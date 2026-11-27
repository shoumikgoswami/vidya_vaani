// Browser audio (Opus/WebM, or MP4/AAC on Safari) to 16 kHz mono 16-bit for speech-to-text.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const WAV_LIMIT = 3.5 * 1024 * 1024; // gRPC messages default to 4 MB

export const ffmpeg = (args) => exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 60_000 });

export async function toAsrAudio(inputPath, { maxSeconds = 125 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vv-'));
  const convert = async (name, extra) => {
    const out = path.join(dir, name);
    await ffmpeg(['-i', inputPath, '-t', String(maxSeconds), '-vn', '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', ...extra, out]);
    return fs.readFile(out);
  };
  try {
    const wav = await convert('a.wav', ['-f', 'wav']);
    if (wav.length <= WAV_LIMIT) return { audio: wav, encoding: 'LINEAR_PCM' };
    return { audio: await convert('a.flac', ['-f', 'flac']), encoding: 'FLAC' };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
