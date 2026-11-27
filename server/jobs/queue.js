// A small persistent job queue inside the server process. A teacher never waits on a rate limit.
import { all, get, run, insert } from '../db/index.js';

const GIVE_UP_AFTER_MS = 6 * 3_600_000;
const CONCURRENCY = 3;
const handlers = new Map();
let timer = null;
let active = 0;

export class RetryLater extends Error {}

export function register(type, handler, { onGiveUp } = {}) {
  handlers.set(type, { handler, onGiveUp });
}

export function enqueue(type, payload, { delayMs = 0 } = {}) {
  const id = insert('job', {
    type, payload: JSON.stringify(payload), run_after: Date.now() + delayMs, created_at: Date.now(),
  });
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
    run('DELETE FROM job WHERE id = ?', job.id);
  } catch (error) {
    const expired = Date.now() - job.created_at > GIVE_UP_AFTER_MS;
    if (error instanceof RetryLater && !expired) {
      run(
        `UPDATE job SET status = 'pending', attempts = attempts + 1, run_after = ?, last_error = ? WHERE id = ?`,
        Date.now() + backoffMs(job.attempts), error.message, job.id,
      );
      return;
    }
    if (!(error instanceof RetryLater)) console.error(`job ${job.type} failed:`, error.message);
    run(`UPDATE job SET status = 'failed', last_error = ? WHERE id = ?`, error.message, job.id);
    await entry?.onGiveUp?.(payload, error);
  }
}

function claim() {
  const job = get(`SELECT * FROM job WHERE status = 'pending' AND run_after <= ? ORDER BY run_after, id LIMIT 1`, Date.now());
  if (!job) return null;
  run(`UPDATE job SET status = 'running' WHERE id = ?`, job.id);
  return job;
}

function tick() {
  while (active < CONCURRENCY) {
    const job = claim();
    if (!job) return;
    active += 1;
    execute(job).finally(() => {
      active -= 1;
      if (timer) setImmediate(tick);
    });
  }
}

export function startWorker() {
  run(`UPDATE job SET status = 'pending' WHERE status = 'running'`);
  timer = setInterval(tick, 700);
  timer.unref?.();
}

export function stopWorker() {
  clearInterval(timer);
  timer = null;
}

/** Runs everything that is due now. Used by the tests and the seed script. */
export async function drain() {
  for (;;) {
    const job = claim();
    if (!job) return;
    await execute(job);
  }
}

export const pendingJobs = () => all(`SELECT * FROM job WHERE status != 'failed'`);
