// The database layer: recordings without a disk, byte ranges, and requests that arrive together.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, uuid, DEMO } from './helpers/app.js';

let app;
let meena;
let sunita;
let classId;
let raviId;

before(async () => {
  app = await startApp();
  meena = await app.client().login(DEMO.meena);
  sunita = await app.client().login(DEMO.sunita);
  classId = (await app.db.get(`SELECT id FROM class WHERE name = '5'`)).id;
  raviId = (await app.db.get(`SELECT id FROM student WHERE name = 'Ravi Kumar'`)).id;
});

after(() => app.stop());

const fields = (extra = {}) => ({
  client_uuid: uuid(), class_id: classId, recipients: JSON.stringify([raviId]), lang_hint: 'hi', duration_ms: 2000, ...extra,
});

const count = async (sql, ...args) => (await app.db.get(sql, ...args)).n;

test('a recording is stored in the database, played back byte for byte, and removed with its note', async () => {
  const created = await meena.upload('/api/notes', app.noteForm(fields()));
  const { id } = created.data;
  const whole = await meena.get(`/api/notes/${id}/audio`);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal(whole.headers.get('content-type'), 'audio/webm');
  const sent = Buffer.from(await app.noteForm({}).get('audio').arrayBuffer());
  assert.ok(whole.data.equals(sent));

  assert.equal(await count('SELECT COUNT(*) AS n FROM media WHERE note_id = ?', id), 1);
  assert.equal((await meena.del(`/api/notes/${id}`)).status, 200);
  assert.equal(await count('SELECT COUNT(*) AS n FROM media WHERE note_id = ?', id), 0);
});

test('audio answers byte ranges, as iPhones require', async () => {
  const { id } = (await meena.upload('/api/notes', app.noteForm(fields()))).data;
  const url = `/api/notes/${id}/audio`;
  const whole = (await meena.get(url)).data;

  const start = await meena.get(url, { headers: { Range: 'bytes=0-1' } });
  assert.equal(start.status, 206);
  assert.equal(start.headers.get('content-range'), `bytes 0-1/${whole.length}`);
  assert.ok(start.data.equals(whole.subarray(0, 2)));

  const rest = await meena.get(url, { headers: { Range: 'bytes=100-' } });
  assert.ok(rest.data.equals(whole.subarray(100)));
  const tail = await meena.get(url, { headers: { Range: 'bytes=-50' } });
  assert.ok(tail.data.equals(whole.subarray(whole.length - 50)));
  assert.equal((await meena.get(url, { headers: { Range: `bytes=${whole.length}-` } })).status, 416);
  // A range never bypasses the permission check.
  assert.equal((await app.client().get(url, { headers: { Range: 'bytes=0-1' } })).status, 401);
});

test('the same upload sent twice at once makes one note', async () => {
  const same = fields({ publish: '1' });
  const results = await Promise.all([
    meena.upload('/api/notes', app.noteForm(same)),
    meena.upload('/api/notes', app.noteForm(same)),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
  assert.equal(results[0].data.id, results[1].data.id);
  assert.equal(await count('SELECT COUNT(*) AS n FROM note WHERE client_uuid = ?', same.client_uuid), 1);
});

test('saving twice at once notifies parents once', async () => {
  const { id } = (await meena.upload('/api/notes', app.noteForm(fields()))).data;
  await app.drain();
  await Promise.all([meena.post(`/api/notes/${id}/publish`, {}), meena.post(`/api/notes/${id}/publish`, {})]);
  assert.equal(
    await count(`SELECT COUNT(*) AS n FROM job WHERE type = 'notify_note' AND (payload::jsonb ->> 'noteId')::int = ?`, id), 1,
  );
});

test('two workers never run the same job', async () => {
  const { register, enqueue, drain } = await import('../server/jobs/queue.js');
  const seen = [];
  register('count_me', async ({ n }) => { seen.push(n); });
  for (let n = 0; n < 12; n += 1) await enqueue('count_me', { n });
  await Promise.all([drain(), drain(), drain()]);
  assert.deepEqual(seen.sort((a, b) => a - b), [...Array(12).keys()]);
});

test('a job abandoned by a stopped server runs again', async () => {
  const { requeueStale } = await import('../server/jobs/queue.js');
  await app.drain();
  await app.db.run(
    `INSERT INTO job (type, payload, run_after, created_at, status, claimed_at) VALUES ('lost', '{}', 0, 0, 'running', ?)`,
    Date.now() - 20 * 60_000,
  );
  await requeueStale();
  assert.equal((await app.db.get(`SELECT status FROM job WHERE type = 'lost'`)).status, 'pending');
});

test('sign-in limits are counted in the database', async () => {
  const { allow } = await import('../server/lib/util.js');
  assert.equal(await allow('t:1', 2, 60_000), true);
  assert.equal(await allow('t:1', 2, 60_000), true);
  assert.equal(await allow('t:1', 2, 60_000), false);
  assert.equal(await allow('t:2', 2, 60_000), true);
});

test('a failed transaction leaves nothing behind', async () => {
  await assert.rejects(app.db.tx(async () => {
    await app.db.run(`INSERT INTO setting (key, value) VALUES ('half', '1')`);
    throw new Error('stop');
  }));
  assert.equal(await app.db.get(`SELECT 1 FROM setting WHERE key = 'half'`), undefined);
});

test('roll numbers and class names sort by their digits, whatever is typed', async () => {
  const added = await meena.post(`/api/classes/${classId}/students`, {
    students: [{ name: 'Zoya Ali', rollNo: 'A-2b' }, { name: 'Yash Pal', rollNo: '' }],
  });
  assert.equal(added.status, 201);
  const list = (await meena.get(`/api/classes/${classId}/students`)).data.students;
  assert.equal(list[0].name, 'Yash Pal');
  assert.ok(list.findIndex((s) => s.rollNo === '10') > list.findIndex((s) => s.rollNo === '9'));
});

test('the diary and class pages carry receipts, replies and tags', async () => {
  const diary = (await sunita.get(`/api/children/${raviId}/notes`)).data;
  assert.ok(diary.notes.some((n) => n.replies > 0));
  assert.ok(diary.notes.some((n) => n.tags.length && n.tags[0].dueDate !== undefined && !('note_id' in n.tags[0])));
  const page = (await meena.get(`/api/classes/${classId}`)).data;
  assert.ok(page.notes.every((n) => typeof n.heard.total === 'number' && Array.isArray(n.recipients)));
});
