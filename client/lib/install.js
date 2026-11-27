// Installing the app on a phone. Android browsers offer a prompt; iPhones and some
// browsers need the steps shown.
import { h, icon, replace } from './dom.js';
import { t, language, languageOf } from './i18n.js';
import { button, sheet, speakButton, toast } from './ui.js';

const SNOOZE_KEY = 'vv.install.snoozed';
const SNOOZE_MS = 7 * 86_400_000;

let promptEvent = null;
let installed = false;
const watchers = new Set();
const notify = () => watchers.forEach((draw) => draw());

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  promptEvent = event;
  notify();
});
window.addEventListener('appinstalled', () => {
  installed = true;
  promptEvent = null;
  notify();
  toast(t('installed'));
});

const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 'installed' | 'prompt' (one tap) | 'ios' | 'menu' (browser menu steps) */
export function installState() {
  if (installed || standalone()) return 'installed';
  if (promptEvent) return 'prompt';
  return isIos() ? 'ios' : 'menu';
}

function steps() {
  const ios = installState() === 'ios';
  const list = ios
    ? [['export', 'install_ios_share'], ['plus-square', 'install_ios_add'], ['check', 'install_ios_confirm']]
    : [['dots-three-vertical', 'install_menu_open'], ['device-mobile', 'install_menu_choose'], ['check', 'install_menu_confirm']];
  sheet(t('install_title'), (close) => [
    h('ol', { class: 'list steps' }, list.map(([glyph, key]) =>
      h('li', { class: 'guide' }, icon(glyph), h('p', {}, t(key)), speakButton(t(key), languageOf(key))))),
    h('p', { class: 'muted small' }, t('install_inapp')),
    button(t('done'), { kind: 'primary big block', onClick: close }),
  ]);
}

export async function install() {
  if (installState() !== 'prompt') return steps();
  const event = promptEvent;
  promptEvent = null;
  event.prompt();
  await event.userChoice.catch(() => {});
  notify();
}

/**
 * A card offering installation. It stays away once installed, can be put off for a week, and
 * on browsers without a prompt appears only where `always` asks for it.
 */
export function installCard({ onLeave, always = false } = {}) {
  const box = h('div', { class: 'install-slot' });
  const draw = () => {
    const state = installState();
    const snoozed = Date.now() - Number(localStorage.getItem(SNOOZE_KEY) || 0) < SNOOZE_MS;
    const offer = state !== 'installed' && (always || (!snoozed && state !== 'menu'));
    box.hidden = !offer;
    if (!offer) return replace(box);
    replace(box, h('section', { class: 'card install', 'aria-label': t('install_title') },
      h('div', { class: 'row' },
        h('img', { src: '/img/icon-192.png', alt: '', width: 48, height: 48, lang: language() }),
        h('div', { class: 'grow' }, h('strong', {}, t('install_title')), h('p', { class: 'muted small' }, t('install_body'))),
        !always && h('button', {
          type: 'button', class: 'iconbtn', 'aria-label': t('install_later'),
          onclick: () => {
            localStorage.setItem(SNOOZE_KEY, String(Date.now()));
            draw();
          },
        }, icon('x'))),
      button(t('install_button'), { iconName: 'download-simple', kind: 'primary block', onClick: install })));
  };
  watchers.add(draw);
  onLeave?.(() => watchers.delete(draw));
  draw();
  return box;
}
