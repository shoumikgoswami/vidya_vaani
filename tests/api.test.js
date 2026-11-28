// The acceptance tests of spec section 17 that need no AI key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, uuid, DEMO } from './helpers/app.js';

let app;
let admin;
let meena;
let sunita;
let ids;

before(async () => {
  app = await startApp();
  admin = await app.client().login(DEMO.admin, 'school');
  meena = await app.client().login(DEMO.meena);
  sunita = await app.client().login(DEMO.sunita);
  const { get } = app.db;
  ids = {
    school: (await get('SELECT id FROM school WHERE is_demo = 1')).id,
    class5: (await get(`SELECT id FROM class WHERE name = '5'`)).id,
    class7: (await get(`SELECT id FROM class WHERE name = '7'`)).id,
    ravi: (await get(`SELECT id FROM student WHERE name = 'Ravi Kumar'`)).id,
    priya: (await get(`SELECT id FROM student WHERE name = 'Priya Sharma'`)).id,
    otherNote: (await get(`SELECT id FROM note WHERE class_id = (SELECT id FROM class WHERE name = '7')`)).id,
  };
});

after(() => app.stop());

async function record(teacher, { classId = ids.class5, recipients = [ids.ravi], publish = true, ...fields } = {}) {
  const created = await teacher.upload('/api/notes', app.noteForm({
    client_uuid: uuid(), class_id: classId, recipients: recipients === 'class' ? 'class' : JSON.stringify(recipients),
    lang_hint: 'hi', duration_ms: 2000, ...fields,
  }));
  assert.equal(created.status, 201, JSON.stringify(created.data));
  await app.drain();
  if (publish) {
    assert.equal((await teacher.post(`/api/notes/${created.data.id}/publish`, { captureMs: 9000 })).status, 200);
    await app.drain();
  }
  return created.data.id;
}

test('starts with no keys and serves the app, not a default page', async () => {
  const guest = app.client();
  assert.deepEqual((await guest.get('/healthz')).data, { ok: true });
  assert.match((await guest.get('/')).data.toString(), /Vidya Vaani/);
  assert.match((await guest.get('/s/anything')).data.toString(), /Vidya Vaani/);
  const config = (await guest.get('/api/config')).data;
  assert.equal(config.demoMode, true);
  assert.equal(config.clerk, null);
  assert.equal(config.ai.nvidia, false);
  assert.equal((await guest.get('/vendor/jsqr.js')).status, 200);
  assert.equal((await guest.get('/vendor/icons/bold/microphone-bold.svg')).status, 200);
  assert.match((await guest.get('/vendor/fonts.css')).data.toString(), /unicode-range/);
});

test('writes without the CSRF token are refused', async () => {
  const res = await sunita.post('/api/privacy/delete-request', { confirm: true }, { headers: { 'X-CSRF-Token': 'wrong' } });
  assert.equal(res.status, 403);
  assert.equal(res.data.error, 'csrf_failed');
});

test('a scan alone gives nothing away', async () => {
  const token = (await app.db.get('SELECT token FROM student WHERE id = ?', ids.ravi)).token;
  assert.equal(token.length, 22);
  const res = await app.client().get(`/api/resolve/s/${token}`);
  assert.deepEqual(res.data, { access: 'login' });
});

test('a parent cannot open another child\'s note, audio or diary by id', async () => {
  assert.equal((await sunita.get(`/api/notes/${ids.otherNote}`)).status, 403);
  assert.equal((await sunita.get(`/api/notes/${ids.otherNote}/audio`)).status, 403);
  assert.equal((await sunita.get(`/api/notes/${ids.otherNote}/translation/hi`)).status, 403);
  assert.equal((await sunita.get(`/api/children/${ids.priya}/notes`)).status, 403);
  assert.equal((await sunita.get(`/api/classes/${ids.class5}`)).status, 403);
  assert.equal((await app.client().get(`/api/notes/${ids.otherNote}`)).status, 401);
});

test('cross-language sample: English audio with a Hindi translation', async () => {
  const diary = (await sunita.get(`/api/children/${ids.ravi}/notes`)).data;
  assert.equal(diary.readLang, 'hi');
  const english = diary.notes.find((n) => n.lang === 'en' && n.tags.some((t) => t.type === 'homework'));
  assert.ok(english.translated);
  assert.match(english.shown, /24/);
  const audio = await sunita.get(english.audioUrl);
  assert.equal(audio.status, 200);
  assert.ok(audio.data.length > 500);
});

