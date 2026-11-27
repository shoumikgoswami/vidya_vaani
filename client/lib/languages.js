// Single registry of the 22 scheduled languages plus English.
// Shared by the browser and the server, so keep it free of platform APIs.
//
// tier   A full, B good, C partial, D audio first (spec section 6)
// asr    NVIDIA speech plan in order of preference: [model, language code].
//        Checked live on 27 Nov 2026: the hosted Parakeet function refuses bn-IN and ta-IN.
// tts    'magpie' when NVIDIA text-to-speech covers it, otherwise the browser voice

const p = (code) => ['parakeet', code];
const w = (code, approximate = false) => ['whisper', code, approximate];

export const LANGUAGES = [
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', bcp47: 'hi-IN', tier: 'A', asr: [p('hi-IN'), w('hi')], tts: 'magpie' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', bcp47: 'bn-IN', tier: 'A', asr: [w('bn')] },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', bcp47: 'ta-IN', tier: 'A', asr: [w('ta')] },
  { code: 'en', name: 'English', native: 'English', bcp47: 'en-IN', tier: 'A', asr: [w('en')], tts: 'magpie' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', bcp47: 'te-IN', tier: 'B', asr: [w('te')] },
  { code: 'mr', name: 'Marathi', native: 'मराठी', bcp47: 'mr-IN', tier: 'B', asr: [w('mr')] },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', bcp47: 'gu-IN', tier: 'B', asr: [w('gu')] },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', bcp47: 'kn-IN', tier: 'B', asr: [w('kn')] },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', bcp47: 'ml-IN', tier: 'B', asr: [w('ml')] },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', bcp47: 'pa-IN', tier: 'B', asr: [w('pa')] },
  { code: 'ur', name: 'Urdu', native: 'اردو', bcp47: 'ur-IN', tier: 'B', asr: [w('ur')], rtl: true },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', bcp47: 'ne-IN', tier: 'C', asr: [w('ne')] },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া', bcp47: 'as-IN', tier: 'C', asr: [w('as')] },
  { code: 'sa', name: 'Sanskrit', native: 'संस्कृतम्', bcp47: 'sa-IN', tier: 'C', asr: [w('sa')], lowData: true },
  { code: 'sd', name: 'Sindhi', native: 'سنڌي', bcp47: 'sd-IN', tier: 'C', asr: [w('sd')], rtl: true, lowData: true },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', bcp47: 'or-IN', tier: 'D', asr: [] },
  { code: 'kok', name: 'Konkani', native: 'कोंकणी', bcp47: 'kok-IN', tier: 'D', asr: [w('mr', true)], lowData: true },
  { code: 'mai', name: 'Maithili', native: 'मैथिली', bcp47: 'mai-IN', tier: 'D', asr: [w('hi', true)], lowData: true },
  { code: 'doi', name: 'Dogri', native: 'डोगरी', bcp47: 'doi-IN', tier: 'D', asr: [w('hi', true)], lowData: true },
  { code: 'brx', name: 'Bodo', native: 'बड़ो', bcp47: 'brx-IN', tier: 'D', asr: [w('hi', true)], lowData: true },
  { code: 'sat', name: 'Santali', native: 'ᱥᱟᱱᱛᱟᱲᱤ', bcp47: 'sat-IN', tier: 'D', asr: [], lowData: true },
  { code: 'mni', name: 'Manipuri', native: 'ꯃꯩꯇꯩꯂꯣꯟ', bcp47: 'mni-IN', tier: 'D', asr: [], lowData: true },
  { code: 'ks', name: 'Kashmiri', native: 'کٲشُر', bcp47: 'ks-IN', tier: 'D', asr: [w('ur', true)], rtl: true, lowData: true },
];

const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));

export const LANG_CODES = LANGUAGES.map((l) => l.code);
export const lang = (code) => byCode.get(code) || byCode.get('en');
export const isLang = (code) => byCode.has(code);
export const isRtl = (code) => Boolean(byCode.get(code)?.rtl);
