// What a visitor sees at the front door: the product itself, playable, then how it works, who it is
// for, and the ways in. Signed-in people and the installed app never come here (app.js).
import { h, add, icon, replace } from '../lib/dom.js';
import { t, language, languageOf } from '../lib/i18n.js';
import { store } from '../lib/state.js';
import { button, player, segmented, languageSheet, nativeName, sheet, avatar } from '../lib/ui.js';
import { LANGUAGES } from '../lib/languages.js';
import { chooseLanguage } from '../app-language.js';
import { consentPoints } from './consent.js';

const SOURCE = 'https://github.com/shoumikgoswami/vidya_vaani';

// One real note from the sample school: the teacher's recording and its stored translation. Only
// languages with a real recording are offered, so each button plays what it names.
const SAMPLE = {
  hi: { text: 'आज रवि ने class में बहुत अच्छा किया। कल Hindi की किताब के page 12 की कविता याद करनी है।', caption: 'lp_note_original' },
  en: { text: 'Ravi did very well in class today. He has to learn the poem on page 12 of the Hindi book by tomorrow.', caption: 'lp_note_spoken' },
};

const demoButton = (kind) => store.config.demoMode && button(t('demo_try'), { iconName: 'play', kind, href: '/demo' });
const registerButton = (kind) => button(t('register_cta'), { iconName: 'chalkboard-teacher', kind, href: '/register' });

const brand = () => h('a', { class: 'brand', href: '/' },
  h('img', { src: '/img/icon.svg', alt: '', width: 34, height: 34 }), h('span', {}, 'Vidya Vaani'));

const header = () => h('header', { class: 'lp-nav' }, h('div', { class: 'lp-wrap' }, brand(),
  h('button', {
    type: 'button', class: 'langbtn', 'aria-label': t('preferred_language'),
    onclick: () => languageSheet(t('preferred_language'), language(), chooseLanguage),
  }, icon('globe', { size: 20 }), h('span', {}, nativeName(language()))),
  h('a', { class: 'lp-signin', href: '/login' }, t('sign_in')),
  demoButton('primary small lp-nav-demo')));

/** The note a visitor can actually play, in three languages. */
function sampleNote(ctx) {
  const stage = h('div', { class: 'stack' });
  let current = null;
  function show(code, autoplay) {
    current?.stop();
    const { text, caption } = SAMPLE[code];
    current = player('/media/note-hi.mp3', {
      hero: true, autoplay, durationMs: 5859, onLeave: ctx.onLeave,
      speech: code === 'hi' ? undefined : { url: '/media/note-en.mp3', text, lang: code },
    });
    replace(stage, current, h('p', { class: 'note-text', lang: code }, text), h('p', { class: 'lp-caption' }, t(caption)));
  }
  show('hi', false);
  return h('div', { class: 'lp-stage' }, h('figure', { class: 'lp-note' },
    h('figcaption', { class: 'row' }, avatar('Meena Kumari'),
      h('span', { class: 'grow' }, h('strong', {}, 'Meena Kumari'), h('span', { class: 'muted small' }, t('lp_note_for')))),
    segmented(Object.keys(SAMPLE).map((code) => [code, nativeName(code)]), 'hi', (code) => show(code, true)),
    stage));
}

const hero = (ctx) => h('section', { class: 'lp-hero lp-wrap', 'aria-labelledby': 'lp-title' },
  h('div', { class: 'lp-hero-copy' },
    h('h1', { id: 'lp-title' }, h('span', {}, t('lp_title_start')), ' ', h('em', {}, t('lp_title_end'))),
    h('p', {}, t('lp_intro')),
    h('div', { class: 'lp-ctas' }, demoButton('primary big'), registerButton(store.config.demoMode ? 'outline big' : 'primary big'))),
  sampleNote(ctx));

/** The short film. Nothing but its picture is downloaded until someone asks to watch. */
function film(ctx) {
  const video = h('video', {
    src: '/media/film.mp4', poster: '/media/film.jpg', preload: 'none', playsinline: true, width: 1280, height: 720,
    'aria-labelledby': 'lp-film',
  });
  const start = h('button', { type: 'button', class: 'lp-play' }, icon('play', { weight: 'fill' }), h('span', {}, t('lp_film_play')));
  start.addEventListener('click', () => {
    video.controls = true;
    start.remove();
    video.play().catch(() => {});
    video.focus();
  });
  // One voice at a time: the film and the sample note stop each other.
  video.addEventListener('play', () => ctx.root.querySelector('.lp-note .player')?.stop());
  ctx.root.addEventListener('click', (event) => event.target.closest('.lp-note') && video.pause());
  ctx.onLeave(() => video.pause());
  return h('section', { class: 'lp-film lp-wrap lp-reveal', 'aria-labelledby': 'lp-film' },
    h('h2', { id: 'lp-film' }, t('lp_film_title')),
    h('div', { class: 'lp-cinema' }, video, start));
}

/** A real diary sticker. Its code opens the demo, so it can be scanned from the screen. */
const sticker = (name, className) => h('div', { class: `lp-sticker ${className || ''}`.trim() },
  h('span', { class: 'mast' }, h('img', { src: '/img/icon.svg', alt: '' }), 'Vidya Vaani'),
  h('img', { class: 'code', src: '/img/landing/demo-qr.svg', alt: t('lp_sticker_alt'), loading: 'lazy' }),
  h('b', {}, name), h('span', {}, `${t('class')} 5A`));

const screen = (name, altKey) => h('img', {
  class: 'lp-screen', src: `/img/landing/${name}.webp`, alt: t(altKey), width: 390, height: 780, loading: 'lazy', decoding: 'async',
});

