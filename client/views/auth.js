// S2 sign-in (Clerk, or the demo phone code) and the first-run wizard.
import { h, add, icon, replace } from '../lib/dom.js';
import { api, post } from '../lib/api.js';
import { t, language } from '../lib/i18n.js';
import { store, signedIn, navigate, homeFor, refreshMe, loadClerk } from '../lib/state.js';
import { guide, button, form, field, languageSelect, skeletons, failure, notice, errorText } from '../lib/ui.js';

const safeNext = (next) => (next && next.startsWith('/') && !next.startsWith('//') ? next : null);

async function afterSignIn(next) {
  await refreshMe();
  store.config = await api('/config');
  sessionStorage.removeItem('vv.next.family');
  sessionStorage.removeItem('vv.next.school');
  navigate(next || homeFor(), { replace: true });
}

/** An account that is not office staff tried the school office sign-in. */
const refused = (onAnother) => notice('lock', [
  h('p', { role: 'alert' }, t('err_not_school_staff')),
  onAnother && button(t('use_other_account'), { kind: 'outline small', onClick: onAnother }),
  button(t('family_signin'), { kind: 'primary small', href: '/login' }),
], 'bad');

function keypad(input, maxLength, onChange) {
  const press = (key) => {
    if (key === 'back') input.value = input.value.slice(0, -1);
    else if (input.value.replace(/\D/g, '').length < maxLength) input.value += key;
    onChange();
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
  return h('div', { class: 'keypad' }, keys.map((key) =>
    key === '' ? h('span') : h('button', {
      type: 'button', class: 'btn outline big', 'aria-label': key === 'back' ? t('delete_digit') : key, onclick: () => press(key),
    }, key === 'back' ? icon('backspace', { flip: true }) : key)));
}

function numberEntry({ label, maxLength, submitLabel, onSubmit, value = '', code = false }) {
  const input = h('input', {
    class: 'code', inputmode: 'none', type: 'tel', autocomplete: code ? 'one-time-code' : 'tel', 'aria-label': label, value,
  });
  const submit = h('button', { type: 'submit', class: 'btn primary big block' }, icon('check'), h('span', {}, submitLabel));
  const error = h('p', { class: 'error', role: 'alert', hidden: true });
  const check = () => {
    error.hidden = true;
    submit.disabled = input.value.replace(/\D/g, '').length < (code ? 6 : 10);
  };
  input.addEventListener('input', check);
  check();
  const el = h('form', { class: 'stack', novalidate: true }, field(label, input), error, keypad(input, maxLength, check), submit);
  el.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      await onSubmit(input.value.trim());
    } catch (e) {
      error.textContent = errorText(e);
      error.hidden = false;
      submit.disabled = false;
    }
  });
  setTimeout(() => input.focus(), 50);
  return el;
}

function demoPhoneLogin(ctx, portal, next) {
  const box = h('div', { class: 'stack' });
  const askCode = (phone, demoCode) => replace(box,
    guide('chat-circle', 'otp_enter', { phone }),
    notice('info', [h('p', {}, t('otp_demo_banner'), ' ', h('strong', { class: 'demo-code' }, demoCode))], 'warn'),
    numberEntry({
      label: t('otp_label'), maxLength: 6, code: true, submitLabel: t('verify'),
      onSubmit: async (code) => {
        try {
          await post('/auth/otp/verify', { phone, code, portal });
        } catch (error) {
          if (error.code !== 'not_school_staff') throw error;
          return replace(box, refused(), button(t('change_number'), { iconName: 'arrow-left', kind: 'block', onClick: askPhone }));
        }
        await afterSignIn(next);
      },
    }),
    button(t('change_number'), { iconName: 'arrow-left', kind: 'block', onClick: askPhone }));
  const askPhone = () => replace(box,
    guide('phone', 'login_phone_guide'),
    numberEntry({
      label: t('phone_label'), maxLength: 12, value: ctx.state.phone || '', submitLabel: t('send_code'),
      onSubmit: async (phone) => {
        const result = await post('/auth/otp/send', { phone });
        askCode(result.phone, result.demoCode);
      },
    }));
  askPhone();
  return box;
}

