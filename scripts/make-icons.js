// Renders the PNG app icons from the SVG marks with an installed Chrome or Edge.
// The PNGs are committed, so this only runs when the artwork changes:  node scripts/make-icons.js
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const img = path.resolve(import.meta.dirname, '..', 'client', 'img');
const browser = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));
if (!browser) throw new Error('Set CHROME_PATH to a Chrome or Edge executable.');

const mark = fs.readFileSync(path.join(img, 'icon.svg'), 'utf8');
// The status bar badge is the white bars alone; Android draws it as a silhouette.
const badge = mark.replace(/<rect width="96" height="96"[^>]*\/>/, '').replaceAll('#f4fbf6', '#ffffff');
const maskable = fs.readFileSync(path.join(img, 'icon-maskable.svg'), 'utf8');

const outputs = [
  ['icon-192.png', mark, 192],
  ['icon-512.png', mark, 512],
  ['maskable-192.png', maskable, 192],
  ['maskable-512.png', maskable, 512],
  // iOS rounds the corners itself and shows transparency as black, so it gets the full-bleed art.
  ['apple-touch-icon.png', maskable, 180],
  ['badge-96.png', badge, 96],
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vv-icons-'));
for (const [name, svg, size] of outputs) {
  const page = path.join(dir, `${name}.html`);
  fs.writeFileSync(page, `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  // Headless Chrome has a minimum window width, so render large and clip to the icon.
  const shot = path.join(dir, name);
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', `--window-size=${Math.max(size, 600)},${Math.max(size, 600)}`,
    `--screenshot=${shot}`, `--user-data-dir=${path.join(dir, 'profile')}`, pathToFileURL(page).href,
  ], { stdio: 'ignore' });
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', shot, '-vf', `crop=${size}:${size}:0:0,format=rgba`, '-frames:v', '1', path.join(img, name)]);
  console.log(name);
}
fs.rmSync(dir, { recursive: true, force: true });
