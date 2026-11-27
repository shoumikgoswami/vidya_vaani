// School settings, teachers, classes, year-end promotion, metrics and the audit log.
import { Router } from 'express';
import { z } from 'zod';
import { get, all, run, insert, update, tx } from '../db/index.js';
import { parse, fail, intParam, normalizePhone, normalizeEmail, now, audit, parseJson } from '../lib/util.js';
import { requireUser } from '../auth/session.js';
import { requireAdmin, membershipsFor } from '../auth/authorize.js';
import { findOrCreateUser, userByPhone, userByEmail } from '../auth/users.js';
import { providerStatus } from '../providers/status.js';
import { todayIst, addDays } from '../nlp/dates.js';
import { LANG_CODES } from '../../client/lib/languages.js';
import { visibleClasses } from './teacher.js';

export const router = Router();
router.use(['/school', '/teachers', '/classes', '/metrics', '/audit'], requireUser);

/** Admin routes name the school explicitly: one person can belong to several. */
function adminSchool(req) {
  const schoolId = intParam(req.query.school ?? req.body?.school);
  requireAdmin(req.user, schoolId);
  return get('SELECT * FROM school WHERE id = ?', schoolId);
}

const presentSchool = (s) => ({
  id: s.id, name: s.name, address: s.address, qrMode: s.qr_mode, defaultLang: s.default_lang,
  enabledLangs: parseJson(s.enabled_langs, []), academicYear: s.academic_year, retentionYears: s.retention_years,
});

router.get('/school', (req, res) => res.json(presentSchool(adminSchool(req))));

router.patch('/school', (req, res) => {
  const school = adminSchool(req);
  const body = parse(z.object({
    school: z.coerce.number().optional(),
    name: z.string().trim().min(2).max(120).optional(),
    address: z.string().trim().max(200).optional(),
    qrMode: z.enum(['per_student', 'per_school']).optional(),
    defaultLang: z.enum(LANG_CODES).optional(),
    enabledLangs: z.array(z.enum(LANG_CODES)).min(1).optional(),
    retentionYears: z.number().int().min(0).max(10).optional(),
  }), req.body);
  update('school', school.id, {
    name: body.name, address: body.address, qr_mode: body.qrMode, default_lang: body.defaultLang,
    enabled_langs: body.enabledLangs && JSON.stringify(body.enabledLangs), retention_years: body.retentionYears,
  });
  audit(req.user.id, 'school.update', { schoolId: school.id, meta: { fields: Object.keys(body) } });
  res.json(presentSchool(get('SELECT * FROM school WHERE id = ?', school.id)));
});

router.get('/school/providers', (req, res) => {
  if (!membershipsFor(req.user.id).some((m) => m.role === 'admin')) fail(403, 'forbidden');
  res.json(providerStatus());
});

/* ---------- Teachers ---------- */

const teachersOf = (schoolId) =>
  all(
    `SELECT m.id, m.active, m.speak_lang AS speakLang, m.subjects, u.name, u.phone, u.email,
       (SELECT COUNT(*) FROM session s WHERE s.user_id = u.id) > 0 AS hasSignedIn
     FROM membership m JOIN user u ON u.id = m.user_id
     WHERE m.school_id = ? AND m.role = 'teacher' ORDER BY m.active DESC, u.name`,
    schoolId,
  ).map((t) => ({ ...t, active: Boolean(t.active), hasSignedIn: Boolean(t.hasSignedIn), subjects: parseJson(t.subjects, []) }));

router.get('/teachers', (req, res) => res.json({ teachers: teachersOf(adminSchool(req).id) }));

const teacherInput = z.object({
  school: z.coerce.number().optional(),
  name: z.string().trim().min(2).max(80),
  phone: z.string().max(40).nullish(),
  email: z.string().max(120).nullish(),
  speakLang: z.enum(LANG_CODES),
  subjects: z.array(z.string().max(40)).max(12).default([]),
});