test('a teacher note without a key keeps the browser text and finds tags and dates', async () => {
  const lakshmi = await app.client().login(DEMO.lakshmi);
  const id = await record(lakshmi, {
    publish: false, lang_hint: 'hi', browser_preview_text: 'कल हिंदी का होमवर्क है। शुक्रवार तक फीस जमा करनी है।',
  });
  const note = (await lakshmi.get(`/api/notes/${id}`)).data;
  assert.equal(note.status, 'ready');
  assert.equal(note.transcript.provider, 'browser');
  assert.deepEqual(note.tags.map((t) => t.type).sort(), ['fee', 'homework']);
  assert.ok(note.tags.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate)));
  // Unsaved notes are invisible to parents.
  assert.equal((await sunita.get(`/api/notes/${id}`)).status, 403);
  await lakshmi.post(`/api/notes/${id}/publish`, {});
  assert.equal((await sunita.get(`/api/notes/${id}`)).status, 200);
});

test('with no browser text and no key, the voice alone is saved', async () => {
  const id = await record(meena);
  const note = (await meena.get(`/api/notes/${id}`)).data;
  assert.equal(note.status, 'audio_only');
  const patched = await meena.patch(`/api/notes/${id}`, { tags: [{ type: 'exam', dueDate: '2030-01-05' }] });
  assert.equal(patched.data.tags[0].source, 'teacher');
});

test('a typed note works when the microphone is refused', async () => {
  const form = new FormData();
  for (const [k, v] of Object.entries({ client_uuid: uuid(), class_id: ids.class5, recipients: JSON.stringify([ids.ravi]), lang_hint: 'en', typed_text: 'Bring the fees tomorrow.' })) form.set(k, v);
  const created = await meena.upload('/api/notes', form);
  assert.equal(created.status, 201);
  await app.drain();
  const note = (await meena.get(`/api/notes/${created.data.id}`)).data;
  assert.equal(note.transcript.provider, 'typed');
  assert.equal(note.audioUrl, null);
  assert.equal(note.tags[0].type, 'fee');
});

test('re-sending an offline note does not create a duplicate', async () => {
  const fields = { client_uuid: uuid(), class_id: ids.class5, recipients: JSON.stringify([ids.ravi]), duration_ms: 2000, publish: '1' };
  const first = await meena.upload('/api/notes', app.noteForm(fields));
  const again = await meena.upload('/api/notes', app.noteForm(fields));
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.data.id, first.data.id);
  assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM note WHERE client_uuid = ?', fields.client_uuid)).n, 1);
});

test('only assigned teachers record, and only for their own students', async () => {
  const fields = { client_uuid: uuid(), recipients: 'class', duration_ms: 2000 };
  assert.equal((await meena.upload('/api/notes', app.noteForm({ ...fields, class_id: ids.class7 }))).status, 403);
  assert.equal((await admin.upload('/api/notes', app.noteForm({ ...fields, class_id: ids.class5 }))).status, 403);
  const stranger = (await app.db.get('SELECT id FROM student WHERE class_id = ?', ids.class7)).id;
  const wrong = await meena.upload('/api/notes', app.noteForm({ ...fields, class_id: ids.class5, recipients: JSON.stringify([stranger]) }));
  assert.equal(wrong.data.error, 'recipients_invalid');
});

test('a whole-class note reaches every diary and receipts update as parents play it', async () => {
  const id = await record(meena, { recipients: 'class' });
  let receipts = (await meena.get(`/api/notes/${id}/receipts`)).data;
  assert.equal(receipts.total, 10);
  assert.equal(receipts.heard, 0);
  await sunita.post(`/api/notes/${id}/listened`, {});
  await sunita.post(`/api/notes/${id}/listened`, {});
  const padma = await app.client().login(DEMO.padma);
  await padma.post(`/api/notes/${id}/listened`, {});
  receipts = (await meena.get(`/api/notes/${id}/receipts`)).data;
  assert.equal(receipts.heard, 2);
  assert.equal((await sunita.get(`/api/notes/${id}/receipts`)).status, 403);
  assert.equal((await meena.post(`/api/notes/${id}/nudge`, {})).data.reminded, 8);
  assert.equal((await meena.post(`/api/notes/${id}/nudge`, {})).status, 429);
});

