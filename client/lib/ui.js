// Shared pieces: guidance with a speaker, sheets, toasts, tags, the audio player and states.
import { h, add, icon, replace } from './dom.js';
import { t, language, languageOf, formatDate, relativeDay, daysUntil } from './i18n.js';
import { speak, stopSpeaking } from './speak.js';
import { LANGUAGES, lang } from './languages.js';

const calm = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Lets freshly loaded content step into place once. Later redraws stay still. */
export function reveal(el) {
  el.classList.add('reveal');
  setTimeout(() => el.classList.remove('reveal'), 900);
  return el;
}

export const TAG_ICONS = {
  homework: 'book-open', fee: 'currency-inr', exam: 'exam', event: 'calendar-blank', holiday: 'umbrella', notice: 'megaphone',
};

export function speakButton(text, code, { soft = true } = {}) {
  const button = h('button', {
    type: 'button', class: `iconbtn${soft ? ' soft' : ''}`, 'aria-label': t('read_aloud'), title: t('read_aloud'),
    onclick: async (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (button.classList.contains('speaking')) {
        button.classList.remove('speaking');
        return stopSpeaking();
      }
      button.classList.add('speaking');
      const spoken = await speak(typeof text === 'function' ? text() : text, typeof code === 'function' ? code() : code || language());
      button.classList.remove('speaking');
      if (!spoken) toast(t('no_voice'));
    },
  }, icon('speaker-high'));
  return button;
}

/** An instruction: icon, words and a button that reads them aloud. */
export function guide(iconName, key, vars) {
  const text = t(key, vars);
  return h('div', { class: 'guide' }, icon(iconName), h('p', {}, text), speakButton(text, languageOf(key)));
}

export function button(label, { iconName, kind = '', onClick, type = 'button', href, ...rest } = {}) {
  const props = { class: `btn ${kind}`.trim(), ...rest };
  const children = [iconName && icon(iconName), h('span', {}, label)];
  if (href) return h('a', { ...props, href }, children);
  const el = h('button', { ...props, type }, children);
  if (onClick) {
    // A second tap while the first is still working does nothing.
    el.addEventListener('click', async (event) => {
      if (el.disabled) return;
      el.disabled = true;
      try {
        await onClick(event);
      } catch (error) {
        showError(error);
      } finally {
        el.disabled = false;
      }
    });
  }
  return el;
}

