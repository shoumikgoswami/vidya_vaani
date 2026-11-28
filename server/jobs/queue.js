// A small persistent job queue in the database. A teacher never waits on a rate limit.
// In the container a timer works through it; on Netlify a background function drains it.
import { all, get, run, insert } from '../db/index.js';

const GIVE_UP_AFTER_MS = 6 * 3_600_000;
/** A job still "running" after this long lost its server. */
const STALE_AFTER_MS = 16 * 60_000;
const CONCURRENCY = 3;
const handlers = new Map();
const listeners = new Set();
let timer = null;
let active = 0;
let claiming = false;

export class RetryLater extends Error {}

export function register(type, handler, { onGiveUp } = {}) {
  handlers.set(type, { handler, onGiveUp });
}

/** Tells a host without a timer that there is new work. */
export function onEnqueue(listener) {
  listeners.add(listener);
}

export async function enqueue(type, payload, { delayMs = 0 } = {}) {
  const id = await insert('job', {
    type, payload: JSON.stringify(payload), run_after: Date.now() + delayMs, created_at: Date.now(),
  });
  for (const listener of listeners) listener(type);
  if (timer) setImmediate(tick);
  return id;
}

export const backoffMs = (attempts) => Math.min(4000 * 2 ** attempts, 10 * 60_000) + Math.floor(Math.random() * 1000);

async function execute(job) {
  const entry = handlers.get(job.type);
  const payload = JSON.parse(job.payload);
  try {
    if (!entry) throw new Error(`no handler for ${job.type}`);
    await entry.handler(payload, { attempts: job.attempts });
    await run('DELETE FROM job WHERE id = ?', job.id);
  } catch (error) {
    const expired = Date.now() - job.created_at > GIVE_UP_AFTER_MS;
    if (error instanceof RetryLater && !expired) {
      await run(
        `UPDATE job SET status = 'pending', attempts = attempts + 1, run_after = ?, last_error = ? WHERE id = ?`,
        Date.now() + backoffMs(job.attempts), error.message, job.id,
      );
      return;
    }
    if (!(error instanceof RetryLater)) console.error(`job ${job.type} failed:`, error.message);
    await run(`UPDATE job SET status = 'failed', last_error = ? WHERE id = ?`, error.message, job.id);
    await entry?.onGiveUp?.(payload, error);
  }
}

/** Takes one due job. Two workers can never take the same one. */
const claim = () => {
  const at = Date.now();
  return get(
    `UPDATE job SET status = 'running', claimed_at = ? WHERE id = (
       SELECT id FROM job WHERE status = 'pending' AND run_after <= ? ORDER BY run_after, id LIMIT 1 FOR UPDATE SKIP LOCKED
     ) RETURNING *`,
    at, at,
  );
};

export const requeueStale = (olderThanMs = STALE_AFTER_MS) =>
  run(
    `UPDATE job SET status = 'pending' WHERE status = 'running' AND COALESCE(claimed_at, 0) < ?`,
    Date.now() - olderThanMs,
  );

async function tick() {
  if (claiming) return;
  claiming = true;
  try {
    while (timer && active < CONCURRENCY) {
      const job = await claim();
      if (!job) return;
      active += 1;
      execute(job)
        .catch((error) => console.error('job queue:', error.message))
        .finally(() => {
          active -= 1;
          if (timer) setImmediate(tick);
        });
    }
  } catch (error) {
    console.error('job queue:', error.message);
  } finally {
    claiming = false;
  }
}

export async function startWorker() {
  // One process owns the built-in database, so anything marked running was interrupted.
  await requeueStale(-1000);
  timer = setInterval(tick, 700);
  timer.unref?.();
}

export function stopWorker() {
  clearInterval(timer);
  timer = null;
}

/**
 * Runs everything that is due now, and with `waitMs` also retries that fall due within that time.
 * Used by the background function, the tests and the seed script.
 */
export async function drain({ waitMs = 0 } = {}) {
  const until = Date.now() + waitMs;
  let done = 0;
  for (;;) {
    const batch = [];
    while (batch.length < CONCURRENCY) {
      const job = await claim();
      if (!job) break;
      batch.push(job);
    }
    if (batch.length) {
      await Promise.all(batch.map(execute));
      done += batch.length;
      continue;
    }
    const next = await get(`SELECT MIN(run_after) AS at FROM job WHERE status = 'pending'`);
    if (!next?.at || next.at > until) return done;
    await new Promise((resolve) => setTimeout(resolve, Math.max(50, next.at - Date.now())));
  }
}

export const pendingJobs = () => all(`SELECT * FROM job WHERE status != 'failed'`);
