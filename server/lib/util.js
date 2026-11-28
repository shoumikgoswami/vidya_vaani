import crypto from 'node:crypto';
import { config } from '../config.js';
import { get, run } from '../db/index.js';

export class HttpError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const fail = (status, code, extra) => {
  throw new HttpError(status, code, extra);
};

export const now = () => new Date().toISOString();
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 22 random base62 characters, about 130 bits. Rejection sampling keeps it unbiased. */
export function randomToken(length = 22) {
  let out = '';
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length * 2)) {
      if (byte < 248) out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    fail(400, 'invalid_input', { fields: result.error.issues.map((i) => i.path.join('.')) });
  }
  return result.data;
}

export const intParam = (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) fail(404, 'not_found');
  return n;
};

export const parseJson = (text, fallback) => {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
};

export async function audit(actorUserId, action, { schoolId = null, entity = null, entityId = null, meta = null } = {}) {
  await run(
    'INSERT INTO audit_log (actor_user_id, school_id, action, entity, entity_id, meta, created_at) VALUES (?,?,?,?,?,?,?)',
    actorUserId ?? null, schoolId, action, entity, entityId == null ? null : String(entityId),
    meta ? JSON.stringify(meta) : null, now(),
  );
}

/** +91 is assumed for a bare 10-digit Indian mobile number. Returns null if it is not a phone number. */
export function normalizePhone(input) {
  if (!input) return null;
  const raw = String(input).trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return null;
}

export function normalizeEmail(input) {
  const email = String(input ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Counts one use in a window shared by every server. False once the limit is passed. */
export async function allow(key, max, windowMs) {
  const t = Date.now();
  const floor = t - windowMs;
  const row = await get(
    `INSERT INTO throttle (key, window_start, hits) VALUES (?, ?, 1)
     ON CONFLICT (key) DO UPDATE SET
       hits = CASE WHEN throttle.window_start <= ? THEN 1 ELSE throttle.hits + 1 END,
       window_start = CASE WHEN throttle.window_start <= ? THEN excluded.window_start ELSE throttle.window_start END
     RETURNING hits`,
    key, t, floor, floor,
  );
  return row.hits <= max;
}

/** Netlify passes the caller's address in its own header. */
export const clientIp = (req) => (config.serverless && req.get('x-nf-client-connection-ip')) || req.ip;

/**
 * Fixed-window limiter. Sign-in and other sensitive routes pass a `name`, so the count lives in the
 * database; busy harmless routes count in memory, per server.
 */
export function limiter({ name, max, windowMs, key = clientIp }) {
  const hits = new Map();
  return async (req, res, next) => {
    const k = key(req);
    let ok;
    if (name) {
      ok = await allow(`${name}:${k}`, max, windowMs);
    } else {
      const t = Date.now();
      let entry = hits.get(k);
      if (!entry || t - entry.start > windowMs) {
        if (hits.size > 5000) hits.clear();
        entry = { start: t, count: 0 };
        hits.set(k, entry);
      }
      entry.count += 1;
      ok = entry.count <= max;
    }
    if (!ok) return res.status(429).json({ error: 'too_many_requests' });
    next();
  };
}
