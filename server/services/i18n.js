// Server-side strings (push notifications), read from the same files the browser uses.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { isLang } from '../../client/lib/languages.js';

const dir = path.join(ROOT, 'client', 'i18n');
const cache = new Map();

export function strings(code) {
  if (!cache.has(code)) {
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
    } catch {
      // Missing locale: English fills in.
    }
    cache.set(code, data);
  }
  return cache.get(code);
}

export function t(code, key, vars = {}) {
  const template = strings(isLang(code) ? code : 'en')[key] ?? strings('en')[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_m, name) => vars[name] ?? '');
}

/** Every fixed phrase in every language: the only text that may be spoken without signing in. */
export function isAppPhrase(code, text) {
  return [strings(code), strings('en')].some((set) => Object.values(set).includes(text));
}