router.post('/teachers', (req, res) => {
  const school = adminSchool(req);
  const body = parse(teacherInput, req.body);
  const phone = body.phone ? normalizePhone(body.phone) || fail(400, 'phone_invalid') : null;
  const email = body.email ? normalizeEmail(body.email) || fail(400, 'email_invalid') : null;
  if (!phone && !email) fail(400, 'phone_or_email_needed');
  const byPhone = userByPhone(phone);
  const byEmail = userByEmail(email);
  if (byPhone && byEmail && byPhone.id !== byEmail.id) fail(409, 'phone_email_belong_to_different_people');

  const user = findOrCreateUser({ phone, email, name: body.name, isDemo: school.is_demo });
  if (get(`SELECT 1 FROM membership WHERE user_id = ? AND school_id = ? AND role = 'teacher'`, user.id, school.id)) {
    fail(409, 'teacher_exists');
  }
  const id = insert('membership', {
    user_id: user.id, school_id: school.id, role: 'teacher', speak_lang: body.speakLang,
    subjects: JSON.stringify(body.subjects), created_at: now(),
  });
  run('UPDATE user SET ui_lang = COALESCE(ui_lang, ?) WHERE id = ?', body.speakLang, user.id);
  audit(req.user.id, 'teacher.add', { schoolId: school.id, entity: 'membership', entityId: id });
  res.status(201).json({ id });
});

router.patch('/teachers/:id', (req, res) => {
  const m = get(`SELECT * FROM membership WHERE id = ? AND role = 'teacher'`, intParam(req.params.id)) || fail(404, 'teacher_not_found');
  requireAdmin(req.user, m.school_id);
  const body = parse(z.object({
    name: z.string().trim().min(2).max(80).optional(),
    speakLang: z.enum(LANG_CODES).optional(),
    subjects: z.array(z.string().max(40)).max(12).optional(),
    active: z.boolean().optional(),
  }), req.body);
  update('membership', m.id, {
    speak_lang: body.speakLang,
    subjects: body.subjects && JSON.stringify(body.subjects),
    active: body.active === undefined ? undefined : body.active ? 1 : 0,
  });
  if (body.name) update('user', m.user_id, { name: body.name });
  if (body.active === false) audit(req.user.id, 'teacher.deactivate', { schoolId: m.school_id, entity: 'membership', entityId: m.id });
  res.json({ ok: true });
});

/* ---------- Classes ---------- */

const classTeachers = (classId) =>
  all(
    `SELECT ct.membership_id AS membershipId, ct.subjects, u.name FROM class_teacher ct
     JOIN membership m ON m.id = ct.membership_id JOIN user u ON u.id = m.user_id WHERE ct.class_id = ?`,
    classId,
  ).map((t) => ({ ...t, subjects: parseJson(t.subjects, []) }));

router.get('/classes', (req, res) => {
  const schoolId = intParam(req.query.school);
  if (!membershipsFor(req.user.id).some((m) => m.school_id === schoolId)) fail(403, 'forbidden');
  res.json({ classes: visibleClasses(req.user.id, schoolId).map((c) => ({ ...c, teachers: classTeachers(c.id) })) });
});

const classInput = z.object({
  school: z.coerce.number().optional(),
  name: z.string().trim().min(1).max(12),
  section: z.string().trim().max(6).default(''),
  year: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  classTeacherId: z.number().int().nullable().optional(),
  teachers: z.array(z.object({ membershipId: z.number().int(), subjects: z.array(z.string().max(40)).default([]) })).max(30).optional(),
});

function assignTeachers(classId, schoolId, classTeacherId, teachers) {
  const valid = (id) => get(`SELECT 1 FROM membership WHERE id = ? AND school_id = ? AND role = 'teacher' AND active = 1`, id, schoolId);
  if (classTeacherId !== undefined) {
    if (classTeacherId !== null && !valid(classTeacherId)) fail(400, 'teacher_not_found');
    update('class', classId, { class_teacher_id: classTeacherId });
  }
  if (teachers) {
    run('DELETE FROM class_teacher WHERE class_id = ?', classId);
    for (const t of teachers) {
      if (!valid(t.membershipId)) fail(400, 'teacher_not_found');
      run('INSERT OR REPLACE INTO class_teacher (class_id, membership_id, subjects) VALUES (?,?,?)',
        classId, t.membershipId, JSON.stringify(t.subjects));
    }
  }
}

const findClass = (schoolId, name, section, year) =>
  get('SELECT * FROM class WHERE school_id = ? AND name = ? AND section = ? AND academic_year = ?', schoolId, name, section, year);

router.post('/classes', (req, res) => {
  const school = adminSchool(req);
  const body = parse(classInput, req.body);
  const year = body.year || school.academic_year;
  if (findClass(school.id, body.name, body.section, year)) fail(409, 'class_exists');
  const id = tx(() => {
    const classId = insert('class', { school_id: school.id, name: body.name, section: body.section, academic_year: year, created_at: now() });
    assignTeachers(classId, school.id, body.classTeacherId, body.teachers);
    return classId;
  });
  res.status(201).json({ id });
});

