// S6 the confirmation card: check the words, numbers and dates, then Save.
import { h, add, icon, replace } from '../lib/dom.js';
import { api, post, patch, del } from '../lib/api.js';
import { t, language, languageOf, formatDate } from '../lib/i18n.js';
import { speak, stopSpeaking, chime } from '../lib/speak.js';
import { voiceCapture } from '../lib/capture.js';
import { lang as languageInfo } from '../lib/languages.js';
import { navigate, speakLanguage } from '../lib/state.js';
import {
  button, sheet, skeletons, failure, showError, notice, segmented, languageSheet, tagChip, TAG_ICONS, player,
  nativeName, form, field, guide, speakButton,
} from '../lib/ui.js';

const TAG_TYPES = Object.keys(TAG_ICONS);

// "Save" said aloud, in the ways a teacher might say it.
const CONFIRM_WORDS = new Set([
  'save', 'save karo', 'ok', 'okay', 'yes', 'haan', 'han', 'theek hai', 'thik hai', 'ठीक है', 'हाँ', 'हां', 'सेव', 'सेव करो',
  'சரி', 'ஆமாம்', 'சேவ்', 'ঠিক আছে', 'হ্যাঁ', 'সেভ', 'సరే', 'అవును', 'हो', 'बरोबर', 'હા', 'ಸರಿ', 'ശരി', 'ਠੀਕ ਹੈ', 'ہاں', 'ٹھیک ہے', 'ହଁ', 'ଠିକ ଅଛି',
]);

function listenForSave(code, onYes) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.lang = languageInfo(code).bcp47;
  recognition.continuous = true;
  recognition.onresult = (event) => {
    const heard = event.results[event.results.length - 1][0].transcript.toLowerCase().replace(/[.!।?]+/g, '').trim();
    if (CONFIRM_WORDS.has(heard)) onYes();
  };
  recognition.onerror = () => {};
  try {
    recognition.start();
  } catch {
    return null;
  }
  return () => {
    recognition.onresult = null;
    recognition.abort();
  };
}

function tagSheet(tags, index, save) {
  const tag = index === null ? { type: 'homework', subject: '', dueDate: '' } : { ...tags[index] };
  sheet(t('tags'), (close) => {
    const grid = h('div', { class: 'grid' });
    const draw = () => replace(grid, TAG_TYPES.map((type) =>
      h('button', {
        type: 'button', class: 'tile', 'aria-pressed': String(type === tag.type),
        onclick: () => {
          tag.type = type;
          draw();
        },
      }, icon(TAG_ICONS[type], { size: 32 }), t(`tag_${type}`))));
    draw();
    const commit = async (next) => {
      await save(next);
      close();
    };
    return form(async (data) => {
      const updated = { type: tag.type, subject: data.subject.trim() || null, dueDate: data.dueDate || null };
      await commit(index === null ? [...tags, updated] : tags.map((x, i) => (i === index ? updated : x)));
    },
    grid,
    field(t('subject_optional'), h('input', { name: 'subject', value: tag.subject || '' })),
    field(t('due_date_optional'), h('input', { name: 'dueDate', type: 'date', value: tag.dueDate || '' })),
    button(t('done'), { iconName: 'check', kind: 'primary big block', type: 'submit' }),
    index !== null && button(t('remove_tag'), { iconName: 'trash', kind: 'danger block', onClick: () => commit(tags.filter((_x, i) => i !== index)) }));
  });
}

