import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LANG_CODES } from '../client/lib/languages.js';

const dir = path.join(import.meta.dirname, '..', 'client', 'i18n');
const read = (code) => JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
const english = read('en');

test('all 23 languages ship, with matching keys and placeholders', () => {
  assert.equal(LANG_CODES.length, 23);
  for (const code of LANG_CODES) {
    const table = read(code);
    if (code !== 'en') assert.equal(table._review, true, `${code} is a draft until a speaker checks it`);
    for (const [key, value] of Object.entries(table)) {
      if (key === '_review') continue;
      assert.ok(key in english, `${code}: unknown key ${key}`);
      assert.equal(placeholders(value), placeholders(english[key]), `${code}: placeholders of ${key}`);
    }
  }
});

test('the interface has no em or en dashes in English', () => {
  for (const [key, value] of Object.entries(english)) assert.doesNotMatch(value, /[–—]/, key);
});

test('every key the app asks for exists', () => {
  const sources = ['client/views', 'client/lib', 'client'].flatMap((folder) => {
    const full = path.join(dir, '..', '..', folder);
    return fs.readdirSync(full).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(full, f), 'utf8'));
  });
  const asked = sources.flatMap((s) => [...s.matchAll(/\bt\('([a-z0-9_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...new Set(asked)].filter((k) => !(k in english)), []);
});
