// Every instruction can be heard: NVIDIA's voice where it exists, then the phone's own voice.
import { lang } from './languages.js';

let audio = null;
let token = 0;
let context = null;
let finishDevice = null;

export function stopSpeaking() {
  token += 1;
  audio?.pause();
  audio = null;
  window.speechSynthesis?.cancel();
  finishDevice?.();
}

function deviceVoice(code) {
  const voices = window.speechSynthesis?.getVoices() || [];
  const wanted = lang(code).bcp47.toLowerCase();
  const normal = (v) => v.lang.toLowerCase().replace('_', '-');
  return voices.find((v) => normal(v) === wanted) || voices.find((v) => normal(v).split('-')[0] === code);
}

window.speechSynthesis?.getVoices();

function playBlob(blob, mine) {
  return new Promise((resolve) => {
    audio = new Audio(URL.createObjectURL(blob));
    audio.onended = audio.onerror = audio.onpause = () => resolve(true);
    if (mine !== token) return resolve(true);
    audio.play().catch(() => resolve(false));
  });
}

/**
 * Resolves true once the text has been spoken, false if this phone has no voice for it. `voice`
 * names an NVIDIA voice to try it out.
 */
export async function speak(text, code, { voice } = {}) {
  stopSpeaking();
  const mine = token;
  if (!text) return false;
  if (navigator.onLine && ['hi', 'en'].includes(code)) {
    try {
      const res = await fetch(`/api/tts?${new URLSearchParams({ lang: code, text: text.slice(0, 600), ...(voice && { voice }) })}`);
      if (res.status === 200) {
        const blob = await res.blob();
        if (mine === token && (await playBlob(blob, mine))) return true;
      }
    } catch {
      // The phone's own voice is next.
    }
  }
  if (mine !== token) return false;
  return sayOnDevice(text, code);
}

/** Without a matching voice the phone would mangle the words. An unfilled list is given the benefit of the doubt. */
export function deviceCanSpeak(code) {
  if (!window.speechSynthesis) return false;
  return Boolean(deviceVoice(code)) || !window.speechSynthesis.getVoices().length;
}

/** The phone's own voice, one sentence at a time because some browsers cut a long one off. */
function sayOnDevice(text, code) {
  if (!deviceCanSpeak(code)) return Promise.resolve(false);
  const voice = deviceVoice(code);
  return new Promise((resolve) => {
    let timer = null;
    const done = () => {
      clearTimeout(timer);
      if (finishDevice === done) finishDevice = null;
      resolve(true);
    };
    finishDevice = done;
    const sentences = text.split(/(?<=[.?!।۔])\s+/u).filter(Boolean);
    sentences.forEach((sentence, i) => {
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.lang = lang(code).bcp47;
      if (voice) utterance.voice = voice;
      utterance.rate = 0.95;
      if (i === sentences.length - 1) utterance.onend = utterance.onerror = done;
      window.speechSynthesis.speak(utterance);
    });
    // Some browsers never fire the end event.
    timer = setTimeout(done, 2500 + text.length * 110);
  });
}

/** Reads a whole note with the phone's voice, stopping anything already being said. */
export function speakOnDevice(text, code) {
  stopSpeaking();
  return sayOnDevice(text, code);
}

export function chime(ok = true) {
  try {
    context ||= new AudioContext();
    context.resume();
    (ok ? [660, 880] : [330, 247]).forEach((frequency, i) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + i * 0.12;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      osc.connect(gain).connect(context.destination);
      osc.start(start);
      osc.stop(start + 0.24);
    });
    navigator.vibrate?.(ok ? 60 : [60, 60, 60]);
  } catch {
    // Sound is a nicety.
  }
}
