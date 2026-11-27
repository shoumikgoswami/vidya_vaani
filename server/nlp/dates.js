// Date words to ISO dates, in India Standard Time.
import { lexicon, findWord, wordRegex } from './text.js';
import { wordsToDigits } from './numbers.js';

const IST_OFFSET_MS = 5.5 * 3_600_000;

export const todayIst = (at = Date.now()) => new Date(at + IST_OFFSET_MS).toISOString().slice(0, 10);
export const hourIst = (at = Date.now()) => new Date(at + IST_OFFSET_MS).getUTCHours();

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s)) && addDays(s, 0) === s;

function onOrAfter(today, day, month) {
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // A date that passed within the last two weeks stays this year: it is probably "last Friday".
    if (isIsoDate(iso) && iso >= addDays(today, -14)) return iso;
  }
  return null;
}

function nextDayOfMonth(today, day) {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let i = 0; i < 3; i += 1) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isIsoDate(iso) && iso >= today) return iso;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return null;
}

/**
 * The due date mentioned in a sentence, or null. In a school note "kal" means tomorrow, and the
 * teacher always sees the real date before saving (spec 5.4).
 */
export function parseDueDate(sentence, today = todayIst()) {
  const text = wordsToDigits(sentence).normalize('NFC');

  for (let m = 0; m < 12; m += 1) {
    for (const name of lexicon.months[m]) {
      const month = wordRegex(name).exec(text);
      if (!month) continue;
      const before = /(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?$/i.exec(text.slice(0, month.index));
      const after = /^\D{0,3}?\s*(\d{1,2})(?!\d)/.exec(text.slice(month.index + month[0].length));
      const day = before?.[1] ?? after?.[1];
      if (day) return onOrAfter(today, Number(day), m + 1);
    }
  }

  const slash = /(?<!\d)(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?!\d)/.exec(text);
  if (slash && Number(slash[2]) <= 12) {
    if (slash[3]) {
      const y = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
      const iso = `${y}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`;
      if (isIsoDate(iso)) return iso;
    }
    const iso = onOrAfter(today, Number(slash[1]), Number(slash[2]));
    if (iso) return iso;
  }

  const dated = /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s*(?:तारीख|तारीख़|tarikh|tareekh|তারিখ|தேதி)/iu.exec(text);
  if (dated) return nextDayOfMonth(today, Number(dated[1]));

  if (findWord(text, lexicon.dayAfter)) return addDays(today, 2);

  for (let d = 0; d < 7; d += 1) {
    if (findWord(text, lexicon.weekdays[d])) {
      const ahead = (d - weekdayOf(today) + 7) % 7 || 7;
      return addDays(today, ahead);
    }
  }

  if (findWord(text, lexicon.tomorrow)) return addDays(today, 1);
  if (findWord(text, lexicon.today)) return today;
  return null;
}
