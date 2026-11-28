// School settings, teachers, classes, year-end promotion, metrics and the audit log.
import { Router } from 'express';
import { z } from 'zod';
import { get, all, run, insert, update, tx } from '../db/index.js';
import { parse, fail, intParam, normalizePhone, normalizeEmail, now, audit, parseJson } from '../lib/util.js';
import { requireUser } from '../auth/session.js';
import { requireAdmin, membershipsFor } from '../auth/authorize.js';
import { findOrCreateUser, userByPhone, userByEmail } from '../auth/users.js';
import { otpLoginEnabled } from '../auth/otp.js';
import { providerStatus } from '../providers/status.js';
import { config } from '../config.js';
import { todayIst, addDays } from '../nlp/dates.js';
import { LANG_CODES } from '../../client/lib/languages.js';
import { visibleClasses } from './teacher.js';
import { hasJoined, issueCode } from '../services/teacher-codes.js';

export const router = Router();
router.use(['/school', '/teachers', '/classes', '/metrics', '/audit'], requireUser);

/** Admin routes name the school explicitly: one person can belong to several. */
async function adminSchool(req) {
  const schoolId = intParam(req.query.school ?? req.body?.school);
  await requireAdmin(req.user, schoolId);
  return get('SELECT * FROM school WHERE id = ?', schoolId);
}

const presentSchool = (s) => ({
  id: s.id, name: s.name, address: s.address, qrMode: s.qr_mode, defaultLang: s.default_lang,
  enabledLangs: parseJson(s.enabled_langs, []), academicYear: s.academic_year, retentionYears: s.retention_years,
});

router.get('/school', async (req, res) => res.json(presentSchool(await adminSchool(req))));

router.patch('/school', async (req, res) => {
  const school = await adminSchool(req);
  const body = parse(z.object({
    school: z.coerce.number().optional(),
    name: z.string().trim().min(2).max(120).optional(),
    address: z.string().trim().max(200).optional(),
    qrMode: z.enum(['per_student', 'per_school']).optional(),
    defaultLang: z.enum(LANG_CODES).optional(),
    enabledLangs: z.array(z.enum(LANG_CODES)).min(1).optional(),
    retentionYears: z.number().int().min(0).max(10).optional(),
  }), req.body);
  await update('school', school.id, {
    name: body.name, address: body.address, qr_mode: body.qrMode, default_lang: body.defaultLang,
    enabled_langs: body.enabledLangs && JSON.stringify(body.enabledLangs), retention_years: body.retentionYears,
  });
  await audit(req.user.id, 'school.update', { schoolId: school.id, meta: { fields: Object.keys(body) } });
  res.json(presentSchool(await get('SELECT * FROM school WHERE id = ?', school.id)));
});

/** Everything technical, for the office's Configuration screen. Whether keys are set, never the keys. */
router.get('/school/config', async (req, res) => {
  const school = await adminSchool(req);
  res.json({
    ...providerStatus(),
    ...await technicalFor(school.id),
    system: {
      signIn: config.clerk.enabled ? 'clerk' : otpLoginEnabled() ? 'demo' : 'none',
      database: config.databaseUrl.startsWith('postgres') ? 'hosted' : 'builtin',
      publicBaseUrl: config.publicBaseUrl,
      demoMode: config.demoMode,
      demoAiDailyLimit: config.demoAiDailyLimit,
    },
  });
});

/* ---------- Teachers ---------- */

const teachersOf = async (schoolId) =>
  Promise.all((await all(
    `SELECT m.id, m.user_id, m.active, m.speak_lang AS "speakLang", m.subjects, u.name, u.phone, u.email
     FROM membership m JOIN app_user u ON u.id = m.user_id
     WHERE m.school_id = ? AND m.role = 'teacher' ORDER BY m.active DESC, u.name`,
    schoolId,
  )).map(async ({ user_id: userId, ...t }) => ({
    ...t, active: Boolean(t.active), joined: await hasJoined(userId), subjects: parseJson(t.subjects, []),
  })));

