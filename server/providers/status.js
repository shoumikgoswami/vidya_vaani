// What each language uses right now, for the office's Configuration screen (spec 5.7).
import { config } from '../config.js';
import { LANGUAGES } from '../../client/lib/languages.js';
import { llmChain } from './llm.js';

export function providerStatus() {
  const nvidia = Boolean(config.nvidia.apiKey);
  const chain = llmChain();
  return {
    nvidia,
    openrouter: Boolean(config.openrouter.apiKey),
    llmModels: chain.map((c) => `${c.provider}: ${c.model}`),
    speech: {
      asr: nvidia ? ['NVIDIA Parakeet', 'NVIDIA Whisper'] : [],
      voice: nvidia ? 'NVIDIA Magpie (Hindi, English)' : null,
    },
    languages: LANGUAGES.map((l) => {
      const first = l.asr[0];
      let speech;
      if (!l.asr.length) speech = 'audio_only';
      else if (!nvidia) speech = 'browser';
      else if (first[2]) speech = 'approximate';
      else speech = first[0];
      return {
        code: l.code,
        name: l.name,
        native: l.native,
        tier: l.tier,
        speech,
        translation: chain.length ? chain[0].provider : 'browser',
        machineWarning: Boolean(l.lowData),
        tts: l.tts === 'magpie' && nvidia ? 'magpie' : 'browser',
      };
    }),
  };
}
