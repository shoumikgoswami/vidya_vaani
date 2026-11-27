// Every setting has a default, so the app starts with no .env file at all.
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

export function loadConfig(env = process.env) {
  const str = (key, fallback = '') => (env[key] ?? '').trim() || fallback;
  const bool = (key, fallback) => {
    const v = str(key).toLowerCase();
    return v ? ['1', 'true', 'yes', 'on'].includes(v) : fallback;
  };
  const list = (key, fallback) => str(key, fallback).split(',').map((s) => s.trim()).filter(Boolean);

  const port = Number(str('PORT', '3000')) || 3000;
  const dataDir = path.resolve(str('DATA_DIR', path.join(ROOT, '.data')));
  const clerkPk = str('CLERK_PUBLISHABLE_KEY');
  const clerkSk = str('CLERK_SECRET_KEY');

  return {
    port,
    dataDir,
    publicBaseUrl: str('PUBLIC_BASE_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
    demoMode: bool('DEMO_MODE', true),
    trustProxy: bool('TRUST_PROXY', false),
    sessionDays: 180,
    maxNoteSeconds: 120,
    clerk: {
      publishableKey: clerkPk,
      secretKey: clerkSk,
      enabled: Boolean(clerkPk && clerkSk),
    },
    nvidia: {
      apiKey: str('NVIDIA_API_KEY'),
      llmBase: str('NVIDIA_LLM_BASE', 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, ''),
      llmModels: [
        str('NVIDIA_LLM_MODEL', 'google/gemma-3-12b-it'),
        str('NVIDIA_LLM_FALLBACK', 'mistralai/mistral-large-4-1t-a52b'),
      ],
      grpcHost: str('NVIDIA_GRPC_HOST', 'grpc.nvcf.nvidia.com:443'),
      parakeetFunctionId: str('NVIDIA_ASR_PARAKEET_FUNCTION_ID', '71203149-d3b7-4460-8231-1be2543a1fca'),
      whisperFunctionId: str('NVIDIA_ASR_WHISPER_FUNCTION_ID', 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d'),
      magpieUrl: str('NVIDIA_TTS_MAGPIE_URL', 'https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com').replace(/\/+$/, ''),
      translateModel: str('NVIDIA_TRANSLATE_MODEL', 'nvidia/riva-translate-4b-instruct-v2'),
      translateHiEn: bool('NVIDIA_TRANSLATE_HI_EN', false),
    },
    openrouter: {
      apiKey: str('OPENROUTER_API_KEY'),
      base: str('OPENROUTER_BASE', 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
      models: list('OPENROUTER_MODELS', 'google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free'),
    },
    rpmLimit: Math.max(1, Number(str('NVIDIA_RPM_LIMIT', '35')) || 35),
    timeouts: {
      asrMs: Number(str('ASR_TIMEOUT_MS', '20000')),
      llmMs: Number(str('LLM_TIMEOUT_MS', '20000')),
      ttsMs: 12000,
    },
  };
}

export const config = loadConfig();

fs.mkdirSync(path.join(config.dataDir, 'audio'), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'tts'), { recursive: true });
