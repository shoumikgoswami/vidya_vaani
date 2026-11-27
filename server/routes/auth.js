import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { get, all, update, insert, run } from '../db/index.js';
import { parse, fail, normalizePhone, normalizeEmail, limiter, audit, now, randomToken } from '../lib/util.js';
import { createSession, destroySession, requireUser } from '../auth/session.js';
import { sendOtp, verifyOtp, otpLoginEnabled } from '../auth/otp.js';
import { identityFromToken, clerkFrontendApi } from '../auth/clerk.js';
import { userForIdentity, findOrCreateUser } from '../auth/users.js';
import { vapidPublicKey } from '../services/push.js';
import { isLang, LANG_CODES } from '../../client/lib/languages.js';

export const router = Router();
const signInLimit = limiter({ max: 30, windowMs: 15 * 60_000 });

export const setupNeeded = () => !get('SELECT 1 FROM school WHERE is_demo = 0');

router.get('/config', (req, res) => {
  res.json({
    demoMode: config.demoMode,
    clerk: config.clerk.enabled
      ? { publishableKey: config.clerk.publishableKey, frontendApi: clerkFrontendApi() }
      : null,
    otpLogin: otpLoginEnabled(),
    ai: { nvidia: Boolean(config.nvidia.apiKey), openrouter: Boolean(config.openrouter.apiKey) },
    vapidPublicKey: vapidPublicKey(),
    setupNeeded: setupNeeded(),
    publicBaseUrl: config.publicBaseUrl,
    csrfToken: req.csrfCookie,
  });
});

router.post('/auth/otp/send', signInLimit, (req, res) => {
  const { phone } = parse(z.object({ phone: z.string() }), req.body);
  const normalised = normalizePhone(phone) || fail(400, 'phone_invalid');
  const code = sendOtp(normalised);
  // Demo sign-in: the code is shown on screen because no SMS is sent.
  res.json({ phone: normalised, demoCode: code });
});

router.post('/auth/otp/verify', signInLimit, (req, res) => {
  const { phone, code } = parse(z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/) }), req.body);
  const normalised = normalizePhone(phone) || fail(400, 'phone_invalid');
  verifyOtp(normalised, code);
  const user = userForIdentity({ phones: [normalised] });
  createSession(req, res, user.id);
  audit(user.id, 'auth.login', { meta: { method: 'demo_otp' } });
  res.json({ ok: true });
});

router.post('/auth/clerk', signInLimit, async (req, res) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) fail(401, 'clerk_token_missing');
  const identity = await identityFromToken(token, `${req.protocol}://${req.get('host')}`);
  const user = userForIdentity(identity);
  createSession(req, res, user.id);
  audit(user.id, 'auth.login', { meta: { method: 'clerk' } });
  res.json({ ok: true });
});

router.post('/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

export function describeMe(user) {
  const memberships = all(
    `SELECT m.id, m.role, m.admin_level AS adminLevel, m.speak_lang AS speakLang, m.school_id AS schoolId,
       s.name AS schoolName, s.qr_mode AS qrMode, s.is_demo AS isDemo, s.default_lang AS defaultLang
     FROM membership m JOIN school s ON s.id = m.school_id
     WHERE m.user_id = ? AND m.active = 1 ORDER BY s.is_demo, m.role`,
    user.id,
  );
  const children = all(
    `SELECT gl.id AS linkId, gl.status, gl.consent_at IS NOT NULL AS consented, gl.read_lang AS readLang,
       s.id AS studentId, s.name, c.name || c.section AS className, c.academic_year AS academicYear,
       sc.name AS schoolName, sc.id AS schoolId, sc.default_lang AS defaultLang
     FROM guardian_link gl JOIN student s ON s.id = gl.student_id JOIN class c ON c.id = s.class_id
     JOIN school sc ON sc.id = s.school_id
     WHERE gl.user_id = ? AND gl.status IN ('active','pending') AND s.active = 1 ORDER BY s.name`,
    user.id,
  );
  return {
    user: { id: user.id, name: user.name, phone: user.phone, email: user.email, uiLang: user.ui_lang, isDemo: Boolean(user.is_demo) },
    memberships: memberships.map((m) => ({ ...m, isDemo: Boolean(m.isDemo) })),
    children: children.map((c) => ({ ...c, consented: Boolean(c.consented) })),
  };
}

router.get('/me', (req, res) => {
  res.json(req.user ? describeMe(req.user) : { user: null });
});

router.patch('/me', requireUser, (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(1).max(80).optional(),
    uiLang: z.enum(LANG_CODES).optional(),
  }), req.body);
  update('user', req.user.id, { name: body.name, ui_lang: body.uiLang });
  res.json({ ok: true });
});

/* ---------- First-run wizard ---------- */

export const academicYear = (date = new Date()) => {
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

router.post('/setup', signInLimit, (req, res) => {
  if (!setupNeeded()) fail(409, 'already_set_up');
  const body = parse(z.object({
    schoolName: z.string().trim().min(2).max(120),
    adminName: z.string().trim().min(2).max(80),
    phone: z.string().optional(),
    email: z.string().optional(),
    defaultLang: z.string().refine(isLang),
    qrMode: z.enum(['per_student', 'per_school']),
  }), req.body);

  if (config.clerk.enabled && !req.user) fail(401, 'login_required');
  if (!config.clerk.enabled && !otpLoginEnabled()) fail(409, 'auth_not_configured');

  let admin = req.user;
  if (!admin) {
    const phone = normalizePhone(body.phone) || fail(400, 'phone_invalid');
    admin = findOrCreateUser({ phone, email: normalizeEmail(body.email), name: body.adminName });
  }
  run('UPDATE user SET name = ?, ui_lang = COALESCE(ui_lang, ?), is_demo = 0 WHERE id = ?', body.adminName, body.defaultLang, admin.id);

  const schoolId = insert('school', {
    name: body.schoolName,
    qr_mode: body.qrMode,
    school_token: randomToken(),
    default_lang: body.defaultLang,
    enabled_langs: JSON.stringify([...new Set([body.defaultLang, 'en', 'hi'])]),
    academic_year: academicYear(),
    created_at: now(),
  });
  insert('membership', { user_id: admin.id, school_id: schoolId, role: 'admin', admin_level: 'owner', created_at: now() });
  audit(admin.id, 'school.create', { schoolId, entity: 'school', entityId: schoolId });
  res.status(201).json({ schoolId, phone: admin.phone, signedIn: Boolean(req.user) });
});
