// Demo phone login, used only when Clerk keys are absent and DEMO_MODE is on.
// The code is shown on screen, so it must never be enabled for a real school.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { get, run } from '../db/index.js';
import { sha256, fail } from '../lib/util.js';

const EXPIRY_MS = 10 * 60_000;
const WINDOW_MS = 15 * 60_000;
const MAX_SENDS = 3;
const MAX_ATTEMPTS = 5;

export const otpLoginEnabled = () => config.demoMode && !config.clerk.enabled;

export function sendOtp(phone) {
  if (!otpLoginEnabled()) fail(404, 'otp_login_disabled');
  const t = Date.now();
  const row = get('SELECT * FROM otp WHERE phone = ?', phone);
  const sameWindow = row && t - row.window_start < WINDOW_MS;
  if (sameWindow && row.sent_count >= MAX_SENDS) fail(429, 'otp_too_many_sends');

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  run(
    `INSERT INTO otp (phone, code_hash, expires_at, attempts, sent_count, window_start) VALUES (?,?,?,0,?,?)
     ON CONFLICT(phone) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       attempts = 0, sent_count = excluded.sent_count, window_start = excluded.window_start`,
    phone, sha256(`${phone}:${code}`), t + EXPIRY_MS,
    sameWindow ? row.sent_count + 1 : 1, sameWindow ? row.window_start : t,
  );
  return code;
}

export function verifyOtp(phone, code) {
  if (!otpLoginEnabled()) fail(404, 'otp_login_disabled');
  const row = get('SELECT * FROM otp WHERE phone = ?', phone);
  if (!row || row.expires_at < Date.now()) fail(400, 'otp_expired');
  if (row.attempts >= MAX_ATTEMPTS) fail(429, 'otp_too_many_attempts');
  run('UPDATE otp SET attempts = attempts + 1 WHERE phone = ?', phone);
  if (row.code_hash !== sha256(`${phone}:${code}`)) fail(400, 'otp_wrong');
  run('UPDATE otp SET expires_at = 0 WHERE phone = ?', phone);
}
