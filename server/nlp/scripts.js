// Small models sometimes drop a word from another Indian script into a translation
// (a Hindi word inside Telugu). Such an answer is rejected and asked for again.

const SCRIPTS = [
  'Devanagari', 'Bengali', 'Tamil', 'Telugu', 'Gujarati', 'Kannada', 'Malayalam', 'Gurmukhi', 'Oriya', 'Arabic',
  'Ol_Chiki', 'Meetei_Mayek',
];
const OWN = {
  hi: ['Devanagari'], mr: ['Devanagari'], ne: ['Devanagari'], sa: ['Devanagari'], kok: ['Devanagari'], mai: ['Devanagari'],
  doi: ['Devanagari'], brx: ['Devanagari'], bn: ['Bengali'], as: ['Bengali'], ta: ['Tamil'], te: ['Telugu'], gu: ['Gujarati'],
  kn: ['Kannada'], ml: ['Malayalam'], pa: ['Gurmukhi'], or: ['Oriya'], ur: ['Arabic'], ks: ['Arabic', 'Devanagari'],
  sd: ['Arabic', 'Devanagari'], sat: ['Ol_Chiki'], mni: ['Meetei_Mayek', 'Bengali'], en: [],
};
// Letters only: the danda and other shared punctuation belong to no single script.
const patterns = new Map(SCRIPTS.map((s) => [s, new RegExp(String.raw`(?=\p{L})\p{Script=${s}}`, 'u')]));

/** True when the text uses its own script (plus Latin for English school words) and no other. */
export function scriptOk(text, code) {
  const own = OWN[code];
  if (!own) return true;
  if (SCRIPTS.some((s) => !own.includes(s) && patterns.get(s).test(text))) return false;
  // A translation into an Indian language must actually contain that script.
  return own.length === 0 || own.some((s) => patterns.get(s).test(text));
}