export async function confirm(ctx) {
  const id = Number(ctx.params.id);
  const context = JSON.parse(sessionStorage.getItem(`vv.note.${id}`) || '{}');
  const warnings = h('div', { class: 'stack' });
  const body = h('div', { class: 'stack' });
  const actions = h('div', { class: 'sticky-actions' });


  let note = null;
  let view = 'clean';
  let saving = false;
  let stopListening = null;
  let announced = false;
  const startedAt = Date.now();
  let timer = null;
  const playback = h('div', {});
  add(ctx.root, h('h1', {}, t('confirm_title')), playback, warnings, body, actions);

  ctx.onLeave(() => {
    clearTimeout(timer);
    stopListening?.();
    stopSpeaking();
  });

  async function load() {
    try {
      note = await api(`/notes/${id}`);
    } catch (error) {
      if (!ctx.alive()) return;
      return replace(body, failure(error, load));
    }
    if (!ctx.alive()) return;
    if (!playback.firstChild && note.audioUrl) {
      add(playback, player(note.audioUrl, { durationMs: note.durationMs, onLeave: ctx.onLeave }));
    }
    draw();
    clearTimeout(timer);
    if (['uploaded', 'transcribing'].includes(note.status)) timer = setTimeout(load, Date.now() - startedAt > 30_000 ? 5000 : 1200);
  }

  const update = async (changes) => {
    note = { ...note, ...(await patch(`/notes/${id}`, changes)) };
    draw();
  };

  async function save() {
    if (saving || note.publishedAt) return;
    saving = true;
    stopListening?.();
    try {
      const captureMs = context.openedAt ? Date.now() - context.openedAt : undefined;
      const result = await post(`/notes/${id}/publish`, { captureMs });
      chime();
      // The sticker is probably still in front of the camera: do not reopen it by accident.
      sessionStorage.setItem('vv.skip', JSON.stringify({ path: sessionStorage.getItem('vv.lastScan'), until: Date.now() + 8000 }));
      const key = result.recipients > 1 ? 'saved_class' : 'saved';
      const text = t(key, { n: result.recipients });
      replace(ctx.root,
        h('div', { class: 'done' }, icon('check-circle'), h('h1', { role: 'status' }, text)),
        button(t('next_student'), { iconName: 'qr-code', kind: 'primary big block', onClick: () => navigate('/scan') }),
        button(t('see_note'), { kind: 'outline block', href: `/t/note/${id}` }));
      sessionStorage.removeItem(`vv.note.${id}`);
      await speak(text, languageOf(key));
      // Scan, speak, done, next: the scanner reopens by itself.
      setTimeout(() => ctx.alive() && navigate('/scan', { replace: true }), 900);
    } catch (error) {
      saving = false;
      showError(error);
    }
  }

  async function rerecord() {
    await del(`/notes/${id}`);
    navigate(context.back || `/t/record?class=${note.classId}`, { replace: true, state: { autostart: true } });
  }

  function respeak(index) {
    const word = note.transcript.words[index].w;
    sheet(t('respeak_title', { word }), (close) => [
      h('p', {}, t('respeak_help')),
      voiceCapture({
        language: note.lang || speakLanguage(), label: t('tap_to_speak'), onLeave: ctx.onLeave,
        onDone: async (result) => {
          const body_ = new FormData();
          body_.set('wordIndex', index);
          body_.set('text', result.previewText);
          body_.set('audio', result.blob, 'word.webm');
          note = { ...note, ...(await api(`/notes/${id}/respeak`, { method: 'POST', form: body_ })) };
          close();
          draw();
        },
      }),
    ]);
  }

  function editText(current) {
    sheet(t('edit_text'), (close) => form(async ({ text }) => {
      if (!text.trim()) return;
      await update({ transcript: text.trim() });
      close();
    },
    field(t('note_text'), h('textarea', { name: 'text', lang: note.lang || speakLanguage(), value: current, rows: 6 })),
    button(t('done'), { iconName: 'check', kind: 'primary big block', type: 'submit' })));
  }

  function draw() {
    const working = ['uploaded', 'transcribing'].includes(note.status);
    const { raw, clean, preview, words, mismatch, approximate } = note.transcript;
    const hasClean = clean && clean !== raw;
    const showing = mismatch || !hasClean ? 'raw' : view;
    const text = (showing === 'clean' ? clean : raw) || preview || '';
    const uncertain = (words || []).map((w, i) => ({ ...w, i })).filter((w) => w.uncertain);

    const alerts = [];
    if (note.flags.noisy) {
      alerts.push(notice('speaker-high', [h('p', {}, t('noisy'))], 'warn'));
    }
    if (mismatch) alerts.push(notice('warning', [h('p', {}, t('mismatch_warning'))], 'warn'));
    if (note.flags.lowConfidence) alerts.push(notice('warning', [h('p', {}, t('low_confidence'))], 'warn'));
    if (approximate) alerts.push(notice('info', [h('p', {}, t('approximate_transcript'))], 'warn'));
    if (note.status === 'audio_only') {
      alerts.push(notice('info', [h('p', {}, t(note.flags.keyMissing ? 'audio_only_key' : 'audio_only'))]));
    }
    if (note.status === 'transcript_failed') {
      alerts.push(notice('hourglass', [h('p', {}, t(note.flags.keyMissing ? 'key_not_set' : 'transcript_pending'))], 'warn'));
    }
    if (note.status === 'ready' && note.transcript.provider === 'browser') {
      alerts.push(notice('info', [h('p', {}, t(note.flags.keyMissing ? 'browser_transcript_key' : 'browser_transcript'))]));
    }
    replace(warnings, alerts);

    const ambiguity = note.ambiguities[0];
    const textBox = showing === 'raw' && words?.length && !note.publishedAt
      ? h('p', { class: 'transcript', lang: note.lang }, words.map((w, i) => [
        w.uncertain ? h('button', { type: 'button', class: 'word', onclick: () => respeak(i) }, w.w) : w.w, ' ']))
      : h('p', { class: 'transcript', lang: note.lang }, text);

    const numbers = [...text.matchAll(/(?:₹\s?)?\p{Nd}+(?:[.,:/]\p{Nd}+)*/gu)].map((m) => m[0]);
    const dates = note.tags.filter((x) => x.dueDate).map((x) => `${t(`tag_${x.type}`)}: ${formatDate(x.dueDate)}`);
    const names = note.recipients.length > 3 ? t('n_students', { n: note.recipients.length }) : note.recipients.map((r) => r.name).join(', ');
    const readback = [[t('for_whom'), names], numbers.length && [t('numbers'), numbers.join(', ')], dates.length && [t('dates'), dates.join(', ')]]
      .filter(Boolean);
    const readbackSpeech = readback.map(([k, v]) => `${k}: ${v}.`).join(' ');

    replace(body,
      working && h('div', { class: 'stack' }, guide('hourglass', 'processing'), !text && skeletons(1, true)),
      ambiguity && h('div', { class: 'card' },
        h('h2', {}, t('confirm_number', { a: ambiguity.options[0], b: ambiguity.options[1] })),
        h('div', { class: 'choice' }, ambiguity.options.slice(0, 2).map((value) =>
          button(value, { kind: 'primary big', onClick: () => update({ resolve: { index: 0, value } }) })))),
      (text || !working) && h('div', { class: 'card' },
        hasClean && !mismatch && segmented([['clean', t('clean_version')], ['raw', t('original_version')]], view, (v) => { view = v; draw(); }),
        text ? textBox : h('p', { class: 'muted' }, t('no_words_yet')),
        uncertain.length > 0 && showing === 'clean' && h('div', { class: 'stack' }, h('p', { class: 'small' }, t('check_words')),
          h('div', { class: 'chips' }, uncertain.map((w) => h('button', { type: 'button', class: 'chip warn', onclick: () => respeak(w.i) }, w.w)))),
        h('div', { class: 'chips' },
          note.audioUrl && h('button', {
            type: 'button', class: 'chip',
            onclick: () => languageSheet(t('transcribe_again'), note.lang, (code) =>
              post(`/notes/${id}/retranscribe`, { lang: code }).then(load).catch(showError)),
          }, icon('translate', { size: 20 }), note.lang ? nativeName(note.lang) : t('auto_language')),
          h('button', { type: 'button', class: 'chip', onclick: () => editText(text) }, icon('pencil-simple', { size: 20 }), t('edit_text')))),
      h('div', { class: 'stack' },
        h('h2', {}, t('tags')),
        h('div', { class: 'chips' },
          note.tags.map((tag, i) => tagChip(tag, { today: note.today, onClick: () => tagSheet(note.tags, i, (tags) => update({ tags })) })),
          h('button', { type: 'button', class: 'chip', onclick: () => tagSheet(note.tags, null, (tags) => update({ tags })) },
            icon('plus', { size: 20 }), t('add_tag')))),
      h('div', { class: 'card' },
        h('div', { class: 'row' }, h('h2', { class: 'grow' }, t('read_back')), speakButton(readbackSpeech, language())),
        h('dl', { class: 'readback' }, readback.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))));

    if (!actions.firstChild) {
      add(actions,
        button(t('save'), { iconName: 'check', kind: 'primary big block', onClick: save }),
        h('div', { class: 'pair' },
          button(t('rerecord'), { iconName: 'arrow-counter-clockwise', kind: 'outline', onClick: rerecord }),
          button(t('later'), { iconName: 'clock', kind: 'outline', href: '/t' })));
    }
    if (note.publishedAt) replace(actions, button(t('done'), { kind: 'primary big block', href: '/t' }));

    // Once the words are in, read the doubt or the prompt aloud and listen for "save".
    if (!working && !announced && !note.publishedAt) {
      announced = true;
      const prompt = ambiguity
        ? t('confirm_number', { a: ambiguity.options[0], b: ambiguity.options[1] })
        : note.flags.noisy ? t('noisy') : t('say_save');
      speak(prompt, languageOf('say_save')).then(() => {
        if (ctx.alive() && !saving && !ambiguity) stopListening = listenForSave(speakLanguage(), save);
      });
    }
  }

  add(body, skeletons(2, true));
  await load();
}
