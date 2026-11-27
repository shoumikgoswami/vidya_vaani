// Day-1 model test (spec 5.4 and 16): which chat model to use, and whether speech works.
//   docker compose exec app npm run models:test
//   docker compose exec app npm run models:test -- model-a model-b      (compare other models)
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../server/config.js';
import { llmChain, chat, extractJson } from '../server/providers/llm.js';
import { enrichSchema } from '../server/nlp/enrich.js';
import { transcribe } from '../server/providers/asr.js';
import { synthesize } from '../server/providers/tts.js';
import { todayIst } from '../server/nlp/dates.js';
import { lang } from '../client/lib/languages.js';

const sentences = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'test-sentences.json'), 'utf8'));
const asked = process.argv.slice(2);
const chain = asked.length
  ? asked.map((model) => ({ provider: 'nvidia', base: config.nvidia.llmBase, key: config.nvidia.apiKey, model }))
  : llmChain();

if (!chain.length) {
  console.error('Set NVIDIA_API_KEY or OPENROUTER_API_KEY in .env first.');
  process.exit(1);
}

const median = (list) => (list.length ? [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] : null);
const lines = [`# Model test, ${todayIst()}`, '', '## Chat models on 30 diary sentences', '',
  '| Model | Valid JSON | Right tag | Translation returned | Median seconds |', '|---|---|---|---|---|'];

for (const target of chain) {
  let valid = 0;
  let tagged = 0;
  let translated = 0;
  const times = [];
  const samples = [];
  for (const [index, [code, sentence, expected]] of sentences.entries()) {
    const started = Date.now();
    try {
      const answer = await chat(target, [
        { role: 'system', content: 'Return one JSON object {"clean": string, "tags": [{"type": "homework"|"fee"|"exam"|"event"|"holiday"|"notice", "subject": string|null, "dueDate": "YYYY-MM-DD"|null}]} for the school note.' },
        { role: 'user', content: `Today: ${todayIst()}. Language: ${lang(code).name}.\n${sentence}` },
      ], { json: true, timeoutMs: 45_000 });
      times.push((Date.now() - started) / 1000);
      const parsed = enrichSchema.safeParse(extractJson(answer));
      if (parsed.success) {
        valid += 1;
        if (parsed.data.tags.some((t) => expected.includes(t.type))) tagged += 1;
      }
      // Every third sentence is also translated, for a person to judge.
      if (index % 3 === 0) {
        const other = await chat(target, [
          { role: 'system', content: 'Translate into plain, simple language. Reply with JSON {"hi": string, "ta": string, "bn": string, "te": string, "en": string}.' },
          { role: 'user', content: sentence },
        ], { json: true, timeoutMs: 45_000 });
        const json = extractJson(other);
        if (json?.en) {
          translated += 1;
          if (samples.length < 4) samples.push(`- ${sentence}\n  ${JSON.stringify(json)}`);
        }
      }
    } catch (error) {
      console.error(`${target.model} sentence ${index + 1}: ${error.message}`);
      if (error.kind === 'auth') break;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 1800));
  }
  lines.push(`| ${target.provider}: ${target.model} | ${valid}/30 | ${tagged}/30 | ${translated}/10 | ${median(times)?.toFixed(1) ?? '-'} |`);
  if (samples.length) lines.push('', `<details><summary>Translations from ${target.model}</summary>`, '', ...samples, '', '</details>', '');
}

lines.push('', '## Speech', '', '| Check | Result |', '|---|---|');
if (config.nvidia.apiKey) {
  const dir = path.join(config.dataDir, 'demo-audio');
  const clips = [['hi-homework', 'hi'], ['bn-exam', 'bn'], ['ta-science', 'ta'], ['or-uniform', 'te'], ['hi-fee', 'mr'], ['hi-homework', 'auto']];
  for (const [clip, code] of clips) {
    const file = path.join(dir, `${clip}.webm`);
    if (!fs.existsSync(file)) {
      lines.push(`| ${clip} (${code}) | no clip; start the app once to create demo audio |`);
      continue;
    }
    try {
      const result = await transcribe(file, { languageHint: code });
      lines.push(`| ${clip} as ${code} | ${result.model}: ${result.text} |`);
    } catch (error) {
      lines.push(`| ${clip} as ${code} | FAILED: ${error.message} |`);
    }
  }
  for (const [code, text] of [['hi', 'हो गया। नोट सेव हो गया।'], ['en', 'Done. The note is saved.']]) {
    lines.push(`| Magpie voice ${code} | ${(await synthesize(text, code)) ? 'audio returned' : 'FAILED'} |`);
  }
  lines.push('', 'Demo clips are computer voices. Repeat with real recordings in demo/sample-notes/ before trusting accuracy.');
} else {
  lines.push('| NVIDIA speech | skipped, NVIDIA_API_KEY not set |');
}

const report = `${lines.join('\n')}\n`;
console.log(`\n\n${report}`);
for (const target of [path.join(ROOT, 'docs', 'model-eval.md'), path.join(config.dataDir, 'model-eval.md')]) {
  try {
    fs.writeFileSync(target, report);
    console.log(`saved to ${target}`);
    break;
  } catch {
    // The container's code folder is read only.
  }
}
process.exit(0);
