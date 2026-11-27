// S17 one-time consent, read aloud, then home screen and notification prompts (J5).
import { h, icon, replace } from '../lib/dom.js';
import { post } from '../lib/api.js';
import { t, language, languageOf } from '../lib/i18n.js';
import { speak } from '../lib/speak.js';
import { store, refreshMe } from '../lib/state.js';
import { button, speakButton, toast } from '../lib/ui.js';
import { enablePush, pushState, canInstall, install } from '../lib/push.js';

export const CONSENT_POINTS = [
  ['database', 'consent_stored'],
  ['users', 'consent_who'],
  ['translate', 'consent_ai'],
  ['trash', 'consent_delete'],
];

export const consentText = () => CONSENT_POINTS.map(([, key]) => t(key)).join(' ');

export const consentPoints = () =>
  h('ul', { class: 'list' }, CONSENT_POINTS.map(([glyph, key]) => h('li', { class: 'guide' }, icon(glyph), h('p', {}, t(key)))));

export function appExtras() {
  const box = h('div', { class: 'actions' });
  if (pushState() === 'default') {
    box.append(button(t('allow_notifications'), {
      iconName: 'bell', kind: 'primary big block',
      onClick: async () => {
        const result = await enablePush(store.config.vapidPublicKey);
        toast(t(result === 'granted' ? 'notifications_on' : 'notifications_off'));
      },
    }));
  }
  box.append(button(t('add_home_screen'), {
    iconName: 'device-mobile', kind: 'outline big block',
    onClick: async () => {
      if (!canInstall() || !(await install())) toast(t('add_home_screen_help'));
    },
  }));
  return box;
}

export function consentCard({ linkId, child, onDone }) {
  const box = h('div', { class: 'stack' });
  const heading = t('consent_title', { child });
  replace(box,
    h('div', { class: 'row' }, h('h1', { class: 'grow' }, heading), speakButton(() => `${heading}. ${consentText()}`, languageOf('consent_stored'))),
    consentPoints(),
    h('div', { class: 'sticky-actions' }, button(t('agree'), {
      iconName: 'check', kind: 'primary big block',
      onClick: async () => {
        await post(`/links/${linkId}/consent`, { readLang: language() });
        await refreshMe();
        replace(box,
          h('h1', {}, t('all_set')),
          appExtras(),
          button(t('open_diary'), { iconName: 'book-open', kind: 'primary big block', onClick: onDone }));
      },
    })));
  speak(`${heading}. ${consentText()}`, languageOf('consent_stored'));
  return box;
}
