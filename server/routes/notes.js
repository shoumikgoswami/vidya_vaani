// Recording, confirming, playing, replying and receipts.
import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { get, all, run, update, tx } from '../db/index.js';
import { parse, fail, intParam, parseJson, randomToken, audit, now } from '../lib/util.js';
import { requireUser } from '../auth/session.js';
import { noteAccess, requireTeacherOfClass, linkedRecipients, loadClass } from '../auth/authorize.js';
import { enqueue } from '../jobs/queue.js';
import { markUncertain, pushNewNote } from '../jobs/handlers.js';
import { transcribe } from '../providers/asr.js';
import { translate } from '../providers/translate.js';
import { wordsToDigits } from '../nlp/numbers.js';
import { lexicon } from '../nlp/text.js';
import { isLang, LANG_CODES } from '../../client/lib/languages.js';
import {
  audioUpload, noteFields, createNote, publishNote, presentNote, summarise, recipientsOf, setTags, shownText,
  audioPathOf, deleteNoteFiles, heardSummary, translationOf,
} from '../services/notes.js';
import { TAG_TYPES } from '../nlp/tags.js';

export const router = Router();
router.use('/notes', requireUser);

const readNote = (id) => get('SELECT * FROM note WHERE id = ?', id);

/** The author, or the class teacher, may correct a teacher's note. */
function editable(user, id) {
  const { note, as } = noteAccess(user, intParam(id));
  if (note.kind !== 'teacher_note' || !['author', 'teacher'].includes(as)) fail(403, 'forbidden');
  return note;
}

function readingLanguage(user, links) {
  return links?.[0]?.read_lang || user.ui_lang || 'en';
}

router.post('/notes', audioUpload, (req, res) => {
  const body = parse(noteFields.extend({
    class_id: z.coerce.number().int(),
    recipients: z.string().max(2000),
    publish: z.string().optional(),
  }), req.body);
  const { cls, membership } = requireTeacherOfClass(req.user, body.class_id);
  const students = all('SELECT id FROM student WHERE class_id = ? AND active = 1', cls.id).map((s) => s.id);
  const wanted = body.recipients === 'class' ? students : parseJson(body.recipients, []).map(Number);
  if (!wanted.length || wanted.some((id) => !students.includes(id))) fail(400, 'recipients_invalid');
  const fields = { ...body, lang_hint: body.lang_hint || membership.speak_lang || undefined };
  const { note, duplicate } = createNote({
    file: req.file, fields, classRow: cls, authorId: req.user.id, kind: 'teacher_note',
    recipients: [...new Set(wanted)], publish: body.publish === '1',
  });
  res.status(duplicate ? 200 : 201).json({ id: note.id, status: note.status, duplicate });
});

router.get('/notes/:id', (req, res) => {
  const { note, as, links } = noteAccess(req.user, intParam(req.params.id));
  const asked = req.query.lang && isLang(req.query.lang) ? req.query.lang : null;
  const viewLang = asked || readingLanguage(req.user, links);
  const source = shownText(note);

  // A language nobody needed yet is translated the first time someone asks (spec 5.5).
  if (note.published_at && source && viewLang !== note.transcript_lang && !translationOf(note.id, viewLang)) {
    const queued = get(
      `SELECT 1 FROM job WHERE type = 'translate_note' AND status != 'failed' AND json_extract(payload, '$.noteId') = ?`, note.id,
    );
    if (!queued) enqueue('translate_note', { noteId: note.id, langs: [...new Set([viewLang, 'en'])] });
  }

  const forTeacher = as !== 'parent';
  const replies = all(
    `SELECT * FROM note WHERE parent_note_id = ? AND published_at IS NOT NULL ORDER BY created_at`, note.id,
  ).filter((reply) => {
    try {
      return Boolean(noteAccess(req.user, reply.id));
    } catch {
      return false;
    }
  });

  res.json({
    ...presentNote(note, { viewLang, forTeacher }),
    viewer: as,
    myChildren: links?.map((l) => ({ studentId: l.student_id, name: l.student_name })),
    replies: replies.map((r) => ({ ...presentNote(r, { viewLang }), mine: r.author_user_id === req.user.id })),
  });
});

