// The Express app, separate from the server start so tests can mount it.
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { HttpError } from './lib/util.js';
import { sessionMiddleware, csrfProtection } from './auth/session.js';
import { clerkFrontendApi } from './auth/clerk.js';
import { router as auth } from './routes/auth.js';
import { router as resolve } from './routes/resolve.js';
import { router as teacher } from './routes/teacher.js';
import { router as notes } from './routes/notes.js';
import { router as parent } from './routes/parent.js';
import { router as admin } from './routes/admin.js';
import { router as misc } from './routes/misc.js';
import { registerHandlers } from './jobs/handlers.js';

function securityHeaders() {
  const clerk = config.clerk.enabled ? [`https://${clerkFrontendApi()}`] : [];
  // Clerk's bot protection loads from these in addition to the instance's own host.
  const challenge = config.clerk.enabled ? ['https://challenges.cloudflare.com', 'https://*.protect.clerk.com'] : [];
  const https = config.publicBaseUrl.startsWith('https://');
  return helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    strictTransportSecurity: https,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...clerk, ...challenge],
        // Clerk's bot check also probes its own domain on other ports.
        connectSrc: ["'self'", ...clerk, ...challenge, ...(config.clerk.enabled ? ['https://*.protect.clerk.com:*', 'https://clerk-telemetry.com'] : [])],
        imgSrc: ["'self'", 'data:', 'blob:', ...(config.clerk.enabled ? ['https://img.clerk.com'] : [])],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        workerSrc: ["'self'", 'blob:'],
        frameSrc: ["'self'", ...challenge],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
      },
    },
  });
}

const FONT_PACKAGES = [
  'noto-sans', 'noto-sans-devanagari', 'noto-sans-bengali', 'noto-sans-tamil', 'noto-sans-telugu', 'noto-sans-kannada',
  'noto-sans-malayalam', 'noto-sans-gujarati', 'noto-sans-gurmukhi', 'noto-sans-oriya', 'noto-sans-ol-chiki',
  'noto-sans-meetei-mayek', 'noto-sans-arabic', 'noto-nastaliq-urdu',
];

function fontStylesheet(root) {
  return FONT_PACKAGES.flatMap((name) => ['400', '700'].map((weight) => {
    try {
      return fs.readFileSync(path.join(root, name, `${weight}.css`), 'utf8').replaceAll('url(./files/', `url(/vendor/fonts/${name}/files/`);
    } catch {
      return '';
    }
  })).join('\n');
}

export function createApp() {
  registerHandlers();
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders());

  // Answers even when NVIDIA, OpenRouter or Clerk are down.
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  const modules = path.join(ROOT, 'node_modules');
  const vendor = { maxAge: '30d', immutable: true };
  app.get('/vendor/jsqr.js', (_req, res) => res.sendFile(path.join(modules, 'jsqr', 'dist', 'jsQR.js'), vendor));
  app.use('/vendor/icons', express.static(path.join(modules, '@phosphor-icons', 'core', 'assets'), vendor));
  // One stylesheet for every script. Each font file downloads only when its characters appear.
  const fonts = fontStylesheet(path.join(modules, '@fontsource'));
  app.get('/vendor/fonts.css', (_req, res) => res.type('text/css').set('Cache-Control', 'public, max-age=86400').send(fonts));
  app.use('/vendor/fonts', express.static(path.join(modules, '@fontsource'), vendor));
  app.use(express.static(path.join(ROOT, 'client'), { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

  const api = express.Router();
  api.use(sessionMiddleware);
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '100kb' }));
  // Signing in with a Clerk bearer token carries its own proof, so it needs no CSRF header.
  api.use((req, res, next) => (req.path === '/auth/clerk' && req.get('authorization') ? next() : csrfProtection(req, res, next)));
  api.use(auth, resolve, teacher, notes, parent, admin, misc);
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);

  // Every other page is the single-page app.
  app.get('/{*page}', (req, res, next) => {
    if (path.extname(req.path) || req.path.startsWith('/vendor/')) return next();
    sessionMiddleware(req, res, () => res.sendFile(path.join(ROOT, 'client', 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.code, ...error.extra });
    if (error instanceof multer.MulterError) return res.status(413).json({ error: 'upload_too_large' });
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    console.error(error);
    res.status(500).json({ error: 'server_error' });
  });

  return app;
}
