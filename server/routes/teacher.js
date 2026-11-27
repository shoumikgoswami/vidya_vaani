// Classes, students, QR codes, approvals, the voice inbox and form filling.
import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { get, all, run, insert, update, tx } from '../db/index.js';
import { parse, fail, intParam, normalizePhone, normalizeEmail, randomToken, now, audit } from '../lib/util.js';
import { requireUser } from '../auth/session.js';
import {
  requireClassManager, requireStudentManager, requireApprover, teachingMembership, membershipsFor, adminMembership,
} from '../auth/authorize.js';
import { userByPhone, userByEmail, autoLinkGuardian } from '../auth/users.js';
import { similarNames, nameKey } from '../nlp/names.js';
import { parsePerson, parseList } from '../nlp/formfill.js';
import { lexicon } from '../nlp/text.js';
import { enqueue } from '../jobs/queue.js';
import { pushNewNote } from '../jobs/handlers.js';
import { completeJson, llmAvailable } from '../providers/llm.js';
import { transcribe } from '../providers/asr.js';
import { audioUpload, summarise, heardSummary, recipientsOf, deleteNoteFiles, presentNote } from '../services/notes.js';

export const router = Router();
router.use(['/classes', '/students', '/qr', '/approvals', '/inbox', '/formfill', '/school-qr'], requireUser);

export const stickerUrl = (token) => `${config.publicBaseUrl}/s/${token}`;
export const qrSvg = (text) => QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });

const pendingLinks = (classId) =>
  all(
    `SELECT gl.id AS linkId, gl.relation, gl.created_at AS createdAt, s.id AS studentId, s.name AS studentName,
       u.name AS parentName, u.phone, u.email
     FROM guardian_link gl JOIN student s ON s.id = gl.student_id JOIN user u ON u.id = gl.user_id
     WHERE s.class_id = ? AND gl.status = 'pending' ORDER BY gl.created_at`,
    classId,
  );

const studentsOf = (classId) =>
  all(
    `SELECT s.id, s.name, s.roll_no AS rollNo, s.parent_phone AS parentPhone, s.parent_email AS parentEmail, s.token,
       (SELECT COUNT(*) FROM guardian_link gl WHERE gl.student_id = s.id AND gl.status = 'active') AS guardians
     FROM student s WHERE s.class_id = ? AND s.active = 1 ORDER BY CAST(s.roll_no AS INTEGER), s.name`,
    classId,
  );

/** The classes this person can open: assigned ones for teachers, all of the school for admins. */
export function visibleClasses(user, schoolId) {
  const userId = user.id;
  const isAdmin = Boolean(adminMembership(user, schoolId));
  return all('SELECT * FROM class WHERE school_id = ? ORDER BY academic_year DESC, CAST(name AS INTEGER), name, section', schoolId)
    .map((cls) => ({ cls, teaching: teachingMembership(userId, cls) }))
    .filter((x) => isAdmin || x.teaching)
    .map(({ cls, teaching }) => ({
      id: cls.id,
      name: cls.name,
      section: cls.section,
      academicYear: cls.academic_year,
      classTeacherId: cls.class_teacher_id,
      teaches: Boolean(teaching),
      isClassTeacher: Boolean(teaching && cls.class_teacher_id === teaching.id),
      students: get('SELECT COUNT(*) AS n FROM student WHERE class_id = ? AND active = 1', cls.id).n,
      pending: pendingLinks(cls.id).length,
    }));
}

router.get('/classes/:id', (req, res) => {
  const { cls, membership: m } = requireClassManager(req.user, intParam(req.params.id));
  const teaches = Boolean(teachingMembership(req.user.id, cls));
  const school = get('SELECT id, name, qr_mode AS qrMode FROM school WHERE id = ?', cls.school_id);
  const isClassTeacher = cls.class_teacher_id === m.id;
  const approver = isClassTeacher || Boolean(adminMembership(req.user, cls.school_id));
  const notes = all(
    `SELECT * FROM note WHERE class_id = ? AND kind = 'teacher_note' AND (author_user_id = ? OR (published_at IS NOT NULL AND ?))
     ORDER BY created_at DESC LIMIT 40`,
    cls.id, req.user.id, isClassTeacher ? 1 : 0,
  ).map((note) => ({ ...summarise(note), heard: heardSummary(note.id), recipients: recipientsOf(note.id).map((r) => r.name) }));
  res.json({
    class: { id: cls.id, name: cls.name, section: cls.section, academicYear: cls.academic_year, teaches, isClassTeacher },
    school,
    students: studentsOf(cls.id),
    approvals: approver ? pendingLinks(cls.id) : [],
    notes,
  });
});