router.get('/notes/:id/status', (req, res) => {
  const { note } = noteAccess(req.user, intParam(req.params.id));
  res.json({ status: note.status, published: Boolean(note.published_at) });
});

router.get('/notes/:id/translation/:lang', async (req, res) => {
  const { note } = noteAccess(req.user, intParam(req.params.id));
  const code = LANG_CODES.includes(req.params.lang) ? req.params.lang : fail(404, 'language_unknown');
  const source = shownText(note);
  if (code === note.transcript_lang) return res.json({ lang: code, text: source, provider: 'original', machineWarning: false });
  let found = translationOf(note.id, code);
  if (!found && source) {
    try {
      const result = await translate(source, note.transcript_lang, [code], { protectTerms: recipientsOf(note.id).map((r) => r.name) });
      if (result[code]) {
        run(
          `INSERT OR REPLACE INTO note_translation (note_id, lang, text, provider, model, machine_warning, created_at)
           VALUES (?,?,?,?,?,?,?)`,
          note.id, code, result[code].text, result[code].provider, result[code].model, result[code].machineWarning ? 1 : 0, now(),
        );
        found = translationOf(note.id, code);
      }
    } catch {
      // Reported to the client as unavailable, with a retry button.
    }
  }
  if (!found) return res.status(404).json({ error: 'translation_unavailable' });
  res.json(found);
});