async function clerkLogin(ctx, portal, next) {
  const mount = h('div', { class: 'stack', style: 'align-items:center' });
  const status = h('div', {}, skeletons(2, true));
  add(ctx.root, guide('shield-check', 'login_clerk_guide'), status, mount);
  const here = portal === 'school' ? '/school/login' : '/login';
  let exchanged = false;
  try {
    const clerk = await loadClerk();
    if (!ctx.alive()) return;
    status.textContent = '';
    const exchange = async () => {
      if (exchanged || !clerk.session) return;
      exchanged = true;
      replace(status, skeletons(1));
      const token = await clerk.session.getToken();
      await api('/auth/clerk', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: { portal } });
      await afterSignIn(next);
    };
    const onError = (error) => {
      if (error.code === 'not_school_staff') {
        return replace(status, refused(async () => {
          await clerk.signOut();
          navigate(here, { replace: true });
        }));
      }
      exchanged = false;
      replace(status, failure(error, () => exchange().catch(onError)));
    };
    if (clerk.session) return exchange().catch(onError);
    const back = `${location.origin}${here}${next ? `?next=${encodeURIComponent(next)}` : ''}`;
    clerk.mountSignIn(mount, { forceRedirectUrl: back, signUpForceRedirectUrl: back, withSignUp: true });
    const stop = clerk.addListener(() => exchange().catch(onError));
    ctx.onLeave(() => {
      stop?.();
      clerk.unmountSignIn(mount);
    });
  } catch (error) {
    replace(status, failure(error, () => navigate(location.pathname + location.search, { replace: true })));
  }
}

async function signInPage(ctx, portal) {
  const office = portal === 'school';
  const key = `vv.next.${portal}`;
  const next = safeNext(ctx.query.get('next')) || safeNext(sessionStorage.getItem(key));
  if (next) sessionStorage.setItem(key, next);
  if (signedIn() && store.me.portal === portal) return afterSignIn(next);
  ctx.root.classList.add('login');
  add(ctx.root,
    h('div', { class: 'portal' }, icon(office ? 'chalkboard-teacher' : 'users', { size: 32 }),
      h('h1', {}, t(office ? 'school_login_title' : 'family_login_title'))),
    office && h('p', { class: 'muted' }, t('school_login_guide')));
  const body = h('div', { class: 'stack' });
  add(ctx.root, body);
  const inner = { ...ctx, root: body };
  if (store.config.clerk) await clerkLogin(inner, portal, next);
  else if (store.config.otpLogin) add(body, demoPhoneLogin(ctx, portal, next));
  else add(body, notice('warning', [h('p', {}, t('auth_not_configured'))], 'bad'));
  add(ctx.root,
    office && store.config.setupNeeded && button(t('setup_title'), { iconName: 'plus', kind: 'outline block', href: '/setup' }),
    button(t(office ? 'family_login_link' : 'school_login_link'), {
      iconName: office ? 'users' : 'chalkboard-teacher', kind: 'block', href: office ? '/login' : '/school/login',
    }),
    store.config.demoMode && button(t('demo_try'), { iconName: 'house', kind: 'block', href: '/' }));
}

export const login = (ctx) => signInPage(ctx, 'family');
export const schoolLogin = (ctx) => signInPage(ctx, 'school');

export function setup(ctx) {
  if (!store.config.setupNeeded) return navigate(homeFor(), { replace: true });
  add(ctx.root, h('h1', {}, t('setup_title')), guide('chalkboard-teacher', 'setup_help'));
  if (store.config.clerk && !signedIn()) {
    return add(ctx.root, notice('lock', [h('p', {}, t('setup_sign_in_first'))]),
      button(t('sign_in'), { iconName: 'phone', kind: 'primary big block', href: '/school/login?next=/setup' }));
  }
  if (!store.config.clerk && !store.config.otpLogin) {
    return add(ctx.root, notice('warning', [h('p', {}, t('auth_not_configured'))], 'bad'));
  }
  const mode = (value, title, help, checked) =>
    h('label', { class: 'card check' }, h('input', { type: 'radio', name: 'qrMode', value, checked }),
      h('span', {}, h('strong', {}, title), h('br'), h('span', { class: 'muted small' }, help)));
  add(ctx.root, form(async (data) => {
    const result = await post('/setup', data);
    store.config = await api('/config');
    if (result.signedIn) {
      await refreshMe();
      return navigate('/admin', { replace: true });
    }
    navigate('/school/login?next=/admin', { state: { phone: result.phone } });
  },
  field(t('school_name'), h('input', { name: 'schoolName', required: true, autocomplete: 'organization', lang: language() })),
  field(t('your_name'), h('input', { name: 'adminName', required: true, autocomplete: 'name', value: store.me.user?.name || '' })),
  !store.config.clerk && field(t('phone_label'), h('input', { name: 'phone', type: 'tel', inputmode: 'tel', required: true })),
  field(t('default_language'), languageSelect('defaultLang', language())),
  h('fieldset', { class: 'stack plain' }, h('legend', {}, h('strong', {}, t('qr_mode'))),
    mode('per_student', t('qr_per_student'), t('qr_per_student_help'), true),
    mode('per_school', t('qr_per_school'), t('qr_per_school_help'), false)),
  button(t('setup_create'), { iconName: 'check', kind: 'primary big block', type: 'submit' })));
}
