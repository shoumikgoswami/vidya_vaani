// S10 note detail: the teacher's voice first, then the words in the reader's own language.
import { h, add, replace, icon } from '../lib/dom.js';
import { api, post, ApiError } from '../lib/api.js';
import { t, language, formatDate, childCount } from '../lib/i18n.js';
import { speakLanguage, navigate } from '../lib/state.js';
import { stopSpeaking, deviceCanSpeak } from '../lib/speak.js';
import {
  button, skeletons, failure, player, tagChip, dueCard, notice, nativeName, toast, sheet,
} from '../lib/ui.js';
import { voiceReply } from './reply.js';
import { translateOnDevice } from '../lib/translator-fallback.js';

export const markListened = (noteId) => post(`/notes/${noteId}/listened`).catch(() => {});

/** A quiet way back to the voice that was actually recorded, so a translation can be checked by ear. */
function originalVoice(note, main, { onPlay, onLeave }) {
  const audio = new Audio();
  const label = t(note.kind === 'parent_reply' ? 'hear_original' : 'hear_teacher', { language: nativeName(note.lang) });
  const glyph = h('span', { style: 'display:grid' }, icon('play', { weight: 'fill', size: 18 }));
  const link = h('button', { type: 'button', class: 'textlink' }, glyph, h('span', {}, label));
  link.addEventListener('click', async () => {
    if (!audio.paused) return audio.pause();
    main?.stop();
    stopSpeaking();
    try {
      if (!audio.src) {
        const res = await fetch(note.audioUrl, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('audio');
        audio.src = URL.createObjectURL(await res.blob());
      }
      await audio.play();
      onPlay?.();
    } catch {
      toast(t('err_audio'), true);
    }
  });
  const show = (playing) => replace(glyph, icon(playing ? 'pause' : 'play', { weight: 'fill', size: 18 }));
  audio.addEventListener('play', () => show(true));
  audio.addEventListener('pause', () => show(false));
  main?.addEventListener('click', (event) => event.target.closest('.play') && audio.pause());
  onLeave?.(() => audio.pause());
  return link;
}

/**
 * A note in the reader's preferred language: one play button, then the words. The same language as
 * the speaker's plays the recording; another speaks the translation. When the server cannot
 * translate, the phone's own translator is tried, and otherwise the original is shown (spec 5.5).
 */
export function noteBody(note, { hero = false, autoplay = false, onPlay, onLeave, onRetry } = {}) {
  const box = h('div', { class: 'stack' });
  const original = note.text;
  const viewLang = note.viewLang;
  const needs = Boolean(viewLang && note.lang !== viewLang && (original || note.translation));
  let translation = note.translation;
  let main = null;
  // Not while a translation is on its way: it would start in the wrong language.
  let startNow = autoplay && !note.translationPending;

  function draw() {
    main?.stop();
    const translated = needs && translation;
    const text = translated || (needs && !original) ? translation?.text : original;
    const code = translated ? viewLang : note.lang;
    const speechUrl = translated && translation === note.translation ? note.speechUrl : null;
    const canSpeak = Boolean(translated && (speechUrl || deviceCanSpeak(viewLang)));
    // A note typed without a microphone has no recording, so its words are spoken.
    const typed = !note.audioUrl && !translated && text;
    const speech = canSpeak ? { url: speechUrl, text, lang: code }
      : typed ? { url: text.length <= 600 && ['hi', 'en'].includes(code) ? `/api/tts?${new URLSearchParams({ lang: code, text })}` : null, text, lang: code }
        : null;
    main = (note.audioUrl || speech) ? player(note.audioUrl, {
      durationMs: note.durationMs, hero, autoplay: startNow, onPlay, onLeave, speech,
    }) : null;
    startNow = false;

    replace(box,
      main,
      translated && !canSpeak && note.audioUrl && h('p', { class: 'muted small' }, t('voice_missing', { language: nativeName(viewLang) })),
      needs && !translation && (note.translationPending
        ? notice('hourglass', [h('p', {}, t('translating'))])
        : notice('translate', [h('p', {}, t('translation_unavailable')),
          onRetry && button(t('try_again'), { iconName: 'arrows-clockwise', kind: 'outline small', onClick: onRetry })], 'warn')),
      text
        ? h('p', { class: 'note-text', lang: code, dir: 'auto' }, text)
        : h('p', { class: 'muted' }, t(note.status === 'transcribing' || note.status === 'uploaded' ? 'processing' : 'listen_only')),
      canSpeak && note.audioUrl && originalVoice(note, main, { onPlay, onLeave }),
      translated && translation.machineWarning && notice('warning', [h('p', {}, t('mt_warning'))], 'warn'),
      translated && translation.machineWarning && note.english && h('p', { class: 'muted', lang: 'en', dir: 'ltr' }, note.english.text));
  }
  draw();

  if (needs && !translation && original && !note.translationPending) {
    translateOnDevice(original, note.lang, viewLang).then((text) => {
      if (!text) return;
      translation = { text, provider: 'device', machineWarning: false };
      draw();
    });
  }
  return box;
}

function answerButton(ctx, reply) {
  const slot = h('div', {});
  slot.append(button(t('answer_by_voice'), {
    iconName: 'microphone', kind: 'outline block',
    onClick: () => replace(slot, voiceReply({ noteId: reply.id, language: speakLanguage(), onLeave: ctx.onLeave, label: t('answer_by_voice') })),
  }));
  return slot;
}

function replyThread(ctx, note) {
  if (!note.replies.length) return null;
  return h('section', { class: 'stack' }, h('h2', {}, t('replies')),
    note.replies.map((r) => h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', { class: 'grow' }, r.mine ? t('you') : r.authorName),
        h('span', { class: 'muted small' }, formatDate(r.createdAt))),
      noteBody(r, { onLeave: ctx.onLeave, onPlay: () => !r.mine && markListened(r.id) }),
      note.viewer !== 'parent' && r.kind === 'parent_reply' && !r.mine && answerButton(ctx, r))));
}