router.get('/classes/:id/students', (req, res) => {
  const { cls } = requireClassManager(req.user, intParam(req.params.id));
  res.json({ students: studentsOf(cls.id) });
});

const studentInput = z.object({
  name: z.string().trim().min(1).max(80),
  parentPhone: z.string().max(40).nullish(),
  parentEmail: z.string().max(120).nullish(),
  rollNo: z.coerce.string().max(10).nullish(),
});

function linkExistingParents(student) {
  for (const [value, find, key] of [[student.parent_phone, userByPhone, 'phones'], [student.parent_email, userByEmail, 'emails']]) {
    const user = value && find(value);
    if (user) autoLinkGuardian(user.id, { [key]: [value] });
  }
}

router.post('/classes/:id/students', (req, res) => {
  const { cls } = requireClassManager(req.user, intParam(req.params.id));
  const body = parse(z.object({ students: z.array(studentInput).min(1).max(100), force: z.boolean().optional() }), req.body);
  const created = [];
  const duplicates = [];
  const invalid = [];

  tx(() => {
    for (const input of body.students) {
      const phone = input.parentPhone ? normalizePhone(input.parentPhone) : null;
      const email = input.parentEmail ? normalizeEmail(input.parentEmail) : null;
      if ((input.parentPhone && !phone) || (input.parentEmail && !email)) {
        invalid.push({ ...input, reason: input.parentPhone && !phone ? 'phone' : 'email' });
        continue;
      }
      if (!body.force) {
        const existing = studentsOf(cls.id).filter((s) => similarNames(s.name, input.name));
        if (existing.length) {
          duplicates.push({ input, existing: existing.map((s) => ({ id: s.id, name: s.name })) });
          continue;
        }
      }
      const id = insert('student', {
        school_id: cls.school_id, class_id: cls.id, name: input.name, name_normalised: nameKey(input.name),
        roll_no: input.rollNo || null, parent_phone: phone, parent_email: email, token: randomToken(), created_at: now(),
      });
      insert('student_history', { student_id: id, class_id: cls.id, academic_year: cls.academic_year, from_date: now() });
      linkExistingParents(get('SELECT * FROM student WHERE id = ?', id));
      created.push({ id, name: input.name });
    }
  });
  if (created.length) audit(req.user.id, 'student.add', { schoolId: cls.school_id, entity: 'class', entityId: cls.id, meta: { count: created.length } });
  res.status(created.length ? 201 : 200).json({ created, duplicates, invalid });
});

router.patch('/students/:id', (req, res) => {
  const { student } = requireStudentManager(req.user, intParam(req.params.id));
  const body = parse(studentInput.partial().extend({ active: z.boolean().optional() }), req.body);
  const patch = { name: body.name, roll_no: body.rollNo === undefined ? undefined : body.rollNo || null };
  if (body.name) patch.name_normalised = nameKey(body.name);
  if (body.parentPhone !== undefined) {
    patch.parent_phone = body.parentPhone ? normalizePhone(body.parentPhone) || fail(400, 'phone_invalid') : null;
  }
  if (body.parentEmail !== undefined) {
    patch.parent_email = body.parentEmail ? normalizeEmail(body.parentEmail) || fail(400, 'email_invalid') : null;
  }
  if (body.active !== undefined) patch.active = body.active ? 1 : 0;
  update('student', student.id, patch);
  linkExistingParents(get('SELECT * FROM student WHERE id = ?', student.id));
  res.json({ ok: true });
});

