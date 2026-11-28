// The "Me" screen: preferred language, a teacher's voice, role, notifications, privacy and sign-out.
import { h, add, icon } from '../lib/dom.js';
import { post, patch } from '../lib/api.js';
import { t, language, languageOf, phrase } from '../lib/i18n.js';
import { store, roles, currentRole, setRole, navigate, homeFor, logout, refreshMe, membershipFor } from '../lib/state.js';
import {
  button, avatar, languageSheet, nativeName, confirmSheet, toast, speakButton, showError, segmented,
} from '../lib/ui.js';
import { speak, stopSpeaking } from '../lib/speak.js';
import { VOICES } from '../lib/languages.js';
import { chooseLanguage } from '../app-language.js';
import { consentPoints, consentText } from './consent.js';
import { enablePush, pushState } from '../lib/push.js';
import { install, installState } from '../lib/install.js';

const row = (glyph, title, detail, onClick) =>
  h('button', { type: 'button', class: 'item', onclick: onClick }, h('span', { class: 'lead' }, icon(glyph)),
    h('span', { class: 'grow' }, h('strong', {}, title), detail && h('span', { class: 'muted small' }, detail)),
    icon('caret-right', { flip: true }));

/** The voice that speaks this teacher's notes to families in Hindi and English. */
function voicePicker() {
  // Samples are in the preferred language where the voices speak it.
  const sampleLang = ['hi', 'en'].includes(language()) ? language() : 'en';
  let chosen = store.me.user.voice;
  const rows = VOICES.map((name) => {
    const pick = h('button', { type: 'button', class: 'voice-pick', 'aria-pressed': String(name === chosen) },
      h('span', { class: 'mark', 'aria-hidden': 'true' }, icon('check', { size: 18 })), h('strong', { lang: 'en' }, name));
    pick.addEventListener('click', async () => {
      try {
        await patch('/me', { voice: name });
        chosen = name;
        for (const other of rows) other.pick.setAttribute('aria-pressed', String(other.name === chosen));
        await refreshMe();
        toast(t('voice_saved', { name }));
      } catch (error) {
        showError(error);
      }
    });
    const listen = h('button', {
      type: 'button', class: 'iconbtn soft', 'aria-label': t('listen_to', { name }),
      onclick: async () => {
        stopSpeaking();
        const sample = await phrase(sampleLang, 'voice_sample');
        if (!(await speak(sample.text, sample.lang, { voice: name }))) toast(t('no_voice'));
      },
    }, icon('speaker-high'));
    return { name, pick, el: h('li', { class: 'voice-row' }, pick, listen) };
  });
  return h('div', { class: 'section' }, h('h2', {}, t('your_voice')), h('p', { class: 'muted' }, t('voice_help')),
    h('ul', { class: 'list' }, rows.map((r) => r.el)));
}

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
    h('div', { class: 'list' },
    row('globe', t('preferred_language'), nativeName(language()), () => languageSheet(t('preferred_language'), language(), chooseLanguage)),
    pushState() === 'default' && row('bell', t('allow_notifications'), null, async () => {
      const result = await enablePush(store.config.vapidPublicKey);
      toast(t(result === 'granted' ? 'notifications_on' : 'notifications_off'));
      navigate('/me', { replace: true });
    }),
    installState() !== 'installed' && row('download-simple', t('install_title'), t('install_body'), install),
    // The other sign-in, for someone who works at the office and also teaches or has a child here.
    store.me.portal === 'school'
      ? store.me.memberships.some((m) => m.role === 'teacher') || children.length
        ? row('users', t('family_signin'), null, () => navigate('/login')) : null
      : store.me.memberships.some((m) => m.role === 'admin')
        ? row('chalkboard-teacher', t('school_signin'), null, () => navigate('/school/login')) : null,
    row('info', t('help_title'), null, () => navigate('/help'))),
    store.me.portal !== 'school' && membershipFor('teacher') && voicePicker(),
    h('div', { class: 'section' }, h('h2', {}, t('appearance')),
      segmented([['light', t('theme_light')], ['dark', t('theme_dark')]], window.vvTheme.current(), window.vvTheme.set)),
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
      iconName: 'sign-out', kind: 'outline block',
      onClick: async () => {
        await logout();
        navigate('/', { replace: true });
      },
    }));
}