function receipts(noteId) {
  const box = h('div', { class: 'card' }, skeletons(1));
  async function load() {
    const data = await api(`/notes/${noteId}/receipts`);
    const waiting = data.students.filter((s) => !s.heardAt);
    const row = (s) => h('li', { class: 'row' },
      h('span', { class: 'grow' }, s.name, !s.guardians && h('span', { class: 'muted small' }, ` · ${t('no_parent_linked')}`)),
      h('span', { class: s.heardAt ? 'chip tag' : 'chip' }, t(s.heardAt ? 'heard' : 'not_heard')));
    replace(box,
      h('h2', {}, t('heard_by', { heard: data.heard, total: data.total })),
      h('button', {
        type: 'button', class: 'btn outline block',
        onclick: () => sheet(t('who_heard'), () => h('ul', { class: 'list' }, [...waiting, ...data.students.filter((s) => s.heardAt)].map(row))),
      }, t('who_heard')),
      waiting.length > 0 && button(t('remind'), {
        iconName: 'bell', kind: 'primary block',
        onClick: async () => {
          const result = await post(`/notes/${noteId}/nudge`);
          toast(t('reminded', { n: result.reminded }));
        },
      }));
  }
  load().catch((error) => replace(box, failure(error, () => load())));
  return box;
}

export async function noteView(ctx) {
  const id = Number(ctx.params.id);
  const childId = Number(ctx.query.get('child')) || null;
  let timer = null;
  let polls = 0;
  const top = h('div', { class: 'stack' });
  const middle = h('div', { class: 'stack' });
  const bottom = h('div', { class: 'stack' });
  add(ctx.root, top, middle, bottom);
  add(top, skeletons(2, true));
  ctx.onLeave(() => clearTimeout(timer));
  let drawn = false;
  // A part is drawn again only when it changed, so checking back never cuts off a voice or a reply.
  const shown = {};
  const changed = (part, data) => {
    const next = JSON.stringify(data);
    if (shown[part] === next) return false;
    shown[part] = next;
    return true;
  };

  async function load() {
    let note;
    try {
      note = await api(`/notes/${id}?lang=${language()}`);
    } catch (error) {
      if (!ctx.alive()) return;
      const hidden = error instanceof ApiError && [403, 404].includes(error.status);
      return replace(top, failure(error, hidden ? () => navigate('/') : load));
    }
    if (!ctx.alive()) return;
    const parent = note.viewer === 'parent';
    const child = note.myChildren?.find((c) => c.studentId === childId) || note.myChildren?.[0];

    if (changed('note', [note.text, note.status, note.translation, note.speechUrl, note.translationPending, note.tags])) {
      replace(middle,
        noteBody(note, {
          hero: true, autoplay: !drawn && (parent || ctx.state.autoplay) && !note.translationPending,
          onLeave: ctx.onLeave, onPlay: () => markListened(id),
          onRetry: async () => {
            await api(`/notes/${id}/translation/${note.viewLang}`);
            await load();
          },
        }),
        note.tags.filter((x) => x.dueDate).map((x) => dueCard(x)),
        note.tags.some((x) => !x.dueDate) && h('div', { class: 'chips' }, note.tags.filter((x) => !x.dueDate).map((x) => tagChip(x))));
    }

    if (!drawn) {
      drawn = true;
      replace(top,
        h('div', {}, h('h1', {}, parent ? note.authorName || t('role_teacher') : t('note_for', { name: note.recipients.length > 2 ? childCount(note.recipients.length) : note.recipients.map((r) => r.name).join(', ') })),
          h('p', { class: 'muted' }, `${t('class')} ${note.className} · ${formatDate(note.publishedAt || note.createdAt)}`)),
        !note.publishedAt && notice('clock', [h('p', {}, t('not_saved_yet')), button(t('check_and_save'), { kind: 'primary', href: `/t/confirm/${id}` })], 'warn'));
    }

    if (changed('thread', [note.replies, note.publishedAt])) {
      replace(bottom,
        replyThread(ctx, note),
        note.publishedAt && !parent && note.kind === 'teacher_note' && receipts(id),
        note.publishedAt && parent && voiceReply({
          noteId: id, studentId: child?.studentId, onLeave: ctx.onLeave, language: language(),
          onSent: () => setTimeout(() => ctx.alive() && load(), 1500),
        }));
    }

    // Wait quietly for the transcript or translation to arrive.
    const waiting = note.translationPending || ['uploaded', 'transcribing'].includes(note.status)
      || note.replies.some((r) => r.translationPending || ['uploaded', 'transcribing'].includes(r.status));
    clearTimeout(timer);
    if (waiting && polls < 20) {
      polls += 1;
      timer = setTimeout(load, 2000 + polls * 400);
    }
  }
  await load();
}