/** Deleting a child's data is an admin action (spec 13). */
router.delete('/students/:id', (req, res) => {
  const student = get('SELECT * FROM student WHERE id = ?', intParam(req.params.id)) || fail(404, 'student_not_found');
  if (!adminMembership(req.user, student.school_id)) fail(403, 'forbidden');
  const onlyTheirs = all(
    `SELECT n.id, n.audio_path FROM note n JOIN note_recipient nr ON nr.note_id = n.id AND nr.student_id = ?
     WHERE NOT EXISTS (SELECT 1 FROM note_recipient o WHERE o.note_id = n.id AND o.student_id != ?)`,
    student.id, student.id,
  );
  deleteNoteFiles(onlyTheirs);
  tx(() => {
    for (const note of onlyTheirs) run('DELETE FROM note WHERE id = ?', note.id);
    run('DELETE FROM student WHERE id = ?', student.id);
  });
  audit(req.user.id, 'student.delete', { schoolId: student.school_id, entity: 'student', entityId: student.id });
  res.json({ ok: true });
});

router.post('/students/:id/rotate-token', (req, res) => {
  const { student } = requireStudentManager(req.user, intParam(req.params.id));
  const token = randomToken();
  tx(() => {
    insert('retired_token', { token: student.token, student_id: student.id, retired_at: now() });
    update('student', student.id, { token, token_rotated_at: now() });
  });
  audit(req.user.id, 'token.rotate', { schoolId: student.school_id, entity: 'student', entityId: student.id });
  res.json({ token });
});

router.get('/classes/:id/stickers', async (req, res) => {
  const { cls } = requireClassManager(req.user, intParam(req.params.id));
  const school = get('SELECT * FROM school WHERE id = ?', cls.school_id);
  const students = await Promise.all(studentsOf(cls.id).map(async (s) => ({
    id: s.id, name: s.name, rollNo: s.rollNo, svg: await qrSvg(stickerUrl(s.token)),
  })));
  res.json({
    school: { name: school.name, qrMode: school.qr_mode, hasLogo: Boolean(school.logo_path), id: school.id },
    className: `${cls.name}${cls.section}`,
    academicYear: cls.academic_year,
    students,
  });
});

router.get('/qr/:token.svg', async (req, res) => {
  const student = get('SELECT * FROM student WHERE token = ?', req.params.token) || fail(404, 'qr_not_found');
  requireStudentManager(req.user, student.id);
  res.type('image/svg+xml').send(await qrSvg(stickerUrl(student.token)));
});

router.get('/school-qr', async (req, res) => {
  const schoolId = intParam(req.query.school);
  if (!membershipsFor(req.user.id).some((m) => m.school_id === schoolId)) fail(403, 'forbidden');
  const school = get('SELECT * FROM school WHERE id = ?', schoolId);
  const url = `${config.publicBaseUrl}/k/${school.school_token}`;
  res.json({ school: { name: school.name, id: school.id, hasLogo: Boolean(school.logo_path) }, url, svg: await qrSvg(url) });
});

router.post('/approvals/:linkId', (req, res) => {
  const { action } = parse(z.object({ action: z.enum(['approve', 'reject']) }), req.body);
  const link = get(
    `SELECT gl.*, s.class_id, s.school_id FROM guardian_link gl JOIN student s ON s.id = gl.student_id WHERE gl.id = ?`,
    intParam(req.params.linkId),
  ) || fail(404, 'link_not_found');
  const { membership: m } = requireApprover(req.user, link.class_id);
  if (link.status !== 'pending') fail(409, 'already_decided');
  update('guardian_link', link.id, { status: action === 'approve' ? 'active' : 'rejected', approved_by: m.id });
  audit(req.user.id, `link.${action}`, { schoolId: link.school_id, entity: 'guardian_link', entityId: link.id });
  if (action === 'approve') enqueue('notify_linked', { linkId: link.id });
  res.json({ ok: true });
});

/* ---------- Voice inbox ---------- */

