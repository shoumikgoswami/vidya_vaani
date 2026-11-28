// What the Netlify functions share: getting the database ready, waking the job worker and the
// scheduled housekeeping. The container does the same work with timers (server/index.js).
import { config } from './config.js';
import { ensureSchema, get, getSetting, setSetting } from './db/index.js';
import { seedDemo } from './db/seed-demo.js';
import { drain, requeueStale } from './jobs/queue.js';
import { registerHandlers } from './jobs/handlers.js';
import { reminderTick, purgeExpiredNotes, sweep } from './jobs/reminders.js';
import { sha256 } from './lib/util.js';
import { todayIst, hourIst } from './nlp/dates.js';

let preparing;
/** Once per running instance: the tables exist and, in demo mode, so does the sample school. */
export function ready() {
  preparing ||= (async () => {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is not set for this site');
    await ensureSchema();
    if (config.demoMode && !(await get('SELECT 1 FROM school WHERE is_demo = 1'))) await seedDemo();
  })().catch((error) => {
    preparing = undefined;
    throw error;
  });
  return preparing;
}

/** Only our own functions know this: it comes from the database address, which never leaves the server. */
export const jobKey = () => sha256(`jobs:${config.databaseUrl}`);

/** Starts the background function. It answers at once and keeps working by itself. */
export async function wakeWorker(origin) {
  try {
    await fetch(`${origin}/.netlify/functions/jobs-background`, {
      method: 'POST',
      headers: { 'x-vv-key': jobKey() },
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    // The scheduled run picks the work up within five minutes.
    console.warn('could not wake the job worker:', error.message);
  }
}

/** Works through the queue, waiting a little for retries that fall due soon. */
export async function runJobs({ waitMs = 90_000 } = {}) {
  await ready();
  registerHandlers();
  await requeueStale();
  return drain({ waitMs });
}

/** Once a day, from 3 am in India: old data goes and the public demo starts fresh. */
export async function nightly(at = Date.now()) {
  const today = todayIst(at);
  if (hourIst(at) < 3 || (await getSetting('nightly')) === today) return false;
  await setSetting('nightly', today);
  await purgeExpiredNotes(today);
  await sweep();
  if (config.demoMode) await seedDemo({ reset: true });
  return true;
}

/** The five-minute tick. Returns true when queued work is waiting for the background function. */
export async function tick(at = Date.now()) {
  await ready();
  registerHandlers();
  await requeueStale();
  await nightly(at);
  await reminderTick(at);
  return Boolean(await get(`SELECT 1 FROM job WHERE status = 'pending' AND run_after <= ?`, Date.now()));
}
