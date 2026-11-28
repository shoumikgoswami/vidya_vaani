// Finding, creating and linking people by a verified phone number or email address.
import { get, all, run, insert, update, tx } from '../db/index.js';
import { now, audit } from '../lib/util.js';

export const userByPhone = async (phone) => (phone ? await get('SELECT * FROM app_user WHERE phone = ?', phone) : undefined);
export const userByEmail = async (email) => (email ? await get('SELECT * FROM app_user WHERE email = ?', email) : undefined);
export const userById = (id) => get('SELECT * FROM app_user WHERE id = ?', id);

/**
 * Used when an admin invites a teacher: the row exists before that person ever signs in.
 * An account that already exists never gains a phone or email here. Whoever types an identifier into
 * a form has proved nothing, and signing in with it would open that person's account.
 */
export async function findOrCreateUser({ phone = null, email = null, name = null, isDemo = 0 }) {
  const existing = await userByPhone(phone) || await userByEmail(email);
  if (existing) {
    if (!existing.name && name) await update('app_user', existing.id, { name });
    return userById(existing.id);
  }
  const id = await insert('app_user', { phone, email, name, is_demo: isDemo ? 1 : 0, created_at: now() });
  return userById(id);
}

/** The accounts holding any of these identifiers, phone matches first. */
async function usersFor(phones, emails) {
  const found = [];
  for (const phone of phones) found.push(await userByPhone(phone));
  for (const email of emails) found.push(await userByEmail(email));
  return found.filter(Boolean);
}

/**
 * Signs in someone whose phones and emails were verified by Clerk or the demo OTP.
 * Matching order: Clerk id, verified phone, verified email.
 */
export function userForIdentity({ clerkUserId = null, phones = [], emails = [], name = null }) {
  return tx(async () => {
    if (clerkUserId) await releaseFromSamples(phones, emails);
    let user = clerkUserId ? await get('SELECT * FROM app_user WHERE clerk_user_id = ?', clerkUserId) : undefined;
    user ||= (await usersFor(phones, emails))[0];

    if (!user) {
      const id = await insert('app_user', {
        phone: phones[0] ?? null, email: emails[0] ?? null, clerk_user_id: clerkUserId, name, created_at: now(),
      });
      user = await userById(id);
    } else {
      // A Clerk sign-in is a real person. The demo phone login proves nothing, so a sample person
      // signing in that way stays a sample person.
      const patch = clerkUserId ? { is_demo: 0 } : {};
      if (clerkUserId && !user.clerk_user_id) patch.clerk_user_id = clerkUserId;
      if (name && !user.name) patch.name = name;
      if (!user.phone && phones[0] && !await userByPhone(phones[0])) patch.phone = phones[0];
      if (!user.email && emails[0] && !await userByEmail(emails[0])) patch.email = emails[0];
      await update('app_user', user.id, patch);
      user = await userById(user.id);
    }
    // A second verified identifier may belong to an invited placeholder row. Fold it into this account.
    for (const other of await usersFor(phones, emails)) {
      if ( other.id !== user.id && !other.clerk_user_id) await mergeUsers(other.id, user.id);
    }
    await autoLinkGuardian(user.id, { phones, emails });
    return userById(user.id);
  });
}

/**
 * Anyone may act as the sample school's office and type anything into it. So a real sign-in never
 * takes over an account made there: that account gives up the verified phone or email instead.
 */
async function releaseFromSamples(phones, emails) {
  for (const [column, values] of [['phone', phones], ['email', emails]]) {
    for (const value of values) {
      await run(`UPDATE app_user SET ${column} = NULL WHERE ${column} = ? AND is_demo = 1 AND clerk_user_id IS NULL`, value);
    }
  }
}

async function mergeUsers(fromId, intoId) {
  const from = await userById(fromId);
  if (!from) return;
  // Rows the kept account already has are left behind and go with the old account.
  await run(
    `UPDATE membership SET user_id = ? WHERE user_id = ? AND NOT EXISTS (
       SELECT 1 FROM membership x WHERE x.user_id = ? AND x.school_id = membership.school_id AND x.role = membership.role)`,
    intoId, fromId, intoId,
  );
  await run(
    `UPDATE guardian_link SET user_id = ? WHERE user_id = ? AND NOT EXISTS (
       SELECT 1 FROM guardian_link x WHERE x.user_id = ? AND x.student_id = guardian_link.student_id)`,
    intoId, fromId, intoId,
  );
  await run('UPDATE note SET author_user_id = ? WHERE author_user_id = ?', intoId, fromId);
  await run('DELETE FROM app_user WHERE id = ?', fromId);
  const into = await userById(intoId);
  await update('app_user', intoId, {
    phone: into.phone || from.phone,
    email: into.email || from.email,
    name: into.name || from.name,
  });
}

/** A parent whose verified phone or email is on a child's record is linked at once (spec 2.2). */
export async function autoLinkGuardian(userId, { phones = [], emails = [] }) {
  const matches = new Map();
  for (const phone of phones) {
    for (const s of await all('SELECT id, school_id FROM student WHERE parent_phone = ? AND active = 1', phone)) matches.set(s.id, s);
  }
  for (const email of emails) {
    for (const s of await all('SELECT id, school_id FROM student WHERE parent_email = ? AND active = 1', email)) matches.set(s.id, s);
  }
  for (const student of matches.values()) {
    const link = await get('SELECT * FROM guardian_link WHERE student_id = ? AND user_id = ?', student.id, userId);
    if (!link) {
      await insert('guardian_link', {
        student_id: student.id, user_id: userId, relation: 'parent', status: 'active', auto_verified: 1, created_at: now(),
      });
      await audit(userId, 'link.auto', { schoolId: student.school_id, entity: 'student', entityId: student.id });
    } else if (link.status === 'pending') {
      await update('guardian_link', link.id, { status: 'active', auto_verified: 1 });
    }
  }
  return matches.size;
}
