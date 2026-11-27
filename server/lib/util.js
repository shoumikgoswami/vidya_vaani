import crypto from 'node:crypto';
import { run } from '../db/index.js';

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

export function audit(actorUserId, action, { schoolId = null, entity = null, entityId = null, meta = null } = {}) {
  run(
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

/** Small fixed-window limiter for sign-in and public routes. In memory: one container, one process. */
export function limiter({ max, windowMs, key = (req) => req.ip }) {
  const hits = new Map();
  return (req, res, next) => {
    const k = key(req);
    const t = Date.now();
    const entry = hits.get(k);
    if (!entry || t - entry.start > windowMs) {
      if (hits.size > 5000) hits.clear();
      hits.set(k, { start: t, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return res.status(429).json({ error: 'too_many_requests' });
    next();
  };
}