router.get('/teachers', async (req, res) => res.json({ teachers: await teachersOf((await adminSchool(req)).id) }));

const teacherInput = z.object({
  school: z.coerce.number().optional(),
  name: z.string().trim().min(2).max(80),
  phone: z.string().max(40).nullish(),
  email: z.string().max(120).nullish(),
  speakLang: z.enum(LANG_CODES),
  subjects: z.array(z.string().max(40)).max(12).default([]),
});

router.post('/teachers', async (req, res) => {
  const school = await adminSchool(req);
  const body = parse(teacherInput, req.body);
  const phone = body.phone ? normalizePhone(body.phone) || fail(400, 'phone_invalid') : null;
  const email = body.email ? normalizeEmail(body.email) || fail(400, 'email_invalid') : null;
  // The sample office is open to anyone, so it must not find, show or add people who really sign in.
  const visible = (found) => (school.is_demo && found?.clerk_user_id ? undefined : found);
  const held = [await userByPhone(phone), await userByEmail(email)];
  const [byPhone, byEmail] = held.map(visible);
  if (byPhone && byEmail && byPhone.id !== byEmail.id) fail(409, 'phone_email_belong_to_different_people');

  const hidden = held.some((found) => found && !visible(found));
  // A number that belongs to a real account is dropped: the sample teacher is a separate person.
  const user = await findOrCreateUser({
    phone: hidden ? null : phone, email: hidden ? null : email, name: body.name, isDemo: school.is_demo,
  });
  if (await get(`SELECT 1 FROM membership WHERE user_id = ? AND school_id = ? AND role = 'teacher'`, user.id, school.id)) {
    fail(409, 'teacher_exists');
  }
  const id = await insert('membership', {
    user_id: user.id, school_id: school.id, role: 'teacher', speak_lang: body.speakLang,
    subjects: JSON.stringify(body.subjects), created_at: now(),
  });
  await run('UPDATE app_user SET ui_lang = COALESCE(ui_lang, ?) WHERE id = ?', body.speakLang, user.id);
  await audit(req.user.id, 'teacher.add', { schoolId: school.id, entity: 'membership', entityId: id });
  // Someone who has not signed in yet gets a code to join with.
  res.status(201).json({ id, ...(await hasJoined(user.id) ? {} : await issueCode(id)) });
});

/** A fresh code for a teacher who has not joined. The earlier one stops working. */
router.post('/teachers/:id/code', async (req, res) => {
  const m = await get(`SELECT * FROM membership WHERE id = ? AND role = 'teacher'`, intParam(req.params.id)) || fail(404, 'teacher_not_found');
  await requireAdmin(req.user, m.school_id);
  if (!m.active || await hasJoined(m.user_id)) fail(409, 'teacher_joined');
  await audit(req.user.id, 'teacher.code', { schoolId: m.school_id, entity: 'membership', entityId: m.id });
  res.status(201).json(await issueCode(m.id));
});

router.patch('/teachers/:id', async (req, res) => {
  const m = await get(`SELECT * FROM membership WHERE id = ? AND role = 'teacher'`, intParam(req.params.id)) || fail(404, 'teacher_not_found');
  await requireAdmin(req.user, m.school_id);
  const body = parse(z.object({
    name: z.string().trim().min(2).max(80).optional(),
    speakLang: z.enum(LANG_CODES).optional(),
    subjects: z.array(z.string().max(40)).max(12).optional(),
    active: z.boolean().optional(),
  }), req.body);
  await update('membership', m.id, {
    speak_lang: body.speakLang,
    subjects: body.subjects && JSON.stringify(body.subjects),
    active: body.active === undefined ? undefined : body.active ? 1 : 0,
  });
  // The office may correct the name it typed, not rename someone who has since signed in as themselves.
  if (body.name) await run('UPDATE app_user SET name = ? WHERE id = ? AND clerk_user_id IS NULL', body.name, m.user_id);
  if (body.active === false) await audit(req.user.id, 'teacher.deactivate', { schoolId: m.school_id, entity: 'membership', entityId: m.id });
  res.json({ ok: true });
});

