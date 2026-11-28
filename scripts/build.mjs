// Netlify build: the app's files, third-party assets and security headers go into dist/.
// The container serves the same things live (server/app.js).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';
import { cspDirectives, fontStylesheet, modules, VENDOR_FILES, VENDOR_DIRS } from '../server/web.js';

const dist = path.join(ROOT, 'dist');
const out = (url) => path.join(dist, ...url.split('/').filter(Boolean));
const copy = (from, to, options) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, ...options });
};

fs.rmSync(dist, { recursive: true, force: true });
copy(path.join(ROOT, 'client'), dist);

for (const [url, file] of Object.entries(VENDOR_FILES)) copy(file, out(url));
// Only the icon weight the app draws.
copy(path.join(VENDOR_DIRS['/vendor/icons'], 'bold'), out('/vendor/icons/bold'));

const css = fontStylesheet();
fs.writeFileSync(out('/vendor/fonts.css'), css);
const fonts = [...new Set([...css.matchAll(/url\(\/vendor\/fonts\/([^)]+)\)/g)].map((m) => m[1]))];
if (!fonts.length) throw new Error('no fonts found: is node_modules complete?');
for (const file of fonts) copy(path.join(modules, '@fontsource', file), out(`/vendor/fonts/${file}`));

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const csp = Object.entries(cspDirectives()).map(([name, values]) => `${kebab(name)} ${values.join(' ')}`).join(';');
const headers = {
  '/*': [
    `Content-Security-Policy: ${csp}`,
    'Strict-Transport-Security: max-age=31536000; includeSubDomains',
    'Cross-Origin-Opener-Policy: same-origin-allow-popups',
    'Cross-Origin-Resource-Policy: same-origin',
    'Referrer-Policy: no-referrer',
    'X-Content-Type-Options: nosniff',
    'X-Frame-Options: SAMEORIGIN',
    'Permissions-Policy: camera=(self), microphone=(self), geolocation=()',
  ],
  '/vendor/icons/*': ['Cache-Control: public, max-age=2592000, immutable'],
  '/vendor/fonts/*': ['Cache-Control: public, max-age=2592000, immutable'],
};
fs.writeFileSync(path.join(dist, '_headers'), Object.entries(headers)
  .map(([route, lines]) => `${route}\n${lines.map((l) => `  ${l}`).join('\n')}`).join('\n') + '\n');

// The ffmpeg that goes with the functions must be the Linux one, even when built on another system.
const ffmpeg = path.join(modules, 'ffmpeg-static', 'ffmpeg');
if (process.platform !== 'linux' && !fs.existsSync(ffmpeg)) {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['install.js'], {
    cwd: path.dirname(ffmpeg),
    stdio: 'inherit',
    env: { ...process.env, npm_config_platform: 'linux', npm_config_arch: 'x64' },
  });
}
if (!fs.existsSync(ffmpeg)) throw new Error('the Linux ffmpeg for the functions is missing');

console.log(`built dist/ with ${fonts.length} font files`);
