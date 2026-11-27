// The AI pipeline against local stand-ins for NVIDIA (gRPC and HTTP) and OpenRouter.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import grpc from '@grpc/grpc-js';
import { startApp, uuid, DEMO } from './helpers/app.js';

const asr = { calls: [], failWith: null, text: 'रवि, कल page 12 की कविता याद करनी है।' };
const llm = { calls: [], systems: [], nvidiaStatus: 200, junk: false };

const answerFor = (body) => {
  llm.systems.push(body.messages[0].content);
  const prompt = body.messages[0].content;
  const user = body.messages[1].content;
  if (llm.junk) return 'sorry, I cannot do that';
  if (prompt.includes('You translate short notes')) {
    const note = user.split('Note:\n')[1];
    const codes = [...user.split('Target languages: ')[1].split('\n')[0].matchAll(/(\w+) \(/g)].map((m) => m[1]);
    // Answers use each target's own script, so they pass the mixed-script guard.
    const letters = { hi: 'क', mr: 'क', bn: 'ক', ta: 'க', te: 'క', or: 'କ' };
    const inScript = (code) => note.replace(/\p{Script=Devanagari}+/gu, letters[code] ?? 'x');
    return JSON.stringify(Object.fromEntries(codes.map((c) => [c, `[${c}] ${inScript(c)}`])));
  }
  return '```json\n' + JSON.stringify({
    clean: asr.text,
    changes: [],
    tags: [{ type: 'homework', subject: 'Hindi', dueDate: '2030-01-02' }],
    entities: { pages: ['12'], names: ['रवि'], amounts: [], dates: [] },
    ambiguities: [],
  }) + '\n```';
};

let app;
let meena;
let mockLlm;
let mockAsr;
let raviId;
let classId;

before(async () => {
  mockLlm = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const provider = req.url.startsWith('/openrouter') ? 'openrouter' : 'nvidia';
      if (!req.url.endsWith('/chat/completions')) return res.writeHead(404).end();
      const body = JSON.parse(raw);
      llm.calls.push({ provider, model: body.model, auth: req.headers.authorization, user: body.messages[1].content });
      if (provider === 'nvidia' && llm.nvidiaStatus !== 200) return res.writeHead(llm.nvidiaStatus).end('{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: answerFor(body) } }] }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => mockLlm.once('listening', r));
  const llmBase = `http://127.0.0.1:${mockLlm.address().port}`;

  // The mock speaks the same proto as the real client.
  const protoLoader = (await import('@grpc/proto-loader')).default;
  const proto = path.join(import.meta.dirname, '..', 'server', 'providers', 'nvidia', 'protos', 'riva_asr.proto');
  const definition = protoLoader.loadSync(proto, { keepCase: true, enums: String, defaults: true });
  const pkg = grpc.loadPackageDefinition(definition).nvidia.riva.asr;
  mockAsr = new grpc.Server();
  mockAsr.addService(pkg.RivaSpeechRecognition.service, {
    Recognize(call, callback) {
      const [functionId] = call.metadata.get('function-id');
      const [authorization] = call.metadata.get('authorization');
      asr.calls.push({ ...call.request.config, functionId, authorization, bytes: call.request.audio.length });
      if (asr.failWith) return callback({ code: asr.failWith, details: 'mock failure' });
      callback(null, {
        results: [{ alternatives: [{
          transcript: asr.text, confidence: 0.92,
          words: asr.text.split(' ').map((word) => ({ word, confidence: word === '12' ? 0.4 : 0.95 })),
        }] }],
      });
    },
  });
  const port = await new Promise((resolve, reject) =>
    mockAsr.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (e, p) => (e ? reject(e) : resolve(p))));

  app = await startApp({
    NVIDIA_API_KEY: 'nvapi-test',
    NVIDIA_LLM_BASE: `${llmBase}/nvidia`,
    NVIDIA_LLM_MODEL: 'primary-model',
    NVIDIA_LLM_FALLBACK: 'second-model',
    OPENROUTER_API_KEY: 'or-test',
    OPENROUTER_BASE: `${llmBase}/openrouter`,
    OPENROUTER_MODELS: 'free-model:free',
    NVIDIA_GRPC_HOST: `127.0.0.1:${port}`,
    NVIDIA_TTS_MAGPIE_URL: `${llmBase}/tts`,
  });
  meena = await app.client().login(DEMO.meena);
  raviId = app.db.get(`SELECT id FROM student WHERE name = 'Ravi Kumar'`).id;
  classId = app.db.get(`SELECT id FROM class WHERE name = '5'`).id;
});

after(async () => {
  await app.stop();
  mockAsr.forceShutdown();
  mockLlm.closeAllConnections();
  mockLlm.close();
});

beforeEach(async () => {
  asr.calls.length = 0;
  asr.failWith = null;
  llm.calls.length = 0;
  llm.nvidiaStatus = 200;
  llm.junk = false;
  app.db.run('DELETE FROM job');
  (await import('../server/providers/ratelimit.js')).resetRateLimits();
});

async function record(fields = {}) {
  const res = await meena.upload('/api/notes', app.noteForm({
    client_uuid: uuid(), class_id: classId, recipients: JSON.stringify([raviId]), lang_hint: 'hi', duration_ms: 2000, ...fields,
  }));
  assert.equal(res.status, 201);
  await app.drain();
  return res.data.id;
}
const noteRow = (id) => app.db.get('SELECT * FROM note WHERE id = ?', id);

test('a Hindi note goes to Parakeet, is cleaned, tagged and translated in one call', async () => {
  const id = await record();
  const [call] = asr.calls;
  assert.equal(call.functionId, '71203149-d3b7-4460-8231-1be2543a1fca');
  assert.equal(call.language_code, 'hi-IN');
  assert.equal(call.encoding, 'LINEAR_PCM');
  assert.equal(call.sample_rate_hertz, 16000);
  assert.equal(call.authorization, 'Bearer nvapi-test');
  assert.ok(call.bytes > 30_000);

  let note = noteRow(id);
  assert.equal(note.stt_provider, 'nvidia');
  assert.equal(note.stt_model, 'parakeet-1.1b-multilingual');
  assert.equal(note.llm_model, 'primary-model');
  assert.equal(note.status, 'ready');
  assert.ok(JSON.parse(note.words).some((w) => w.w === '12' && w.uncertain));
  // Only first names go to the model, and never a phone number.
  assert.ok(!llm.calls[0].user.includes('+91'));
  assert.ok(!llm.calls[0].user.includes('Kumar'));

  llm.calls.length = 0;
  await meena.post(`/api/notes/${id}/publish`, {});
  await app.drain();
  assert.equal(llm.calls.length, 1, 'one call covers every language');
  assert.match(llm.calls[0].user, /⟦N1⟧/);
  const english = app.db.get(`SELECT * FROM note_translation WHERE note_id = ? AND lang = 'en'`, id);
  assert.match(english.text, /12/);
  assert.doesNotMatch(english.text, /⟦/);
  assert.equal(english.model, 'primary-model');
});

test('Tamil and Telugu use Whisper, and Odia stays as audio', async () => {
  await record({ lang_hint: 'ta' });
  assert.equal(asr.calls.length, 1);
  assert.equal(asr.calls[0].language_code, 'ta');
  asr.calls.length = 0;
  await record({ lang_hint: 'te' });
  assert.equal(asr.calls[0].functionId, 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d');
  assert.equal(asr.calls[0].language_code, 'te');
  asr.calls.length = 0;
  const odia = await record({ lang_hint: 'or' });
  assert.equal(asr.calls.length, 0);
  assert.equal(noteRow(odia).status, 'audio_only');
});

test('re-transcribing runs the saved audio in the chosen language', async () => {
  const id = await record();
  asr.calls.length = 0;
  await meena.post(`/api/notes/${id}/retranscribe`, { lang: 'mr' });
  await app.drain();
  assert.equal(asr.calls[0].language_code, 'mr');
  assert.equal(noteRow(id).transcript_lang, 'mr');
});

test('a rate limit queues the note and it completes later', async () => {
  asr.failWith = grpc.status.RESOURCE_EXHAUSTED;
  const id = await record({ browser_preview_text: 'कल कविता' });
  let note = noteRow(id);
  assert.equal(note.status, 'transcribing');
  assert.equal(note.transcript_raw, 'कल कविता', 'the browser text shows meanwhile');
  const job = app.db.get(`SELECT * FROM job WHERE type = 'process_note'`);
  assert.equal(job.status, 'pending');
  assert.ok(job.run_after > Date.now());

  asr.failWith = null;
  app.db.run('UPDATE job SET run_after = 0');
  await app.drain();
  note = noteRow(id);
  assert.equal(note.status, 'ready');
  assert.equal(note.stt_provider, 'nvidia');
  assert.equal(note.transcript_raw, asr.text);
  assert.ok(app.db.get('SELECT SUM(errors_429) AS n FROM ai_usage').n > 0);
});

test('a bad key still saves the note with the browser text', async () => {
  asr.failWith = grpc.status.UNAUTHENTICATED;
  llm.nvidiaStatus = 401;
  const id = await record({ browser_preview_text: 'कल कविता याद करनी है' });
  const note = noteRow(id);
  assert.equal(note.status, 'transcript_failed');
  assert.equal(note.transcript_raw, 'कल कविता याद करनी है');
  assert.equal(note.stt_provider, 'browser');
});

test('OpenRouter free models take over when NVIDIA is down', async () => {
  llm.nvidiaStatus = 503;
  const id = await record();
  assert.deepEqual(llm.calls.map((c) => c.model), ['primary-model', 'second-model', 'free-model:free']);
  assert.equal(llm.calls[2].auth, 'Bearer or-test');
  assert.equal(noteRow(id).llm_model, 'free-model:free');
});

test('invalid model output is retried once per model, then the rules take over', async () => {
  llm.junk = true;
  const id = await record();
  assert.equal(llm.calls.length, 6);
  const note = noteRow(id);
  assert.equal(note.status, 'ready');
  assert.equal(note.llm_model, null);
  assert.equal(note.transcript_clean, null);
  const sources = app.db.all('SELECT source FROM note_tag WHERE note_id = ?', id).map((t) => t.source);
  assert.deepEqual([...new Set(sources)], ['rules']);
});

test('a respoken word replaces only that word', async () => {
  const id = await record();
  const words = JSON.parse(noteRow(id).words);
  const index = words.findIndex((w) => w.w === '12');
  const original = asr.text;
  asr.text = '21';
  const form = app.noteForm({ wordIndex: index });
  const res = await meena.upload(`/api/notes/${id}/respeak`, form);
  asr.text = original;
  assert.equal(res.status, 200);
  assert.match(res.data.transcript.raw, /page 21/);
});

test('placeholders are only mentioned when a note has names or numbers', async () => {
  const { translate } = await import('../server/providers/translate.js');
  llm.systems.length = 0;
  await translate('कल कविता याद करनी है।', 'hi', ['en']);
  assert.doesNotMatch(llm.systems.at(-1), /placeholder/);
  await translate('कल page 12 याद करना है।', 'hi', ['en']);
  assert.match(llm.systems.at(-1), /placeholder/);
});

test('the limiter holds calls back once the per-minute budget is spent', async () => {
  const { acquire, resetRateLimits } = await import('../server/providers/ratelimit.js');
  resetRateLimits();
  assert.equal(await acquire('m', { limit: 2, maxWaitMs: 0 }), true);
  assert.equal(await acquire('m', { limit: 2, maxWaitMs: 0 }), true);
  assert.equal(await acquire('m', { limit: 2, maxWaitMs: 0 }), false);
  assert.equal(await acquire('other', { limit: 2, maxWaitMs: 0 }), true);
});
