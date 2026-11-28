// S9 the parent diary: the newest note large and playable, this week, then everything by date.
import { h, add, icon, replace } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { t, languageOf, formatDate, relativeDay } from '../lib/i18n.js';
import { speak } from '../lib/speak.js';
import { store, navigate, refreshMe } from '../lib/state.js';
import {
  button, skeletons, failure, player, dueCard, empty, speakButton, TAG_ICONS, tagChip, notice, avatar, reveal,
} from '../lib/ui.js';
import { installCard } from '../lib/install.js';
import { consentCard } from './consent.js';
import { markListened } from './note.js';

const FILTERS = [
  ['', 'all_notes'], ['tag:homework', 'tag_homework'], ['tag:fee', 'tag_fee'], ['tag:exam', 'tag_exam'],
  ['tag:notice', 'tag_notice'], ['tag:event', 'tag_event'], ['tag:holiday', 'tag_holiday'],
  ['status:pending', 'pending'], ['status:done', 'done_filter'],
];

const open = (note, childId) => `/p/note/${note.id}?child=${childId}`;

function latestCard(ctx, note, childId, readLang, today, autoplay) {
  const due = note.nextDue && note.tags.find((x) => x.dueDate === note.nextDue);
  return h('article', { class: `card lift${note.heard ? '' : ' unheard'}` },
    h('div', { class: 'row' }, avatar(note.authorName), h('div', { class: 'grow' }, h('strong', {}, note.authorName), h('br'),
      h('span', { class: 'muted small' }, relativeDay(note.publishedAt.slice(0, 10), today) || formatDate(note.publishedAt))),
    !note.heard && h('span', { class: 'chip good' }, t('new_note'))),
    note.audioUrl && player(note.audioUrl, { durationMs: note.durationMs, hero: true, autoplay, onLeave: ctx.onLeave, onPlay: () => markListened(note.id) }),
    note.shown && h('div', { class: 'row top' },
      h('p', { class: 'note-text grow', dir: 'auto', lang: note.translated ? readLang : note.lang }, note.shown),
      speakButton(note.shown, note.translated ? readLang : note.lang)),
    due ? dueCard(due, today) : h('div', { class: 'chips' }, note.tags.map((x) => tagChip(x, { today }))),
    button(t('open_and_reply'), { iconName: 'microphone', kind: 'outline block', href: open(note, childId) }));
}

function summaryCard(childId) {
  const box = h('div', { class: 'card' }, skeletons(1));
  api(`/children/${childId}/summary`).then((s) => {
    const lines = s.due.map((d) => `${t(`tag_${d.type}`)}${d.subject ? ` ${d.subject}` : ''}: ${relativeDay(d.dueDate, s.today) || formatDate(d.dueDate)}`);
    const spoken = [t('week_new', { n: s.newNotes }), t('week_unheard', { n: s.unheard }), ...(lines.length ? lines : [t('week_nothing_due')])].join('. ');
    replace(box,
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, t('this_week')), speakButton(spoken, languageOf('this_week'))),
      h('p', {}, `${s.newNotes === 1 ? t('week_new_one') : t('week_new', { n: s.newNotes })} · ${t('week_unheard', { n: s.unheard })}`),
      s.due.length
        ? h('ul', { class: 'list' }, s.due.map((d, i) => h('li', {}, h('a', { class: 'item', href: `/p/note/${d.noteId}?child=${childId}` },
          h('span', { class: 'lead' }, icon(TAG_ICONS[d.type])), h('span', { class: 'grow' }, h('strong', {}, lines[i])), icon('caret-right', { flip: true })))))
        : h('p', { class: 'muted' }, t('week_nothing_due')));
  }).catch(() => box.remove());
  return box;
}

const row = (note, childId) =>
  h('li', {}, h('a', { class: `item${note.heard ? '' : ' unheard'}`, href: open(note, childId) },
    h('span', { class: 'lead' }, icon(note.tags[0] ? TAG_ICONS[note.tags[0].type] : 'play')),
    h('span', { class: 'grow' },
      h('strong', { dir: 'auto' }, note.shown ? `${note.shown.slice(0, 70)}${note.shown.length > 70 ? '…' : ''}` : t('listen_only')),
      h('span', { class: 'muted small' }, [note.authorName, ...note.tags.map((x) => t(`tag_${x.type}`)), !note.heard && t('new_note')].filter(Boolean).join(' · '))),
    icon('caret-right', { flip: true })));

