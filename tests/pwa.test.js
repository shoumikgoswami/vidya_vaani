// What a phone needs before it will offer to install the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const client = path.join(import.meta.dirname, '..', 'client');
const read = (file) => fs.readFileSync(path.join(client, file), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));

/** Width and height are stored at fixed offsets in a PNG header. */
const pngSize = (file) => {
  const data = fs.readFileSync(path.join(client, file));
  assert.equal(data.subarray(1, 4).toString(), 'PNG', file);
  return `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`;
};

test('the manifest names the app and opens it full screen', () => {
  assert.ok(manifest.name && manifest.short_name.length <= 12);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.id, '/');
});

test('PNG icons exist at 192 and 512, with maskable versions, at their stated sizes', () => {
  for (const purpose of ['any', 'maskable']) {
    for (const size of ['192x192', '512x512']) {
      assert.ok(manifest.icons.some((i) => i.sizes === size && i.purpose === purpose), `${purpose} ${size}`);
    }
  }
  for (const image of [...manifest.icons, ...manifest.screenshots].filter((i) => i.src.endsWith('.png'))) {
    assert.equal(pngSize(image.src), image.sizes, image.src);
  }
});

test('iPhones get a PNG home screen icon and standalone tags', () => {
  const html = read('index.html');
  assert.match(html, /rel="apple-touch-icon" href="\/img\/apple-touch-icon\.png"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.equal(pngSize('img/apple-touch-icon.png'), '180x180');
});

test('every file the service worker saves for offline use exists', () => {
  const source = read('sw.js');
  const fixed = [...source.matchAll(/'(\/(?:css|img|lib|views|i18n|app)[\w./-]*)'/g)].map((m) => m[1]);
  const group = (folder) => {
    const list = new RegExp(String.raw`\.\.\.\[([^\]]+)\]\s*\.map\(\(n\) => \x60/${folder}/`).exec(source)[1];
    return [...list.matchAll(/'([\w-]+)'/g)].map((m) => `/${folder}/${m[1]}.js`);
  };
  const files = [...fixed, ...group('lib'), ...group('views')];
  assert.ok(files.length > 25);
  for (const file of files) assert.ok(fs.existsSync(path.join(client, file)), file);
  // And nothing the app loads is left out.
  for (const folder of ['lib', 'views']) {
    for (const name of fs.readdirSync(path.join(client, folder))) assert.ok(files.includes(`/${folder}/${name}`), `${name} not saved offline`);
  }
});
