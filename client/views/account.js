// The "Me" screen: language, role, notifications, privacy and sign-out.
import { h, add, icon } from '../lib/dom.js';
import { post, patch } from '../lib/api.js';
import { t, language, languageOf } from '../lib/i18n.js';
import { store, roles, currentRole, setRole, navigate, homeFor, logout, refreshMe } from '../lib/state.js';
import {
  button, avatar, languageSheet, nativeName, confirmSheet, toast, speakButton, showError, segmented,
} from '../lib/ui.js';
import { chooseLanguage } from '../app-language.js';
import { consentPoints, consentText, appExtras } from './consent.js';

export function account(ctx) {
  const { user, children } = store.me;
  const mine = roles();
  add(ctx.root,
    h('div', { class: 'row' }, avatar(user.name || user.phone || user.email),
      h('div', { class: 'grow' }, h('h1', {}, user.name || t('me')), h('p', { class: 'muted' }, user.phone || user.email))),
    mine.length > 1 && h('div', { class: 'stack' }, h('h2', {}, t('i_am_here_as')),
      segmented(mine.map((r) => [r, t(`role_${r}`)]), currentRole(), (r) => {
        setRole(r);
        navigate(homeFor(r));
      })),
    h('button', { type: 'button', class: 'item', onclick: () => languageSheet(t('app_language'), language(), chooseLanguage) },
      icon('globe', { size: 30 }), h('span', { class: 'grow' }, h('strong', {}, t('app_language')), h('span', { class: 'muted' }, nativeName(language())))),
    children.filter((c) => c.status === 'active').map((c) => h('button', {
      type: 'button', class: 'item',
      onclick: () => languageSheet(t('read_in'), c.readLang, (code) =>
        patch(`/links/${c.linkId}`, { readLang: code }).then(refreshMe).then(() => navigate('/me', { replace: true })).catch(showError)),
    }, icon('translate', { size: 30 }), h('span', { class: 'grow' }, h('strong', {}, t('notes_for_child', { child: c.name })),
      h('span', { class: 'muted' }, nativeName(c.readLang || user.uiLang || 'en'))))),
    appExtras(),
    button(t('help_title'), { iconName: 'info', kind: 'outline block', href: '/help' }),
    children.length > 0 && h('details', { class: 'card' },
      h('summary', {}, h('strong', {}, t('privacy_title'))),
      h('div', { class: 'row' }, h('p', { class: 'grow muted' }, t('privacy_intro')), speakButton(consentText(), languageOf('consent_stored'))),
      consentPoints(),
      button(t('delete_my_data'), {
        iconName: 'trash', kind: 'danger block',
        onClick: async () => {
          if (!(await confirmSheet(t('delete_my_data'), t('delete_my_data_confirm'), t('delete_my_data'), { danger: true }))) return;
          await post('/privacy/delete-request', { confirm: true });
          await window.caches?.delete('vv-data');
          await refreshMe();
          toast(t('deleted'));
          navigate('/', { replace: true });
        },
      })),
    button(t('sign_out'), {
      iconName: 'sign-out', kind: 'block',
      onClick: async () => {
        await logout();
        navigate('/', { replace: true });
      },
    }));
}
