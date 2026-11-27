// Linking, consent, the diary and deletion requests.
import { Router } from 'express';
import { z } from 'zod';
import { get, all, run, insert, update, tx } from '../db/index.js';
import { parse, fail, intParam, now, audit, limiter } from '../lib/util.js';
import { requireUser, destroySession } from '../auth/session.js';
import { requireChild } from '../auth/authorize.js';
import { enqueue } from '../jobs/queue.js';
import { summarise, translationOf, deleteNoteFiles } from '../services/notes.js';
import { todayIst, addDays } from '../nlp/dates.js';
import { LANG_CODES } from '../../client/lib/languages.js';
import { TAG_TYPES } from '../nlp/tags.js';

export const router = Router();
router.use(['/links', '/children', '/privacy'], requireUser);

router.post('/links/request', limiter({ max: 20, windowMs: 3_600_000, key: (req) => `link:${req.user?.id}` }), (req, res) => {
  const body = parse(z.object({
    token: z.string().min(10).max(40),
    relation: z.string().trim().max(40).optional(),
    readLang: z.enum(LANG_CODES).optional(),
  }), req.body);
  if (get('SELECT 1 FROM retired_token WHERE token = ?', body.token)) fail(410, 'qr_inactive');
  const student = get('SELECT * FROM student WHERE token = ? AND active = 1', body.token) || fail(404, 'qr_not_found');
  const existing = get('SELECT * FROM guardian_link WHERE student_id = ? AND user_id = ?', student.id, req.user.id);
  if (existing && ['active', 'pending'].includes(existing.status)) {
    return res.json({ linkId: existing.id, status: existing.status });
  }
  const matches = Boolean(
    (student.parent_phone && student.parent_phone === req.user.phone)
    || (student.parent_email && student.parent_email === req.user.email),
  );
  const status = matches ? 'active' : 'pending';
  let linkId = existing?.id;
  if (existing) {
    update('guardian_link', existing.id, { status, relation: body.relation, read_lang: body.readLang, auto_verified: matches ? 1 : 0 });
  } else {
    linkId = insert('guardian_link', {
      student_id: student.id, user_id: req.user.id, relation: body.relation || 'parent',
      read_lang: body.readLang || req.user.ui_lang, status, auto_verified: matches ? 1 : 0, created_at: now(),
    });
  }
  audit(req.user.id, matches ? 'link.auto' : 'link.request', { schoolId: student.school_id, entity: 'student', entityId: student.id });
  if (!matches) enqueue('notify_approval', { linkId });
  res.status(201).json({ linkId, status });
});

const ownLink = (req) =>
  get('SELECT * FROM guardian_link WHERE id = ? AND user_id = ?', intParam(req.params.id), req.user.id) || fail(403, 'forbidden');

router.post('/links/:id/consent', (req, res) => {
  const link = ownLink(req);
  if (link.status !== 'active') fail(409, 'link_not_active');
  const { readLang } = parse(z.object({ readLang: z.enum(LANG_CODES).optional() }), req.body);
  update('guardian_link', link.id, { consent_at: link.consent_at || now(), read_lang: readLang || link.read_lang });
  audit(req.user.id, 'consent.given', { entity: 'guardian_link', entityId: link.id });
  res.json({ ok: true });
});

router.patch('/links/:id', (req, res) => {
  const link = ownLink(req);
  const { readLang } = parse(z.object({ readLang: z.enum(LANG_CODES) }), req.body);
  update('guardian_link', link.id, { read_lang: readLang });
  res.json({ ok: true });
});

const notesForChild = (studentId, { before = null, limit = 20 } = {}) =>
  all(
    `SELECT n.* FROM note n JOIN note_recipient nr ON nr.note_id = n.id AND nr.student_id = ?
     WHERE n.kind = 'teacher_note' AND n.published_at IS NOT NULL AND (? IS NULL OR n.published_at < ?)
     ORDER BY n.published_at DESC LIMIT ?`,
    studentId, before, before, limit,
  );

