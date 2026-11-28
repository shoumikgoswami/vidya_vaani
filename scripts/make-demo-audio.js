// Makes the sample school's computer-voice recordings, kept in demo/audio.
// Needs ffmpeg and espeak-ng on the PATH:  node scripts/make-demo-audio.js
// A real recording in demo/sample-notes/<key>.webm is always used instead.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'sample-data.json'), 'utf8'));
const out = path.join(ROOT, 'demo', 'audio');
const wav = path.join(os.tmpdir(), 'vv-demo.wav');
fs.mkdirSync(out, { recursive: true });

for (const sample of [...data.notes, ...data.replies]) {
  execFileSync('espeak-ng', ['-v', sample.lang, '-s', '135', '-w', wav, sample.raw]);
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-c:a', 'libopus', '-b:a', '24k', path.join(out, `${sample.key}.webm`),
  ]);
  console.log(`demo/audio/${sample.key}.webm`);
}
fs.rmSync(wav, { force: true });
