// The code a school office gives a new teacher: eight characters that are hard to misread, valid for
// two weeks and usable once.
import crypto from 'node:crypto';
import { get, run, tx, update } from '../db/index.js';
import { fail, sha256, now, audit } from '../lib/util.js';

/** No I, O, 0 or 1. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_DAYS = 14;

/** What someone typed, without spaces, dashes or small letters. */
const tidy = (code) => String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** A teacher has joined once they have ever signed in. Their record is then theirs. */
export const hasJoined = async (userId) => Boolean(await get(
  `SELECT 1 FROM app_user u WHERE u.id = ? AND (u.clerk_user_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM audit_log a WHERE a.actor_user_id = u.id AND a.action = 'auth.login'))`,
  userId,
));

/** Replaces any earlier code. The code itself is returned here and never stored. */
export async function issueCode(membershipId) {
  const code = Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
  const expiresAt = Date.now() + CODE_DAYS * 86_400_000;
  await run(
    `INSERT INTO teacher_code (membership_id, code_hash, expires_at, created_at) VALUES (?,?,?,?)
     ON CONFLICT (membership_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       created_at = excluded.created_at`,
    membershipId, sha256(code), expiresAt, now(),
  );
  return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: new Date(expiresAt).toISOString() };
}

/** Hands the prepared teacher record, with its classes, to the signed-in person. */
export function redeemCode(typed, user) {
  return tx(async () => {
    // Deleting is the claim, so a code works once even when sent twice at the same moment.
    const claimed = await get(
      'DELETE FROM teacher_code WHERE code_hash = ? AND expires_at > ? RETURNING membership_id', sha256(tidy(typed)), Date.now(),
    ) || fail(400, 'code_wrong');
    const m = await get(
      `SELECT m.*, s.name AS school_name FROM membership m JOIN school s ON s.id = m.school_id
       WHERE m.id = ? AND m.role = 'teacher' AND m.active = 1`,
      claimed.membership_id,
    ) || fail(400, 'code_wrong');

    if (m.user_id !== user.id) {
      if (await hasJoined(m.user_id)) fail(409, 'code_used');
      if (await get(`SELECT 1 FROM membership WHERE user_id = ? AND school_id = ? AND role = 'teacher'`, user.id, m.school_id)) {
        fail(409, 'teacher_exists');
      }
      const prepared = await get('SELECT * FROM app_user WHERE id = ?', m.user_id);
      await update('membership', m.id, { user_id: user.id });
      await run(
        'UPDATE app_user SET name = COALESCE(name, ?), ui_lang = COALESCE(ui_lang, ?) WHERE id = ?',
        prepared.name, m.speak_lang, user.id,
      );
      // The placeholder goes, unless something else still belongs to it.
      await run(
        `DELETE FROM app_user WHERE id = ? AND NOT EXISTS (SELECT 1 FROM membership WHERE user_id = app_user.id)
           AND NOT EXISTS (SELECT 1 FROM guardian_link WHERE user_id = app_user.id)`,
        prepared.id,
      );
    }
    await audit(user.id, 'teacher.join', { schoolId: m.school_id, entity: 'membership', entityId: m.id });
    return { schoolId: m.school_id, schoolName: m.school_name };
  });
}