test('a parent\'s voice reply reaches the teacher, and the teacher can answer', async () => {
  const id = await record(meena);
  const reply = await sunita.upload(`/api/notes/${id}/reply`, app.noteForm({
    client_uuid: uuid(), duration_ms: 2000, lang_hint: 'hi', browser_preview_text: 'समझ गई मैडम',
  }));
  assert.equal(reply.status, 201);
  await app.drain();
  const inbox = (await meena.get('/api/inbox')).data.replies;
  const found = inbox.find((r) => r.id === reply.data.id);
  assert.equal(found.student.name, 'Ravi Kumar');
  assert.equal(found.text, 'समझ गई मैडम');
  // Another family never sees it.
  const padma = await app.client().login(DEMO.padma);
  assert.equal((await padma.get(`/api/notes/${reply.data.id}`)).status, 403);
  const answer = await meena.upload(`/api/notes/${reply.data.id}/reply`, app.noteForm({ client_uuid: uuid(), duration_ms: 2000 }));
  assert.equal(answer.status, 201);
  assert.equal((await sunita.get(`/api/notes/${answer.data.id}`)).status, 200);
});

test('students: add, duplicate warning across scripts, automatic and approved linking', async () => {
  const added = await meena.post(`/api/classes/${ids.class5}/students`, {
    students: [{ name: 'Gita Bai', parentPhone: '98111 22233' }],
  });
  assert.equal(added.data.created.length, 1);
  const duplicate = await meena.post(`/api/classes/${ids.class5}/students`, { students: [{ name: 'रवि कुमार' }] });
  assert.equal(duplicate.data.created.length, 0);
  assert.equal(duplicate.data.duplicates[0].existing[0].name, 'Ravi Kumar');
  const { id: studentId } = added.data.created[0];
  const { token } = await app.db.get('SELECT token FROM student WHERE id = ?', studentId);

  const mother = await app.client().login('+919811122233');
  const mine = (await mother.get(`/api/resolve/s/${token}`)).data;
  assert.equal(mine.access, 'consent');
  assert.equal((await mother.get(`/api/children/${studentId}/notes`)).status, 403, 'consent comes first');
  await mother.post(`/api/links/${mine.linkId}/consent`, { readLang: 'mr' });
  assert.equal((await mother.get(`/api/children/${studentId}/notes`)).status, 200);

  const uncle = await app.client().login('+919822233344');
  assert.equal((await uncle.get(`/api/resolve/s/${token}`)).data.access, 'request');
  const asked = await uncle.post('/api/links/request', { token, relation: 'other' });
  assert.equal(asked.data.status, 'pending');
  assert.equal((await uncle.get(`/api/children/${studentId}/notes`)).status, 403);
  assert.equal((await uncle.post(`/api/approvals/${asked.data.linkId}`, { action: 'approve' })).status, 403);
  assert.equal((await meena.post(`/api/approvals/${asked.data.linkId}`, { action: 'approve' })).status, 200);
  assert.equal((await uncle.get(`/api/resolve/s/${token}`)).data.access, 'consent');
});

test('speaking or pasting a list fills the form without a key', async () => {
  const form = new FormData();
  form.set('kind', 'list');
  form.set('text', '1. Asha Rani, 9876501234\n2. Mohan Lal 98765 05678');
  const res = await meena.upload('/api/formfill', form);
  assert.deepEqual(res.data.people.map((p) => [p.name, p.phone]), [['Asha Rani', '+919876501234'], ['Mohan Lal', '+919876505678']]);
});

test('stickers print for managers only, and a rotated QR stops working', async () => {
  const sheet = await meena.get(`/api/classes/${ids.class5}/stickers`);
  assert.match(sheet.data.students[0].svg, /^<svg/);
  assert.equal((await sunita.get(`/api/classes/${ids.class5}/stickers`)).status, 403);
  const old = (await app.db.get('SELECT token FROM student WHERE id = ?', ids.priya)).token;
  const rotated = await meena.post(`/api/students/${ids.priya}/rotate-token`, {});
  assert.notEqual(rotated.data.token, old);
  const dead = await meena.get(`/api/resolve/s/${old}`);
  assert.equal(dead.status, 410);
  assert.equal(dead.data.error, 'qr_inactive');
  assert.equal((await meena.get(`/api/resolve/s/${rotated.data.token}`)).data.access, 'record');
});

