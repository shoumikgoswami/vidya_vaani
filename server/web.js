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

const FONT_PACKAGES = [
  'noto-sans', 'noto-sans-devanagari', 'noto-sans-bengali', 'noto-sans-tamil', 'noto-sans-telugu', 'noto-sans-kannada',
  'noto-sans-malayalam', 'noto-sans-gujarati', 'noto-sans-gurmukhi', 'noto-sans-oriya', 'noto-sans-ol-chiki',
  'noto-sans-meetei-mayek', 'noto-sans-arabic', 'noto-nastaliq-urdu',
];

/** One stylesheet for every script. Each font file downloads only when its characters appear. */
export function fontStylesheet(root = path.join(modules, '@fontsource')) {
  return FONT_PACKAGES.flatMap((name) => ['400', '700'].map((weight) => {
    try {
      return fs.readFileSync(path.join(root, name, `${weight}.css`), 'utf8').replaceAll('url(./files/', `url(/vendor/fonts/${name}/files/`);
    } catch {
      return '';
    }
  })).join('\n');
}

export const VENDOR_FILES = {
  '/vendor/jsqr.js': path.join(modules, 'jsqr', 'dist', 'jsQR.js'),
};

export const VENDOR_DIRS = {
  '/vendor/icons': path.join(modules, '@phosphor-icons', 'core', 'assets'),
};
