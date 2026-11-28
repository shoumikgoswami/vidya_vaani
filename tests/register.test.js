// Schools ask to join, the owner approves, and one school's office never reaches another's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, DEMO } from './helpers/app.js';

const OWNER = 'owner@example.org';
let app;
let owner;
let demoSchool;

before(async () => {
  app = await startApp({ OWNER_EMAILS: OWNER });
  demoSchool = (await app.db.get('SELECT id FROM school WHERE is_demo = 1')).id;
  // Stands in for a Clerk sign-in that proved the owner's email.
  owner = await app.client().login('9800000001');
  const { id } = await app.db.get(`SELECT id FROM app_user WHERE phone = '+919800000001'`);
  await app.db.run('UPDATE session SET owner_email = ? WHERE user_id = ?', OWNER, id);
});

after(() => app.stop());

const form = (extra = {}) => ({
  schoolName: 'Gram Vidyalaya', contactName: 'Kamla Devi', phone: '9811100001', town: 'Rampur', lang: 'hi', ...extra,
});
const rows = () => app.db.all('SELECT * FROM school_request ORDER BY id');

test('with an owner set, nobody can claim the site through the first-run wizard', async () => {
  const guest = app.client();
  assert.equal((await guest.get('/api/config')).data.setupNeeded, false);
  const made = await guest.post('/api/setup', {
    schoolName: 'Taken', adminName: 'Stranger', phone: '9811100009', defaultLang: 'hi', qrMode: 'per_student',
  });
  assert.equal(made.status, 409);
});

test('a request is saved once, bad details are refused and form-filling programs are ignored', async () => {
  const guest = app.client();
  assert.equal((await guest.post('/api/register', form({ phone: '123' }))).data.error, 'phone_invalid');
  assert.equal((await guest.post('/api/register', form({ email: 'not-an-email' }))).data.error, 'email_invalid');
  assert.equal((await guest.post('/api/register', form({ website: 'http://spam' }))).status, 201);
  assert.equal((await rows()).length, 0);
  assert.equal((await guest.post('/api/register', form())).status, 201);
  assert.equal((await guest.post('/api/register', form({ town: 'Rampur Khas' }))).status, 201);
  assert.deepEqual((await rows()).map((r) => [r.town, r.status]), [['Rampur Khas', 'pending']]);
  assert.equal((await app.db.get('SELECT COUNT(*) AS n FROM school WHERE is_demo = 0')).n, 0, 'nothing is created yet');
  assert.equal((await guest.post('/api/register', form())).status, 429, 'five an hour from one address');
});

test('only the owner sees requests, and an email typed on an account counts for nothing', async () => {
  assert.equal((await app.client().get('/api/owner/requests')).status, 401);
  const pretender = await app.client().login('9800000002');
  await app.db.run(`UPDATE app_user SET email = ? WHERE phone = '+919800000002'`, OWNER);
  assert.equal((await pretender.get('/api/owner/requests')).status, 403);
  assert.equal((await pretender.get('/api/me')).data.owner, false);
  const office = await app.client().login(DEMO.admin, 'school');
  assert.equal((await office.get('/api/owner/requests')).status, 403);
  assert.equal((await owner.get('/api/me')).data.owner, true);
  assert.equal((await owner.get('/api/owner/requests')).data.requests.length, 1);
});

test('approving creates one school, and its office is closed to every other school', async () => {
  const [asked] = await rows();
  const approved = await owner.post(`/api/owner/requests/${asked.id}/approve`, {});
  assert.equal(approved.status, 201);
  assert.equal(approved.data.signInWith, '+919811100001');
  assert.equal((await owner.post(`/api/owner/requests/${asked.id}/approve`, {})).status, 409);
  const school = approved.data.schoolId;

  const head = await app.client().login('9811100001', 'school');
  assert.equal((await head.get(`/api/school?school=${school}`)).data.name, 'Gram Vidyalaya');
  const demoOffice = await app.client().login(DEMO.admin, 'school');
  for (const [client, other] of [[head, demoSchool], [demoOffice, school]]) {
    for (const path of ['school', 'school/config', 'teachers', 'classes', 'metrics', 'audit', 'school-qr']) {
      const res = await client.get(`/api/${path}?school=${other}`);
      assert.ok([403, 404].includes(res.status), `${path} of another school answered ${res.status}`);
    }
    const added = await client.post('/api/teachers', { school: other, name: 'Cross', phone: '9811100077', speakLang: 'hi' });
    assert.equal(added.status, 403);
  }
  const demoClass = (await app.db.get('SELECT id FROM class WHERE school_id = ?', demoSchool)).id;
  assert.equal((await head.get(`/api/classes/${demoClass}`)).status, 403);
  const demoNote = (await app.db.get('SELECT id FROM note WHERE school_id = ?', demoSchool)).id;
  assert.equal((await head.get(`/api/notes/${demoNote}`)).status, 403);
});

test('an approval with an email ties only that email, never the number beside it', async () => {
  await app.db.run(`DELETE FROM throttle`);
  await app.client().post('/api/register', form({ schoolName: 'Second School', phone: '9811100002', email: 'head@example.com' }));
  const asked = (await rows()).find((r) => r.school_name === 'Second School');
  assert.equal((await owner.post(`/api/owner/requests/${asked.id}/approve`, {})).data.signInWith, 'head@example.com');
  const admin = await app.db.get(`SELECT * FROM app_user WHERE email = 'head@example.com'`);
  assert.equal(admin.phone, null);
  assert.equal(await app.db.get(`SELECT 1 FROM app_user WHERE phone = '+919811100002'`), undefined);
});

test('a request can be declined and its details deleted', async () => {
  await app.db.run(`DELETE FROM throttle`);
  await app.client().post('/api/register', form({ schoolName: 'Third School', phone: '9811100003' }));
  const asked = (await rows()).find((r) => r.school_name === 'Third School');
  assert.equal((await owner.post(`/api/owner/requests/${asked.id}/decline`, {})).status, 200);
  assert.equal((await owner.post(`/api/owner/requests/${asked.id}/approve`, {})).status, 409);
  assert.equal((await owner.del(`/api/owner/requests/${asked.id}`)).status, 200);
  assert.ok(!(await rows()).some((r) => r.id === asked.id));
});
