// Fuzzy student-name matching across scripts, for the duplicate warning (spec 2.3).
// The Brahmi-derived Unicode blocks share one layout, so an offset table covers nine scripts.

const BLOCKS = [0x0900, 0x0980, 0x0a00, 0x0a80, 0x0b00, 0x0b80, 0x0c00, 0x0c80, 0x0d00];

const CONSONANTS = {
  0x15: 'k', 0x16: 'k', 0x17: 'g', 0x18: 'g', 0x19: 'n', 0x1a: 'c', 0x1b: 'c', 0x1c: 'j', 0x1d: 'j', 0x1e: 'n',
  0x1f: 't', 0x20: 't', 0x21: 'd', 0x22: 'd', 0x23: 'n', 0x24: 't', 0x25: 't', 0x26: 'd', 0x27: 'd', 0x28: 'n',
  0x29: 'n', 0x2a: 'p', 0x2b: 'p', 0x2c: 'b', 0x2d: 'b', 0x2e: 'm', 0x2f: 'y', 0x30: 'r', 0x31: 'r', 0x32: 'l',
  0x33: 'l', 0x34: 'l', 0x35: 'v', 0x36: 's', 0x37: 's', 0x38: 's', 0x39: 'h',
};
const VOWELS = { 0x05: 'a', 0x06: 'a', 0x07: 'i', 0x08: 'i', 0x09: 'u', 0x0a: 'u', 0x0f: 'e', 0x10: 'e', 0x13: 'o', 0x14: 'o', 0x02: 'n' };

const URDU = {
  ا: 'a', آ: 'a', ب: 'b', پ: 'p', ت: 't', ٹ: 't', ث: 's', ج: 'j', چ: 'c', ح: 'h', خ: 'k', د: 'd', ڈ: 'd', ذ: 'j',
  ر: 'r', ڑ: 'r', ز: 'j', س: 's', ش: 's', ص: 's', ض: 'j', ط: 't', ظ: 'j', غ: 'g', ف: 'p', ق: 'k', ک: 'k', گ: 'g',
  ل: 'l', م: 'm', ن: 'n', ں: 'n', و: 'v', ہ: 'h', ھ: '', ی: 'y', ے: 'y', ع: 'a',
};

export function transliterate(text) {
  let out = '';
  for (const ch of String(text ?? '').normalize('NFD')) {
    const code = ch.codePointAt(0);
    const block = BLOCKS.find((b) => code >= b && code < b + 0x80);
    if (block !== undefined) {
      const offset = code - block;
      out += CONSONANTS[offset] ?? VOWELS[offset] ?? '';
    } else if (URDU[ch] !== undefined) {
      out += URDU[ch];
    } else {
      out += ch;
    }
  }
  return out;
}

/** A rough sound key: consonant skeleton of each word, so "Ravi", "रवि" and "ரவி" meet. */
export function nameKey(name) {
  return transliterate(name)
    .toLowerCase()
    .replace(/[̀-ͯ]/g, '')
    .replace(/ph/g, 'p')
    .replace(/([kgcjtdpbs])h/g, '$1')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/q/g, 'k')
    .replace(/f/g, 'p')
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((word) => word[0] + word.slice(1).replace(/[aeiouy]/g, ''))
    .map((word) => word.replace(/(.)\1+/g, '$1'))
    .join(' ');
}

export function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

export function similarNames(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // One is the other without a surname: "Ravi" and "Ravi Kumar".
  const [short, long] = x.split(' ').length <= y.split(' ').length ? [x, y] : [y, x];
  if (long.startsWith(`${short} `)) return true;
  return Math.max(x.length, y.length) >= 5 && editDistance(x, y) <= 1;
}
