// Browser audio (Opus/WebM, or MP4/AAC on Safari) to 16 kHz mono 16-bit for speech-to-text.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../../config.js';

const exec = promisify(execFile);
const WAV_LIMIT = 3.5 * 1024 * 1024; // gRPC messages default to 4 MB

let binary;
/** The copy bundled with a serverless function is read only and may have lost its run permission. */
async function bundled() {
  const { default: source } = await import('ffmpeg-static');
  const target = path.join(os.tmpdir(), 'vv-ffmpeg');
  const ready = await fs.stat(target).then(async (s) => s.size === (await fs.stat(source)).size, () => false);
  if (!ready) {
    // Written beside the target and renamed, so a second request never runs a half-copied file.
    const staging = `${target}-${process.pid}-${Date.now()}`;
    await fs.copyFile(source, staging);
    await fs.chmod(staging, 0o755);
    await fs.rename(staging, target);
  }
  return target;
}

/** The container has ffmpeg installed. A Netlify function carries its own copy. */
async function ffmpegPath() {
  binary ||= process.env.FFMPEG_PATH || (config.serverless ? bundled() : 'ffmpeg');
  return binary;
}

export const ffmpeg = async (args) => exec(await ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 60_000 });

/** Takes the uploaded recording as bytes; ffmpeg works on short-lived temporary files. */
export async function toAsrAudio(recording, { maxSeconds = 125 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vv-'));
  const inputPath = path.join(dir, 'in');
  const convert = async (name, extra) => {
    const out = path.join(dir, name);
    await ffmpeg(['-i', inputPath, '-t', String(maxSeconds), '-vn', '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', ...extra, out]);
    return fs.readFile(out);
  };
  try {
    await fs.writeFile(inputPath, recording);
    const wav = await convert('a.wav', ['-f', 'wav']);
    if (wav.length <= WAV_LIMIT) return { audio: wav, encoding: 'LINEAR_PCM' };
    return { audio: await convert('a.flac', ['-f', 'flac']), encoding: 'FLAC' };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
