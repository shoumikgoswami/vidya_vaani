// Per-model sliding window that keeps us under the NVIDIA free tier (about 40 requests a minute),
// plus the daily counters behind the metrics page.
import { config } from '../config.js';
import { run } from '../db/index.js';
import { todayIst } from '../nlp/dates.js';

const WINDOW_MS = 60_000;
const calls = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for a free slot. Returns false if that would take longer than maxWaitMs. */
export async function acquire(model, { maxWaitMs = Infinity, limit = config.rpmLimit } = {}) {
  const started = Date.now();
  for (;;) {
    const t = Date.now();
    const recent = (calls.get(model) || []).filter((at) => t - at < WINDOW_MS);
    if (recent.length < limit) {
      recent.push(t);
      calls.set(model, recent);
      return true;
    }
    calls.set(model, recent);
    const wait = recent[0] + WINDOW_MS - t + 20;
    if (t - started + wait > maxWaitMs) return false;
    await sleep(Math.min(wait, 1000));
  }
}

export const resetRateLimits = () => calls.clear();

export function recordUsage(model, error) {
  const is429 = error?.status === 429;
  run(
    `INSERT INTO ai_usage (day, model, calls, errors_429, errors_other) VALUES (?,?,1,?,?)
     ON CONFLICT(day, model) DO UPDATE SET calls = calls + 1,
       errors_429 = errors_429 + excluded.errors_429, errors_other = errors_other + excluded.errors_other`,
    todayIst(), model, is429 ? 1 : 0, error && !is429 ? 1 : 0,
  );
}

export class ProviderError extends Error {
  /** kind: 'rate' | 'down' | 'auth' | 'bad' ; transient errors are worth retrying later. */
  constructor(message, kind = 'down', status) {
    super(message);
    this.kind = kind;
    this.status = status ?? (kind === 'rate' ? 429 : undefined);
    this.transient = kind === 'rate' || kind === 'down';
  }
}

export function errorFromStatus(status, message) {
  if (status === 429) return new ProviderError(message, 'rate', status);
  if (status === 401 || status === 403) return new ProviderError(message, 'auth', status);
  if (status === 408 || status >= 500) return new ProviderError(message, 'down', status);
  return new ProviderError(message, 'bad', status);
}
