// Chat completions with a fallback chain: NVIDIA primary, NVIDIA fallback, then free OpenRouter models.
// Both speak the OpenAI-compatible API.
import { config } from '../config.js';
import { acquire, recordUsage, errorFromStatus, ProviderError } from './ratelimit.js';

export function llmChain(cfg = config) {
  const chain = [];
  if (cfg.nvidia.apiKey) {
    for (const model of cfg.nvidia.llmModels) {
      chain.push({ provider: 'nvidia', base: cfg.nvidia.llmBase, key: cfg.nvidia.apiKey, model });
    }
  }
  if (cfg.openrouter.apiKey) {
    for (const model of cfg.openrouter.models) {
      chain.push({ provider: 'openrouter', base: cfg.openrouter.base, key: cfg.openrouter.apiKey, model });
    }
  }
  return chain;
}

export const llmAvailable = () => llmChain().length > 0;

export async function chat(target, messages, { json = false, maxTokens = 1500, timeoutMs = config.timeouts.llmMs } = {}) {
  const key = `${target.provider}:${target.model}`;
  if (!(await acquire(key, { maxWaitMs: 5000 }))) throw new ProviderError(`${key} is at its rate limit`, 'rate');

  const send = async (withFormat) => {
    const body = { model: target.model, messages, temperature: 0, max_tokens: maxTokens };
    if (withFormat) body.response_format = { type: 'json_object' };
    try {
      return await fetch(`${target.base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${target.key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(`${key} unreachable: ${error.name}`, 'down');
    }
  };

  try {
    let res = await send(json);
    // Not every model accepts response_format.
    if (json && res.status === 400) res = await send(false);
    if (!res.ok) throw errorFromStatus(res.status, `${key} returned ${res.status}`);
    const data = await res.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new ProviderError(`${key} returned an empty answer`, 'down');
    await recordUsage(key);
    return content;
  } catch (error) {
    await recordUsage(key, error);
    throw error;
  }
}

/** Pulls the first JSON object out of a model answer, which may be wrapped in prose or code fences. */
export function extractJson(text) {
  const cleaned = String(text).replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Asks the chain for JSON that satisfies a zod schema. Each model gets one stricter retry on
 * invalid output. Throws a ProviderError; `.transient` says whether a later retry makes sense.
 */
export async function completeJson({ system, user, schema, maxTokens, chain = llmChain() }) {
  if (!chain.length) throw new ProviderError('no AI key set', 'auth');
  let worst = new ProviderError('every model failed', 'bad');
  for (const target of chain) {
    const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const answer = await chat(target, messages, { json: true, maxTokens });
        const checked = schema.safeParse(extractJson(answer));
        if (checked.success) return { data: checked.data, provider: target.provider, model: target.model };
        messages.push(
          { role: 'assistant', content: answer },
          { role: 'user', content: 'That was not valid. Reply with one JSON object in exactly the shape described. No other text.' },
        );
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      if (error.transient || !worst.transient) worst = error;
    }
  }
  throw worst;
}
