// A school asks to join. Nothing is created until the site owner approves (views/owner.js).
import { h, add, replace } from '../lib/dom.js';
import { post } from '../lib/api.js';
import { t, language, languageOf } from '../lib/i18n.js';
import { store, navigate } from '../lib/state.js';
import { guide, button, form, field, languageSelect, tick } from '../lib/ui.js';

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
    h('h1', {}, t('register_title')),
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
