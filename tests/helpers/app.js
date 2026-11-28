// A throwaway server on a temporary data folder. Real keys in the environment are never used.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function startApp(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-test-'));
  Object.assign(process.env, {
    DATA_DIR: dataDir,
    // Never the real database, whatever the shell or .env says.
    DATABASE_URL: 'memory:',
    NETLIFY_DATABASE_URL: '',
    SERVERLESS: 'false',
    DEMO_MODE: 'true',
    TRUST_PROXY: 'true',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    NVIDIA_API_KEY: '',
    OPENROUTER_API_KEY: '',
    CLERK_PUBLISHABLE_KEY: '',
    CLERK_SECRET_KEY: '',
    OWNER_EMAILS: '',
    NVIDIA_RPM_LIMIT: '1000',
    NVIDIA_TRANSLATE_HI_EN: 'false',
    ...env,
  });
  const { createApp } = await import('../../server/app.js');
  const { seedDemo } = await import('../../server/db/seed-demo.js');
  const { drain } = await import('../../server/jobs/queue.js');
  const db = await import('../../server/db/index.js');
  await seedDemo();

  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let clients = 0;

  /** A browser stand-in: keeps cookies, echoes the CSRF token, and has its own client address. */
  function client() {
    const jar = new Map();
    clients += 1;
    const address = `10.0.${Math.floor(clients / 250)}.${clients % 250}`;
    const call = async (method, url, { body, form, headers = {} } = {}) => {
      if (!jar.has('vv_csrf') && method !== 'GET') await call('GET', '/api/config');
      const h = { ...headers, 'X-Forwarded-For': address, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
      if (method !== 'GET' && !('X-CSRF-Token' in h)) h['X-CSRF-Token'] = jar.get('vv_csrf');
      let payload = form;
      if (body !== undefined) {
        h['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const res = await fetch(base + url, { method, headers: h, body: payload });
      for (const cookie of res.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const [name, value] = pair.split('=');
        if (value) jar.set(name, value);
        else jar.delete(name);
      }
      const type = res.headers.get('content-type') || '';
      const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
      return { status: res.status, data, headers: res.headers };
    };
    return {
      get: (url, options) => call('GET', url, options),
      post: (url, body, options) => call('POST', url, { body, ...options }),
      upload: (url, form) => call('POST', url, { form }),
      patch: (url, body) => call('PATCH', url, { body }),
      del: (url) => call('DELETE', url),
      async login(phone, portal = 'family') {
        const sent = await call('POST', '/api/auth/otp/send', { body: { phone } });
        if (sent.status !== 200) throw new Error(`otp send ${sent.status} ${sent.data.error}`);
        const verified = await call('POST', '/api/auth/otp/verify', { body: { phone, code: sent.data.demoCode, portal } });
        if (verified.status !== 200) throw new Error(`otp verify ${verified.status}`);
        return this;
      },
    };
  }

  const tone = path.join(dataDir, 'tone.webm');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', '-c:a', 'libopus', tone]);
  const audio = fs.readFileSync(tone);

  function noteForm(fields) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
    form.set('audio', new Blob([audio], { type: 'audio/webm' }), 'note.webm');
    return form;
  }

  async function stop() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  return { base, client, noteForm, drain, db, stop, dataDir };
}

export const uuid = () => crypto.randomUUID();

/** Demo people by their fixed numbers. */
export const DEMO = {
  admin: '+919900000001', meena: '+919900000002', lakshmi: '+919900000003', arjun: '+919900000004',
  sunita: '+919900000011', padma: '+919900000012', bimal: '+919900000014',
};
