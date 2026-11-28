// The whole API: the same Express app the container runs, behind one function.
import '../lib/env.mjs';
import { createApp } from '../../server/app.js';
import { onEnqueue } from '../../server/jobs/queue.js';
import { ready, wakeWorker } from '../../server/serverless.js';
import { expressHandler } from '../lib/express.mjs';

let queued = false;
onEnqueue(() => {
  queued = true;
});

const app = expressHandler(createApp());

export default async (request, context) => {
  const url = new URL(request.url);
  // Health answers even before the database does.
  if (url.pathname !== '/healthz') await ready();
  queued = false;
  const response = await app(request, context);
  // A function is frozen once it answers, so the worker is woken first.
  if (queued) await wakeWorker(url.origin);
  return response;
};

export const config = { path: ['/api/*', '/healthz'] };
