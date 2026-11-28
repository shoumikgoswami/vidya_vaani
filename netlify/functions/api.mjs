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
  if (url.pathname !== '/healthz') {
    try {
      await ready();
    } catch (error) {
      // The detail belongs in the function log, not in the reply.
      console.error('not ready:', error.message);
      return Response.json({ error: 'server_error' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  }
  queued = false;
  const response = await app(request, context);
  // A function is frozen once it answers, so the worker is woken first. The address comes from the
  // site's own settings, so the worker key is never sent to a host named by a request.
  if (queued) await wakeWorker(process.env.URL || url.origin);
  return response;
};

export const config = { path: ['/api/*', '/healthz'] };
