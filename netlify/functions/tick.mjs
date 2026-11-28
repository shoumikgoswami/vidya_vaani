// Every five minutes: reminders, stuck jobs, and the nightly clean-up.
import '../lib/env.mjs';
import { tick, wakeWorker } from '../../server/serverless.js';

export default async () => {
  if (await tick()) await wakeWorker(process.env.URL);
  return new Response(null, { status: 200 });
};

export const config = { schedule: '*/5 * * * *' };
