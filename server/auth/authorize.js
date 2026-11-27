// Every permission decision in one place (spec section 1, permission matrix).
import { get, all } from '../db/index.js';
import { fail } from '../lib/util.js';

export const membershipsFor = (userId) =>
  all('SELECT * FROM membership WHERE user_id = ? AND active = 1', userId);

export const membership = (userId, schoolId, role) =>
  get('SELECT * FROM membership WHERE user_id = ? AND school_id = ? AND role = ? AND active = 1', userId, schoolId, role);

/** Office rights apply only to a session that came through the school office sign-in. */
export const adminMembership = (user, schoolId) =>
  (user.portal === 'school' ? membership(user.id, schoolId, 'admin') : undefined);

export function requireAdmin(user, schoolId) {
  const admin = membership(user.id, schoolId, 'admin') || fail(403, 'forbidden');
  if (user.portal !== 'school') fail(403, 'school_sign_in_needed');
  return admin;
}

export function loadClass(classId) {
  return get('SELECT * FROM class WHERE id = ?', classId) || fail(404, 'class_not_found');
}

/** The teacher membership when this user teaches the class, otherwise undefined. */
export function teachingMembership(userId, cls) {
  return get(
    `SELECT m.* FROM membership m
     WHERE m.user_id = ? AND m.school_id = ? AND m.role = 'teacher' AND m.active = 1
       AND (m.id = ? OR EXISTS (SELECT 1 FROM class_teacher ct WHERE ct.class_id = ? AND ct.membership_id = m.id))`,
    userId, cls.school_id, cls.class_teacher_id, cls.id,
  );
}

/** Recording a note: assigned teachers only. */
export function requireTeacherOfClass(user, classId) {
  const cls = loadClass(classId);
  const m = teachingMembership(user.id, cls) || fail(403, 'forbidden');
  return { cls, membership: m };
}

/** Students, stickers, QR rotation, receipts: the class's teachers and school admins. */
export function requireClassManager(user, classId) {
  const cls = loadClass(classId);
  const m = teachingMembership(user.id, cls) || adminMembership(user, cls.school_id) || fail(403, 'forbidden');
  return { cls, membership: m };
}

export function requireStudentManager(user, studentId) {
  const student = get('SELECT * FROM student WHERE id = ?', studentId) || fail(404, 'student_not_found');
  return { student, ...requireClassManager(user, student.class_id) };
}

/** Second guardians are approved by the class teacher or a school admin. */
export function requireApprover(user, classId) {
  const cls = loadClass(classId);
  const classTeacher = get(
    `SELECT * FROM membership WHERE id = ? AND user_id = ? AND active = 1`, cls.class_teacher_id, user.id,
  );
  return { cls, membership: classTeacher || adminMembership(user, cls.school_id) || fail(403, 'forbidden') };
}

export const activeLink = (userId, studentId) =>
  get(
    `SELECT * FROM guardian_link WHERE user_id = ? AND student_id = ? AND status = 'active' AND consent_at IS NOT NULL`,
    userId, studentId,
  );

export function requireChild(user, studentId) {
  return activeLink(user.id, studentId) || fail(403, 'forbidden');
}

/** The recipient students of a note that this parent is linked to (with consent). */
export const linkedRecipients = (userId, noteId) =>
  all(
    `SELECT gl.*, s.name AS student_name FROM note_recipient nr
     JOIN guardian_link gl ON gl.student_id = nr.student_id AND gl.user_id = ?
       AND gl.status = 'active' AND gl.consent_at IS NOT NULL
     JOIN student s ON s.id = nr.student_id
     WHERE nr.note_id = ?`,
    userId, noteId,
  );

/**
 * How this user may see a note: 'author', 'teacher', 'parent', or a 403.
 * A parent can never reach another child's note by guessing its id.
 */
export function noteAccess(user, noteId) {
  const note = get('SELECT * FROM note WHERE id = ?', noteId) || fail(404, 'note_not_found');
  if (note.author_user_id === user.id) return { note, as: 'author' };

  if (!note.published_at) fail(403, 'forbidden');

  const cls = loadClass(note.class_id);
  const teaching = teachingMembership(user.id, cls);
  if (teaching) {
    if (cls.class_teacher_id === teaching.id) return { note, as: 'teacher' };
    if (note.kind === 'parent_reply' && note.parent_note_id) {
      const original = get('SELECT author_user_id FROM note WHERE id = ?', note.parent_note_id);
      if (original?.author_user_id === user.id) return { note, as: 'teacher' };
    }
  }
  const links = linkedRecipients(user.id, note.id);
  if (links.length) return { note, as: 'parent', links };
  fail(403, 'forbidden');
}
