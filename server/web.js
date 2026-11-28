// What every page needs whichever host serves it: the security headers and the third-party files
// served from our own address. The server uses this live; the Netlify build writes it to files.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { clerkFrontendApi } from './auth/clerk.js';

export function cspDirectives() {
  const clerk = config.clerk.enabled ? [`https://${clerkFrontendApi()}`] : [];
  // Clerk's bot protection loads from these in addition to the instance's own host.
  const challenge = config.clerk.enabled ? ['https://challenges.cloudflare.com', 'https://*.protect.clerk.com'] : [];
  return {
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
  };
}

export const modules = path.join(ROOT, 'node_modules');

// Anek is one family drawn for India's scripts; Noto covers the scripts Anek does not have.
const ANEK = ['latin', 'devanagari', 'bangla', 'tamil', 'telugu', 'kannada', 'malayalam', 'gujarati', 'gurmukhi', 'odia'];
const NOTO = ['noto-sans-ol-chiki', 'noto-sans-meetei-mayek', 'noto-sans-arabic', 'noto-nastaliq-urdu'];

export const FONTS = [
  ...ANEK.map((script) => ({ name: `anek-${script}`, scope: '@fontsource-variable', sheets: ['index.css'] })),
  ...NOTO.map((name) => ({ name, scope: '@fontsource', sheets: ['400.css', '700.css'] })),
].map((font) => ({ ...font, dir: path.join(modules, font.scope, font.name) }));

/** One stylesheet for every script. Each font file downloads only when its characters appear. */
export function fontStylesheet() {
  return FONTS.flatMap(({ name, dir, sheets }) => sheets.map((sheet) =>
    fs.readFileSync(path.join(dir, sheet), 'utf8').replaceAll('url(./files/', `url(/vendor/fonts/${name}/files/`))).join('\n');
}

export const VENDOR_FILES = {
  '/vendor/jsqr.js': path.join(modules, 'jsqr', 'dist', 'jsQR.js'),
};

export const VENDOR_DIRS = {
  '/vendor/icons': path.join(modules, '@phosphor-icons', 'core', 'assets'),
};
