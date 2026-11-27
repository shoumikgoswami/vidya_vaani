// One call translates a note into every language needed (spec 5.5).
import { z } from 'zod';
import { config } from '../config.js';
import { lang } from '../../client/lib/languages.js';
import { completeJson, chat, llmAvailable } from './llm.js';
import { protect, restore } from '../nlp/placeholders.js';

const SYSTEM = `You translate short notes between school teachers and parents in India.
Use plain, simple words a parent with little schooling understands. Translate the meaning, not word for word.
Keep common English school words such as homework, test, fees and exam, written in the target script.
Text like ⟦N1⟧ is a placeholder for a name or number. Copy every placeholder exactly, once, into every translation.
Do not add or remove information. Reply with one JSON object whose keys are the requested language codes.`;

export const needsWarning = (target) => Boolean(lang(target).lowData);

async function rivaHiEn(text, from, to) {
  const names = { hi: 'Hindi', en: 'English' };
  return chat(
    { provider: 'nvidia', base: config.nvidia.llmBase, key: config.nvidia.apiKey, model: config.nvidia.translateModel },
    [
      { role: 'system', content: `You are an expert at translating text from ${names[from]} to ${names[to]}.` },
      { role: 'user', content: `What is the ${names[to]} translation of the sentence: ${text}?` },
    ],
    { maxTokens: 800 },
  );
}

/**
 * translate(text, from, toLangs) -> { [lang]: { text, provider, model, machineWarning } }
 * Languages that fail are simply missing from the result. Throws when the whole chain failed.
 */
export async function translate(text, from, toLangs, { protectTerms = [] } = {}) {
  const targets = [...new Set(toLangs)].filter((code) => code && code !== from);
  const out = {};
  if (!targets.length || !text || !llmAvailable()) return out;

  const guarded = protect(text, protectTerms);
  const done = (code, value, provider, model) => {
    const restored = restore(value, guarded.values);
    if (restored) out[code] = { text: restored, provider, model, machineWarning: needsWarning(code) };
  };

  if (config.nvidia.translateHiEn && config.nvidia.apiKey && ['hi', 'en'].includes(from)) {
    for (const code of targets.filter((c) => ['hi', 'en'].includes(c))) {
      try {
        done(code, await rivaHiEn(guarded.text, from, code), 'nvidia', config.nvidia.translateModel);
      } catch {
        // The general model below covers it.
      }
    }
  }

  let remaining = targets.filter((c) => !out[c]);
  // One extra round for any language whose placeholders came back damaged.
  for (let round = 0; round < 2 && remaining.length; round += 1) {
    const wanted = remaining.map((c) => `${c} (${lang(c).name})`).join(', ');
    const schema = z.object(Object.fromEntries(remaining.map((c) => [c, z.string().min(1)]))).partial()
      .refine((o) => Object.keys(o).length > 0);
    try {
      const result = await completeJson({
        system: SYSTEM,
        user: `Source language: ${from ? lang(from).name : 'detect it'}.\nTarget languages: ${wanted}.\nNote:\n${guarded.text}`,
        schema,
        maxTokens: Math.min(4000, 300 + remaining.length * Math.ceil(text.length * 1.5)),
      });
      for (const code of remaining) {
        if (result.data[code]) done(code, result.data[code], result.provider, result.model);
      }
    } catch (error) {
      if (!Object.keys(out).length) throw error;
      break;
    }
    remaining = targets.filter((c) => !out[c]);
  }
  return out;
}
