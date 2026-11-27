// Text-to-speech, push subscriptions and the demo bar.
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { get, all, run } from '../db/index.js';
import { parse, fail, limiter, audit, now } from '../lib/util.js';
import { requireUser, createSession } from '../auth/session.js';
import { synthesize } from '../providers/tts.js';
import { isAppPhrase } from '../services/i18n.js';
import { sendToUser } from '../services/push.js';
import { seedDemo, DEMO_PERSONAS } from '../db/seed-demo.js';
import { LANG_CODES } from '../../client/lib/languages.js';

export const router = Router();

/** 204 tells the browser to use its own voice. */
router.get('/tts', limiter({ max: 120, windowMs: 60_000 }), async (req, res) => {
  const { lang, text } = parse(z.object({ lang: z.enum(LANG_CODES), text: z.string().trim().min(1).max(600) }), req.query);
  // Only the app's own phrases may be synthesised without signing in, to protect the free tier.
  if (!req.user && !isAppPhrase(lang, text)) return res.status(204).end();
  const file = await synthesize(text, lang);
  if (!file) return res.status(204).end();
  res.sendFile(file, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=604800' } });
});

router.post('/push/subscribe', requireUser, (req, res) => {
  const body = parse(z.object({
    endpoint: z.string().url().startsWith('https://').max(600),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
  }), req.body);
  run(
    `INSERT INTO push_subscription (user_id, endpoint, keys, created_at) VALUES (?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys`,
    req.user.id, body.endpoint, JSON.stringify(body.keys), now(),
  );
  res.status(201).json({ ok: true });
});

router.post('/push/test', requireUser, async (req, res) => {
  res.json({ sent: await sendToUser(req.user.id, { title: 'Vidya Vaani', body: 'Vidya Vaani', url: '/', tag: 'test' }) });
});

/* ---------- Demo mode (spec 15) ---------- */

const demoOnly = (_req, _res, next) => {
  if (!config.demoMode) fail(404, 'demo_off');
  next();
};

/** Demo sign-in only ever reaches accounts that exist purely inside the demo school. */
const demoUsers = () =>
  all(
    `SELECT u.id, u.phone FROM user u WHERE u.is_demo = 1
       AND NOT EXISTS (SELECT 1 FROM membership m JOIN school s ON s.id = m.school_id WHERE m.user_id = u.id AND s.is_demo = 0)
       AND NOT EXISTS (SELECT 1 FROM guardian_link gl JOIN student st ON st.id = gl.student_id
         JOIN school s ON s.id = st.school_id WHERE gl.user_id = u.id AND s.is_demo = 0)`,
  );

router.get('/demo/personas', demoOnly, (_req, res) => {
  const allowed = new Map(demoUsers().map((u) => [u.phone, u.id]));
  res.json({
    personas: DEMO_PERSONAS.filter((p) => allowed.has(p.phone)).map((p) => ({ ...p, userId: allowed.get(p.phone), phone: undefined })),
  });
});

router.post('/demo/login', demoOnly, limiter({ max: 120, windowMs: 60_000 }), (req, res) => {
  const { userId } = parse(z.object({ userId: z.number().int() }), req.body);
  if (!demoUsers().some((u) => u.id === userId)) fail(403, 'forbidden');
  createSession(req, res, userId);
  audit(userId, 'auth.login', { meta: { method: 'demo_switch' } });
  const persona = DEMO_PERSONAS.find((p) => p.phone === get('SELECT phone FROM user WHERE id = ?', userId).phone);
  res.json({ ok: true, persona: persona && { ...persona, phone: undefined } });
});

/** "Simulate scan": the demo school's stickers as tappable cards. */
router.get('/demo/students', demoOnly, (_req, res) => {
  res.json({
    students: all(
      `SELECT s.name, s.token, c.name || c.section AS className FROM student s
       JOIN class c ON c.id = s.class_id JOIN school sc ON sc.id = s.school_id
       WHERE sc.is_demo = 1 AND s.active = 1 ORDER BY className, s.name`,
    ),
  });
});

router.post('/demo/reset', demoOnly, limiter({ max: 6, windowMs: 60_000 }), async (_req, res) => {
  await seedDemo({ reset: true });
  res.json({ ok: true });
});