/* ---------- Classes ---------- */

const classTeachers = async (classId) =>
  (await all(
    `SELECT ct.membership_id AS "membershipId", ct.subjects, u.name FROM class_teacher ct
     JOIN membership m ON m.id = ct.membership_id JOIN app_user u ON u.id = m.user_id WHERE ct.class_id = ?`,
    classId,
  )).map((t) => ({ ...t, subjects: parseJson(t.subjects, []) }));

router.get('/classes', async (req, res) => {
  const schoolId = intParam(req.query.school);
  if (!(await membershipsFor(req.user.id)).some((m) => m.school_id === schoolId)) fail(403, 'forbidden');
  const classes = await visibleClasses(req.user, schoolId);
  res.json({ classes: await Promise.all(classes.map(async (c) => ({ ...c, teachers: await classTeachers(c.id) }))) });
});

const classInput = z.object({
  school: z.coerce.number().optional(),
  name: z.string().trim().min(1).max(12),
  section: z.string().trim().max(6).default(''),
  year: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  classTeacherId: z.number().int().nullable().optional(),
  teachers: z.array(z.object({ membershipId: z.number().int(), subjects: z.array(z.string().max(40)).default([]) })).max(30).optional(),
});

async function assignTeachers(classId, schoolId, classTeacherId, teachers) {
  const valid = (id) => get(`SELECT 1 FROM membership WHERE id = ? AND school_id = ? AND role = 'teacher' AND active = 1`, id, schoolId);
  if (classTeacherId !== undefined) {
    if (classTeacherId !== null && !await valid(classTeacherId)) fail(400, 'teacher_not_found');
    await update('class', classId, { class_teacher_id: classTeacherId });
  }
  if (teachers) {
    await run('DELETE FROM class_teacher WHERE class_id = ?', classId);
    for (const t of teachers) {
      if (!await valid(t.membershipId)) fail(400, 'teacher_not_found');
      await run(
        `INSERT INTO class_teacher (class_id, membership_id, subjects) VALUES (?,?,?)
         ON CONFLICT (class_id, membership_id) DO UPDATE SET subjects = excluded.subjects`,
        classId, t.membershipId, JSON.stringify(t.subjects));
    }
  }
}

const findClass = (schoolId, name, section, year) =>
  get('SELECT * FROM class WHERE school_id = ? AND name = ? AND section = ? AND academic_year = ?', schoolId, name, section, year);

router.post('/classes', async (req, res) => {
  const school = await adminSchool(req);
  const body = parse(classInput, req.body);
  const year = body.year || school.academic_year;
  if (await findClass(school.id, body.name, body.section, year)) fail(409, 'class_exists');
  const id = await tx(async () => {
    const classId = await insert('class', { school_id: school.id, name: body.name, section: body.section, academic_year: year, created_at: now() });
    await assignTeachers(classId, school.id, body.classTeacherId, body.teachers);
    return classId;
  });
  res.status(201).json({ id });
});

router.patch('/classes/:id', async (req, res) => {
  const cls = await get('SELECT * FROM class WHERE id = ?', intParam(req.params.id)) || fail(404, 'class_not_found');
  await requireAdmin(req.user, cls.school_id);
  const body = parse(classInput.partial(), req.body);
  await tx(async () => {
    await update('class', cls.id, { name: body.name, section: body.section });
    await assignTeachers(cls.id, cls.school_id, body.classTeacherId, body.teachers);
  });
  res.json({ ok: true });
});

/** A class for a year, made if missing. It starts with the teachers that class had the year before. */
async function classFor(schoolId, name, section, year) {
  const found = await findClass(schoolId, name, section, year);
  if (found) return found.id;
  const before = await get(
    `SELECT * FROM class WHERE school_id = ? AND name = ? AND section = ? AND academic_year < ? ORDER BY academic_year DESC LIMIT 1`,
    schoolId, name, section, year,
  );
  const id = await insert('class', {
    school_id: schoolId, name, section, academic_year: year, class_teacher_id: before?.class_teacher_id ?? null, created_at: now(),
  });
  if (before) {
    await run(
      `INSERT INTO class_teacher (class_id, membership_id, subjects)
       SELECT ?, ct.membership_id, ct.subjects FROM class_teacher ct JOIN membership m ON m.id = ct.membership_id AND m.active = 1
       WHERE ct.class_id = ?`,
      id, before.id,
    );
  }
  return id;
}

