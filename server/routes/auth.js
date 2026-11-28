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
const signInLimit = limiter({ name: 'signin', max: 30, windowMs: 15 * 60_000 });

export const setupNeeded = async () => !await get('SELECT 1 FROM school WHERE is_demo = 0');

const portalField = z.enum(['family', 'school']).default('family');

/** The school office sign-in admits office staff only, or a newcomer about to create the school. */
async function admit(req, res, user, portal, method) {
  if (portal === 'school') {
    const roles = (await all('SELECT role FROM membership WHERE user_id = ? AND active = 1', user.id)).map((m) => m.role);
    // Someone who already teaches here is not the person setting up a school.
    const founder = await setupNeeded() && !roles.length;
    if (!roles.includes('admin') && !founder) fail(403, 'not_school_staff');
  }
  await createSession(req, res, user.id, portal);
  await audit(user.id, 'auth.login', { meta: { method, portal } });
  res.json({ ok: true });
}

router.get('/config', async (req, res) => {
  res.json({
    demoMode: config.demoMode,
    clerk: config.clerk.enabled
      ? { publishableKey: config.clerk.publishableKey, frontendApi: clerkFrontendApi() }
      : null,
    otpLogin: otpLoginEnabled(),
    ai: { nvidia: Boolean(config.nvidia.apiKey), openrouter: Boolean(config.openrouter.apiKey) },
    vapidPublicKey: await vapidPublicKey(),
    setupNeeded: await setupNeeded(),
    publicBaseUrl: config.publicBaseUrl,
    csrfToken: req.csrfCookie,
  });
});

router.post('/auth/otp/send', signInLimit, async (req, res) => {
  const { phone } = parse(z.object({ phone: z.string() }), req.body);
  const normalised = normalizePhone(phone) || fail(400, 'phone_invalid');
  const code = await sendOtp(normalised);
  // Demo sign-in: the code is shown on screen because no SMS is sent.
  res.json({ phone: normalised, demoCode: code });
});

router.post('/auth/otp/verify', signInLimit, async (req, res) => {
  const { phone, code, portal } = parse(
    z.object({ phone: z.string(), code: z.string().regex(/^\d{6}$/), portal: portalField }), req.body,
  );
  const normalised = normalizePhone(phone) || fail(400, 'phone_invalid');
  await verifyOtp(normalised, code);
  await admit(req, res, await userForIdentity({ phones: [normalised] }), portal, 'demo_otp');
});

router.post('/auth/clerk', signInLimit, async (req, res) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) fail(401, 'clerk_token_missing');
  const { portal } = parse(z.object({ portal: portalField }), req.body);
  const identity = await identityFromToken(token, `${req.protocol}://${req.get('host')}`);
  await admit(req, res, await userForIdentity(identity), portal, 'clerk');
});

router.post('/auth/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

export async function describeMe(user) {
  const memberships = await all(
    `SELECT m.id, m.role, m.admin_level AS "adminLevel", m.speak_lang AS "speakLang", m.school_id AS "schoolId",
       s.name AS "schoolName", s.qr_mode AS "qrMode", s.is_demo AS "isDemo", s.default_lang AS "defaultLang"
     FROM membership m JOIN school s ON s.id = m.school_id
     WHERE m.user_id = ? AND m.active = 1 ORDER BY s.is_demo, m.role`,
    user.id,
  );
  const children = await all(
    `SELECT gl.id AS "linkId", gl.status, gl.consent_at IS NOT NULL AS consented, gl.read_lang AS "readLang",
       s.id AS "studentId", s.name, c.name || c.section AS "className", c.academic_year AS "academicYear",
       sc.name AS "schoolName", sc.id AS "schoolId", sc.default_lang AS "defaultLang"
     FROM guardian_link gl JOIN student s ON s.id = gl.student_id JOIN class c ON c.id = s.class_id
     JOIN school sc ON sc.id = s.school_id
     WHERE gl.user_id = ? AND gl.status IN ('active','pending') AND s.active = 1 ORDER BY s.name`,
    user.id,
  );
  return {
    portal: user.portal || 'family',
    user: { id: user.id, name: user.name, phone: user.phone, email: user.email, uiLang: user.ui_lang, isDemo: Boolean(user.is_demo) },
    memberships: memberships.map((m) => ({ ...m, isDemo: Boolean(m.isDemo) })),
    children: children.map((c) => ({ ...c, consented: Boolean(c.consented) })),
  };
}

router.get('/me', async (req, res) => {
  res.json(req.user ? await describeMe(req.user) : { user: null });
});

router.patch('/me', requireUser, async (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(1).max(80).optional(),
    uiLang: z.enum(LANG_CODES).optional(),
  }), req.body);
  await update('app_user', req.user.id, { name: body.name, ui_lang: body.uiLang });
  res.json({ ok: true });
});

/* ---------- First-run wizard ---------- */

export const academicYear = (date = new Date()) => {
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

router.post('/setup', signInLimit, async (req, res) => {
  if (!await setupNeeded()) fail(409, 'already_set_up');
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
    admin = await findOrCreateUser({ phone, email: normalizeEmail(body.email), name: body.adminName });
  }
  await run('UPDATE app_user SET name = ?, ui_lang = COALESCE(ui_lang, ?), is_demo = 0 WHERE id = ?', body.adminName, body.defaultLang, admin.id);

  const schoolId = await insert('school', {
    name: body.schoolName,
    qr_mode: body.qrMode,
    school_token: randomToken(),
    default_lang: body.defaultLang,
    enabled_langs: JSON.stringify([...new Set([body.defaultLang, 'en', 'hi'])]),
    academic_year: academicYear(),
    created_at: now(),
  });
  await insert('membership', { user_id: admin.id, school_id: schoolId, role: 'admin', admin_level: 'owner', created_at: now() });
  // Whoever just created the school is now at the school office.
  if (req.user) await run(`UPDATE session SET portal = 'school' WHERE id = ?`, req.user.session_id);
  await audit(admin.id, 'school.create', { schoolId, entity: 'school', entityId: schoolId });
  res.status(201).json({ schoolId, phone: admin.phone, signedIn: Boolean(req.user) });
});
