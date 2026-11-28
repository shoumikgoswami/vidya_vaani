// Classes, students, QR codes, approvals, the voice inbox and form filling.
import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { get, all, run, insert, update, tx, byNumber } from '../db/index.js';
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
import { aiAllowedFor } from '../services/demo-budget.js';
import { transcribe } from '../providers/asr.js';
import { audioUpload, summarise, summariseAll, heardByNote, recipientsByNote, recipientsOf, presentNote } from '../services/notes.js';

export const router = Router();
router.use(['/classes', '/students', '/qr', '/approvals', '/inbox', '/formfill', '/school-qr'], requireUser);

export const stickerUrl = (token) => `${config.publicBaseUrl}/s/${token}`;
export const qrSvg = (text) => QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });

const pendingLinks = (classId) =>
  all(
    `SELECT gl.id AS "linkId", gl.relation, gl.created_at AS "createdAt", s.id AS "studentId", s.name AS "studentName",
       u.name AS "parentName", u.phone, u.email
     FROM guardian_link gl JOIN student s ON s.id = gl.student_id JOIN app_user u ON u.id = gl.user_id
     WHERE s.class_id = ? AND gl.status = 'pending' ORDER BY gl.created_at`,
    classId,
  );

const studentsOf = (classId) =>
  all(
    `SELECT s.id, s.name, s.roll_no AS "rollNo", s.parent_phone AS "parentPhone", s.parent_email AS "parentEmail", s.token,
       (SELECT COUNT(*) FROM guardian_link gl WHERE gl.student_id = s.id AND gl.status = 'active') AS guardians
     FROM student s WHERE s.class_id = ? AND s.active = 1 ORDER BY ${byNumber('s.roll_no')}, s.name`,
    classId,
  );

/** The classes this person can open: assigned ones for teachers, all of the school for admins. */
export async function visibleClasses(user, schoolId) {
  const isAdmin = Boolean(await adminMembership(user, schoolId));
  const classes = await all(`SELECT * FROM class WHERE school_id = ? ORDER BY academic_year DESC, ${byNumber('name')}, name, section`, schoolId);
  const taught = await Promise.all(classes.map(async (cls) => ({ cls, teaching: await teachingMembership(user.id, cls) })));
  return Promise.all(taught
    .filter((x) => isAdmin || x.teaching)
    .map(async ({ cls, teaching }) => ({
      id: cls.id,
      name: cls.name,
      section: cls.section,
      academicYear: cls.academic_year,
      classTeacherId: cls.class_teacher_id,
      teaches: Boolean(teaching),
      isClassTeacher: Boolean(teaching && cls.class_teacher_id === teaching.id),
      students: (await get('SELECT COUNT(*) AS n FROM student WHERE class_id = ? AND active = 1', cls.id)).n,
      pending: (await pendingLinks(cls.id)).length,
    })));
}

router.get('/classes/:id', async (req, res) => {
  const { cls, membership: m } = await requireClassManager(req.user, intParam(req.params.id));
  const teaches = Boolean(await teachingMembership(req.user.id, cls));
  const school = await get('SELECT id, name, qr_mode AS "qrMode" FROM school WHERE id = ?', cls.school_id);
  const isClassTeacher = cls.class_teacher_id === m.id;
  const approver = isClassTeacher || Boolean(await adminMembership(req.user, cls.school_id));
  const rows = await all(
    `SELECT * FROM note WHERE class_id = ? AND kind = 'teacher_note' AND (author_user_id = ? OR (published_at IS NOT NULL AND ?::int = 1))
     ORDER BY created_at DESC LIMIT 40`,
    cls.id, req.user.id, isClassTeacher ? 1 : 0,
  );
  const ids = rows.map((n) => n.id);
  const [summaries, heard, names] = await Promise.all([summariseAll(rows), heardByNote(ids), recipientsByNote(ids)]);
  const notes = summaries.map((n) => ({
    ...n, heard: heard.get(n.id) || { total: 0, heard: 0 }, recipients: (names.get(n.id) || []).map((r) => r.name),
  }));
  res.json({
    class: { id: cls.id, name: cls.name, section: cls.section, academicYear: cls.academic_year, teaches, isClassTeacher },
    school,
    students: await studentsOf(cls.id),
    approvals: approver ? await pendingLinks(cls.id) : [],
    notes,
  });
});

router.get('/classes/:id/students', async (req, res) => {
  const { cls } = await requireClassManager(req.user, intParam(req.params.id));
  res.json({ students: await studentsOf(cls.id) });
});

