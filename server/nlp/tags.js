// Rule engine: used without an AI key, and when the model fails or returns junk.
import { lexicon, findWord, sentences } from './text.js';
import { parseDueDate, todayIst } from './dates.js';
import { numberAmbiguities, wordsToDigits } from './numbers.js';

export const TAG_TYPES = ['homework', 'fee', 'exam', 'event', 'holiday', 'notice'];

export function ruleExtract(text, today = todayIst()) {
  const tags = new Map();
  for (const sentence of sentences(text)) {
    const due = parseDueDate(sentence, today);
    const subject = Object.keys(lexicon.subjects).find((s) => findWord(sentence, lexicon.subjects[s])) || null;
    const found = TAG_TYPES.filter((type) => findWord(sentence, lexicon.tags[type]));
    // "bring your fees" is a fee note, not also a general notice.
    const types = found.length > 1 ? found.filter((t) => t !== 'notice') : found;
    for (const type of types) {
      const tagSubject = type === 'homework' || type === 'exam' ? subject : null;
      const key = `${type}:${tagSubject}`;
      if (!tags.has(key) || (!tags.get(key).dueDate && due)) {
        tags.set(key, { type, subject: tagSubject, dueDate: due });
      }
    }
  }
  const digits = wordsToDigits(text);
  return {
    tags: [...tags.values()],
    entities: {
      amounts: [...digits.matchAll(/(?:₹|rs\.?)\s*(\d[\d,]*)|(\d[\d,]*)\s*(?:rupaye|rupees|रुपये|रुपए|টাকা|ரூபாய்)/giu)]
        .map((m) => (m[1] || m[2]).replace(/,/g, '')),
      pages: [...digits.matchAll(/(?:page|पेज|पृष्ठ|পাতা|பக்கம்)\s*(\d+)/giu)].map((m) => m[1]),
      dates: [...new Set([...tags.values()].map((t) => t.dueDate).filter(Boolean))],
      names: [],
    },
    ambiguities: numberAmbiguities(text),
  };
}