function inboxFor(userId, classIds) {
  const replies = [];
  for (const classId of classIds) {
    const cls = get('SELECT * FROM class WHERE id = ?', classId);
    const teaching = teachingMembership(userId, cls);
    if (!teaching) continue;
    const rows = all(
      `SELECT n.* FROM note n LEFT JOIN note o ON o.id = n.parent_note_id
       WHERE n.class_id = ? AND n.kind = 'parent_reply' AND n.published_at IS NOT NULL AND (o.author_user_id = ? OR ?)`,
      classId, userId, cls.class_teacher_id === teaching.id ? 1 : 0,
    );
    const me = get('SELECT ui_lang FROM user WHERE id = ?', userId);
    for (const note of rows) {
      const original = note.parent_note_id && get('SELECT * FROM note WHERE id = ?', note.parent_note_id);
      replies.push({
        ...presentNote(note, { viewLang: me.ui_lang || teaching.speak_lang || 'en' }),
        student: recipientsOf(note.id)[0] || null,
        about: original ? summarise(original).text.slice(0, 80) : null,
        heard: Boolean(get('SELECT 1 FROM listen_receipt WHERE note_id = ? AND user_id = ?', note.id, userId)),
        answered: Boolean(get('SELECT 1 FROM note WHERE parent_note_id = ? AND author_user_id = ?', note.id, userId)),
      });
    }
  }
  return replies.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

router.get('/inbox', (req, res) => {
  const classIds = membershipsFor(req.user.id)
    .filter((m) => m.role === 'teacher')
    .flatMap((m) => visibleClasses(req.user, m.school_id).filter((c) => c.teaches).map((c) => c.id));
  res.json({ replies: inboxFor(req.user.id, [...new Set(classIds)]) });
});

router.get('/classes/:id/inbox', (req, res) => {
  const { cls } = requireClassManager(req.user, intParam(req.params.id));
  if (!teachingMembership(req.user.id, cls)) fail(403, 'forbidden');
  res.json({ replies: inboxFor(req.user.id, [cls.id]) });
});

router.post('/classes/:id/nudge-pending', async (req, res) => {
  const { cls } = requireClassManager(req.user, intParam(req.params.id));
  const { noteId } = parse(z.object({ noteId: z.number().int() }), req.body);
  const note = get('SELECT * FROM note WHERE id = ? AND class_id = ?', noteId, cls.id) || fail(404, 'note_not_found');
  await pushNewNote(note.id);
  res.json({ ok: true });
});

/* ---------- Filling forms by voice (spec J1, J2) ---------- */

const personSchema = z.object({
  people: z.array(z.object({
    name: z.string().min(1),
    phone: z.coerce.string().nullable().catch(null).default(null),
    email: z.string().nullable().catch(null).default(null),
    rollNo: z.coerce.string().nullable().catch(null).default(null),
    subjects: z.array(z.string()).catch([]).default([]),
  })).min(1),
});

router.post('/formfill', audioUpload, async (req, res) => {
  const body = parse(z.object({
    kind: z.enum(['student', 'teacher', 'list']),
    text: z.string().max(8000).optional(),
    lang: z.string().max(8).optional(),
  }), req.body);
  if (!membershipsFor(req.user.id).length) fail(403, 'forbidden');

  let spoken = body.text?.trim() || '';
  if (req.file) {
    const file = path.join(os.tmpdir(), `vv-form-${randomToken(10)}`);
    fs.writeFileSync(file, req.file.buffer);
    try {
      spoken = (await transcribe(file, { languageHint: body.lang }))?.text || spoken;
    } catch {
      // The browser's live text, if any, is used instead.
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
  if (!spoken) fail(422, 'nothing_heard');

  if (body.kind === 'list') return res.json({ text: spoken, people: parseList(spoken), provider: 'rules' });

  const rules = parsePerson(spoken);
  if (llmAvailable()) {
    try {
      const { data, model } = await completeJson({
        system: `Extract ${body.kind === 'teacher' ? 'teachers' : 'students and their parent phone numbers'} from speech.
Reply with JSON {"people":[{"name":string,"phone":string|null,"email":string|null,"rollNo":string|null,"subjects":string[]}]}.
Keep names in the script spoken. Subjects must come from: ${Object.keys(lexicon.subjects).join(', ')}.
Never invent a phone number: copy the digits that were said, or use null.`,
        user: spoken,
        schema: personSchema,
        maxTokens: 600,
      });
      // A phone number is only trusted if its digits were actually heard.
      const people = data.people.map((p) => ({
        ...p,
        phone: rules.phone && data.people.length === 1 ? rules.phone : normalizePhone(p.phone),
        email: normalizeEmail(p.email),
      }));
      return res.json({ text: spoken, people, provider: model });
    } catch {
      // Fall through to the rules.
    }
  }
  res.json({ text: spoken, people: rules.name ? [rules] : [], provider: 'rules' });
});
