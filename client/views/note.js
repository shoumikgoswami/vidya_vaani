// S10 note detail: the teacher's voice first, then the words in the reader's own language.
import { h, add, replace } from '../lib/dom.js';
import { api, post, ApiError } from '../lib/api.js';
import { t, language, formatDate, childCount } from '../lib/i18n.js';
import { store, speakLanguage, navigate } from '../lib/state.js';
import {
  button, skeletons, failure, player, tagChip, dueCard, segmented, notice, speakButton, nativeName, toast, languageSheet, sheet,
} from '../lib/ui.js';
import { voiceReply } from './reply.js';
import { translateOnDevice } from '../lib/translator-fallback.js';

export const markListened = (noteId) => post(`/notes/${noteId}/listened`).catch(() => {});

/**
 * Translation block: the translated words with a toggle to the original. When the server cannot
 * translate, the phone's own translator is tried, and otherwise the original is shown (spec 5.5).
 */
export function words(note, { onRetry } = {}) {
  const box = h('div', { class: 'stack' });
  const original = note.text;
  const viewLang = note.viewLang;
  const needs = Boolean(viewLang && note.lang !== viewLang && (original || note.translation));
  let translation = note.translation;
  let showing = 'translation';

  function draw() {
    const showTranslation = needs && translation && showing === 'translation';
    const text = showTranslation || (needs && !original) ? translation?.text : original;
    const code = showTranslation ? viewLang : note.lang;
    replace(box,
      needs && translation && original && segmented(
        [['translation', nativeName(viewLang)], ['original', t('original_version')]], showing,
        (v) => { showing = v; draw(); }),
      needs && !translation && (note.translationPending
        ? notice('hourglass', [h('p', {}, t('translating'))])
        : notice('translate', [h('p', {}, t('translation_unavailable')),
          onRetry && button(t('try_again'), { iconName: 'arrows-clockwise', kind: 'outline small', onClick: onRetry })], 'warn')),
      text
        ? h('div', { class: 'row top' },
          h('p', { class: 'note-text grow', lang: code, dir: 'auto' }, text), speakButton(text, code))
        : h('p', { class: 'muted' }, t(note.status === 'transcribing' || note.status === 'uploaded' ? 'processing' : 'listen_only')),
      showTranslation && translation.machineWarning && notice('warning', [h('p', {}, t('mt_warning'))], 'warn'),
      showTranslation && translation.machineWarning && note.english && h('p', { class: 'muted', lang: 'en', dir: 'ltr' }, note.english.text));
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
      r.audioUrl && player(r.audioUrl, { durationMs: r.durationMs, onLeave: ctx.onLeave, onPlay: () => !r.mine && markListened(r.id) }),
      words(r),
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
  let viewLang = null;
  let timer = null;
  let polls = 0;
  const top = h('div', { class: 'stack' });
  const middle = h('div', { class: 'stack' });
  const bottom = h('div', { class: 'stack' });
  add(ctx.root, top, middle, bottom);
  add(top, skeletons(2, true));
  ctx.onLeave(() => clearTimeout(timer));
  let drawn = false;

  async function load() {
    let note;
    try {
      note = await api(`/notes/${id}${viewLang ? `?lang=${viewLang}` : ''}`);
    } catch (error) {
      if (!ctx.alive()) return;
      const hidden = error instanceof ApiError && [403, 404].includes(error.status);
      return replace(top, failure(error, hidden ? () => navigate('/') : load));
    }
    if (!ctx.alive()) return;
    const parent = note.viewer === 'parent';
    const child = note.myChildren?.find((c) => c.studentId === childId) || note.myChildren?.[0];

    replace(middle,
      words(note, {
        onRetry: async () => {
          await api(`/notes/${id}/translation/${note.viewLang}`);
          await load();
        },
      }),
      parent && Boolean(note.text || note.translation || note.english) && h('button', {
        type: 'button', class: 'chip',
        onclick: () => languageSheet(t('read_in'), note.viewLang, (code) => {
          viewLang = code;
          polls = 0;
          load();
        }),
      }, t('read_in_other')),
      note.tags.filter((x) => x.dueDate).map((x) => dueCard(x)),
      note.tags.some((x) => !x.dueDate) && h('div', { class: 'chips' }, note.tags.filter((x) => !x.dueDate).map((x) => tagChip(x))));

    if (!drawn) {
      drawn = true;
      replace(top,
        h('div', {}, h('h1', {}, parent ? note.authorName || t('role_teacher') : t('note_for', { name: note.recipients.length > 2 ? childCount(note.recipients.length) : note.recipients.map((r) => r.name).join(', ') })),
          h('p', { class: 'muted' }, `${t('class')} ${note.className} · ${formatDate(note.publishedAt || note.createdAt)}`)),
        note.audioUrl && player(note.audioUrl, {
          durationMs: note.durationMs, hero: true, autoplay: parent || ctx.state.autoplay, onLeave: ctx.onLeave,
          onPlay: () => markListened(id),
        }),
        !note.publishedAt && notice('clock', [h('p', {}, t('not_saved_yet')), button(t('check_and_save'), { kind: 'primary', href: `/t/confirm/${id}` })], 'warn'));
    }

    replace(bottom,
      replyThread(ctx, note),
      note.publishedAt && !parent && note.kind === 'teacher_note' && receipts(id),
      note.publishedAt && parent && voiceReply({
        noteId: id, studentId: child?.studentId, onLeave: ctx.onLeave,
        language: store.me.children.find((c) => c.studentId === child?.studentId)?.readLang || language(),
        onSent: () => setTimeout(() => ctx.alive() && load(), 1500),
      }));

    // Wait quietly for the transcript or translation to arrive.
    const waiting = note.translationPending || ['uploaded', 'transcribing'].includes(note.status)
      || note.replies.some((r) => ['uploaded', 'transcribing'].includes(r.status));
    clearTimeout(timer);
    if (waiting && polls < 20) {
      polls += 1;
      timer = setTimeout(load, 2000 + polls * 400);
    }
  }
  await load();
}
