// Drafts the missing app strings with the configured model. Run on your computer, review, commit.
//   npm run i18n:fill              every language
//   npm run i18n:fill -- mr gu     only these
import './memory-db.js';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT } from '../server/config.js';
import { completeJson, llmAvailable } from '../server/providers/llm.js';
import { LANGUAGES, lang } from '../client/lib/languages.js';

if (!llmAvailable()) {
  console.error('Set NVIDIA_API_KEY or OPENROUTER_API_KEY in .env first.');
  process.exit(1);
}

const dir = path.join(ROOT, 'client', 'i18n');
const read = (code) => JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
/** Windows now and then holds a file for a moment, for example while it is being scanned. */
function save(code, table) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return fs.writeFileSync(path.join(dir, `${code}.json`), `${JSON.stringify(table, null, 2)}\n`);
    } catch (error) {
      if (attempt >= 6) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300 * attempt);
    }
  }
}
const english = read('en');
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
const args = process.argv.slice(2);
const wanted = args.filter((a) => !a.startsWith('--'));

/** The wording a parent meets, from registering to replying: `npm run i18n:fill -- --parent`. */
function parentKeys() {
  const screens = [
    'app.js', 'lib/ui.js', 'lib/install.js', 'views/register.js', 'views/scan.js', 'views/auth.js', 'views/consent.js',
    'views/parent.js', 'views/note.js', 'views/reply.js', 'views/account.js',
  ].map((file) => fs.readFileSync(path.join(ROOT, 'client', file), 'utf8')).join('\n');
  // Words quoted in those files, and the families of words picked by name while the app runs.
  const quoted = new Set([...screens.matchAll(/'([a-z][a-z0-9_]+)'/g)].map((m) => m[1]));
  const families = /^(tag|err|consent|welcome|link|parent|scan|login|push|help|install|register_(parent|teacher|school|choose|cta|title))/;
  // The office's request form and approvals are not part of a parent's path.
  const office = /^(register_(town|email|privacy|send|done|intro)|request_|approve|decline|delete_request|err_(teacher|class|already|owner|setup))/;
  return Object.keys(english).filter((k) => (quoted.has(k) || families.test(k)) && !office.test(k));
}
const only = args.includes('--parent') ? new Set(parentKeys()) : null;

const SCRIPTS = ['Devanagari', 'Bengali', 'Tamil', 'Telugu', 'Gujarati', 'Kannada', 'Malayalam', 'Gurmukhi', 'Oriya', 'Arabic', 'Ol_Chiki', 'Meetei_Mayek'];
/** The script a language is read in, taken from its own name. */
const scriptOf = (native) => SCRIPTS.find((s) => new RegExp(`\\p{Script=${s}}`, 'u').test(native));
/** Names that stay in English letters in every language. */
const NAMES = /\{\w+\}|QR|NVIDIA|Vidya Vaani|Google|OTP|SMS|Chrome|Safari|iPhone|Samsung Internet|Android/g;
/** Models sometimes spell a language in English letters, which its readers cannot use. */
const readable = (value, script) => {
  const words = String(value).replace(NAMES, '');
  return (words.match(/\p{L}/gu)?.length || 0) <= 3 || new RegExp(`\\p{Script=${script}}`, 'u').test(words);
};

for (const { code, native } of LANGUAGES) {
  if (code === 'en' || (wanted.length && !wanted.includes(code))) continue;
  const table = read(code);
  const script = scriptOf(native);
  // Anything written in the wrong letters is dropped, and asked for again below.
  const unreadable = Object.keys(table).filter((k) => k !== '_review' && !readable(table[k], script));
  for (const key of unreadable) delete table[key];
  if (unreadable.length) save(code, table);
  const missing = Object.keys(english).filter((k) => !(k in table) && (!only || only.has(k)));
  for (let i = 0; i < missing.length; i += 40) {
    const batch = Object.fromEntries(missing.slice(i, i + 40).map((k) => [k, english[k]]));
    try {
      const { data } = await completeJson({
        system: `You translate the text of a phone app for rural parents and teachers in India into ${lang(code).name}.
Use short, plain, everyday words. Keep every {placeholder} exactly. Keep "QR", "NVIDIA" and "Vidya Vaani" as they are.
Write only in the ${script.replace('_', ' ')} script. Never spell ${lang(code).name} words in English letters.
Do not use long dashes. Reply with one JSON object with the same keys.`,
        user: JSON.stringify(batch),
        schema: z.record(z.string()),
        maxTokens: 3500,
      });
      for (const [key, value] of Object.entries(data)) {
        if (key in batch && value.trim() && placeholders(value) === placeholders(batch[key]) && readable(value, script)) {
          table[key] = value.replace(/[–—]/g, '-');
        }
      }
      table._review = true;
      save(code, table);
      process.stdout.write(`${code} ${Math.min(i + 40, missing.length)}/${missing.length}\n`);
    } catch (error) {
      console.error(`${code}: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
process.exit(0);
