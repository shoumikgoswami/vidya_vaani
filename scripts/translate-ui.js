// Drafts the missing app strings with the configured model. Run on your computer, review, commit.
//   npm run i18n:fill              every language
//   npm run i18n:fill -- mr gu     only these
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
const english = read('en');
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
const wanted = process.argv.slice(2);

for (const { code } of LANGUAGES) {
  if (code === 'en' || (wanted.length && !wanted.includes(code))) continue;
  const table = read(code);
  const missing = Object.keys(english).filter((k) => !(k in table));
  for (let i = 0; i < missing.length; i += 40) {
    const batch = Object.fromEntries(missing.slice(i, i + 40).map((k) => [k, english[k]]));
    try {
      const { data } = await completeJson({
        system: `You translate the text of a phone app for rural parents and teachers in India into ${lang(code).name}.
Use short, plain, everyday words. Keep every {placeholder} exactly. Keep "QR", "NVIDIA" and "Vidya Vaani" as they are.
Do not use long dashes. Reply with one JSON object with the same keys.`,
        user: JSON.stringify(batch),
        schema: z.record(z.string()),
        maxTokens: 3500,
      });
      for (const [key, value] of Object.entries(data)) {
        if (key in batch && value.trim() && placeholders(value) === placeholders(batch[key])) {
          table[key] = value.replace(/[–—]/g, '-');
        }
      }
      table._review = true;
      fs.writeFileSync(path.join(dir, `${code}.json`), `${JSON.stringify(table, null, 2)}\n`);
      process.stdout.write(`${code} ${Math.min(i + 40, missing.length)}/${missing.length}\n`);
    } catch (error) {
      console.error(`${code}: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
process.exit(0);