function diaryEntry(note, studentId, userId, readLang) {
  const base = summarise(note);
  const translation = readLang !== base.lang ? translationOf(note.id, readLang) : null;
  const today = todayIst();
  const due = base.tags.map((t) => t.dueDate).filter(Boolean).sort();
  return {
    ...base,
    shown: translation?.text || base.text,
    translated: Boolean(translation),
    heard: Boolean(get('SELECT 1 FROM listen_receipt WHERE note_id = ? AND student_id = ? AND user_id = ?', note.id, studentId, userId)),
    nextDue: due.find((d) => d >= today) || null,
    state: due.some((d) => d >= today) ? 'pending' : 'done',
    replies: get(`SELECT COUNT(*) AS n FROM note WHERE parent_note_id = ? AND published_at IS NOT NULL`, note.id).n,
  };
}

router.get('/children/:id/notes', (req, res) => {
  const studentId = intParam(req.params.id);
  const link = requireChild(req.user, studentId);
  const query = parse(z.object({
    tag: z.enum(TAG_TYPES).optional(),
    status: z.enum(['pending', 'done']).optional(),
    cursor: z.string().max(40).optional(),
  }), req.query);
  const readLang = link.read_lang || req.user.ui_lang || 'en';
  const page = 20;
  // Filtering happens after loading, so read further back when a filter is on.
  const rows = notesForChild(studentId, { before: query.cursor || null, limit: query.tag || query.status ? 200 : page });
  const notes = rows
    .map((n) => diaryEntry(n, studentId, req.user.id, readLang))
    .filter((n) => (!query.tag || n.tags.some((t) => t.type === query.tag)) && (!query.status || n.state === query.status));
  res.json({
    readLang,
    today: todayIst(),
    notes,
    nextCursor: !query.tag && !query.status && rows.length === page ? rows.at(-1).published_at : null,
  });
});

/** "This week": what arrived in the last seven days and what is due in the next seven. */
router.get('/children/:id/summary', (req, res) => {
  const studentId = intParam(req.params.id);
  const link = requireChild(req.user, studentId);
  const today = todayIst();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const entries = notesForChild(studentId, { limit: 100 })
    .map((n) => diaryEntry(n, studentId, req.user.id, link.read_lang || req.user.ui_lang || 'en'));
  const due = entries
    .flatMap((n) => n.tags.filter((t) => t.dueDate >= today && t.dueDate <= addDays(today, 7))
      .map((t) => ({ noteId: n.id, type: t.type, subject: t.subject, dueDate: t.dueDate })))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  res.json({
    today,
    newNotes: entries.filter((n) => n.publishedAt >= since).length,
    unheard: entries.filter((n) => !n.heard).length,
    due,
  });
});

/** Removes this parent's links, receipts, replies and notification subscriptions (spec 13). */
router.post('/privacy/delete-request', (req, res) => {
  const { confirm } = parse(z.object({ confirm: z.literal(true) }), req.body);
  if (!confirm) fail(400, 'invalid_input');
  const replies = all(`SELECT id, audio_path FROM note WHERE author_user_id = ? AND kind = 'parent_reply'`, req.user.id);
  const schools = all(
    `SELECT DISTINCT s.school_id AS id FROM guardian_link gl JOIN student s ON s.id = gl.student_id WHERE gl.user_id = ?`, req.user.id,
  );
  deleteNoteFiles(replies);
  tx(() => {
    for (const reply of replies) run('DELETE FROM note WHERE id = ?', reply.id);
    run('DELETE FROM listen_receipt WHERE user_id = ?', req.user.id);
    run('DELETE FROM guardian_link WHERE user_id = ?', req.user.id);
    run('DELETE FROM push_subscription WHERE user_id = ?', req.user.id);
    for (const school of schools) audit(req.user.id, 'privacy.delete', { schoolId: school.id, entity: 'user', entityId: req.user.id });
  });
  destroySession(req, res);
  res.json({ ok: true });
});