export async function diary(ctx) {
  await refreshMe().catch(() => {});
  if (!ctx.alive()) return;
  const children = store.me.children;
  const asked = Number(ctx.query.get('child'));
  const child = children.find((c) => c.studentId === asked) || children.find((c) => c.status === 'active') || children[0];

  if (!child) {
    add(ctx.root,
      empty('qr-code', 'diary_empty', button(t('scan_qr'), { iconName: 'qr-code', kind: 'primary big block', href: '/scan' })),
      // Office staff who came through this door are shown the other one.
      store.me.memberships.some((m) => m.role === 'admin') && notice('chalkboard-teacher', [
        h('p', {}, t('family_only_notice')), button(t('school_signin'), { kind: 'primary small', href: '/school/login' }),
      ]),
      // On a fresh install the first person to sign in may be here to create the school.
      store.config.setupNeeded && !store.me.memberships.length
        && button(t('setup_title'), { iconName: 'chalkboard-teacher', kind: 'outline block', href: '/school/login?next=/setup' }));
    return speak(t('diary_empty'), languageOf('diary_empty'));
  }

  const switcher = children.length > 1 && h('div', { class: 'chips scroll', role: 'group', 'aria-label': t('choose_child') },
    children.map((c) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(c.studentId === child.studentId),
      onclick: () => navigate(`/p?child=${c.studentId}`, { replace: true }),
    }, c.name)));
  add(ctx.root, switcher,
    h('div', { class: 'page-head' }, h('h1', {}, child.name), h('p', { class: 'muted' }, `${t('class')} ${child.className} · ${child.schoolName}`)));

  if (child.status === 'pending') {
    return add(ctx.root, notice('hourglass', [h('p', {}, t('link_pending', { child: child.name })),
      button(t('check_again'), { kind: 'outline small', onClick: () => navigate(location.pathname + location.search, { replace: true }) })], 'warn'));
  }
  if (!child.consented) {
    ctx.root.textContent = '';
    return add(ctx.root, consentCard({ linkId: child.linkId, child: child.name, onDone: () => navigate(`/p?child=${child.studentId}`, { replace: true }) }));
  }

  const latest = h('div', {}, skeletons(1, true));
  const week = summaryCard(child.studentId);
  const filterBar = h('div', { class: 'chips scroll', role: 'group', 'aria-label': t('filters') });
  const list = h('div', { class: 'stack' });
  add(ctx.root, latest, installCard({ onLeave: ctx.onLeave }), week, filterBar, list);

  let filter = '';
  let generation = 0;

  async function load(cursor) {
    const mine = cursor ? generation : (generation += 1);
    const [key, value] = filter.split(':');
    const params = new URLSearchParams();
    if (value) params.set(key, value);
    if (cursor) params.set('cursor', cursor);
    const data = await api(`/children/${child.studentId}/notes?${params}`);
    if (!ctx.alive() || mine !== generation) return;

    if (!filter && !cursor) {
      replace(reveal(latest), data.notes[0]
        ? latestCard(ctx, data.notes[0], child.studentId, data.readLang, data.today, ctx.state.autoplay || !data.notes[0].heard)
        : empty('book-open', 'no_notes_yet'));
    }
    if (!cursor) list.textContent = '';
    list.querySelector('.more')?.remove();
    // The newest note is already shown large above the unfiltered list.
    const notes = !filter && !cursor ? data.notes.slice(1) : data.notes;
    let lastDate = list.querySelector('[data-date]:last-of-type')?.dataset.date;
    let group = list.querySelector('ul:last-of-type');
    for (const note of notes) {
      const date = note.publishedAt.slice(0, 10);
      const heading = `${formatDate(date)} · ${t('class')} ${note.className} (${note.academicYear})`;
      if (date !== lastDate) {
        lastDate = date;
        group = h('ul', { class: 'list' });
        add(list, h('h2', { class: 'date-head', 'data-date': date }, heading), group);
      }
      add(group, row(note, child.studentId));
    }
    if (filter && !data.notes.length) add(list, empty('book-open', 'no_matching_notes'));
    if (data.nextCursor) {
      add(list, h('div', { class: 'more' }, button(t('show_older'), { kind: 'outline block', onClick: () => load(data.nextCursor) })));
    }
  }

  function drawFilters() {
    replace(filterBar, FILTERS.map(([id, key]) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(id === filter),
      onclick: () => {
        filter = id;
        drawFilters();
        latest.hidden = week.hidden = Boolean(id);
        load().catch((e) => replace(list, failure(e, () => load())));
      },
    }, id.startsWith('tag:') && icon(TAG_ICONS[id.slice(4)], { size: 20 }), t(key))));
  }
  drawFilters();
  await load().catch((error) => replace(latest, failure(error, () => navigate(location.pathname + location.search, { replace: true }))));
}