router.patch('/classes/:id', (req, res) => {
  const cls = get('SELECT * FROM class WHERE id = ?', intParam(req.params.id)) || fail(404, 'class_not_found');
  requireAdmin(req.user, cls.school_id);
  const body = parse(classInput.partial(), req.body);
  tx(() => {
    update('class', cls.id, { name: body.name, section: body.section });
    assignTeachers(cls.id, cls.school_id, body.classTeacherId, body.teachers);
  });
  res.json({ ok: true });
});

/** 5A in 2026-27 becomes 6A in 2027-28. Students keep their QR code and every old note. */
router.post('/classes/:id/promote', (req, res) => {
  const cls = get('SELECT * FROM class WHERE id = ?', intParam(req.params.id)) || fail(404, 'class_not_found');
  requireAdmin(req.user, cls.school_id);
  const body = parse(z.object({
    name: z.string().trim().min(1).max(12),
    section: z.string().trim().max(6).default(''),
    year: z.string().regex(/^\d{4}-\d{2}$/),
    classTeacherId: z.number().int().nullable().optional(),
    decisions: z.record(z.enum(['promote', 'hold', 'left'])),
  }), req.body);
  if (body.year <= cls.academic_year) fail(400, 'year_must_be_later');

  const result = tx(() => {
    const targetClass = (name, section) => {
      const found = findClass(cls.school_id, name, section, body.year);
      if (found) return found.id;
      return insert('class', { school_id: cls.school_id, name, section, academic_year: body.year, created_at: now() });
    };
    const counts = { promote: 0, hold: 0, left: 0 };
    let nextId = null;
    let heldId = null;
    for (const student of all('SELECT id FROM student WHERE class_id = ? AND active = 1', cls.id)) {
      const decision = body.decisions[student.id] || 'promote';
      counts[decision] += 1;
      run('UPDATE student_history SET to_date = ? WHERE student_id = ? AND to_date IS NULL', now(), student.id);
      if (decision === 'left') {
        update('student', student.id, { active: 0 });
        continue;
      }
      let target;
      if (decision === 'promote') {
        nextId ||= targetClass(body.name, body.section);
        target = nextId;
      } else {
        heldId ||= targetClass(cls.name, cls.section);
        target = heldId;
      }
      update('student', student.id, { class_id: target });
      insert('student_history', { student_id: student.id, class_id: target, academic_year: body.year, from_date: now() });
    }
    if (nextId && body.classTeacherId !== undefined) assignTeachers(nextId, cls.school_id, body.classTeacherId);
    if (heldId) update('class', heldId, { class_teacher_id: cls.class_teacher_id });
    update('school', cls.school_id, { academic_year: body.year });
    return { classId: nextId, counts };
  });
  audit(req.user.id, 'class.promote', { schoolId: cls.school_id, entity: 'class', entityId: cls.id, meta: result.counts });
  res.json(result);
});

/* ---------- Metrics (spec 14) ---------- */

const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);

