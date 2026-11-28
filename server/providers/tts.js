// NVIDIA Magpie text-to-speech for Hindi and English, cached in the database.
// Every other case returns null and the browser's own voice takes over.
import { config } from '../config.js';
import { saveMedia, loadMedia } from '../services/media.js';
import { sha256 } from '../lib/util.js';
import { lang, VOICES } from '../../client/lib/languages.js';
import { toHindiSpeech } from '../nlp/speech-hi.js';
import { toMp3 } from './audio/ffmpeg.js';
import { acquire, recordUsage, errorFromStatus } from './ratelimit.js';

const SAMPLE_RATE = 22050;
const MAGPIE_LOCALE = { hi: 'hi-IN', en: 'en-US' };
/** Long notes are spoken a few sentences at a time and joined. */
const PIECE = 900;
let voicePromise;

async function listVoices() {
  const res = await fetch(`${config.nvidia.magpieUrl}/v1/audio/list_voices`, {
    headers: { Authorization: `Bearer ${config.nvidia.apiKey}` },
    signal: AbortSignal.timeout(config.timeouts.ttsMs),
  });
  if (!res.ok) throw errorFromStatus(res.status, 'list_voices failed');
  const data = await res.json();
  return Object.values(data).flatMap((v) => (Array.isArray(v) ? v : v?.voices || []));
}

/** The service's full name for a voice such as "Leo", in this language. */
export async function voiceFor(code, name = VOICES[0]) {
  const locale = MAGPIE_LOCALE[code];
  // The promise itself is cached, so many requests at once ask for the list only once.
  voicePromise ||= listVoices().catch(() => {
    voicePromise = undefined;
    return [];
  });
  const voices = await voicePromise;
  const tag = `.${locale.toUpperCase()}.`;
  const matching = voices.filter((v) => typeof v === 'string' && v.toUpperCase().includes(tag));
  const called = (wanted) => matching.find((v) => v.endsWith(`.${wanted}`));
  return called(name) || called(VOICES[0]) || matching[0] || `Magpie-Multilingual.${locale.toUpperCase()}.${name}`;
}

export function pieces(text, limit = PIECE) {
  const out = [];
  let current = '';
  // Sentences end with a full stop, a danda, a question or an exclamation mark.
  for (const sentence of text.split(/(?<=[.?!।])\s+/u)) {
    for (let rest = sentence; rest;) {
      // A sentence longer than the limit breaks at a space.
      const cut = rest.length <= limit ? rest.length : rest.lastIndexOf(' ', limit) > 0 ? rest.lastIndexOf(' ', limit) : limit;
      const part = rest.slice(0, cut);
      rest = rest.slice(cut).trim();
      if (current && current.length + part.length + 1 > limit) {
        out.push(current);
        current = part;
      } else current = current ? `${current} ${part}` : part;
    }
  }
  if (current) out.push(current);
  return out;
}

/** The service answers with a WAV file or bare samples. */
const samplesOf = (buffer) => (buffer.subarray(0, 4).toString('ascii') === 'RIFF'
  ? buffer.subarray(buffer.indexOf('data', 12, 'ascii') + 8) : buffer);

function toWav(samples) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

async function speakPiece(text, code, voice) {
  if (!(await acquire('nvidia:magpie-tts', { maxWaitMs: 2000 }))) return null;
  const form = new FormData();
  form.set('text', text);
  form.set('language', MAGPIE_LOCALE[code]);
  form.set('voice', voice);
  form.set('encoding', 'LINEAR_PCM');
  form.set('sample_rate_hz', String(SAMPLE_RATE));
  const res = await fetch(`${config.nvidia.magpieUrl}/v1/audio/synthesize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.nvidia.apiKey}` },
    body: form,
    // A long piece takes longer to speak than a short instruction.
    signal: AbortSignal.timeout(config.timeouts.ttsMs + text.length * 20),
  });
  if (!res.ok) {
    await recordUsage('nvidia:magpie-tts', errorFromStatus(res.status, 'synthesize failed'));
    return null;
  }
  await recordUsage('nvidia:magpie-tts');
  return samplesOf(Buffer.from(await res.arrayBuffer()));
}

/**
 * The spoken text as audio bytes, or null. WAV for short instructions; MP3 for a note, which is
 * stored with that note and deleted with it.
 */
export async function synthesize(text, code, { voice: name, mp3 = false, noteId = null } = {}) {
  if (!config.nvidia.apiKey || lang(code).tts !== 'magpie') return null;
  try {
    const voice = await voiceFor(code, name || VOICES[0]);
    // "v2": Hindi recorded before English words were converted is not reused.
    const key = `${noteId ? `speech/${noteId}` : 'tts'}/v2-${code}-${sha256(`${voice}:${text}`).slice(0, 32)}`;
    const cached = await loadMedia(key);
    if (cached) return cached.data;

    const spoken = code === 'hi' ? await toHindiSpeech(text) : { text, complete: true };
    const parts = [];
    for (const part of pieces(spoken.text)) {
      const samples = await speakPiece(part, code, voice);
      if (!samples) return null;
      parts.push(samples);
    }
    const wav = toWav(Buffer.concat(parts));
    const audio = mp3 ? await toMp3(wav) : wav;
    if (spoken.complete) await saveMedia(key, { mime: mp3 ? 'audio/mpeg' : 'audio/wav', data: audio, noteId });
    return audio;
  } catch (error) {
    console.warn('speech failed', error.message);
    return null;
  }
}
