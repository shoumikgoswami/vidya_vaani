// Finding, creating and linking people by a verified phone number or email address.
import { get, all, run, insert, update, tx } from '../db/index.js';
import { now, audit } from '../lib/util.js';

export const userByPhone = (phone) => (phone ? get('SELECT * FROM user WHERE phone = ?', phone) : undefined);
export const userByEmail = (email) => (email ? get('SELECT * FROM user WHERE email = ?', email) : undefined);
export const userById = (id) => get('SELECT * FROM user WHERE id = ?', id);

/** Used when an admin invites a teacher: the row exists before that person ever signs in. */
export function findOrCreateUser({ phone = null, email = null, name = null, isDemo = 0 }) {
  const existing = userByPhone(phone) || userByEmail(email);
  if (existing) {
    const patch = {};
    if (!existing.name && name) patch.name = name;
    if (!existing.phone && phone && !userByPhone(phone)) patch.phone = phone;
    if (!existing.email && email && !userByEmail(email)) patch.email = email;
    update('user', existing.id, patch);
    return userById(existing.id);
  }
  const id = insert('user', { phone, email, name, is_demo: isDemo ? 1 : 0, created_at: now() });
  return userById(id);
}

/**
 * Signs in someone whose phones and emails were verified by Clerk or the demo OTP.
 * Matching order: Clerk id, verified phone, verified email.
 */
export function userForIdentity({ clerkUserId = null, phones = [], emails = [], name = null }) {
  return tx(() => {
    let user = clerkUserId ? get('SELECT * FROM user WHERE clerk_user_id = ?', clerkUserId) : undefined;
    user ||= phones.map(userByPhone).find(Boolean) || emails.map(userByEmail).find(Boolean);

    if (!user) {
      const id = insert('user', {
        phone: phones[0] ?? null, email: emails[0] ?? null, clerk_user_id: clerkUserId, name, created_at: now(),
      });
      user = userById(id);
    } else {
      const patch = { is_demo: 0 };
      if (clerkUserId && !user.clerk_user_id) patch.clerk_user_id = clerkUserId;
      if (name && !user.name) patch.name = name;
      if (!user.phone && phones[0] && !userByPhone(phones[0])) patch.phone = phones[0];
      if (!user.email && emails[0] && !userByEmail(emails[0])) patch.email = emails[0];
      update('user', user.id, patch);
      user = userById(user.id);
    }
    // A second verified identifier may belong to an invited placeholder row. Fold it into this account.
    for (const other of [...phones.map(userByPhone), ...emails.map(userByEmail)]) {
      if (other && other.id !== user.id && !other.clerk_user_id) mergeUsers(other.id, user.id);
    }
    autoLinkGuardian(user.id, { phones, emails });
    return userById(user.id);
  });
}

function mergeUsers(fromId, intoId) {
  const from = userById(fromId);
  if (!from) return;
  run('UPDATE OR IGNORE membership SET user_id = ? WHERE user_id = ?', intoId, fromId);
  run('UPDATE OR IGNORE guardian_link SET user_id = ? WHERE user_id = ?', intoId, fromId);
  run('UPDATE note SET author_user_id = ? WHERE author_user_id = ?', intoId, fromId);
  run('DELETE FROM user WHERE id = ?', fromId);
  const into = userById(intoId);
  update('user', intoId, {
    phone: into.phone || from.phone,
    email: into.email || from.email,
    name: into.name || from.name,
  });
}

/** A parent whose verified phone or email is on a child's record is linked at once (spec 2.2). */
export function autoLinkGuardian(userId, { phones = [], emails = [] }) {
  const matches = new Map();
  for (const phone of phones) {
    for (const s of all('SELECT id, school_id FROM student WHERE parent_phone = ? AND active = 1', phone)) matches.set(s.id, s);
  }
  for (const email of emails) {
    for (const s of all('SELECT id, school_id FROM student WHERE parent_email = ? AND active = 1', email)) matches.set(s.id, s);
  }
  for (const student of matches.values()) {
    const link = get('SELECT * FROM guardian_link WHERE student_id = ? AND user_id = ?', student.id, userId);
    if (!link) {
      insert('guardian_link', {
        student_id: student.id, user_id: userId, relation: 'parent', status: 'active', auto_verified: 1, created_at: now(),
      });
      audit(userId, 'link.auto', { schoolId: student.school_id, entity: 'student', entityId: student.id });
    } else if (link.status === 'pending') {
      update('guardian_link', link.id, { status: 'active', auto_verified: 1 });
    }
  }
  return matches.size;
}
