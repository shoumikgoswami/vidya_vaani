// S5 the record screen: scan, speak, done (J3, J4).
import { h, add, icon, replace } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { t, language, languageOf, phrase, childCount } from '../lib/i18n.js';
import { speak, stopSpeaking, chime } from '../lib/speak.js';
import { startRecording, recordingSupported } from '../lib/recorder.js';
import * as outbox from '../lib/outbox.js';
import { store, navigate, speakLanguage } from '../lib/state.js';
import {
  button, avatar, skeletons, failure, showError, notice, segmented, languageSheet, speakButton, nativeName, form, field,
} from '../lib/ui.js';
import { pickFromList } from './scan.js';

function waveform() {
  const canvas = h('canvas', { class: 'wave', width: 600, height: 56, 'aria-hidden': 'true' });
  const context = canvas.getContext('2d');
  const levels = new Array(100).fill(0);
  return {
    canvas,
    push(level) {
      levels.push(level);
      levels.shift();
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = getComputedStyle(canvas).color;
      levels.forEach((v, i) => {
        const height = Math.max(3, v * canvas.height);
        context.fillRect(i * 6, (canvas.height - height) / 2, 3, height);
      });
    },
  };
}

export async function record(ctx) {
  const classId = Number(ctx.query.get('class'));
  const studentId = Number(ctx.query.get('student')) || null;
  add(ctx.root, skeletons(2, true));
  let data;
  try {
    data = await api(`/classes/${classId}`);
  } catch (error) {
    ctx.root.textContent = '';
    return add(ctx.root, failure(error, () => navigate(location.pathname + location.search, { replace: true })));
  }
  if (!ctx.alive()) return;
  ctx.root.textContent = '';
  if (!data.class.teaches) return add(ctx.root, notice('lock', [h('p', {}, t('only_teachers_record'))], 'bad'));
  if (!data.students.length) {
    return add(ctx.root, notice('users', [h('p', {}, t('class_empty')),
      button(t('add_students'), { kind: 'primary', href: `/t/class/${classId}/add` })]));
  }

  const student = data.students.find((s) => s.id === studentId) || null;
  const openedAt = Date.now();
  let mode = student ? 'one' : 'class';
  const selected = new Set(student ? [student.id] : []);
  let spoken = speakLanguage();
  let session = null;
  let phase = 'idle';
  let silentTries = 0;

  const className = `${data.class.name}${data.class.section}`;
  const header = h('div', { class: 'stage head' });
  const picker = h('div', { class: 'chips pick', hidden: true });
  const stage = h('div', { class: 'stage' });
  const messages = h('div', { class: 'stack', 'aria-live': 'polite' });

  const recipients = () => (mode === 'class' ? 'class' : JSON.stringify([...selected]));
  const count = () => (mode === 'class' ? data.students.length : selected.size);

  function drawHeader() {
    const some = selected.size === 1 ? t('one_child_chosen') : t('n_selected', { n: selected.size });
    const name = mode === 'one' ? student.name : mode === 'class' ? t('whole_class') : some;
    replace(header,
      mode === 'one' ? avatar(student.name, true) : h('span', { class: 'avatar large' }, icon('users-three', { size: 44 })),
      h('h1', {}, name),
      h('p', { class: 'muted' }, mode === 'class' ? `${t('class')} ${className} · ${childCount(count())}` : `${t('class')} ${className}`));
    picker.hidden = mode !== 'some';
    if (mode === 'some') {
      replace(picker, data.students.map((s) =>
        h('button', {
          type: 'button', class: 'chip', 'aria-pressed': String(selected.has(s.id)),
          onclick: () => {
            if (selected.has(s.id)) selected.delete(s.id);
            else selected.add(s.id);
            drawHeader();
          },
        }, s.name)));
    }
  }

  const glyph = h('span', { style: 'display:grid' }, icon('microphone'));
  const mic = h('button', { type: 'button', class: 'mic', 'aria-label': t('tap_to_speak'), onclick: () => (phase === 'recording' ? stop() : start()) }, glyph);
  const caption = h('h2', {}, t('tap_to_speak'));
  const timer = h('p', { class: 'timer', hidden: true });
  const meter = h('meter', { min: 0, max: 1, value: 0, 'aria-label': t('noise_level') });
  const meterLabel = h('span', {}, t('noise_level'));
  const noise = h('div', { class: 'noise', hidden: true }, icon('speaker-high', { size: 20 }), meter, meterLabel);
  const wave = waveform();
  wave.canvas.hidden = true;
  const live = h('div', { class: 'live', hidden: true, lang: spoken });
  const langChip = h('button', { type: 'button', class: 'chip', onclick: () => pickLanguage() });
  const drawLang = () => replace(langChip, icon('translate', { size: 20 }), t('speaking_in', { language: nativeName(spoken) }));

  function pickLanguage() {
    languageSheet(t('speaking_language'), spoken, (code) => {
      spoken = code;
      live.lang = code;
      drawLang();
    });
  }

  function setPhase(next) {
    phase = next;
    const recording = next === 'recording';
    mic.classList.toggle('recording', recording);
    mic.disabled = next === 'saving' || next === 'prompting';
    replace(glyph, icon(recording ? 'stop' : next === 'saving' ? 'hourglass' : 'microphone'));
    caption.textContent = t(recording ? 'speak_now' : next === 'saving' ? 'processing' : 'tap_to_speak');
    timer.hidden = noise.hidden = wave.canvas.hidden = !recording;
    langChip.hidden = recording || next === 'saving';
    if (!recording) mic.style.removeProperty('--level');
  }

  async function start({ announce = false } = {}) {
    if (phase !== 'idle') return;
    if (!count()) return showError({ code: 'recipients_invalid' });
    if (!recordingSupported()) return micFailed();
    stopSpeaking();
    messages.textContent = '';
    setPhase('prompting');
    if (announce) {
      // The prompt is spoken first so the microphone does not record it.
      const { text, lang } = await phrase(spoken, mode === 'one' ? 'ready' : 'ready_class', { name: student?.name.split(' ')[0], class: className });
      caption.textContent = text;
      await speak(text, lang);
      if (!ctx.alive()) return;
    }
    try {
      session = await startRecording({
        language: spoken,
        onLevel: (level, { noisy, elapsed }) => {
          mic.style.setProperty('--level', level.toFixed(2));
          meter.value = level;
          wave.push(level);
          noise.classList.toggle('loud', noisy);
          meterLabel.textContent = t(noisy ? 'noisy_short' : 'noise_level');
          timer.textContent = `0:${String(Math.floor(elapsed / 1000)).padStart(2, '0')}`.replace(/^0:(\d{3,})/, '$1');
        },
        onPreview: (text) => {
          live.hidden = !text;
          live.textContent = text;
        },
        onEnd: (reason) => (reason === 'nothing' ? silence() : stop()),
      });
      if (!ctx.alive()) return session.cancel();
      setPhase('recording');
    } catch (error) {
      setPhase('idle');
      micFailed(error);
    }
  }

  async function silence() {
    session?.cancel();
    session = null;
    setPhase('idle');
    chime(false);
    silentTries += 1;
    replace(messages, notice('warning', [h('p', {}, t('silence'))], 'warn'));
    await speak(t('silence'), languageOf('silence'));
    // One more try on its own, then the button.
    if (silentTries === 1 && ctx.alive() && phase === 'idle') start();
  }

  async function stop() {
    if (phase !== 'recording') return;
    setPhase('saving');
    const result = await session.stop();
    session = null;
    live.hidden = true;
    if (result.durationMs < 1000 || (!result.heardSpeech && !result.previewText && result.durationMs < 2500)) {
      setPhase('idle');
      chime(false);
      replace(messages, notice('warning', [h('p', {}, t('retry_short'))], 'warn'));
      return speak(t('retry_short'), languageOf('retry_short'));
    }
    await upload({
      blob: result.blob,
      fields: {
        lang_hint: spoken,
        browser_preview_text: result.previewText,
        duration_ms: result.durationMs,
        snr_db: result.snrDb,
      },
    });
  }

  async function upload({ blob, fields }) {
    const entry = {
      uuid: outbox.newUuid(),
      userId: store.me.user.id,
      path: '/notes',
      blob,
      fields: { ...fields, class_id: classId, recipients: recipients(), capture_ms: Date.now() - openedAt },
    };
    // Saved on the phone first, then uploaded (spec 5.9).
    await outbox.queue(entry);
    try {
      const saved = await outbox.send(entry);
      sessionStorage.setItem(`vv.note.${saved.id}`, JSON.stringify({ openedAt, back: location.pathname + location.search }));
      navigate(`/t/confirm/${saved.id}`, { replace: true });
    } catch (error) {
      if (error.message !== 'offline' && error.status < 500) {
        setPhase('idle');
        return showError(error);
      }
      // No network: send it to the diaries as soon as the phone is back online.
      entry.fields.publish = '1';
      await outbox.queue(entry);
      chime();
      replace(ctx.root,
        h('div', { class: 'done' }, icon('cloud-slash'), h('h1', {}, t('offline_saved')), h('p', {}, t('offline_will_send'))),
        button(t('next_student'), { iconName: 'qr-code', kind: 'primary big block', onClick: () => navigate('/scan') }),
        button(t('back_to_class'), { kind: 'outline block', href: `/t/class/${classId}` }));
      speak(t('offline_saved'), languageOf('offline_saved'));
    }
  }

  /** The only typing in the app: when the microphone is refused (spec 7). */
  function micFailed(error) {
    const blocked = ['NotAllowedError', 'SecurityError'].includes(error?.name);
    replace(messages,
      notice('microphone-slash', [h('strong', {}, t(blocked ? 'mic_blocked' : 'mic_missing')), button(t('help_title'), { kind: 'outline small', href: '/help' })], 'bad'),
      form(async ({ text }) => {
        if (!text.trim()) return;
        await upload({ blob: null, fields: { lang_hint: spoken, typed_text: text.trim() } });
      },
      field(t('type_note'), h('textarea', { name: 'text', lang: spoken, required: true })),
      button(t('continue'), { iconName: 'check', kind: 'primary block', type: 'submit' })));
  }

  const toggle = segmented(
    [student && ['one', t('this_child')], ['class', t('whole_class')], ['some', t('select_students')]].filter(Boolean),
    mode,
    (value) => {
      mode = value;
      if (value === 'one') {
        selected.clear();
        selected.add(student.id);
      }
      drawHeader();
    },
  );

  drawHeader();
  drawLang();
  add(stage, mic, h('div', { class: 'row' }, caption, speakButton(() => caption.textContent, language())), timer, wave.canvas, noise, live, langChip);
  add(ctx.root, header, toggle, picker, stage, messages,
    h('div', { class: 'actions' }, button(t('another_child'), { iconName: 'list-bullets', kind: 'block', onClick: pickFromList })));
  ctx.onLeave(() => {
    session?.cancel();
    stopSpeaking();
  });
  if (ctx.state.autostart) start({ announce: true });
}