/**
 * Each student moves on their own: to any class and section, or out of the school. Students not
 * listed stay where they are. Everyone keeps their QR code and every old note.
 */
router.post('/classes/:id/move', async (req, res) => {
  const cls = await get('SELECT * FROM class WHERE id = ?', intParam(req.params.id)) || fail(404, 'class_not_found');
  await requireAdmin(req.user, cls.school_id);
  const body = parse(z.object({
    year: z.string().regex(/^\d{4}-\d{2}$/),
    moves: z.array(z.object({
      studentId: z.number().int(),
      to: z.union([z.literal('left'), z.object({ name: z.string().trim().min(1).max(12), section: z.string().trim().max(6).default('') })]),
    })).min(1).max(200),
  }), req.body);
  if (body.year < cls.academic_year) fail(400, 'year_must_be_later');

  const counts = await tx(async () => {
    const done = { moved: 0, left: 0 };
    const targets = new Map();
    const here = new Set((await all('SELECT id FROM student WHERE class_id = ? AND active = 1', cls.id)).map((s) => s.id));
    for (const { studentId, to } of body.moves) {
      // Also stops one student being listed twice.
      if (!here.delete(studentId)) fail(400, 'student_not_found');
      let target = null;
      if (to !== 'left') {
        const section = to.section.toUpperCase();
        const label = `${to.name}|${section}`;
        if (!targets.has(label)) targets.set(label, await classFor(cls.school_id, to.name, section, body.year));
        target = targets.get(label);
        if (target === cls.id) continue;
      }
      await run('UPDATE student_history SET to_date = ? WHERE student_id = ? AND to_date IS NULL', now(), studentId);
      if (target === null) {
        await update('student', studentId, { active: 0 });
        done.left += 1;
        continue;
      }
      await update('student', studentId, { class_id: target });
      await insert('student_history', { student_id: studentId, class_id: target, academic_year: body.year, from_date: now() });
      done.moved += 1;
    }
    await run('UPDATE school SET academic_year = ? WHERE id = ? AND academic_year < ?', body.year, cls.school_id, body.year);
    return done;
  });
  await audit(req.user.id, 'class.move', { schoolId: cls.school_id, entity: 'class', entityId: cls.id, meta: counts });
  res.json({ counts });
});

/* ---------- Metrics (spec 14) ---------- */

const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);