export function metricsFor(schoolId) {
  const notes = all(
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

  const teachers = all(`SELECT user_id FROM membership WHERE school_id = ? AND role = 'teacher' AND active = 1`, schoolId);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const activeTeachers = all(
    `SELECT DISTINCT n.author_user_id FROM note n JOIN membership m ON m.user_id = n.author_user_id AND m.school_id = n.school_id
       AND m.role = 'teacher' AND m.active = 1
     WHERE n.school_id = ? AND n.published_at >= ?`,
    schoolId, weekAgo,
  );

  const parents = get(
    `SELECT COUNT(DISTINCT gl.user_id) AS n FROM guardian_link gl JOIN student s ON s.id = gl.student_id
     WHERE s.school_id = ? AND gl.status = 'active'`,
    schoolId,
  ).n;
  const repliers = get(
    `SELECT COUNT(DISTINCT author_user_id) AS n FROM note WHERE school_id = ? AND kind = 'parent_reply' AND published_at IS NOT NULL`,
    schoolId,
  ).n;

  const deadlines = all(
    `SELECT nr.note_id, nr.student_id, MIN(nt.due_date) AS due,
       (SELECT MIN(lr.first_played_at) FROM listen_receipt lr WHERE lr.note_id = nr.note_id AND lr.student_id = nr.student_id) AS heard
     FROM note n JOIN note_recipient nr ON nr.note_id = n.id
     JOIN note_tag nt ON nt.note_id = n.id AND nt.type IN ('fee','exam') AND nt.due_date IS NOT NULL
     WHERE n.school_id = ? AND n.published_at IS NOT NULL GROUP BY nr.note_id, nr.student_id`,
    schoolId,
  ).filter((r) => r.due < todayIst());
  const beforeDue = deadlines.filter((r) => r.heard && r.heard.slice(0, 10) <= r.due);

  const quality = all(
    `SELECT COALESCE(transcript_lang, lang_hint, 'unknown') AS lang, COUNT(*) AS notes,
       SUM(CASE WHEN transcript_conf IS NOT NULL AND transcript_conf < 0.7 THEN 1 ELSE 0 END) AS lowConfidence,
       SUM(edited) AS edited
     FROM note WHERE school_id = ? AND kind = 'teacher_note' GROUP BY 1 ORDER BY notes DESC`,
    schoolId,
  ).map((q) => ({ lang: q.lang, notes: q.notes, lowPercent: percent(q.lowConfidence, q.notes), editedPercent: percent(q.edited, q.notes) }));

  return {
    notes: notes.length,
    heardIn24h: { percent: percent(heardFast.length, old.length), of: old.length, target: 70 },
    medianCaptureSeconds: { value: captures.length ? Math.round(captures[Math.floor(captures.length / 2)] / 1000) : null, target: 15 },
    activeTeachers: { percent: percent(activeTeachers.length, teachers.length), of: teachers.length, target: 80 },
    parentsReplied: { percent: percent(repliers, parents), of: parents, target: 30 },
    heardBeforeDue: { percent: percent(beforeDue.length, deadlines.length), of: deadlines.length },
    quality,
    aiUsage: all('SELECT day, model, calls, errors_429 AS errors429, errors_other AS errorsOther FROM ai_usage WHERE day >= ? ORDER BY day DESC, model',
      addDays(todayIst(), -6)),
    outcomes: all(
      `SELECT o.period, o.homework_done_pct AS homeworkDonePct, o.fee_missed_count AS feeMissedCount, c.name || c.section AS className
       FROM outcome o LEFT JOIN class c ON c.id = o.class_id WHERE o.school_id = ? ORDER BY o.created_at DESC LIMIT 30`,
      schoolId,
    ),
  };
}

router.get('/metrics', (req, res) => {
  const schoolId = intParam(req.query.school);
  const mine = membershipsFor(req.user.id).filter((m) => m.school_id === schoolId);
  if (!mine.length) fail(403, 'forbidden');
  res.json(metricsFor(schoolId));
});

router.post('/metrics/outcomes', (req, res) => {
  const body = parse(z.object({
    school: z.number().int(),
    classId: z.number().int().nullable().optional(),
    period: z.string().trim().min(2).max(40),
    homeworkDonePct: z.number().int().min(0).max(100).nullable().optional(),
    feeMissedCount: z.number().int().min(0).max(10000).nullable().optional(),
  }), req.body);
  if (!membershipsFor(req.user.id).some((m) => m.school_id === body.school)) fail(403, 'forbidden');
  if (body.classId && !get('SELECT 1 FROM class WHERE id = ? AND school_id = ?', body.classId, body.school)) fail(400, 'class_not_found');
  insert('outcome', {
    school_id: body.school, class_id: body.classId ?? null, period: body.period,
    homework_done_pct: body.homeworkDonePct ?? null, fee_missed_count: body.feeMissedCount ?? null,
    entered_by: req.user.id, created_at: now(),
  });
  res.status(201).json({ ok: true });
});

router.get('/audit', (req, res) => {
  const school = adminSchool(req);
  res.json({
    entries: all(
      `SELECT a.id, a.action, a.entity, a.entity_id AS entityId, a.created_at AS createdAt, u.name AS actor
       FROM audit_log a LEFT JOIN user u ON u.id = a.actor_user_id
       WHERE a.school_id = ? OR (a.school_id IS NULL AND a.actor_user_id IN (SELECT user_id FROM membership WHERE school_id = ?))
       ORDER BY a.id DESC LIMIT 100`,
      school.id, school.id,
    ),
  });
});
