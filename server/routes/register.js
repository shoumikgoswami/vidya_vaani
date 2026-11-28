// New schools send a request; the site owner approves each one. Nothing is created before that.
import { Router } from 'express';
import { z } from 'zod';
import { get, all, run, insert, update, tx } from '../db/index.js';
import { parse, fail, intParam, normalizePhone, normalizeEmail, limiter, audit, now, randomToken } from '../lib/util.js';
import { requireOwner } from '../auth/session.js';
import { findOrCreateUser, releaseFromSamples } from '../auth/users.js';
import { LANG_CODES } from '../../client/lib/languages.js';
import { academicYear } from './auth.js';

export const router = Router();

/** A full queue means someone is filling it by machine. */
const PENDING_LIMIT = 200;

const request = z.object({
  schoolName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(30),
  email: z.string().trim().max(120).optional(),
  town: z.string().trim().min(2).max(120),
  lang: z.enum(LANG_CODES),
  // A field people never see. Only a form-filling program writes in it.
  website: z.string().max(200).optional(),
});

router.post('/register', limiter({ name: 'register', max: 5, windowMs: 3_600_000 }), async (req, res) => {
  const body = parse(request, req.body);
  if (body.website) return res.status(201).json({ ok: true });
  const phone = normalizePhone(body.phone) || fail(400, 'phone_invalid');
  const email = body.email ? normalizeEmail(body.email) || fail(400, 'email_invalid') : null;
  const values = {
    school_name: body.schoolName, contact_name: body.contactName, phone, email, town: body.town, lang: body.lang,
  };
  // Sending the form again for the same school corrects the earlier request.
  const waiting = await get(
    `SELECT id FROM school_request WHERE status = 'pending' AND phone = ? AND lower(school_name) = lower(?)`, phone, body.schoolName,
  );
  if (waiting) {
    await update('school_request', waiting.id, values);
  } else {
    const { n } = await get(`SELECT COUNT(*) AS n FROM school_request WHERE status = 'pending'`);
    if (n >= PENDING_LIMIT) fail(429, 'too_many_requests');
    await insert('school_request', { ...values, created_at: now() });
  }
  res.status(201).json({ ok: true });
});

router.use('/owner', requireOwner);

const present = (r) => ({
  id: r.id, schoolName: r.school_name, contactName: r.contact_name, phone: r.phone, email: r.email, town: r.town,
  lang: r.lang, status: r.status, createdAt: r.created_at,
});

router.get('/owner/requests', async (_req, res) => {
  const rows = await all(`SELECT * FROM school_request ORDER BY status = 'pending' DESC, created_at DESC LIMIT 300`);
  res.json({ requests: rows.map(present) });
});

/**
 * Creates the school and gives its office to ONE verified route in: the Google email if given,
 * otherwise the mobile number. Tying both together would let a request join a stranger's number to
 * someone else's email.
 */
router.post('/owner/requests/:id/approve', async (req, res) => {
  const id = intParam(req.params.id);
  const result = await tx(async () => {
    // Only the request that flips it creates a school, however often the button is pressed.
    const asked = await get(
      `UPDATE school_request SET status = 'approved', decided_at = ? WHERE id = ? AND status = 'pending' RETURNING *`, now(), id,
    ) || fail(409, 'already_decided');
    const identity = asked.email ? { email: asked.email } : { phone: asked.phone };
    await releaseFromSamples(identity.phone ? [identity.phone] : [], identity.email ? [identity.email] : []);
    const admin = await findOrCreateUser({ ...identity, name: asked.contact_name });
    await run('UPDATE app_user SET ui_lang = COALESCE(ui_lang, ?), is_demo = 0 WHERE id = ?', asked.lang, admin.id);
    const schoolId = await insert('school', {
      name: asked.school_name,
      address: asked.town,
      qr_mode: 'per_student',
      school_token: randomToken(),
      default_lang: asked.lang,
      enabled_langs: JSON.stringify([...new Set([asked.lang, 'en', 'hi'])]),
      academic_year: academicYear(),
      created_at: now(),
    });
    await insert('membership', { user_id: admin.id, school_id: schoolId, role: 'admin', admin_level: 'owner', created_at: now() });
    await update('school_request', id, { school_id: schoolId });
    await audit(req.user.id, 'school.approve', { schoolId, entity: 'school_request', entityId: id });
    return { schoolId, signInWith: identity.email || identity.phone };
  });
  res.status(201).json(result);
});

router.post('/owner/requests/:id/decline', async (req, res) => {
  const row = await get(
    `UPDATE school_request SET status = 'declined', decided_at = ? WHERE id = ? AND status = 'pending' RETURNING id`,
    now(), intParam(req.params.id),
  );
  if (!row) fail(409, 'already_decided');
  res.json({ ok: true });
});

/** Removes the details someone sent. An approved school itself stays. */
router.delete('/owner/requests/:id', async (req, res) => {
  const { changes } = await run('DELETE FROM school_request WHERE id = ?', intParam(req.params.id));
  if (!changes) fail(404, 'not_found');
  res.json({ ok: true });
});
