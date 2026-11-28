// What a scanned QR means for the person holding the phone. A scan alone never grants access.
import { Router } from 'express';
import { get, all } from '../db/index.js';
import { fail, limiter } from '../lib/util.js';
import { loadClass, teachingMembership, membership } from '../auth/authorize.js';

export const router = Router();
const scanLimit = limiter({ max: 240, windowMs: 5 * 60_000 });

router.get('/resolve/s/:token', scanLimit, async (req, res) => {
  const { token } = req.params;
  if (await get('SELECT 1 FROM retired_token WHERE token = ?', token)) fail(410, 'qr_inactive');
  const student = await get('SELECT * FROM student WHERE token = ?', token) || fail(404, 'qr_not_found');
  if (!student.active) fail(410, 'qr_inactive');
  if (!req.user) return res.json({ access: 'login' });

  const cls = await loadClass(student.class_id);
  const card = { id: student.id, name: student.name, classId: cls.id, className: `${cls.name}${cls.section}` };
  const teaches = await teachingMembership(req.user.id, cls);
  const link = await get('SELECT * FROM guardian_link WHERE user_id = ? AND student_id = ?', req.user.id, student.id);

  // Someone who is both teacher and parent of this child picks a side with ?as=parent.
  if (teaches && !(link?.status === 'active' && req.query.as === 'parent')) {
    return res.json({ access: 'record', student: card, alsoParent: link?.status === 'active' });
  }
  if (link?.status === 'active') {
    return res.json(link.consent_at
      ? { access: 'listen', studentId: student.id }
      : { access: 'consent', linkId: link.id, student: card });
  }
  if (link?.status === 'pending') return res.json({ access: 'pending', student: card });
  if (link?.status === 'rejected') return res.json({ access: 'rejected', student: card });
  if (await membership(req.user.id, cls.school_id, 'admin')) return res.json({ access: 'manage', student: card });
  res.json({ access: 'request', student: { name: student.name.split(' ')[0], className: card.className } });
});

router.get('/resolve/k/:schoolToken', scanLimit, async (req, res) => {
  const school = await get('SELECT id, name FROM school WHERE school_token = ?', req.params.schoolToken) || fail(404, 'qr_not_found');
  if (!req.user) return res.json({ access: 'login', school: { name: school.name } });

  if (await membership(req.user.id, school.id, 'teacher')) return res.json({ access: 'record', school });
  const children = await all(
    `SELECT gl.id AS "linkId", gl.status, gl.consent_at, s.id AS "studentId", s.name FROM guardian_link gl
     JOIN student s ON s.id = gl.student_id
     WHERE gl.user_id = ? AND s.school_id = ? AND gl.status IN ('active','pending') AND s.active = 1`,
    req.user.id, school.id,
  );
  if (children.length) return res.json({ access: 'listen', school, children });
  if (await membership(req.user.id, school.id, 'admin')) return res.json({ access: 'manage', school });
  res.json({ access: 'unlinked', school });
});