const tagInput = z.object({
  type: z.enum(TAG_TYPES),
  subject: z.string().max(40).nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces "12 or 2" with the chosen value. */
function settle(text, [a, b], value) {
  if (!text) return text;
  const or = lexicon.or.map(escapeRegex).join('|');
  return wordsToDigits(text).replace(new RegExp(`(?<!\\d)${escapeRegex(a)}\\s+(?:${or})\\s+${escapeRegex(b)}(?!\\d)`, 'iu'), value);
}

router.patch('/notes/:id', (req, res) => {
  const note = editable(req.user, req.params.id);
  const body = parse(z.object({
    transcript: z.string().trim().min(1).max(6000).optional(),
    useRaw: z.boolean().optional(),
    tags: z.array(tagInput).max(12).optional(),
    recipients: z.array(z.number().int()).min(1).max(200).optional(),
    resolve: z.object({ index: z.number().int().min(0), value: z.string().max(20) }).optional(),
  }), req.body);

  let textChanged = false;
  tx(() => {
    if (body.transcript !== undefined && body.transcript !== shownText(note)) {
      update('note', note.id, {
        transcript_clean: body.transcript,
        transcript_raw: note.transcript_raw || body.transcript,
        transcript_lang: note.transcript_lang || note.lang_hint,
        mismatch: 0, edited: 1, words: null,
      });
      textChanged = true;
    }
    if (body.useRaw) {
      update('note', note.id, { transcript_clean: null, edited: 1 });
      textChanged = true;
    }
    if (body.resolve) {
      const doubts = parseJson(note.ambiguities, []);
      const doubt = doubts[body.resolve.index];
      if (!doubt || !doubt.options.includes(body.resolve.value)) fail(400, 'invalid_input');
      const fresh = readNote(note.id);
      update('note', note.id, {
        transcript_raw: settle(fresh.transcript_raw, doubt.options, body.resolve.value),
        transcript_clean: settle(fresh.transcript_clean, doubt.options, body.resolve.value),
        ambiguities: JSON.stringify(doubts.filter((_d, i) => i !== body.resolve.index)),
        words: null, edited: 1,
      });
      textChanged = true;
    }
    if (body.tags) setTags(note.id, body.tags.map((t) => ({ ...t, source: 'teacher' })));
    if (body.recipients) {
      const students = all('SELECT id FROM student WHERE class_id = ? AND active = 1', note.class_id).map((s) => s.id);
      if (note.published_at || body.recipients.some((id) => !students.includes(id))) fail(400, 'recipients_invalid');
      run('DELETE FROM note_recipient WHERE note_id = ?', note.id);
      for (const id of new Set(body.recipients)) run('INSERT INTO note_recipient (note_id, student_id) VALUES (?,?)', note.id, id);
    }
    if (textChanged) run('DELETE FROM note_translation WHERE note_id = ?', note.id);
  });
  if (textChanged && note.published_at) enqueue('translate_note', { noteId: note.id });
  res.json(presentNote(readNote(note.id), { forTeacher: true }));
});

router.post('/notes/:id/publish', (req, res) => {
  const { note, as } = noteAccess(req.user, intParam(req.params.id));
  if (as !== 'author' || note.kind !== 'teacher_note') fail(403, 'forbidden');
  const body = parse(z.object({ captureMs: z.number().int().min(0).max(3_600_000).optional() }), req.body);
  const first = publishNote(note.id, body);
  res.json({ ok: true, alreadySaved: !first, recipients: recipientsOf(note.id).length });
});

/** Re-record: an unsaved note is thrown away. Saved notes stay in the children's diaries. */
router.delete('/notes/:id', (req, res) => {
  const { note, as } = noteAccess(req.user, intParam(req.params.id));
  if (as !== 'author' || note.published_at) fail(403, 'forbidden');
  deleteNoteFiles([note]);
  run('DELETE FROM note WHERE id = ?', note.id);
  res.json({ ok: true });
});

router.post('/notes/:id/retranscribe', (req, res) => {
  const note = editable(req.user, req.params.id);
  const { lang } = parse(z.object({ lang: z.enum([...LANG_CODES, 'auto']) }), req.body);
  tx(() => {
    update('note', note.id, {
      lang_hint: lang === 'auto' ? null : lang, status: 'uploaded', edited: 0,
      transcript_raw: null, transcript_clean: null, transcript_lang: null, words: null, llm_model: null,
    });
    // A new language makes the browser's old live text meaningless.
    if (lang !== note.lang_hint) update('note', note.id, { browser_preview_text: null });
    run(`DELETE FROM note_tag WHERE note_id = ?`, note.id);
    run(`DELETE FROM note_translation WHERE note_id = ?`, note.id);
    run(`DELETE FROM job WHERE type = 'process_note' AND json_extract(payload, '$.noteId') = ?`, note.id);
  });
  enqueue('process_note', { noteId: note.id });
  res.json({ ok: true });
});

/** The teacher taps an amber word and says it again. */
router.post('/notes/:id/respeak', audioUpload, async (req, res) => {
  const note = editable(req.user, req.params.id);
  const body = parse(z.object({ wordIndex: z.coerce.number().int().min(0), text: z.string().max(200).optional() }), req.body);
  const words = parseJson(note.words, []);
  const target = words[body.wordIndex] || fail(400, 'invalid_input');

  let heard = '';
  if (req.file) {
    const file = path.join(os.tmpdir(), `vv-word-${randomToken(10)}`);
    fs.writeFileSync(file, req.file.buffer);
    try {
      heard = (await transcribe(file, { languageHint: note.transcript_lang || note.lang_hint }))?.text || '';
    } catch {
      // The browser's live text, sent with the request, is used instead.
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
  heard = (heard || body.text || '').replace(/[.।?!]+$/u, '').trim();
  if (!heard) fail(422, 'nothing_heard');

  const replaceWord = (text) => text && text.replace(target.w, heard);
  words[body.wordIndex] = { w: heard, conf: null, uncertain: false };
  update('note', note.id, {
    words: JSON.stringify(words),
    transcript_raw: replaceWord(note.transcript_raw),
    transcript_clean: replaceWord(note.transcript_clean),
    edited: 1,
  });
  run('DELETE FROM note_translation WHERE note_id = ?', note.id);
  if (note.published_at) enqueue('translate_note', { noteId: note.id });
  res.json(presentNote(readNote(note.id), { forTeacher: true }));
});

router.get('/notes/:id/receipts', (req, res) => {
  const { note, as } = noteAccess(req.user, intParam(req.params.id));
  if (as === 'parent') fail(403, 'forbidden');
  const students = all(
    `SELECT s.id, s.name,
       (SELECT MIN(lr.first_played_at) FROM listen_receipt lr
         WHERE lr.note_id = nr.note_id AND lr.student_id = s.id AND lr.user_id != ?) AS heardAt,
       (SELECT COUNT(*) FROM guardian_link gl WHERE gl.student_id = s.id AND gl.status = 'active') AS guardians
     FROM note_recipient nr JOIN student s ON s.id = nr.student_id WHERE nr.note_id = ? ORDER BY s.name`,
    note.author_user_id ?? 0, note.id,
  );
  res.json({ ...heardSummary(note.id), students });
});

const lastNudge = new Map();

router.post('/notes/:id/nudge', async (req, res) => {
  const note = editable(req.user, req.params.id);
  if (!note.published_at) fail(400, 'not_saved');
  if (Date.now() - (lastNudge.get(note.id) || 0) < 3_600_000) fail(429, 'nudged_recently');
  lastNudge.set(note.id, Date.now());
  const heard = new Set(all('SELECT student_id FROM listen_receipt WHERE note_id = ?', note.id).map((r) => r.student_id));
  await pushNewNote(note.id, { userFilter: (g) => !heard.has(g.student_id) });
  res.json({ ok: true, reminded: recipientsOf(note.id).filter((r) => !heard.has(r.id)).length });
});

/** Playing a note sends the "heard" receipt automatically. */
router.post('/notes/:id/listened', (req, res) => {
  const { note, as, links } = noteAccess(req.user, intParam(req.params.id));
  if (!note.published_at) return res.json({ ok: true });
  let studentIds = [];
  if (as === 'parent') studentIds = links.map((l) => l.student_id);
  else if (note.kind === 'parent_reply') studentIds = recipientsOf(note.id).map((r) => r.id);
  for (const studentId of studentIds) {
    run(
      `INSERT INTO listen_receipt (note_id, student_id, user_id, first_played_at, play_count) VALUES (?,?,?,?,1)
       ON CONFLICT(note_id, student_id, user_id) DO UPDATE SET play_count = play_count + 1`,
      note.id, studentId, req.user.id, now(),
    );
  }
  res.json({ ok: true, recorded: studentIds.length });
});

router.post('/notes/:id/reply', audioUpload, (req, res) => {
  const { note, as, links } = noteAccess(req.user, intParam(req.params.id));
  if (!note.published_at) fail(400, 'not_saved');
  const body = parse(noteFields.extend({ student_id: z.coerce.number().int().optional() }), req.body);
  const cls = loadClass(note.class_id);
  const recipients = recipientsOf(note.id).map((r) => r.id);

  let kind;
  let students;
  const mine = linkedRecipients(req.user.id, note.id);
  if (as === 'parent' || (note.kind === 'parent_reply' && as === 'author' && mine.length)) {
    kind = 'parent_reply';
    const own = (links || mine).map((l) => l.student_id);
    students = [own.includes(body.student_id) ? body.student_id : own[0]];
  } else {
    // A teacher answers a parent, or adds to their own note.
    requireTeacherOfClass(req.user, note.class_id);
    kind = 'teacher_note';
    students = recipients;
  }
  const fields = { ...body, lang_hint: body.lang_hint || req.user.ui_lang || undefined };
  const { note: reply, duplicate } = createNote({
    file: req.file, fields, classRow: cls, authorId: req.user.id, kind, recipients: students,
    parentNoteId: note.id, publish: true,
  });
  audit(req.user.id, 'note.reply', { schoolId: cls.school_id, entity: 'note', entityId: reply.id });
  res.status(duplicate ? 200 : 201).json({ id: reply.id, duplicate });
});

router.get('/notes/:id/audio', (req, res) => {
  const { note } = noteAccess(req.user, intParam(req.params.id));
  const file = audioPathOf(note);
  if (!file || !fs.existsSync(file)) fail(404, 'audio_missing');
  res.sendFile(file, { headers: { 'Content-Type': note.audio_mime, 'Cache-Control': 'private, max-age=86400' } });
});

router.get('/drafts', requireUser, (req, res) => {
  const rows = all(
    `SELECT * FROM note WHERE author_user_id = ? AND kind = 'teacher_note' AND published_at IS NULL ORDER BY created_at DESC LIMIT 20`,
    req.user.id,
  );
  res.json({ drafts: rows.map((n) => ({ ...summarise(n), recipients: recipientsOf(n.id).map((r) => r.name) })) });
});
