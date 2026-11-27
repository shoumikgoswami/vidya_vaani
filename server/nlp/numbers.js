// Number words to digits, only where a number is clearly meant.
// "दो" is also "give" and "do" is also an English verb, so context decides.
import { lexicon, asciiDigits } from './text.js';

const NUMBERS = new Map(Object.entries(lexicon.numbers));
const CONTEXT = new Set(lexicon.numberContext);
const OR = new Set(lexicon.or);

const split = (text) => String(text ?? '').split(/(\s+|[,.;:!?।॥۔()]+)/u);
const isWord = (part) => part && !/^(\s+|[,.;:!?।॥۔()]+)$/u.test(part);
const valueOf = (part) => NUMBERS.get(part.toLowerCase()) ?? (/^\d+$/.test(part) ? Number(part) : null);

export function wordsToDigits(text) {
  const parts = split(asciiDigits(text));
  const words = parts.map((p, i) => ({ p, i })).filter((x) => isWord(x.p));
  const convert = new Set();

  words.forEach(({ p }, n) => {
    if (valueOf(p) === null) return;
    const prev = words[n - 1]?.p.toLowerCase();
    const next = words[n + 1]?.p.toLowerCase();
    const nearContext = CONTEXT.has(prev) || CONTEXT.has(next);
    // "barah ya do": both sides of "or" are numbers when one of them sits in a numeric context.
    if (OR.has(next) && words[n + 2] && valueOf(words[n + 2].p) !== null) {
      if (nearContext || CONTEXT.has(words[n + 3]?.p.toLowerCase()) || valueOf(p) > 2) {
        convert.add(n);
        convert.add(n + 2);
      }
    }
    // "paanch sau" and "do hazaar" compose into one number.
    if (next && (NUMBERS.get(next) === 100 || NUMBERS.get(next) === 1000)) {
      convert.add(n);
      convert.add(n + 1);
    }
    if (nearContext) convert.add(n);
  });

  let skip = -1;
  words.forEach(({ p, i }, n) => {
    if (!convert.has(n) || n <= skip) return;
    let value = valueOf(p);
    let last = n;
    while (words[last + 1] && convert.has(last + 1)) {
      const scale = NUMBERS.get(words[last + 1].p.toLowerCase());
      if (scale !== 100 && scale !== 1000) break;
      value *= scale;
      last += 1;
      const tail = words[last + 1] && valueOf(words[last + 1].p);
      if (tail && tail < scale && convert.has(last + 1)) {
        value += tail;
        last += 1;
      }
    }
    parts[i] = String(value);
    for (let k = n + 1; k <= last; k += 1) {
      for (let j = words[k - 1].i + 1; j <= words[k].i; j += 1) parts[j] = '';
    }
    skip = last;
  });
  return parts.join('');
}

/** Every number in a text, for comparing a cleaned transcript with the raw one. */
export const numbersIn = (text) =>
  (wordsToDigits(text).match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/,/g, ''));

/** "पेज 12 या 2" style doubts: the teacher gets two big buttons. */
export function numberAmbiguities(text) {
  const or = lexicon.or.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(\\d+)\\s+(?:${or})\\s+(\\d+)`, 'giu');
  return [...wordsToDigits(text).matchAll(re)]
    .filter((m) => m[1] !== m[2])
    .map((m) => ({ what: 'number', options: [m[1], m[2]] }));
}
