// Our own cookie session. Clerk or the demo login only decide who gets one.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { get, run } from '../db/index.js';
import { now, sha256, fail } from '../lib/util.js';

const SESSION_COOKIE = 'vv_session';
const CSRF_COOKIE = 'vv_csrf';

export function readCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

const cookieOptions = (req, maxAgeMs, httpOnly) => ({
  httpOnly,
  sameSite: 'lax',
  secure: req.secure,
  path: '/',
  maxAge: maxAgeMs,
});

const lifetime = () => config.sessionDays * 86_400_000;

export function createSession(req, res, userId, portal = 'family') {
  const token = crypto.randomBytes(32).toString('base64url');
  run(
    'INSERT INTO session (id, user_id, device_label, created_at, last_seen_at, expires_at, portal) VALUES (?,?,?,?,?,?,?)',
    sha256(token), userId, String(req.headers['user-agent'] || '').slice(0, 120), now(), now(), Date.now() + lifetime(), portal,
  );
  res.cookie(SESSION_COOKIE, token, cookieOptions(req, lifetime(), true));
}

export function destroySession(req, res) {
  const token = readCookies(req)[SESSION_COOKIE];
  if (token) run('DELETE FROM session WHERE id = ?', sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function sessionMiddleware(req, res, next) {
  const cookies = readCookies(req);
  const token = cookies[SESSION_COOKIE];
  req.user = null;
  if (token) {
    const row = get(
      `SELECT u.*, s.id AS session_id, s.last_seen_at, s.portal FROM session s JOIN user u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
      sha256(token), Date.now(),
    );
    if (row) {
      req.user = row;
      if (Date.now() - Date.parse(row.last_seen_at) > 3_600_000) {
        run('UPDATE session SET last_seen_at = ? WHERE id = ?', now(), row.session_id);
      }
    }
  }
  req.csrfCookie = cookies[CSRF_COOKIE];
  if (!req.csrfCookie) {
    req.csrfCookie = crypto.randomBytes(24).toString('base64url');
    res.cookie(CSRF_COOKIE, req.csrfCookie, cookieOptions(req, lifetime(), false));
  }
  next();
}

/** Double-submit token on top of SameSite cookies: a foreign page cannot read the cookie to echo it. */
export function csrfProtection(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const header = req.get('x-csrf-token');
  if (!header || header !== req.csrfCookie) fail(403, 'csrf_failed');
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) fail(401, 'login_required');
  next();
}
