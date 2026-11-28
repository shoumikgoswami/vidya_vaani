// A new teacher joins with the one-time code the school office gave them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, DEMO } from './helpers/app.js';

let app;
let office;
let school;
let class5;

before(async () => {
  app = await startApp();
  office = await app.client().login(DEMO.admin, 'school');
  school = (await app.db.get('SELECT id FROM school WHERE is_demo = 1')).id;
  class5 = (await app.db.get(`SELECT id FROM class WHERE name = '5'`)).id;
});

after(() => app.stop());

const addTeacher = (name, extra = {}) => office.post('/api/teachers', { school, name, speakLang: 'hi', ...extra });
const teacher = async (id) => (await office.get(`/api/teachers?school=${school}`)).data.teachers.find((x) => x.id === id);

test('a name is enough to add a teacher, who joins once with the code and gets the classes', async () => {
  const added = await addTeacher('Nisha Patel');
  assert.equal(added.status, 201);
  assert.match(added.data.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM teacher_code WHERE code_hash = ?', added.data.code)).n, 0, 'only a fingerprint is kept');
  assert.equal((await teacher(added.data.id)).joined, false);
  await office.patch(`/api/classes/${class5}`, {
    teachers: [{ membershipId: added.data.id }], classTeacherId: added.data.id,
  });

  assert.equal((await app.client().post('/api/join', { code: added.data.code })).status, 401);
  const nisha = await app.client().login('9822200001');
  assert.equal((await nisha.get(`/api/classes/${class5}`)).status, 403);
  const joined = await nisha.post('/api/join', { code: ` ${added.data.code.toLowerCase().replace('-', ' ')} ` });
  assert.equal(joined.status, 201, JSON.stringify(joined.data));
  assert.equal(joined.data.schoolName, 'Sarvodaya Vidyalaya');
  assert.equal((await nisha.get(`/api/classes/${class5}`)).status, 200);
  const me = (await nisha.get('/api/me')).data;
  assert.equal(me.user.name, 'Nisha Patel');
  assert.deepEqual(me.memberships.map((m) => m.role), ['teacher']);
  assert.equal((await teacher(added.data.id)).joined, true);
  assert.equal((await app.db.get(`SELECT COUNT(*) AS n FROM app_user WHERE name = 'Nisha Patel'`)).n, 1, 'the placeholder is gone');

  const other = await app.client().login('9822200002');
  assert.equal((await other.post('/api/join', { code: added.data.code })).data.error, 'code_wrong', 'used once');
  assert.equal((await office.post(`/api/teachers/${added.data.id}/code`, {})).data.error, 'teacher_joined');
});

test('an old or expired code does not work, and guessing is stopped', async () => {
  const added = await addTeacher('Ravi Teacher');
  const fresh = await office.post(`/api/teachers/${added.data.id}/code`, {});
  assert.equal(fresh.status, 201);
  const person = await app.client().login('9822200003');
  assert.equal((await person.post('/api/join', { code: added.data.code })).data.error, 'code_wrong', 'replaced');
  await app.db.run('UPDATE teacher_code SET expires_at = 1 WHERE membership_id = ?', added.data.id);
  assert.equal((await person.post('/api/join', { code: fresh.data.code })).data.error, 'code_wrong', 'expired');
  for (let i = 0; i < 6; i += 1) await person.post('/api/join', { code: 'AAAA-AAAA' });
  assert.equal((await person.post('/api/join', { code: 'AAAA-AAAA' })).status, 429);
});

test('someone already teaching here cannot take a second record, and the code is kept for its owner', async () => {
  const added = await addTeacher('Second Record');
  const meena = await app.client().login(DEMO.meena);
  assert.equal((await meena.post('/api/join', { code: added.data.code })).data.error, 'teacher_exists');
  const owner = await app.client().login('9822200004');
  assert.equal((await owner.post('/api/join', { code: added.data.code })).status, 201);
});

test('only the office of that school can make codes', async () => {
  const added = await addTeacher('Guarded');
  const meena = await app.client().login(DEMO.meena);
  assert.equal((await meena.post(`/api/teachers/${added.data.id}/code`, {})).status, 403);
});