export function toast(message, bad = false) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast${bad ? ' bad' : ''}` }, message);
  replace(box, el);
  setTimeout(() => el.classList.add('leaving'), 3960);
  setTimeout(() => el.remove(), 4200);
}

export function errorText(error) {
  if (error?.message === 'offline') return t('err_offline');
  if (error?.code) {
    const key = `err_${error.code}`;
    const text = t(key);
    return text === key ? t('err_generic') : text;
  }
  return t('err_generic');
}

export function showError(error) {
  console.warn(error);
  toast(errorText(error), true);
}

export function sheet(title, build) {
  const body = h('div', { class: 'sheet-body' });
  const dialog = h('dialog', { class: 'sheet', 'aria-label': title }, body);
  const close = () => {
    if (!dialog.open || dialog.classList.contains('closing')) return;
    if (calm()) return dialog.close();
    // Slides away first, then closes. The timer covers a phone that skips the animation.
    dialog.classList.add('closing');
    setTimeout(() => dialog.close(), 220);
  };
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => e.target === dialog && close());
  add(body,
    h('div', { class: 'sheet-head' }, h('h2', {}, title),
      h('button', { type: 'button', class: 'iconbtn', 'aria-label': t('close'), onclick: close }, icon('x'))),
    build(close));
  document.body.append(dialog);
  dialog.showModal();
  return close;
}

export const confirmSheet = (title, message, actionLabel, { danger = false } = {}) =>
  new Promise((resolve) => {
    let answer = false;
    sheet(title, (close) => [
      h('p', {}, message),
      button(actionLabel, { kind: `${danger ? 'danger' : 'primary'} big block`, onClick: () => { answer = true; close(); } }),
      button(t('cancel'), { kind: 'outline block', onClick: close }),
    ]);
    document.querySelector('dialog.sheet:last-of-type')?.addEventListener('close', () => resolve(answer));
  });

export function languageTiles(selected, onPick, { codes } = {}) {
  const list = codes ? LANGUAGES.filter((l) => codes.includes(l.code)) : LANGUAGES;
  return h('div', { class: 'grid' }, list.map((l) =>
    h('button', {
      type: 'button', class: 'tile', lang: l.code, 'aria-pressed': String(l.code === selected),
      onclick: () => {
        speak(l.native, l.code);
        onPick(l.code);
      },
    }, h('span', { class: 'name' }, l.native), h('span', { class: 'small muted', lang: 'en' }, l.name))));
}

export const languageSheet = (title, selected, onPick, extra) =>
  sheet(title, (close) => [
    extra?.(close),
    languageTiles(selected, (code) => {
      close();
      onPick(code);
    }),
  ]);

export function languageSelect(name, value) {
  return h('select', { name, value },
    LANGUAGES.map((l) => h('option', { value: l.code }, `${l.native} (${l.name})`)));
}

export function field(label, control, help) {
  return h('label', { class: 'field' }, h('span', {}, label), control, help && h('small', {}, help));
}

export const formData = (form) => Object.fromEntries(new FormData(form));

/** Names the first empty required field, aloud-friendly, instead of a vague server error. */
function firstMissing(el) {
  const fields = [...el.querySelectorAll('[required]')];
  for (const control of fields) control.removeAttribute('aria-invalid');
  const empty = fields.find((control) => !control.value.trim());
  if (!empty) return false;
  empty.setAttribute('aria-invalid', 'true');
  empty.focus();
  const label = empty.closest('.field')?.querySelector('span')?.textContent || empty.name;
  toast(t('fill_in', { field: label }), true);
  return true;
}

export function form(onSubmit, ...children) {
  const el = h('form', { class: 'stack', novalidate: true });
  add(el, ...children);
  el.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = el.querySelector('[type=submit]');
    if (submit?.disabled || firstMissing(el)) return;
    if (submit) submit.disabled = true;
    try {
      await onSubmit(formData(el), el);
    } catch (error) {
      showError(error);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
  return el;
}

/** Choices side by side. The marker slides to the chosen one. */
export function segmented(options, selected, onPick) {
  const el = h('div', { class: 'segmented', role: 'group' });
  const buttons = options.map(([id, label]) =>
    h('button', { type: 'button', onclick: () => { mark(id); onPick(id); } }, label));
  function mark(value) {
    el.style.setProperty('--i', Math.max(0, options.findIndex(([id]) => id === value)));
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === value)));
  }
  el.style.setProperty('--n', options.length);
  mark(selected);
  return add(el, buttons);
}

export function tagLabel(tag, today) {
  const parts = [t(`tag_${tag.type}`)];
  if (tag.subject) parts.push(tag.subject);
  if (tag.dueDate) {
    const rel = relativeDay(tag.dueDate, today);
    parts.push(rel ? `${rel} (${formatDate(tag.dueDate)})` : formatDate(tag.dueDate));
  }
  return parts.join(' · ');
}

export const tagChip = (tag, { today, onClick } = {}) =>
  h(onClick ? 'button' : 'span', { class: 'chip tag', type: onClick ? 'button' : undefined, onclick: onClick },
    icon(TAG_ICONS[tag.type], { size: 20 }), h('span', {}, tagLabel(tag, today)));

/** A last date, drawn as a calendar leaf so it can be read without the words. */
export function dueCard(tag, today) {
  const days = daysUntil(tag.dueDate, today);
  const count = days > 1 ? t('days_left', { n: days }) : days === 1 ? t('tomorrow') : days === 0 ? t('today') : t('date_passed');
  const full = formatDate(tag.dueDate, { weekday: 'long', day: 'numeric', month: 'long' });
  return h('div', { class: `due${days >= 0 && days <= 1 ? ' soon' : ''}` },
    h('div', { class: 'leaf', 'aria-hidden': 'true' },
      h('small', {}, formatDate(tag.dueDate, { month: 'short' })), h('b', {}, Number(tag.dueDate.slice(8, 10)))),
    h('div', { class: 'grow' }, h('span', {}, tagLabel({ ...tag, dueDate: null })), h('strong', {}, full), h('span', {}, count)),
    speakButton(() => `${t(`tag_${tag.type}`)}. ${full}. ${count}`, language()));
}

const clock = (seconds) => {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const BARS = 36;

/** The same recording always draws the same bars. */
function barHeights(seed) {
  let n = [...seed].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 7);
  return Array.from({ length: BARS }, (_x, i) => {
    n = (n * 1103515245 + 12345) >>> 0;
    // Quieter at the ends, as speech is.
    const shape = 0.45 + 0.55 * Math.sin((Math.PI * (i + 0.5)) / BARS);
    return Math.max(0.16, shape * (0.35 + ((n >>> 16) % 66) / 100));
  });
}

/**
 * The teacher's own voice. The audio is fetched whole, so the service worker can keep it for
 * offline replay. If the browser blocks autoplay, the large button is already on screen.
 */
export function player(src, { durationMs, hero = false, autoplay = false, onPlay, onLeave } = {}) {
  const audio = new Audio();
  let loading = null;
  let reported = false;
  let frame = 0;
  const total = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (durationMs || 0) / 1000);
  const glyph = h('span', { style: 'display:grid' }, icon('play', { weight: 'fill' }));
  const time = h('time', {}, clock((durationMs || 0) / 1000));
  const range = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': t('position') });
  const bars = barHeights(src).map((height) => h('i', { style: `--h:${height.toFixed(2)}` }));
  const scrub = h('div', { class: 'scrub' }, h('div', { class: 'bars', 'aria-hidden': 'true' }, bars), range);

  function paint() {
    const done = total() ? audio.currentTime / total() : 0;
    const upTo = Math.ceil(done * BARS);
    bars.forEach((bar, i) => {
      bar.classList.toggle('on', i < upTo);
      bar.classList.toggle('now', i === upTo - 1);
    });
  }
  function follow() {
    paint();
    if (!audio.paused) frame = requestAnimationFrame(follow);
  }

  const load = () => {
    loading ||= fetch(src, { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error('audio');
        return r.blob();
      })
      .then((blob) => { audio.src = URL.createObjectURL(blob); })
      .catch((error) => {
        loading = null;
        throw error;
      });
    return loading;
  };

  async function toggle(silent = false) {
    if (!audio.paused) return audio.pause();
    try {
      stopSpeaking();
      await load();
      await audio.play();
    } catch {
      if (!silent) toast(t('err_audio'), true);
    }
  }

  const play = h('button', { type: 'button', class: 'play', 'aria-label': t('play'), onclick: () => toggle() }, glyph);
  const box = h('div', { class: `player${hero ? ' hero' : ''}` }, play, h('div', { class: 'track' }, scrub, time));
  audio.addEventListener('play', () => {
    replace(glyph, icon('pause', { weight: 'fill' }));
    play.setAttribute('aria-label', t('pause'));
    box.classList.add('playing');
    cancelAnimationFrame(frame);
    follow();
    if (!reported) {
      reported = true;
      onPlay?.();
    }
  });
  audio.addEventListener('pause', () => {
    replace(glyph, icon('play', { weight: 'fill' }));
    play.setAttribute('aria-label', t('play'));
    box.classList.remove('playing');
    paint();
  });
  audio.addEventListener('timeupdate', () => {
    range.value = total() ? Math.round((audio.currentTime / total()) * 1000) : 0;
    time.textContent = `${clock(audio.currentTime)} / ${clock(total())}`;
    paint();
  });
  range.addEventListener('input', () => {
    if (total() && audio.src) {
      audio.currentTime = (range.value / 1000) * total();
      paint();
    }
  });
  if (autoplay) setTimeout(() => toggle(true), 350);
  onLeave?.(() => {
    audio.pause();
    cancelAnimationFrame(frame);
  });
  return box;
}

/** The saved tick, which draws itself. */
export function tick() {
  const make = (name, attributes) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
    return el;
  };
  const svg = make('svg', { viewBox: '0 0 108 108', class: 'tick', 'aria-hidden': 'true' });
  svg.append(
    make('circle', { cx: 54, cy: 54, r: 48, transform: 'rotate(-90 54 54)' }),
    make('path', { d: 'M33 56 L48 71 L77 40' }),
  );
  return svg;
}

export const empty = (iconName, key, action) =>
  h('div', { class: 'empty' }, icon(iconName), h('p', {}, t(key)), speakButton(t(key), languageOf(key)), action);

export const skeletons = (count = 3, tall = false) =>
  h('div', { class: 'stack', 'aria-busy': 'true', 'aria-label': t('loading') },
    Array.from({ length: count }, () => h('div', { class: `skeleton${tall ? ' tall' : ''}` })));

export function failure(error, retry) {
  return h('div', { class: 'empty' }, icon(error?.message === 'offline' ? 'wifi-slash' : 'warning'),
    h('p', {}, errorText(error)),
    retry && button(t('try_again'), { iconName: 'arrow-counter-clockwise', kind: 'primary', onClick: retry }));
}

export const avatar = (name, large = false) =>
  h('span', { class: `avatar${large ? ' large' : ''}`, 'aria-hidden': 'true' }, [...(name || '?').trim()][0]?.toUpperCase() || '?');

export const notice = (iconName, content, kind = '') =>
  h('div', { class: `notice ${kind}`.trim() }, icon(iconName), h('div', {}, content));

export const nativeName = (code) => lang(code).native;
