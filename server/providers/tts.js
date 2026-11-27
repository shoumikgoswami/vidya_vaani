// NVIDIA Magpie text-to-speech for Hindi and English, cached on disk.
// Every other case returns null and the browser's own voice takes over.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { get, run } from '../db/index.js';
import { sha256 } from '../lib/util.js';
import { lang } from '../../client/lib/languages.js';
import { acquire, recordUsage, errorFromStatus } from './ratelimit.js';

const SAMPLE_RATE = 22050;
const MAGPIE_LOCALE = { hi: 'hi-IN', en: 'en-US' };
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

export async function voiceFor(code) {
  const locale = MAGPIE_LOCALE[code];
  voicePromise ||= listVoices().catch(() => []);
  const voices = await voicePromise;
  const tag = `.${locale.toUpperCase()}.`;
  const matching = voices.filter((v) => typeof v === 'string' && v.toUpperCase().includes(tag));
  return matching.find((v) => v.endsWith('.Aria')) || matching[0] || `Magpie-Multilingual.${locale.toUpperCase()}.Aria`;
}

function toWav(buffer) {
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF') return buffer;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + buffer.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(buffer.length, 40);
  return Buffer.concat([header, buffer]);
}

export async function synthesize(text, code) {
  if (!config.nvidia.apiKey || lang(code).tts !== 'magpie') return null;
  try {
    const voice = await voiceFor(code);
    const hash = sha256(text);
    const cached = get('SELECT audio_path FROM tts_cache WHERE lang = ? AND voice = ? AND text_hash = ?', code, voice, hash);
    if (cached) {
      const file = path.join(config.dataDir, cached.audio_path);
      if (fs.existsSync(file)) return file;
    }
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
      signal: AbortSignal.timeout(config.timeouts.ttsMs),
    });
    if (!res.ok) {
      recordUsage('nvidia:magpie-tts', errorFromStatus(res.status, 'synthesize failed'));
      return null;
    }
    recordUsage('nvidia:magpie-tts');
    const relative = path.join('tts', `${code}-${sha256(`${voice}:${text}`).slice(0, 32)}.wav`);
    fs.writeFileSync(path.join(config.dataDir, relative), toWav(Buffer.from(await res.arrayBuffer())));
    run('INSERT OR REPLACE INTO tts_cache (lang, voice, text_hash, audio_path) VALUES (?,?,?,?)', code, voice, hash, relative);
    return path.join(config.dataDir, relative);
  } catch {
    return null;
  }
}
