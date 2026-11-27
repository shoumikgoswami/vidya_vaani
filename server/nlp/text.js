// Text helpers that work across Indic scripts, where \b is useless.
import fs from 'node:fs';
import path from 'node:path';

export const lexicon = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'lexicon.json'), 'utf8'));

// Zero code points of the decimal digit blocks used in India.
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x1c50, 0xabf0];

export function asciiDigits(text) {
  return String(text ?? '').replace(/\p{Nd}/gu, (ch) => {
    const code = ch.codePointAt(0);
    const zero = DIGIT_ZEROS.find((z) => code >= z && code <= z + 9);
    return zero === undefined ? ch : String(code - zero);
  });
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regex for a lexicon word. Latin words need boundaries on both sides. Indic words only need a
 * left boundary, because case endings attach to the right (வெள்ளிக்கிழமைக்குள்).
 */
export function wordRegex(word, flags = 'iu') {
  const left = '(?<![\\p{L}\\p{M}\\p{N}])';
  const right = /^[\x20-\x7e]+$/.test(word) ? '(?![\\p{L}\\p{N}])' : '';
  const body = escapeRegex(word.normalize('NFC'));
  return new RegExp(/^[^\p{L}\p{N}]/u.test(word) ? body : `${left}${body}${right}`, flags);
}

export const findWord = (text, words) => {
  for (const word of words) {
    const match = wordRegex(word).exec(text);
    if (match) return { word, index: match.index };
  }
  return null;
};

export const tokens = (text) =>
  String(text ?? '').normalize('NFC').split(/[\s,.;:!?।॥۔"'()\[\]]+/u).filter(Boolean);

export const sentences = (text) =>
  String(text ?? '').split(/(?<=[.!?।॥۔])\s+|\n+/u).map((s) => s.trim()).filter(Boolean);