const studentInput = z.object({
  name: z.string().trim().min(1).max(80),
  parentPhone: z.string().max(40).nullish(),
  parentEmail: z.string().max(120).nullish(),
  rollNo: z.coerce.string().max(10).nullish(),
});

async function linkExistingParents(student) {
  for (const [value, find, key] of [[student.parent_phone, userByPhone, 'phones'], [student.parent_email, userByEmail, 'emails']]) {
    const user = value && await find(value);
    if (user) await autoLinkGuardian(user.id, { [key]: [value] });
  }
}

router.post('/classes/:id/students', async (req, res) => {
  const { cls } = await requireClassManager(req.user, intParam(req.params.id));
  const body = parse(z.object({ students: z.array(studentInput).min(1).max(100), force: z.boolean().optional() }), req.body);
  const created = [];
  const duplicates = [];
  const invalid = [];

  await tx(async () => {
    for (const input of body.students) {
      const phone = input.parentPhone ? normalizePhone(input.parentPhone) : null;
      const email = input.parentEmail ? normalizeEmail(input.parentEmail) : null;
      if ((input.parentPhone && !phone) || (input.parentEmail && !email)) {
        invalid.push({ ...input, reason: input.parentPhone && !phone ? 'phone' : 'email' });
        continue;
      }
      if (!body.force) {
        const existing = (await studentsOf(cls.id)).filter((s) => similarNames(s.name, input.name));
        if (existing.length) {
          duplicates.push({ input, existing: existing.map((s) => ({ id: s.id, name: s.name })) });
          continue;
        }
      }
      const id = await insert('student', {
        school_id: cls.school_id, class_id: cls.id, name: input.name, name_normalised: nameKey(input.name),
        roll_no: input.rollNo || null, parent_phone: phone, parent_email: email, token: randomToken(), created_at: now(),
      });
      await insert('student_history', { student_id: id, class_id: cls.id, academic_year: cls.academic_year, from_date: now() });
      await linkExistingParents(await get('SELECT * FROM student WHERE id = ?', id));
      created.push({ id, name: input.name });
    }
  });
  if (created.length) await audit(req.user.id, 'student.add', { schoolId: cls.school_id, entity: 'class', entityId: cls.id, meta: { count: created.length } });
  res.status(created.length ? 201 : 200).json({ created, duplicates, invalid });
});

router.patch('/students/:id', async (req, res) => {
  const { student } = await requireStudentManager(req.user, intParam(req.params.id));
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
  await update('student', student.id, patch);
  await linkExistingParents(await get('SELECT * FROM student WHERE id = ?', student.id));
  res.json({ ok: true });
});

/** Deleting a child's data is an admin action (spec 13). */
router.delete('/students/:id', async (req, res) => {
  const student = await get('SELECT * FROM student WHERE id = ?', intParam(req.params.id)) || fail(404, 'student_not_found');
  if (!await adminMembership(req.user, student.school_id)) fail(403, 'forbidden');
  const onlyTheirs = await all(
    `SELECT n.id FROM note n JOIN note_recipient nr ON nr.note_id = n.id AND nr.student_id = ?
     WHERE NOT EXISTS (SELECT 1 FROM note_recipient o WHERE o.note_id = n.id AND o.student_id != ?)`,
    student.id, student.id,
  );
  await tx(async () => {
    for (const note of onlyTheirs) await run('DELETE FROM note WHERE id = ?', note.id);
    await run('DELETE FROM student WHERE id = ?', student.id);
  });
  await audit(req.user.id, 'student.delete', { schoolId: student.school_id, entity: 'student', entityId: student.id });
  res.json({ ok: true });
});

router.post('/students/:id/rotate-token', async (req, res) => {
  const { student } = await requireStudentManager(req.user, intParam(req.params.id));
  const token = randomToken();
  await tx(async () => {
    await insert('retired_token', { token: student.token, student_id: student.id, retired_at: now() });
    await update('student', student.id, { token, token_rotated_at: now() });
  });
  await audit(req.user.id, 'token.rotate', { schoolId: student.school_id, entity: 'student', entityId: student.id });
  res.json({ token });
});