const STEPS = [
  ['qr-code', 'lp_scan_title', 'lp_scan_body', () => h('div', { class: 'lp-board' }, sticker('Ravi Kumar'))],
  ['microphone', 'lp_speak_title', 'lp_speak_body', () => screen('speak', 'lp_speak_alt')],
  ['speaker-high', 'lp_heard_title', 'lp_heard_body', () => screen('heard', 'lp_heard_alt')],
];

/** On a wide screen one picture stays put and changes as the steps scroll past it. */
function steps(ctx) {
  const pictures = STEPS.map(([, , , picture], i) => h('div', { class: `lp-frame${i ? '' : ' on'}` }, picture()));
  const items = STEPS.map(([glyph, title, body, picture], i) => h('li', { class: i ? '' : 'on', 'data-step': i },
    h('span', { class: 'lead' }, icon(glyph)), h('h3', {}, t(title)), h('p', {}, t(body)),
    h('div', { class: 'lp-inline' }, picture())));
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const n = Number(entry.target.dataset.step);
      pictures.forEach((p, i) => p.classList.toggle('on', i === n));
      items.forEach((item, i) => item.classList.toggle('on', i === n));
    }
  }, { rootMargin: '-45% 0px -45% 0px' });
  items.forEach((item) => watcher.observe(item));
  ctx.onLeave(() => watcher.disconnect());
  return h('section', { class: 'lp-steps lp-wrap', 'aria-labelledby': 'lp-steps' },
    h('h2', { id: 'lp-steps' }, t('app_tagline')),
    h('div', { class: 'lp-steps-grid' },
      h('div', { class: 'lp-pinned', 'aria-hidden': 'true' }, pictures),
      h('ol', {}, items)));
}

function languages() {
  const names = () => LANGUAGES.map((l) => h('span', { lang: l.code }, l.native));
  return h('section', { class: 'lp-lang', 'aria-labelledby': 'lp-lang' },
    h('div', { class: 'lp-wrap lp-reveal' }, h('h2', { id: 'lp-lang' }, t('lp_lang_title')), h('p', {}, t('lp_lang_body'))),
    // The row is repeated so it can move without a gap. Screen readers get the list once.
    h('div', { class: 'lp-marquee', 'aria-hidden': 'true' }, h('div', {}, names(), names())),
    h('ul', { class: 'lp-hidden' }, LANGUAGES.map((l) => h('li', { lang: l.code }, l.native))));
}

const tile = (kind, titleKey, bodyKey, picture) => h('article', { class: `lp-tile ${kind} lp-reveal` },
  h('div', { class: 'lp-tile-copy' }, h('h3', {}, t(titleKey)), h('p', {}, t(bodyKey))), picture);

const people = () => h('section', { class: 'lp-people lp-wrap', 'aria-labelledby': 'lp-people' },
  h('h2', { id: 'lp-people', class: 'lp-reveal' }, t('lp_people_title')),
  h('div', { class: 'lp-tiles' },
    tile('teachers', 'lp_teachers_title', 'lp_teachers_body', screen('teacher', 'lp_teacher_alt')),
    tile('parents', 'lp_parents_title', 'lp_parents_body', screen('diary', 'lp_parent_alt')),
    tile('office', 'lp_office_title', 'lp_office_body', h('div', { class: 'lp-fan', 'aria-hidden': 'true' },
      sticker('Priya Sharma'), sticker('Ravi Kumar'), sticker('Kavya Reddy')))));

const REASONS = [
  ['device-mobile', 'lp_phone'], ['wifi-slash', 'lp_network'], ['download-simple', 'lp_install'],
  ['users', 'lp_children'], ['speaker-high', 'lp_voice'], ['lock', 'lp_privacy'],
];

const village = () => h('section', { class: 'lp-village lp-wrap', 'aria-labelledby': 'lp-village' },
  h('h2', { id: 'lp-village', class: 'lp-reveal' }, t('lp_village_title')),
  h('ul', {}, REASONS.map(([glyph, key]) => h('li', { class: 'lp-reveal' }, h('span', { class: 'lead' }, icon(glyph)),
    h('div', {}, h('h3', {}, t(`${key}_title`)), h('p', {}, t(`${key}_body`)))))));

const closing = () => h('section', { class: 'lp-closing', 'aria-labelledby': 'lp-closing' },
  h('div', { class: 'lp-wrap lp-reveal' },
    h('h2', { id: 'lp-closing' }, t('lp_closing_title')), h('p', {}, t('lp_closing_body')),
    h('div', { class: 'lp-ctas' }, registerButton('big lp-light'), demoButton('big lp-ghost')),
    h('p', { class: 'lp-joined' }, t('lp_joined'), ' ', h('a', { href: '/login' }, t('sign_in')))));

const footer = () => h('footer', { class: 'lp-footer' }, h('div', { class: 'lp-wrap' }, brand(),
  h('nav', {},
    h('a', { href: '/school/login' }, t('school_signin')),
    h('a', { href: '/help' }, t('help_title')),
    h('button', { type: 'button', onclick: () => sheet(t('privacy_title'), () => consentPoints()) }, t('lp_data')),
    h('a', { href: SOURCE, target: '_blank', rel: 'noopener' }, t('lp_source')))));

/** Sections step into place the first time they are scrolled to. */
function reveals(ctx) {
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      watcher.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  ctx.root.querySelectorAll('.lp-reveal').forEach((el) => watcher.observe(el));
  ctx.onLeave(() => watcher.disconnect());
}

export function landing(ctx) {
  ctx.root.classList.add('lp');
  ctx.root.lang = languageOf('lp_intro');
  add(ctx.root, header(), hero(ctx), film(ctx), steps(ctx), languages(), people(), village(), closing(), footer());
  reveals(ctx);
}
