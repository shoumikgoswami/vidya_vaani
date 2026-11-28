// Speech-to-text on NVIDIA's hosted Riva functions (Parakeet and Whisper) over gRPC.
import path from 'node:path';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { config, ROOT } from '../../config.js';
import { ProviderError } from '../ratelimit.js';

const definition = protoLoader.loadSync(path.join(ROOT, 'server', 'providers', 'nvidia', 'protos', 'riva_asr.proto'), {
  keepCase: true, enums: String, longs: String, defaults: true,
});
export const asrPackage = grpc.loadPackageDefinition(definition).nvidia.riva.asr;

const MAX_MESSAGE = 16 * 1024 * 1024;
const clients = new Map();

function client(host) {
  if (!clients.has(host)) {
    // Plain text is only ever used against a local mock in the tests.
    const local = /^(localhost|127\.0\.0\.1):/.test(host);
    const credentials = local ? grpc.credentials.createInsecure() : grpc.credentials.createSsl();
    clients.set(host, new asrPackage.RivaSpeechRecognition(host, credentials, {
      'grpc.max_send_message_length': MAX_MESSAGE,
      'grpc.max_receive_message_length': MAX_MESSAGE,
    }));
  }
  return clients.get(host);
}

function toProviderError(error) {
  const { status } = grpc;
  const kind =
    error.code === status.RESOURCE_EXHAUSTED ? 'rate'
      : error.code === status.UNAUTHENTICATED || error.code === status.PERMISSION_DENIED ? 'auth'
        : [status.UNAVAILABLE, status.DEADLINE_EXCEEDED, status.INTERNAL, status.UNKNOWN].includes(error.code) ? 'down'
          : 'bad';
  return new ProviderError(`speech-to-text failed: ${error.details || error.message}`, kind);
}

export function recognize({ audio, encoding, languageCode, functionId, timeoutMs = config.timeouts.asrMs }) {
  const metadata = new grpc.Metadata();
  metadata.set('authorization', `Bearer ${config.nvidia.apiKey}`);
  metadata.set('function-id', functionId);

  const request = {
    config: {
      encoding,
      sample_rate_hertz: 16000,
      language_code: languageCode,
      max_alternatives: 1,
      enable_word_time_offsets: true,
      enable_automatic_punctuation: true,
    },
    audio,
  };

  return new Promise((resolve, reject) => {
    client(config.nvidia.grpcHost).Recognize(request, metadata, { deadline: Date.now() + timeoutMs }, (error, response) => {
      if (error) return reject(toProviderError(error));
      const best = (response.results || []).map((r) => r.alternatives?.[0]).filter(Boolean);
      const words = best.flatMap((a) => a.words || []).map((w) => ({
        w: w.word,
        // Models that do not score words report zero. That is "unknown", not "certainly wrong".
        conf: w.confidence > 0 ? Math.round(w.confidence * 100) / 100 : null,
      }));
      const scores = best.map((a) => a.confidence).filter((c) => c > 0 && c <= 1);
      resolve({
        text: best.map((a) => a.transcript.trim()).join(' ').trim(),
        words: words.length ? words : null,
        conf: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
        language: best[0]?.language_code?.[0] || null,
      });
    });
  });
}
