// Filling the add-student and add-teacher forms from speech or a pasted list, without AI.
import { lexicon, asciiDigits, findWord, tokens } from './text.js';
import { normalizePhone, normalizeEmail } from '../lib/util.js';

const FILLER = new Set([
  'papa', 'mummy', 'mama', 'pita', 'mata', 'ka', 'ki', 'ke', 'number', 'no', 'mobile', 'phone', 'hai', 'is', 'father', 'mother',
  'parent', 'parents', 'name', 'naam', 'teacher', 'aur', 'and', 'roll', 'subject', 'subjects', 'email', 'gmail',
  'पापा', 'मम्मी', 'पिता', 'माता', 'का', 'की', 'के', 'नंबर', 'नम्बर', 'मोबाइल', 'फोन', 'फ़ोन', 'है', 'नाम', 'और', 'टीचर', 'विषय',
  'அப்பா', 'அம்மா', 'எண்', 'நம்பர்', 'போன்', 'বাবা', 'মা', 'নম্বর', 'ফোন', 'এর',
]);

const SPOKEN_DIGITS = new Map(
  Object.entries(lexicon.numbers).filter(([, v]) => v < 10).concat([['zero', 0], ['shunya', 0], ['शून्य', 0], ['ज़ीरो', 0], ['जीरो', 0]]),
);

/** "nau aath saat ..." spoken digit by digit becomes "987...". */
function joinSpokenDigits(text) {
  const parts = asciiDigits(text).split(/(\s+)/);
  const isDigitish = (p) => /^\d+$/.test(p) || SPOKEN_DIGITS.has(p.toLowerCase());
  let out = '';
  let run = [];
  const flush = () => {
    if (run.length >= 3) out += run.map((p) => (/^\d+$/.test(p) ? p : SPOKEN_DIGITS.get(p.toLowerCase()))).join('') + ' ';
    else if (run.length) out += `${run.join(' ')} `;
    run = [];
  };
  for (const part of parts) {
    if (/^\s+$/.test(part)) continue;
    const bare = part.replace(/[,.।]+$/, '');
    if (isDigitish(bare)) {
      run.push(bare);
      if (bare !== part) flush();
    } else {
      flush();
      out += `${part} `;
    }
  }
  flush();
  return out.trim();
}

const PHONE = /(?:\+?\d[\d\s-]{8,16}\d)/;
const EMAIL = /[^\s,;]+@[^\s,;]+\.[a-z]{2,}/i;

export function parsePerson(line) {
  let text = joinSpokenDigits(line);
  const emailMatch = EMAIL.exec(text);
  const email = normalizeEmail(emailMatch?.[0]);
  if (emailMatch) text = text.replace(emailMatch[0], ' , ');
  const phoneMatch = PHONE.exec(text);
  const phone = normalizePhone(phoneMatch?.[0].replace(/[\s-]/g, ''));
  if (phoneMatch) text = text.replace(phoneMatch[0], ' , ');

  const subjects = Object.keys(lexicon.subjects).filter((s) => findWord(text, lexicon.subjects[s]));

  // The name is what comes before the first comma, number or filler word.
  const head = text.split(/[,;|\t]|\s-\s/)[0];
  const words = [];
  for (const word of tokens(head)) {
    if (FILLER.has(word.toLowerCase()) || /^\d+$/.test(word)) {
      if (words.length) break;
      continue;
    }
    words.push(word);
    if (words.length === 4) break;
  }
  const rollMatch = /(?:roll(?:\s*no\.?)?|रोल(?:\s*नंबर)?)\s*(\d{1,4})/iu.exec(asciiDigits(line));
  return {
    name: words.join(' ').replace(/^\d+[.)]\s*/, '').trim(),
    phone,
    email,
    rollNo: rollMatch?.[1] ?? null,
    subjects,
  };
}

/** One student per line, for example copied from WhatsApp. */
export const parseList = (text) =>
  String(text ?? '')
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean)
    .map(parsePerson)
    .filter((p) => p.name);
