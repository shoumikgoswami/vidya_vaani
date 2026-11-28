// Every setting has a default, so the app starts with no .env file at all.
import path from 'node:path';

// Files are found from the project root. A Netlify function is bundled into one file, so there the
// root is the function's task folder, where netlify.toml's included files keep their paths.
export const ROOT = process.env.LAMBDA_TASK_ROOT || path.resolve(import.meta.dirname, '..');

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
  // Set by the Netlify functions: no disk to keep, no timers, a proxy in front.
  const serverless = bool('SERVERLESS', false);

  return {
    port,
    dataDir,
    // Neon when set (Netlify's own database variable also works), otherwise the built-in database.
    databaseUrl: str('DATABASE_URL') || str('NETLIFY_DATABASE_URL'),
    serverless,
    // The public demo spends at most this many AI jobs a day on its sample school. 0 means no limit.
    demoAiDailyLimit: Math.max(0, Number(str('AI_DEMO_DAILY_LIMIT', serverless ? '300' : '0')) || 0),
    publicBaseUrl: str('PUBLIC_BASE_URL', `http://localhost:${port}`).replace(/\/+$/, ''),
    demoMode: bool('DEMO_MODE', true),
    trustProxy: bool('TRUST_PROXY', serverless),
    // Who approves requests from new schools: the emails the site owner signs in with.
    ownerEmails: list('OWNER_EMAILS', '').map((email) => email.toLowerCase()),
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
        // Chosen by the live test in docs/model-eval.md.
        str('NVIDIA_LLM_MODEL', 'nvidia/nemotron-3.5-bolt-e4b'),
        str('NVIDIA_LLM_FALLBACK', 'minimaxai/minimax-m3.1-flash'),
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
