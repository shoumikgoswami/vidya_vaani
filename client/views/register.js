// Registering, by who you are. A parent chooses a language and scans the diary sticker; a teacher
// types the school's code; a school sends a request that the site owner approves (views/owner.js).
import { h, add, icon, replace } from '../lib/dom.js';
import { post } from '../lib/api.js';
import { t, language, languageOf } from '../lib/i18n.js';
import { speak } from '../lib/speak.js';
import { store, signedIn, navigate, refreshMe, setRole } from '../lib/state.js';
import { guide, button, form, field, languageSelect, languageTiles, speakButton, tick, toast, nativeName } from '../lib/ui.js';
import { chooseLanguage } from '../app-language.js';

/** Set while a parent is on their way from here to the diary, so nobody asks for the language twice. */
export const PARENT_PATH = 'vv.parent';

const ROLES = [
  ['parent', 'users'], ['teacher', 'chalkboard-teacher'], ['school', 'gear'],
];

export function registerChoice(ctx) {
  add(ctx.root,
    h('h1', {}, t('register_title')),
    guide('hand-tap', 'register_choose'),
    h('div', { class: 'stack' }, ROLES.map(([role, glyph]) => {
      const title = `register_${role}`;
      const body = `register_${role}_body`;
      return h('div', { class: 'card role-card' },
        h('a', { href: `/register/${role}` }, h('span', { class: 'lead' }, icon(glyph, { size: 28 })),
          h('span', { class: 'grow' }, h('strong', {}, t(title)), h('span', { class: 'muted' }, t(body)))),
        speakButton(() => `${t(title)}. ${t(body)}`, languageOf(body)));
    })),
    h('p', { class: 'center muted' }, t('lp_joined'), ' ', h('a', { href: '/login' }, t('sign_in'))));
}

const PARENT_STEPS = [
  ['qr-code', 'parent_step_scan'], ['phone', 'parent_step_signin'], ['check-circle', 'parent_step_approve'],
  ['speaker-high', 'parent_step_listen'],
];

/** The language first, then what to do, written and spoken in it. */
export function registerParent(ctx) {
  sessionStorage.setItem(PARENT_PATH, '1');
  if (ctx.query.get('step') !== '2') {
    const next = async (code) => {
      await chooseLanguage(code);
      navigate('/register/parent?step=2');
    };
    add(ctx.root,
      h('h1', {}, t('parent_language')),
      guide('translate', 'welcome_pick_language'),
      languageTiles(language(), next),
      h('div', { class: 'sticky-actions' },
        button(`${t('continue')}: ${nativeName(language())}`, { iconName: 'arrow-right', kind: 'primary big block', onClick: () => next(language()) })));
    return speak(t('welcome_pick_language'), languageOf('welcome_pick_language'));
  }
  add(ctx.root,
    h('h1', {}, t('parent_title')),
    h('ol', { class: 'steps' }, PARENT_STEPS.map(([glyph, key]) =>
      h('li', { class: 'guide' }, icon(glyph), h('p', {}, t(key)), speakButton(t(key), languageOf(key))))),
    button(t('parent_scan'), { iconName: 'qr-code', kind: 'primary big block', href: '/scan' }),
    button(t('parent_change_language'), { iconName: 'globe', kind: 'outline block', href: '/register/parent' }),
    h('p', { class: 'center muted' }, t('lp_joined'), ' ', h('a', { href: '/login?next=/p' }, t('sign_in'))));
  speak(t('parent_step_scan'), languageOf('parent_step_scan'));
}

/** Sign in, then the code from the school office. */
export function registerTeacher(ctx) {
  sessionStorage.removeItem(PARENT_PATH);
  add(ctx.root, h('h1', {}, t('teacher_join_title')));
  // Teaching belongs to the teacher and parent sign-in, not the school office one.
  if (!signedIn() || store.me.portal === 'school') {
    return add(ctx.root, guide('phone', 'teacher_join_signin'),
      button(t('sign_in'), { iconName: 'arrow-right', kind: 'primary big block', href: '/login?next=/register/teacher' }));
  }
  add(ctx.root,
    guide('lock', 'teacher_join_code'),
    form(async ({ code }) => {
      const joined = await post('/join', { code });
      await refreshMe();
      setRole('teacher');
      toast(t('teacher_joined', { school: joined.schoolName }));
      navigate('/t', { replace: true });
    },
    field(t('teacher_code_label'), h('input', {
      name: 'code', class: 'code', required: true, maxlength: 12, dir: 'ltr', autocomplete: 'one-time-code',
      autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCD-2345',
    })),
    button(t('teacher_join'), { iconName: 'check', kind: 'primary big block', type: 'submit' })));
}

/** A school asks to join. Nothing is created until the site owner approves. */
export function registerSchool(ctx) {
  const holder = h('div', { class: 'view' });
  add(ctx.root, holder);

  const sent = () => {
    replace(holder,
      h('div', { class: 'stage' }, tick(), h('h1', {}, t('register_done_title'))),
      guide('check-circle', 'register_done_body'),
      store.config.demoMode && button(t('demo_try'), { iconName: 'house', kind: 'primary big block', href: '/demo' }),
      button(t('back_home'), { kind: 'quiet block', onClick: () => navigate('/') }));
    window.scrollTo(0, 0);
  };

  const input = (name, extra = {}) => h('input', { name, ...extra });
  add(holder,
    h('h1', {}, t('register_school_title')),
    guide('chalkboard-teacher', 'register_intro'),
    form(async (data) => {
      await post('/register', data);
      sent();
    },
    field(t('school_name'), input('schoolName', { required: true, autocomplete: 'organization', lang: languageOf('school_name') })),
    field(t('register_town'), input('town', { required: true, autocomplete: 'address-level2' })),
    field(t('your_name'), input('contactName', { required: true, autocomplete: 'name' })),
    field(t('phone_label'), input('phone', { required: true, type: 'tel', inputmode: 'tel', autocomplete: 'tel' })),
    field(t('register_email'), input('email', { type: 'email', autocomplete: 'email', dir: 'ltr' }), t('register_email_help')),
    field(t('default_language'), languageSelect('lang', language())),
    // Hidden from people. Programs that fill in every field give themselves away.
    h('input', { name: 'website', class: 'trap', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' }),
    h('p', { class: 'muted small' }, t('register_privacy')),
    button(t('register_send'), { iconName: 'check', kind: 'primary big block', type: 'submit' })));
}
