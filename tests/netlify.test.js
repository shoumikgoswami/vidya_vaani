// The hosted version's extra parts: the function adapter, the scheduled work and the demo limit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, uuid, DEMO } from './helpers/app.js';

let app;
let serverless;
let handle;

before(async () => {
  app = await startApp({ AI_DEMO_DAILY_LIMIT: '2' });
  serverless = await import('../server/serverless.js');
  const { createApp } = await import('../server/app.js');
  const { expressHandler } = await import('../netlify/lib/express.mjs');
  handle = expressHandler(createApp());
});

after(() => app.stop());

test('a function request becomes an Express request, with both cookies and bytes intact', async () => {
  const jar = new Map();
  const call = async (method, url, { body, headers = {} } = {}) => {
    const res = await handle(new Request(`https://vv.example${url}`, {
      method, body,
      headers: { ...headers, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-csrf-token': jar.get('vv_csrf') || '' },
    }), { ip: '203.0.113.7' });
    for (const line of res.headers.getSetCookie()) {
      const [name, value] = line.split(';')[0].split('=');
      jar.set(name, value);
    }
    return res;
  };
  assert.equal((await call('GET', '/healthz')).status, 200);
  const config = await call('GET', '/api/config');
  assert.match(config.headers.getSetCookie().join(), /vv_csrf=[^;]+.*Secure/);

  const send = await call('POST', '/api/auth/otp/send', {
    body: JSON.stringify({ phone: DEMO.meena }), headers: { 'content-type': 'application/json' },
  });
  const { demoCode } = await send.json();
  const verified = await call('POST', '/api/auth/otp/verify', {
    body: JSON.stringify({ phone: DEMO.meena, code: demoCode }), headers: { 'content-type': 'application/json' },
  });
  assert.equal(verified.status, 200);

  const note = await app.db.get(`SELECT id, audio_path FROM note WHERE audio_path IS NOT NULL AND author_user_id =
    (SELECT id FROM app_user WHERE phone = ?)`, DEMO.meena);
  const audio = await call('GET', `/api/notes/${note.id}/audio`);
  const { loadMedia } = await import('../server/services/media.js');
  assert.ok(Buffer.from(await audio.arrayBuffer()).equals((await loadMedia(note.audio_path)).data));
});

test('the nightly clean-up runs once a day, after 3 am in India, and resets the demo', async () => {
  const school = async () => (await app.db.get('SELECT id FROM school WHERE is_demo = 1')).id;
  const first = await school();
  // 02:00 IST is too early.
  assert.equal(await serverless.nightly(Date.parse('2030-01-01T20:30:00Z')), false);
  // 03:30 IST on 2 January.
  assert.equal(await serverless.nightly(Date.parse('2030-01-01T22:00:00Z')), true);
  assert.notEqual(await school(), first);
  assert.equal(await serverless.nightly(Date.parse('2030-01-01T23:00:00Z')), false);
});

test('the five-minute tick reports waiting work', async () => {
  await app.drain();
  await app.db.run('DELETE FROM job');
  const early = Date.parse('2030-01-01T20:00:00Z');
  assert.equal(await serverless.tick(early), false);
  await app.db.run(`INSERT INTO job (type, payload, run_after, created_at) VALUES ('notify_linked', '{"linkId":0}', 0, ?)`, Date.now());
  assert.equal(await serverless.tick(early), true);
});

test('the sample school has a daily AI limit, and a real school has none', async () => {
  const { aiAllowed } = await import('../server/services/demo-budget.js');
  const demo = (await app.db.get('SELECT id FROM school WHERE is_demo = 1')).id;
  assert.deepEqual([await aiAllowed(demo), await aiAllowed(demo), await aiAllowed(demo)], [true, true, false]);
  const real = await app.db.insert('school', {
    name: 'Real', school_token: uuid(), academic_year: '2026-27', created_at: new Date().toISOString(),
  });
  assert.equal(await aiAllowed(real), true);
});

test('the worker key is derived, stable and never the database address', () => {
  assert.match(serverless.jobKey(), /^[0-9a-f]{64}$/);
  assert.equal(serverless.jobKey(), serverless.jobKey());
});