router.get('/classes/:id/stickers', async (req, res) => {
  const { cls } = await requireClassManager(req.user, intParam(req.params.id));
  const school = await get('SELECT * FROM school WHERE id = ?', cls.school_id);
  const students = await Promise.all((await studentsOf(cls.id)).map(async (s) => ({
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
  const student = await get('SELECT * FROM student WHERE token = ?', req.params.token) || fail(404, 'qr_not_found');
  await requireStudentManager(req.user, student.id);
  res.type('image/svg+xml').send(await qrSvg(stickerUrl(student.token)));
});

router.get('/school-qr', async (req, res) => {
  const schoolId = intParam(req.query.school);
  if (!(await membershipsFor(req.user.id)).some((m) => m.school_id === schoolId)) fail(403, 'forbidden');
  const school = await get('SELECT * FROM school WHERE id = ?', schoolId);
  const url = `${config.publicBaseUrl}/k/${school.school_token}`;
  res.json({ school: { name: school.name, id: school.id, hasLogo: Boolean(school.logo_path) }, url, svg: await qrSvg(url) });
});

router.post('/approvals/:linkId', async (req, res) => {
  const { action } = parse(z.object({ action: z.enum(['approve', 'reject']) }), req.body);
  const link = await get(
    `SELECT gl.*, s.class_id, s.school_id FROM guardian_link gl JOIN student s ON s.id = gl.student_id WHERE gl.id = ?`,
    intParam(req.params.linkId),
  ) || fail(404, 'link_not_found');
  const { membership: m } = await requireApprover(req.user, link.class_id);
  if (link.status !== 'pending') fail(409, 'already_decided');
  await update('guardian_link', link.id, { status: action === 'approve' ? 'active' : 'rejected', approved_by: m.id });
  await audit(req.user.id, `link.${action}`, { schoolId: link.school_id, entity: 'guardian_link', entityId: link.id });
  if (action === 'approve') await enqueue('notify_linked', { linkId: link.id });
  res.json({ ok: true });
});

/* ---------- Voice inbox ---------- */

async function inboxFor(userId, classIds) {
  const replies = [];
  for (const classId of classIds) {
    const cls = await get('SELECT * FROM class WHERE id = ?', classId);
    const teaching = await teachingMembership(userId, cls);
    if (!teaching) continue;
    const rows = await all(
      `SELECT n.* FROM note n LEFT JOIN note o ON o.id = n.parent_note_id
       WHERE n.class_id = ? AND n.kind = 'parent_reply' AND n.published_at IS NOT NULL AND (o.author_user_id = ? OR ?::int = 1)`,
      classId, userId, cls.class_teacher_id === teaching.id ? 1 : 0,
    );
    const me = await get('SELECT ui_lang FROM app_user WHERE id = ?', userId);
    for (const note of rows) {
      const original = note.parent_note_id && await get('SELECT * FROM note WHERE id = ?', note.parent_note_id);
      replies.push({
        ...await presentNote(note, { viewLang: me.ui_lang || teaching.speak_lang || 'en' }),
        student: (await recipientsOf(note.id))[0] || null,
        about: original ? (await summarise(original)).text.slice(0, 80) : null,
        heard: Boolean(await get('SELECT 1 FROM listen_receipt WHERE note_id = ? AND user_id = ?', note.id, userId)),
        answered: Boolean(await get('SELECT 1 FROM note WHERE parent_note_id = ? AND author_user_id = ?', note.id, userId)),
      });
    }
  }
  return replies.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

router.get('/inbox', async (req, res) => {
  const classIds = new Set();
  for (const m of (await membershipsFor(req.user.id)).filter((x) => x.role === 'teacher')) {
    for (const c of await visibleClasses(req.user, m.school_id)) if (c.teaches) classIds.add(c.id);
  }
  res.json({ replies: await inboxFor(req.user.id, [...classIds]) });
});

router.get('/classes/:id/inbox', async (req, res) => {
  const { cls } = await requireClassManager(req.user, intParam(req.params.id));
  if (!await teachingMembership(req.user.id, cls)) fail(403, 'forbidden');
  res.json({ replies: await inboxFor(req.user.id, [cls.id]) });
});

router.post('/classes/:id/nudge-pending', async (req, res) => {
  const { cls } = await requireClassManager(req.user, intParam(req.params.id));
  const { noteId } = parse(z.object({ noteId: z.number().int() }), req.body);
  const note = await get('SELECT * FROM note WHERE id = ? AND class_id = ?', noteId, cls.id) || fail(404, 'note_not_found');
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
  if (!(await membershipsFor(req.user.id)).length) fail(403, 'forbidden');

  let spoken = body.text?.trim() || '';
  const budget = await aiAllowedFor(req.user.id);
  if (req.file && budget) {
    try {
      spoken = (await transcribe(req.file.buffer, { languageHint: body.lang }))?.text || spoken;
    } catch {
      // The browser's live text, if any, is used instead.
    }
  }
  if (!spoken) fail(422, 'nothing_heard');

  if (body.kind === 'list') return res.json({ text: spoken, people: parseList(spoken), provider: 'rules' });

  const rules = parsePerson(spoken);
  if (llmAvailable() && budget) {
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
