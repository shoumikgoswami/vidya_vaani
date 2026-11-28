// The Express app, separate from the server start so tests can mount it.
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { HttpError } from './lib/util.js';
import { sessionMiddleware, csrfProtection } from './auth/session.js';
import { cspDirectives, fontStylesheet, FONTS, VENDOR_FILES, VENDOR_DIRS } from './web.js';
import { router as auth } from './routes/auth.js';
import { router as resolve } from './routes/resolve.js';
import { router as teacher } from './routes/teacher.js';
import { router as notes } from './routes/notes.js';
import { router as parent } from './routes/parent.js';
import { router as admin } from './routes/admin.js';
import { router as misc } from './routes/misc.js';
import { router as register } from './routes/register.js';
import { router as join } from './routes/join.js';
import { registerHandlers } from './jobs/handlers.js';

function securityHeaders() {
  return helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    strictTransportSecurity: config.publicBaseUrl.startsWith('https://'),
    contentSecurityPolicy: { useDefaults: false, directives: cspDirectives() },
  });
}

/** The app's own files. On Netlify these come from the CDN, built by scripts/build.mjs. */
function serveClient(app) {
  const vendor = { maxAge: '30d', immutable: true };
  for (const [url, file] of Object.entries(VENDOR_FILES)) app.get(url, (_req, res) => res.sendFile(file, vendor));
  for (const [url, dir] of Object.entries(VENDOR_DIRS)) app.use(url, express.static(dir, vendor));
  const fonts = fontStylesheet();
  app.get('/vendor/fonts.css', (_req, res) => res.type('text/css').set('Cache-Control', 'public, max-age=86400').send(fonts));
  for (const font of FONTS) app.use(`/vendor/fonts/${font.name}`, express.static(font.dir, vendor));
  app.use(express.static(path.join(ROOT, 'client'), { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
}

export function createApp() {
  registerHandlers();
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders());

  // Answers even when NVIDIA, OpenRouter or Clerk are down.
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  if (!config.serverless) serveClient(app);

  const api = express.Router();
  api.use(sessionMiddleware);
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '100kb' }));
  // Signing in with a Clerk bearer token carries its own proof, so it needs no CSRF header.
  api.use((req, res, next) => (req.path === '/auth/clerk' && req.get('authorization') ? next() : csrfProtection(req, res, next)));
  api.use(auth, resolve, teacher, notes, parent, admin, misc, join, register);
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);

  // Every other page is the single-page app.
  if (!config.serverless) {
    app.get('/{*page}', (req, res, next) => {
      if (path.extname(req.path) || req.path.startsWith('/vendor/')) return next();
      return sessionMiddleware(req, res, () => res.sendFile(path.join(ROOT, 'client', 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
    });
  }

  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.code, ...error.extra });
    if (error instanceof multer.MulterError) return res.status(413).json({ error: 'upload_too_large' });
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    console.error(error);
    res.status(500).json({ error: 'server_error' });
  });

  return app;
}
