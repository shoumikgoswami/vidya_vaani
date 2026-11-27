// S1 home, S16 mic and camera help, and the demo shortcuts.
import { h, add, icon } from '../lib/dom.js';
import { api, post } from '../lib/api.js';
import { t, languageOf } from '../lib/i18n.js';
import { store, signedIn, navigate, homeFor, refreshMe, setRole } from '../lib/state.js';
import { installCard } from '../lib/install.js';
import { guide, button, sheet, avatar, skeletons, showError, speakButton, toast } from '../lib/ui.js';

const roleLabel = (p) => (p.role === 'parent' ? t('parent_of', { child: p.child.split(' ')[0] }) : t(`role_${p.role}`));

export async function actAs(persona) {
  await post('/demo/login', { userId: persona.userId });
  await window.caches?.delete('vv-data');
  setRole(persona.role);
  await refreshMe();
  navigate(homeFor(persona.role), { state: { switched: true } });
}

function personaList(after) {
  const box = h('div', { class: 'stack' }, skeletons(3));
  api('/demo/personas').then(({ personas }) => {
    box.textContent = '';
    const row = (p) => h('button', {
      type: 'button', class: 'item',
      onclick: () => actAs(p).then(after).catch(showError),
    }, avatar(p.name), h('span', { class: 'grow' }, h('strong', {}, p.name), h('span', { class: 'muted small' }, roleLabel(p))),
    icon('caret-right', { flip: true }));
    for (const [key, group] of [['family_signin', personas.filter((p) => p.role !== 'admin')], ['school_signin', personas.filter((p) => p.role === 'admin')]]) {
      add(box, h('h3', {}, t(key)), h('div', { class: 'list' }, group.map(row)));
    }
  }).catch((error) => {
    box.textContent = '';
    showError(error);
  });
  return box;
}

export function simulateScan() {
  sheet(t('demo_simulate'), (close) => {
    const grid = h('div', { class: 'grid' }, skeletons(2));
    api('/demo/students').then(({ students }) => {
      grid.textContent = '';
      add(grid, students.map((s) =>
        h('button', {
          type: 'button', class: 'tile',
          onclick: () => {
            close();
            navigate(`/s/${s.token}`, { state: { fromScanner: true } });
          },
        }, icon('qr-code', { size: 40 }), h('strong', {}, s.name), h('span', { class: 'muted small' }, `${t('class')} ${s.className}`))));
    }).catch(showError);
    return [h('p', {}, t('demo_simulate_help')), grid];
  });
}

export function demoSheet() {
  sheet(t('demo_title'), (close) => [
    h('p', { class: 'chip' }, icon(store.config.ai.nvidia ? 'check-circle' : 'info', { size: 20 }),
      store.config.ai.nvidia ? t('ai_on') : t('ai_off')),
    h('h3', {}, t('demo_act_as')),
    personaList(close),
    button(t('demo_simulate'), { iconName: 'qr-code', kind: 'outline block', onClick: () => { close(); simulateScan(); } }),
    button(t('demo_reset'), {
      iconName: 'arrows-clockwise', kind: 'outline block',
      onClick: async () => {
        await post('/demo/reset');
        await window.caches?.delete('vv-data');
        await refreshMe();
        close();
        toast(t('demo_reset_done'));
        navigate('/', { replace: true });
      },
    }),
  ]);
}

const doorway = (href, glyph, title, detail) =>
  h('a', { class: 'item doorway', href }, h('span', { class: 'avatar' }, icon(glyph, { size: 28 })),
    h('span', { class: 'grow' }, h('strong', {}, t(title)), h('span', { class: 'muted small' }, t(detail))),
    icon('caret-right', { flip: true }));

export async function home(ctx) {
  if (signedIn()) return navigate(homeFor(), { replace: true });
  const { demoMode, setupNeeded } = store.config;
  // A fresh install that is not a demo goes straight to the first-run wizard.
  if (setupNeeded && !demoMode) return navigate('/setup', { replace: true });

  add(ctx.root,
    h('div', { class: 'welcome' }, h('h1', {}, t('app_tagline')), h('p', { class: 'muted' }, t('app_subtitle'))),
    guide('hand-tap', 'home_guide'),
    h('div', { class: 'actions' },
      button(t('scan_qr'), { iconName: 'qr-code', kind: 'primary big block', href: '/scan' })),
    h('section', { class: 'stack', 'aria-labelledby': 'signin-title' },
      h('h2', { id: 'signin-title' }, t('sign_in')),
      doorway('/login', 'users', 'family_signin', 'family_signin_detail'),
      doorway('/school/login', 'chalkboard-teacher', 'school_signin', 'school_signin_detail')),
    installCard({ onLeave: ctx.onLeave }),
    demoMode && h('section', { class: 'stack', 'aria-labelledby': 'demo-title' },
      h('div', { class: 'row' }, h('h2', { class: 'grow', id: 'demo-title' }, t('demo_try')), speakButton(t('demo_try_help'), languageOf('demo_try_help'))),
      h('p', { class: 'muted' }, t('demo_try_help')),
      personaList(),
      button(t('demo_simulate'), { iconName: 'qr-code', kind: 'outline block', onClick: simulateScan })),
    setupNeeded && h('div', { class: 'card' }, h('h2', {}, t('setup_title')), h('p', {}, t('setup_help')),
      button(t('setup_start'), { iconName: 'chalkboard-teacher', kind: 'outline block', href: '/setup' })),
    button(t('help_title'), { iconName: 'info', kind: 'block', href: '/help' }));
}

const BROWSERS = [
  ['help_chrome', ['lock', 'help_tap_lock'], ['gear', 'help_open_permissions']],
  ['help_samsung', ['list', 'help_tap_menu'], ['gear', 'help_site_permissions']],
  ['help_desktop', ['lock', 'help_tap_lock'], ['gear', 'help_open_permissions']],
  ['help_safari', ['text-aa', 'help_tap_aa'], ['gear', 'help_website_settings']],
];

export function help(ctx) {
  add(ctx.root,
    h('h1', {}, t('help_title')),
    guide('info', 'help_intro'),
    BROWSERS.map(([name, ...steps], index) =>
      h('details', { class: 'card', open: index === 0 },
        h('summary', {}, h('strong', {}, t(name))),
        h('ol', { class: 'list' }, [...steps, ['microphone', 'help_allow_mic'], ['camera', 'help_allow_camera'], ['arrows-clockwise', 'help_reload']]
          .map(([glyph, key]) => h('li', { class: 'guide' }, icon(glyph), h('p', {}, t(key)), speakButton(t(key), languageOf(key))))))),
    button(t('back_home'), { iconName: 'house', kind: 'primary block', onClick: () => navigate(homeFor()) }));
}
