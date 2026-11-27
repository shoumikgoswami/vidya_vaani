// Microphone capture with silence detection, a noise meter and the browser's live text (spec 5.9).
import { lang } from './languages.js';

const SILENCE_MS = 2000;
const NO_SPEECH_MS = 5000;
const MAX_MS = 120_000;
const CALIBRATE_MS = 300;

const mimeType = () =>
  ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => window.MediaRecorder?.isTypeSupported(m)) || '';

export const recordingSupported = () => Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

/** Words as they are spoken, where the browser can do it (Chrome and Edge). */
export function livePreview(code, onText) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return { text: () => '', stop() {} };
  const finals = [];
  let interim = '';
  let running = true;
  let recognition;
  const text = () => `${finals.join(' ')} ${interim}`.replace(/\s+/g, ' ').trim();
  const start = () => {
    recognition = new Recognition();
    recognition.lang = lang(code).bcp47;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const said = event.results[i][0].transcript.trim();
        if (event.results[i].isFinal) finals.push(said);
        else interim += ` ${said}`;
      }
      onText?.(text());
    };
    recognition.onerror = (event) => {
      if (['not-allowed', 'service-not-allowed', 'language-not-supported', 'network', 'audio-capture'].includes(event.error)) running = false;
    };
    // Chrome ends the session after pauses. Keep listening while the mic is open.
    recognition.onend = () => running && setTimeout(() => running && start(), 150);
    try {
      recognition.start();
    } catch {
      running = false;
    }
  };
  start();
  return {
    text,
    stop() {
      running = false;
      try {
        recognition?.stop();
      } catch {
        // Already stopped.
      }
    },
  };
}

/**
 * Starts the mic. `onLevel(level 0..1, {noisy})` drives the meter, `onPreview(text)` the live words,
 * `onEnd(reason)` fires on auto stop: 'silence' | 'nothing' | 'limit'.
 */
export async function startRecording({ language, onLevel, onPreview, onEnd, preview = true }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true, channelCount: 1 },
  });
  const type = mimeType();
  const recorder = new MediaRecorder(stream, { ...(type && { mimeType: type }), audioBitsPerSecond: 24_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const context = new AudioContext();
  await context.resume().catch(() => {});
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const live = preview ? livePreview(language, onPreview) : { text: () => '', stop() {} };
  const started = performance.now();
  const floor = [];
  let noise = 0.008;
  let speechSum = 0;
  let speechFrames = 0;
  let lastVoice = 0;
  let ended = false;

  const finish = (reason) => {
    if (ended) return;
    ended = true;
    onEnd?.(reason);
  };

  recorder.start(250);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
    const elapsed = performance.now() - started;
    if (elapsed < CALIBRATE_MS) {
      floor.push(rms);
      noise = Math.max(0.003, [...floor].sort((a, b) => a - b)[Math.floor(floor.length / 2)]);
    }
    // A teacher who starts talking at once would inflate the floor, so cap the threshold.
    const threshold = Math.min(0.06, Math.max(0.018, noise * 2.2));
    if (elapsed >= CALIBRATE_MS && rms > threshold) {
      speechSum += rms;
      speechFrames += 1;
      lastVoice = elapsed;
    }
    onLevel?.(Math.min(1, rms * 8), { noisy: noise > 0.04, elapsed, samples });
    const spoke = speechFrames >= 4;
    if (spoke && elapsed - lastVoice > SILENCE_MS) finish('silence');
    else if (!spoke && elapsed > NO_SPEECH_MS) finish('nothing');
    else if (elapsed > MAX_MS) finish('limit');
  }, 60);

  const release = () => {
    clearInterval(timer);
    live.stop();
    stream.getTracks().forEach((track) => track.stop());
    context.close().catch(() => {});
  };

  return {
    stop() {
      ended = true;
      const durationMs = Math.round(performance.now() - started);
      return new Promise((resolve) => {
        const done = () => {
          const speech = speechFrames ? speechSum / speechFrames : 0;
          resolve({
            blob: new Blob(chunks, { type: (recorder.mimeType || type || 'audio/webm').split(';')[0] }),
            durationMs,
            heardSpeech: speechFrames >= 4,
            speechMs: speechFrames * 60,
            snrDb: speech ? Math.round(20 * Math.log10(speech / noise) * 10) / 10 : null,
            previewText: live.text(),
          });
        };
        if (recorder.state === 'inactive') {
          release();
          return done();
        }
        recorder.onstop = done;
        recorder.stop();
        release();
      });
    },
    cancel() {
      ended = true;
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}
