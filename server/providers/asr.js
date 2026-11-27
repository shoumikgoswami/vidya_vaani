// Picks the speech model by language and walks the fallback chain (spec 5.2).
import { config } from '../config.js';
import { lang, isLang } from '../../client/lib/languages.js';
import { recognize } from './nvidia/riva-asr.js';
import { toAsrAudio } from './audio/ffmpeg.js';
import { acquire, recordUsage, ProviderError } from './ratelimit.js';

const MODELS = {
  parakeet: { name: 'parakeet-1.1b-multilingual', functionId: () => config.nvidia.parakeetFunctionId },
  whisper: { name: 'whisper-large-v3', functionId: () => config.nvidia.whisperFunctionId },
};

export function asrPlan(languageHint) {
  // No hint means "Auto": Whisper detects the language itself.
  if (!languageHint || languageHint === 'auto' || !isLang(languageHint)) {
    return [{ model: 'whisper', code: 'multi', approximate: false }];
  }
  return lang(languageHint).asr.map(([model, code, approximate = false]) => ({ model, code, approximate }));
}

/**
 * Returns the transcript, or null when NVIDIA cannot cover this language or no key is set.
 * Throws a ProviderError when every model in the plan failed.
 */
export async function transcribe(audioPath, { languageHint } = {}) {
  const plan = asrPlan(languageHint);
  if (!config.nvidia.apiKey || !plan.length) return null;

  const prepared = await toAsrAudio(audioPath);
  let worst = null;
  for (const step of plan) {
    const model = MODELS[step.model];
    const key = `nvidia:${model.name}`;
    try {
      if (!(await acquire(key, { maxWaitMs: 5000 }))) throw new ProviderError(`${key} is at its rate limit`, 'rate');
      const result = await recognize({ ...prepared, languageCode: step.code, functionId: model.functionId() });
      recordUsage(key);
      if (!result.text) throw new ProviderError(`${key} heard nothing`, 'bad');
      return {
        ...result,
        language: languageHint && languageHint !== 'auto' ? languageHint : (result.language || '').split('-')[0] || null,
        provider: 'nvidia',
        model: model.name,
        approximate: step.approximate,
      };
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      recordUsage(key, error);
      if (!worst || error.transient) worst = error;
    }
  }
  throw worst;
}