export async function metricsFor(schoolId) {
  const notes = await all(
    `SELECT n.id, n.published_at, n.capture_ms,
       (SELECT MIN(lr.first_played_at) FROM listen_receipt lr WHERE lr.note_id = n.id AND lr.user_id != COALESCE(n.author_user_id, 0)) AS first_heard
     FROM note n WHERE n.school_id = ? AND n.kind = 'teacher_note' AND n.published_at IS NOT NULL`,
    schoolId,
  );
  const dayAgo = Date.now() - 86_400_000;
  const toMs = (s) => Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  const old = notes.filter((n) => toMs(n.published_at) < dayAgo);
  const heardFast = old.filter((n) => n.first_heard && toMs(n.first_heard) - toMs(n.published_at) <= 86_400_000);
  const captures = notes.map((n) => n.capture_ms).filter((v) => v > 0).sort((a, b) => a - b);

  const teachers = await all(`SELECT user_id FROM membership WHERE school_id = ? AND role = 'teacher' AND active = 1`, schoolId);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const activeTeachers = await all(
    `SELECT DISTINCT n.author_user_id FROM note n JOIN membership m ON m.user_id = n.author_user_id AND m.school_id = n.school_id
       AND m.role = 'teacher' AND m.active = 1
     WHERE n.school_id = ? AND n.published_at >= ?`,
    schoolId, weekAgo,
  );

  const parents = (await get(
    `SELECT COUNT(DISTINCT gl.user_id) AS n FROM guardian_link gl JOIN student s ON s.id = gl.student_id
     WHERE s.school_id = ? AND gl.status = 'active'`,
    schoolId,
  )).n;
  const repliers = (await get(
    `SELECT COUNT(DISTINCT author_user_id) AS n FROM note WHERE school_id = ? AND kind = 'parent_reply' AND published_at IS NOT NULL`,
    schoolId,
  )).n;

  const deadlines = (await all(
    `SELECT nr.note_id, nr.student_id, MIN(nt.due_date) AS due,
       (SELECT MIN(lr.first_played_at) FROM listen_receipt lr WHERE lr.note_id = nr.note_id AND lr.student_id = nr.student_id) AS heard
     FROM note n JOIN note_recipient nr ON nr.note_id = n.id
     JOIN note_tag nt ON nt.note_id = n.id AND nt.type IN ('fee','exam') AND nt.due_date IS NOT NULL
     WHERE n.school_id = ? AND n.published_at IS NOT NULL GROUP BY nr.note_id, nr.student_id`,
    schoolId,
  )).filter((r) => r.due < todayIst());
  const beforeDue = deadlines.filter((r) => r.heard && r.heard.slice(0, 10) <= r.due);

  return {
    notes: notes.length,
    heardIn24h: { percent: percent(heardFast.length, old.length), of: old.length, target: 70 },
    medianCaptureSeconds: { value: captures.length ? Math.round(captures[Math.floor(captures.length / 2)] / 1000) : null, target: 15 },
    activeTeachers: { percent: percent(activeTeachers.length, teachers.length), of: teachers.length, target: 80 },
    parentsReplied: { percent: percent(repliers, parents), of: parents, target: 30 },
    heardBeforeDue: { percent: percent(beforeDue.length, deadlines.length), of: deadlines.length },
  };
}

/** How well the speech and language services are doing. */
async function technicalFor(schoolId) {
  const quality = (await all(
    `SELECT COALESCE(transcript_lang, lang_hint, 'unknown') AS lang, COUNT(*) AS notes,
       SUM(CASE WHEN transcript_conf IS NOT NULL AND transcript_conf < 0.7 THEN 1 ELSE 0 END) AS "lowConfidence",
       SUM(edited) AS edited
     FROM note WHERE school_id = ? AND kind = 'teacher_note' GROUP BY 1 ORDER BY notes DESC`,
    schoolId,
  )).map((q) => ({ lang: q.lang, notes: q.notes, lowPercent: percent(q.lowConfidence, q.notes), editedPercent: percent(q.edited, q.notes) }));
  const aiUsage = await all(
    'SELECT day, model, calls, errors_429 AS "errors429", errors_other AS "errorsOther" FROM ai_usage WHERE day >= ? ORDER BY day DESC, model',
    addDays(todayIst(), -6),
  );
  return { quality, aiUsage };
}

router.get('/metrics', async (req, res) => {
  const schoolId = intParam(req.query.school);
  const mine = (await membershipsFor(req.user.id)).filter((m) => m.school_id === schoolId);
  if (!mine.length) fail(403, 'forbidden');
  res.json(await metricsFor(schoolId));
});

router.get('/audit', async (req, res) => {
  const school = await adminSchool(req);
  res.json({
    entries: await all(
      `SELECT a.id, a.action, a.entity, a.entity_id AS "entityId", a.created_at AS "createdAt", u.name AS actor
       FROM audit_log a LEFT JOIN app_user u ON u.id = a.actor_user_id
       WHERE a.school_id = ? OR (a.school_id IS NULL AND a.actor_user_id IN (SELECT user_id FROM membership WHERE school_id = ?))
       ORDER BY a.id DESC LIMIT 100`,
      school.id, school.id,
    ),
  });
});
