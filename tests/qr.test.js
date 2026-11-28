// The styled QR codes must still scan. Each one is painted to pixels and read back with the same
// library the app's scanner uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { brandedQr } from '../server/services/qr.js';
import { randomToken } from '../server/lib/util.js';

/** Paints the codes, which are made only of rounded rectangles. */
function paint(svg, pixels) {
  const full = Number(/viewBox="0 0 (\d+)/.exec(svg)[1]);
  const scale = pixels / full;
  const image = new Uint8ClampedArray(pixels * pixels * 4).fill(255);
  const rgb = (hex) => (hex.length === 4 ? [...hex.slice(1)].map((c) => parseInt(c + c, 16)) : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const fillWhere = (x0, y0, x1, y1, inside, colour) => {
    for (let py = Math.max(0, Math.floor(y0 * scale)); py < Math.min(pixels, Math.ceil(y1 * scale)); py += 1) {
      for (let px = Math.max(0, Math.floor(x0 * scale)); px < Math.min(pixels, Math.ceil(x1 * scale)); px += 1) {
        if (inside((px + 0.5) / scale, (py + 0.5) / scale)) image.set(rgb(colour), (py * pixels + px) * 4);
      }
    }
  };
  for (const [, attributes] of svg.matchAll(/<rect ([^>]*?)\/>/g)) {
    const a = Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const [x0, y0, w, h, rx] = [a.x, a.y, a.width, a.height, a.rx || 0].map(Number);
    fillWhere(x0, y0, x0 + w, y0 + h, (x, y) => {
      const dx = Math.max(x0 + rx - x, 0, x - (x0 + w - rx));
      const dy = Math.max(y0 + rx - y, 0, y - (y0 + h - rx));
      return x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h && dx * dx + dy * dy <= rx * rx;
    }, a.fill);
  }
  return image;
}

const read = (svg, pixels) => jsQR(paint(svg, pixels), pixels, pixels)?.data;

const links = [
  () => `https://vidyavaani.shoumikgoswami.com/s/${randomToken()}`,
  () => `https://vidyavaani.shoumikgoswami.com/k/${randomToken()}`,
  () => `http://localhost:3000/s/${randomToken()}`,
  () => `https://a-much-longer-school-address.example.education.in/s/${randomToken()}`,
];

test('every branded code reads back, large and as small as a phone sees a sticker', () => {
  for (const make of links) {
    for (let i = 0; i < 12; i += 1) {
      const url = make();
      const svg = brandedQr(url);
      for (const pixels of [900, 480, 240]) assert.equal(read(svg, pixels), url, `${url} at ${pixels}px`);
    }
  }
});

test('the code carries the brand: logo, blue corner squares and a clear border', () => {
  const svg = brandedQr(links[0]());
  assert.equal([...svg.matchAll(/fill="#2438c8"/g)].length, 4, 'three corners and the logo');
  assert.match(svg, /fill="#ffb020"/);
  // Nothing but the white background reaches into the four-module border.
  const full = Number(/viewBox="0 0 (\d+)/.exec(svg)[1]);
  const shapes = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].slice(1);
  for (const [, x, y, w, h] of shapes.map((m) => m.map(Number))) {
    assert.ok(x >= 4 && y >= 4 && x + w <= full - 4 && y + h <= full - 4);
  }
});
