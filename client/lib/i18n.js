// App text in the person's language. A missing string falls back to English (spec 6).
import { lang, isLang, isRtl } from './languages.js';

const cache = new Map();
let current = 'en';
let table = {};
let english = {};

async function load(code) {
  if (!cache.has(code)) {
    const data = await fetch(`/i18n/${code}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    cache.set(code, data);
  }
  return cache.get(code);
}

export function initialLanguage() {
  const saved = localStorage.getItem('vv.lang');
  if (isLang(saved)) return saved;
  const device = (navigator.language || 'en').split('-')[0];
  return isLang(device) ? device : 'en';
}

export const hasChosenLanguage = () => Boolean(localStorage.getItem('vv.lang'));

export async function setLanguage(code, { remember = true } = {}) {
  current = isLang(code) ? code : 'en';
  [english, table] = await Promise.all([load('en'), load(current)]);
  if (remember) localStorage.setItem('vv.lang', current);
  document.documentElement.lang = current;
  document.documentElement.dir = isRtl(current) ? 'rtl' : 'ltr';
}

export const language = () => current;

/** The language a string will actually be shown in, so speech uses the matching voice. */
export const languageOf = (key) => (table[key] === undefined ? 'en' : current);

export function t(key, vars = {}) {
  const template = table[key] ?? english[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_m, name) => vars[name] ?? '');
}

/** A phrase in a specific language, used when speaking to someone in theirs. */
export async function phrase(code, key, vars = {}) {
  const data = await load(isLang(code) ? code : 'en');
  const text = data[key] ?? (await load('en'))[key] ?? key;
  return { text: text.replace(/\{(\w+)\}/g, (_m, name) => vars[name] ?? ''), lang: data[key] === undefined ? 'en' : code };
}

export function formatDate(iso, options = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return '';
  const date = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  try {
    return new Intl.DateTimeFormat(lang(current).bcp47, options).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-IN', options).format(date);
  }
}

export const todayIso = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export function daysUntil(iso, today = todayIso()) {
  return Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);
}

export function relativeDay(iso, today = todayIso()) {
  const days = daysUntil(iso, today);
  if (days === 0) return t('today');
  if (days === 1) return t('tomorrow');
  if (days === -1) return t('yesterday');
  return null;
}
