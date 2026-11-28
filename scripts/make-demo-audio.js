// Makes the sample school's recordings, kept in demo/audio, in NVIDIA's natural voice. The sample
// school speaks Hindi and English only, the languages that voice covers.
//   node --env-file-if-exists=.env scripts/make-demo-audio.js            every sample
//   node --env-file-if-exists=.env scripts/make-demo-audio.js hi-fee     only the ones named
// Needs NVIDIA_API_KEY and ffmpeg. A real recording in demo/sample-notes/<key>.webm is always used
// instead.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'sample-data.json'), 'utf8'));
const out = path.join(ROOT, 'demo', 'audio');
const key = process.env.NVIDIA_API_KEY?.trim();
const magpie = (process.env.NVIDIA_TTS_MAGPIE_URL?.trim() || 'https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com')
  .replace(/\/+$/, '');
const LOCALES = { hi: 'hi-IN', en: 'en-US' };
/** One voice for each person, so every speaker sounds like someone else. */
const VOICES = { meena: 'Aria', sunita: 'Isabela', arjun: 'Leo', lakshmi: 'Sofia.Calm' };
if (!key) throw new Error('Set NVIDIA_API_KEY (in .env) first.');

async function speak(sample, file) {
  const locale = LOCALES[sample.lang];
  if (!locale) throw new Error(`${sample.key}: the sample school speaks Hindi or English only`);
  const form = new FormData();
  // `say` spells English school words in the sentence's own script, so they are pronounced well.
  form.set('text', sample.say || sample.raw);
  form.set('language', locale);
  form.set('voice', `Magpie-Multilingual.${locale.toUpperCase()}.${VOICES[sample.author] || 'Aria'}`);
  form.set('encoding', 'LINEAR_PCM');
  form.set('sample_rate_hz', '22050');
  const res = await fetch(`${magpie}/v1/audio/synthesize`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`NVIDIA returned ${res.status}`);
  const audio = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, audio);
  // The service answers with a WAV file or bare samples.
  return audio.subarray(0, 4).toString() === 'RIFF' ? [] : ['-f', 's16le', '-ar', '22050', '-ac', '1'];
}

const wanted = process.argv.slice(2);
const samples = [...data.notes, ...data.replies].filter((s) => !wanted.length || wanted.includes(s.key));
const spoken = path.join(os.tmpdir(), `vv-demo-${process.pid}`);
fs.mkdirSync(out, { recursive: true });

for (const sample of samples) {
  const input = await speak(sample, spoken);
  const target = path.join(out, `${sample.key}.webm`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...input, '-i', spoken, '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', target]);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', target]));
  console.log(`demo/audio/${sample.key}.webm  "durationMs": ${Math.round(seconds * 1000)}`);
  // The free service allows about 40 requests a minute.
  await new Promise((resolve) => setTimeout(resolve, 1600));
}
fs.rmSync(spoken, { force: true });