test('school settings and teachers belong to the admin', async () => {
  assert.equal((await meena.patch(`/api/school?school=${ids.school}`, { name: 'Hacked' })).status, 403);
  const added = await admin.post('/api/teachers', { school: ids.school, name: 'Farida Khan', phone: '9833344455', speakLang: 'ur' });
  assert.equal(added.status, 201);
  assert.equal((await admin.post('/api/teachers', { school: ids.school, name: 'Farida Khan', phone: '9833344455', speakLang: 'ur' })).status, 409);
  await admin.patch(`/api/school?school=${ids.school}`, { qrMode: 'per_school' });
  const qr = (await admin.get(`/api/school-qr?school=${ids.school}`)).data;
  assert.match(qr.url, /\/k\/[A-Za-z0-9]{22}$/);
  const schoolToken = qr.url.split('/k/')[1];
  assert.equal((await sunita.get(`/api/resolve/k/${schoolToken}`)).data.access, 'listen');
  assert.equal((await meena.get(`/api/resolve/k/${schoolToken}`)).data.access, 'record');
  await admin.patch(`/api/school?school=${ids.school}`, { qrMode: 'per_student' });
});

test('promotion moves 5A to 6A and old notes stay visible to parents', async () => {
  const before = (await sunita.get(`/api/children/${ids.ravi}/notes`)).data.notes.length;
  const anjali = (await app.db.get(`SELECT id FROM student WHERE name = 'Anjali Nair'`)).id;
  const result = await admin.post(`/api/classes/${ids.class5}/promote`, {
    name: '6', section: 'A', year: '2030-31', decisions: { [anjali]: 'hold' },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.counts.hold, 1);
  const me = (await sunita.get('/api/me')).data;
  assert.equal(me.children[0].className, '6A');
  const after = (await sunita.get(`/api/children/${ids.ravi}/notes`)).data.notes;
  assert.equal(after.length, before);
  assert.equal(after[0].className, '5A');
});

test('metrics and the activity log answer the admin', async () => {
  const metrics = (await admin.get(`/api/metrics?school=${ids.school}`)).data;
  assert.ok(metrics.notes >= 5);
  assert.equal(metrics.heardIn24h.target, 70);
  assert.equal((await admin.post('/api/metrics/outcomes', { school: ids.school, period: 'Nov', homeworkDonePct: 81 })).status, 201);
  const log = (await admin.get(`/api/audit?school=${ids.school}`)).data.entries;
  assert.ok(log.some((e) => e.action === 'class.promote'));
  assert.equal((await sunita.get(`/api/metrics?school=${ids.school}`)).status, 403);
});

test('demo sign-in code: wrong codes fail and sends are limited', async () => {
  const guest = app.client();
  const sent = await guest.post('/api/auth/otp/send', { phone: '9844455566' });
  const wrong = sent.data.demoCode === '000000' ? '111111' : '000000';
  assert.equal((await guest.post('/api/auth/otp/verify', { phone: '9844455566', code: wrong })).data.error, 'otp_wrong');
  await guest.post('/api/auth/otp/send', { phone: '9844455566' });
  await guest.post('/api/auth/otp/send', { phone: '9844455566' });
  assert.equal((await guest.post('/api/auth/otp/send', { phone: '9844455566' })).data.error, 'otp_too_many_sends');
});

test('the setup wizard runs once, and demo switching never reaches a real account', async () => {
  const guest = app.client();
  // Before any school exists the office sign-in still turns teachers away, but admits a newcomer.
  const sent = await guest.post('/api/auth/otp/send', { phone: DEMO.arjun });
  const teacher = await guest.post('/api/auth/otp/verify', { phone: DEMO.arjun, code: sent.data.demoCode, portal: 'school' });
  assert.equal(teacher.data.error, 'not_school_staff');
  const newcomer = await app.client().login('9811199999', 'school');
  assert.equal((await newcomer.get('/api/me')).data.portal, 'school');
  const made = await guest.post('/api/setup', {
    schoolName: 'Asli School', adminName: 'Real Owner', phone: '9855566677', defaultLang: 'hi', qrMode: 'per_student',
  });
  assert.equal(made.status, 201);
  assert.equal((await guest.post('/api/setup', { schoolName: 'Second', adminName: 'Other', phone: '9855566678', defaultLang: 'hi', qrMode: 'per_student' })).status, 409);
  const owner = await app.db.get(`SELECT id FROM app_user WHERE phone = '+919855566677'`);
  assert.equal((await guest.post('/api/demo/login', { userId: owner.id })).status, 403);

  // A demo person who gains a real role is no longer open to demo sign-in.
  const real = (await app.db.get('SELECT id FROM school WHERE is_demo = 0')).id;
  const meenaId = (await app.db.get('SELECT id FROM app_user WHERE phone = ?', DEMO.meena)).id;
  await app.db.run(`INSERT INTO membership (user_id, school_id, role, created_at) VALUES (?,?, 'teacher', '2026')`, meenaId, real);
  assert.equal((await guest.post('/api/demo/login', { userId: meenaId })).status, 403);
});

test('text-to-speech falls back to the phone voice without a key', async () => {
  assert.equal((await sunita.get('/api/tts?lang=hi&text=hello')).status, 204);
});

test('a parent can delete their data', async () => {
  const bimal = await app.client().login(DEMO.bimal);
  const userId = (await app.db.get('SELECT id FROM app_user WHERE phone = ?', DEMO.bimal)).id;
  assert.equal((await bimal.post('/api/privacy/delete-request', { confirm: true })).status, 200);
  assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM guardian_link WHERE user_id = ?', userId)).n, 0);
  assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM listen_receipt WHERE user_id = ?', userId)).n, 0);
  assert.equal((await bimal.get(`/api/children/${ids.ravi}/notes`)).status, 401);
});

test('a username-only account stays separate and is never linked automatically', async () => {
  const { userForIdentity } = await import('../server/auth/users.js');
  const first = await userForIdentity({ clerkUserId: 'user_a', name: 'asha_01' });
  const second = await userForIdentity({ clerkUserId: 'user_b', name: 'ravi_papa' });
  assert.notEqual(first.id, second.id);
  assert.equal((await userForIdentity({ clerkUserId: 'user_a' })).id, first.id);
  assert.equal(first.phone, null);
  assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM guardian_link WHERE user_id IN (?,?)', first.id, second.id)).n, 0);
});

test('the school office has its own sign-in', async () => {
  // A parent or teacher is turned away, and gets no session.
  const outsider = app.client();
  const sent = await outsider.post('/api/auth/otp/send', { phone: '9866677788' });
  const real = await app.db.get('SELECT id FROM school WHERE is_demo = 0');
  assert.ok(real, 'a school exists, so the first-run exception does not apply');
  const refused = await outsider.post('/api/auth/otp/verify', { phone: '9866677788', code: sent.data.demoCode, portal: 'school' });
  assert.equal(refused.status, 403);
  assert.equal(refused.data.error, 'not_school_staff');
  assert.equal((await outsider.get('/api/me')).data.user, null);

  // An admin who comes through the teacher and parent door has no office rights.
  const wrongDoor = await app.client().login(DEMO.admin);
  assert.equal((await wrongDoor.get('/api/me')).data.portal, 'family');
  const blocked = await wrongDoor.get(`/api/school?school=${ids.school}`);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error, 'school_sign_in_needed');
  assert.equal((await wrongDoor.get(`/api/classes/${ids.class7}`)).status, 403);
  assert.equal((await wrongDoor.get(`/api/school/config?school=${ids.school}`)).status, 403);

  const office = await app.client().login(DEMO.admin, 'school');
  const technical = (await office.get(`/api/school/config?school=${ids.school}`)).data;
  assert.equal(technical.system.database, 'builtin');
  assert.ok(Array.isArray(technical.aiUsage) && Array.isArray(technical.quality));
  // The figures teachers can read carry nothing technical.
  const teacher = await app.client().login(DEMO.meena);
  const figures = (await teacher.get(`/api/metrics?school=${ids.school}`)).data;
  assert.ok(!('aiUsage' in figures) && !('quality' in figures));
  assert.equal((await teacher.get(`/api/school/config?school=${ids.school}`)).status, 403);
  assert.equal((await office.get('/api/me')).data.portal, 'school');
  assert.equal((await office.get(`/api/school?school=${ids.school}`)).status, 200);
});

test('a sample person who signs in by demo phone code stays in the demo switcher', async () => {
  const guest = app.client();
  await app.client().login(DEMO.lakshmi);
  const { personas } = (await guest.get('/api/demo/personas')).data;
  assert.ok(personas.some((p) => p.key === 'lakshmi'));
});

test('demo data can be reset', async () => {
  assert.equal((await app.client().post('/api/demo/reset', {})).status, 200);
  assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM school WHERE is_demo = 1')).n, 1);
  assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM school WHERE is_demo = 0')).n, 1);
});
