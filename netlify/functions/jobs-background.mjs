// Speech-to-text, translation and notifications. The "-background" name gives it up to 15 minutes,
// so nobody waits on a rate limit.
import '../lib/env.mjs';
import { jobKey, runJobs } from '../../server/serverless.js';

export default async (request) => {
  if (request.headers.get('x-vv-key') !== jobKey()) return new Response(null, { status: 403 });
  await runJobs();
  return new Response(null, { status: 200 });
};
