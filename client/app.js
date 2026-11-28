// Boot, the router and the shell: demo banner, top bar and bottom tabs.
import { h, icon, replace } from './lib/dom.js';
import { api } from './lib/api.js';
import { t, setLanguage, initialLanguage, language } from './lib/i18n.js';
import { store, signedIn, refreshMe, currentRole, homeFor, navigate, roles, setRole, atSchoolOffice } from './lib/state.js';
import { stopSpeaking } from './lib/speak.js';
import * as outbox from './lib/outbox.js';
import { skeletons, failure, languageSheet, nativeName, toast } from './lib/ui.js';
import { chooseLanguage, followAccountLanguage } from './app-language.js';
import { standalone } from './lib/install.js';
import { home, demo, help, demoSheet } from './views/home.js';
import { landing } from './views/landing.js';
import { registerSchool } from './views/register.js';
import { ownerRequests } from './views/owner.js';
import { login, schoolLogin, setup } from './views/auth.js';
import { scan, sticker, schoolSticker } from './views/scan.js';
import { record } from './views/record.js';
import { confirm } from './views/confirm.js';
import { teacherHome, classView, addStudents, inbox } from './views/teacher.js';
import { classStickers, allStickers, schoolQr } from './views/stickers.js';
import { noteView } from './views/note.js';
import { diary } from './views/parent.js';
import { account } from './views/account.js';
import { school, people, promote, reports } from './views/admin.js';
import { configuration } from './views/config.js';

// [pattern, view, options]
const ROUTES = [
  ['/', home],
  ['/demo', demo, { title: 'demo_try' }],
  ['/register', registerSchool, { title: 'register_title' }],
  ['/owner', ownerRequests, { auth: true, title: 'school_requests' }],
  ['/login', login],
  ['/school/login', schoolLogin],
  ['/setup', setup],
  ['/help', help],
  ['/scan', scan, { title: 'scan_qr' }],
  ['/s/:token', sticker],
  ['/k/:token', schoolSticker],
  ['/me', account, { auth: true, title: 'me' }],
  ['/t', teacherHome, { auth: true, role: 'teacher', wide: true }],
  ['/t/record', record, { auth: true }],
  ['/t/confirm/:id', confirm, { auth: true }],
  ['/t/class/:id', classView, { auth: true, wide: true }],
  ['/t/class/:id/add', addStudents, { auth: true }],
  ['/t/stickers/:id', classStickers, { auth: true, wide: true }],
  ['/t/inbox', inbox, { auth: true, role: 'teacher' }],
  ['/t/note/:id', noteView, { auth: true }],
  // No role needed: this is also where a brand-new account lands, with nothing linked yet.
  ['/p', diary, { auth: true }],
  ['/p/note/:id', noteView, { auth: true, role: 'parent' }],
  ['/admin', school, { auth: true, role: 'admin', wide: true }],
  ['/admin/people', people, { auth: true, role: 'admin', wide: true }],
  ['/admin/promote/:id', promote, { auth: true, role: 'admin' }],
  ['/admin/reports', reports, { auth: true, role: 'admin', wide: true }],
  ['/admin/school-qr', schoolQr, { auth: true, role: 'admin' }],
  ['/admin/stickers', allStickers, { auth: true, role: 'admin', wide: true }],
  ['/admin/config', configuration, { auth: true, role: 'admin', wide: true }],
].map(([pattern, view, options = {}]) => ({
  view,
  options,
  regex: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}/?$`),
}));

/** A visitor in a browser meets the landing page, which brings its own header and footer. */
const LANDING = { view: landing, options: { bare: true }, regex: /^\/$/ };
const visiting = () => !signedIn() && !standalone() && !(store.config.setupNeeded && !store.config.demoMode);

const TABS = {
  teacher: [['/t', 'users-three', 'tab_classes'], ['/scan', 'qr-code', 'tab_scan'], ['/t/inbox', 'chat-circle', 'tab_replies']],
  parent: [['/p', 'book-open', 'tab_diary'], ['/scan', 'qr-code', 'tab_scan'], ['/me', 'user', 'me']],
  admin: [['/admin', 'gear', 'tab_school'], ['/admin/people', 'users-three', 'tab_people'], ['/admin/reports', 'chart-bar', 'reports']],
};
const TAB_ROOTS = new Set(['/', '/t', '/p', '/admin', '/admin/people', '/admin/reports', '/t/inbox']);

const $ = (id) => document.getElementById(id);
let cleanups = [];
let navigation = 0;
let depth = 0;
let bare = false;

function drawBanner() {
  if (bare) return replace($('banner'));
  const parts = [];
  if (!navigator.onLine) parts.push(h('div', { class: 'banner offline' }, icon('wifi-slash', { size: 20 }), t('offline_banner')));
  if (store.config?.demoMode && (location.pathname === '/demo' || store.me.user?.isDemo)) {
    parts.push(h('div', { class: 'banner' },
      h('span', {}, t('demo_banner')),
      h('button', { type: 'button', onclick: demoSheet }, t('demo_switch'))));
  }
  replace($('banner'), parts);
}

function drawTopbar(route) {
  const path = location.pathname;
  const root = TAB_ROOTS.has(path);
  const back = h('button', {
    type: 'button', class: 'iconbtn', 'aria-label': t('back'),
    onclick: () => (depth > 0 ? history.back() : navigate(homeFor())),
  }, icon('arrow-left', { flip: true }));
  const brand = h('a', { class: 'brand', href: signedIn() ? homeFor() : '/' },
    h('img', { src: '/img/icon.svg', alt: '', width: 34, height: 34 }),
    h('span', {}, 'Vidya Vaani', atSchoolOffice() && h('small', {}, t('school_signin'))));
  replace($('topbar'), h('div', { class: 'bar' },
    root ? brand : [back, h('span', { class: 'bar-title' }, route?.options.title ? t(route.options.title) : '')],
    h('button', { type: 'button', class: 'langbtn', 'aria-label': t('preferred_language'), onclick: () => languageSheet(t('preferred_language'), language(), chooseLanguage) },
      icon('globe', { size: 20 }), h('span', {}, nativeName(language()))),
    signedIn() && h('a', { class: 'iconbtn', href: '/me', 'aria-label': t('me') }, icon('user'))));
}

let inboxCount = 0;
function drawTabs() {
  const path = location.pathname;
  const area = path.startsWith('/admin') ? 'admin' : path.startsWith('/t') ? 'teacher' : path.startsWith('/p') ? 'parent' : currentRole();
  const hidden = !signedIn() || !area || !roles().includes(area) || /^\/(t\/record|t\/confirm|s\/|k\/|login|school\/|setup)/.test(path);
  if (hidden) return replace($('tabs'));
  replace($('tabs'), h('div', { class: 'tabs-inner' }, TABS[area].map(([href, glyph, key]) =>
    h('a', { class: 'tab', href, 'aria-current': path === href ? 'page' : undefined, onclick: () => setRole(area) },
      h('span', { class: 'pip' }, icon(glyph, { weight: path === href ? 'fill' : 'bold' })), t(key),
      href === '/t/inbox' && inboxCount > 0 && h('span', { class: 'badge' }, inboxCount)))));
}

async function refreshInboxCount() {
  if (currentRole() !== 'teacher') return;
  const data = await api('/inbox').catch(() => null);
  if (!data) return;
  const next = data.replies.filter((r) => !r.heard).length;
  if (next !== inboxCount) {
    inboxCount = next;
    drawTabs();
  }
}

async function render(state = {}) {
  const mine = (navigation += 1);
  for (const cleanup of cleanups.splice(0)) {
    try {
      cleanup();
    } catch (error) {
      console.warn(error);
    }
  }
  stopSpeaking();
  document.querySelectorAll('dialog.sheet').forEach((d) => d.close());

  const path = location.pathname;
  const route = path === '/' && visiting() ? LANDING : ROUTES.find((r) => r.regex.test(path));
  const main = $('main');

  if (!route) return navigate(homeFor(), { replace: true });
  const office = route.options.role === 'admin';
  if (route.options.auth && (!signedIn() || (office && !atSchoolOffice()))) {
    return navigate(`${office ? '/school/login' : '/login'}?next=${encodeURIComponent(path + location.search)}`, { replace: true });
  }
  if (route.options.role) {
    if (!roles().includes(route.options.role)) return navigate(signedIn() ? homeFor() : '/', { replace: true });
    setRole(route.options.role);
  }

  const root = h('div', { class: 'view' });
  const ctx = {
    root,
    params: route.regex.exec(path).groups || {},
    query: new URLSearchParams(location.search),
    state,
    alive: () => mine === navigation,
    onLeave: (fn) => (mine === navigation ? cleanups.push(fn) : fn()),
  };
  const failed = (error) => {
    console.error(error);
    if (ctx.alive()) replace(root, failure(error, () => render(state)));
  };
  let shown;
  await transition(path, () => {
    if (!ctx.alive()) return;
    bare = Boolean(route.options.bare);
    main.classList.toggle('wide', Boolean(route.options.wide));
    main.classList.toggle('full', bare);
    drawBanner();
    if (bare) {
      replace($('topbar'));
      replace($('tabs'));
    } else {
      drawTopbar(route);
      drawTabs();
    }
    replace(main, root);
    window.scrollTo(0, 0);
    // The view starts here but is not waited for: the screen change must not hang on the network.
    shown = Promise.resolve().then(() => route.view(ctx)).catch(failed);
  });
  await shown;
  if (ctx.alive()) refreshInboxCount();
}

/** Slides between screens where the browser can. The same screen redrawing itself stays still. */
let lastPath = null;
async function transition(path, update) {
  // The first screen replaces the splash without ceremony.
  const same = lastPath === null || path === lastPath;
  lastPath = path;
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (same || calm || !document.startViewTransition || document.hidden) return update();
  const change = document.startViewTransition(update);
  // A newer screen change cancels this one's animation, which is not an error.
  change.ready.catch(() => {});
  change.finished.catch(() => {});
  await change.updateCallbackDone.catch((error) => console.warn(error));
}

window.addEventListener('navigate', (event) => {
  const { path, replace: swap, state } = event.detail;
  document.documentElement.dataset.nav = 'forward';
  if (swap) history.replaceState(state, '', path);
  else {
    history.pushState(state, '', path);
    depth += 1;
  }
  render(state);
});

window.addEventListener('popstate', (event) => {
  depth = Math.max(0, depth - 1);
  document.documentElement.dataset.nav = 'back';
  render(event.state?.autostart ? {} : event.state || {});
});

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || link.target) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.hash) return;
  event.preventDefault();
  navigate(url.pathname + url.search);
});

async function syncOutbox() {
  if (!signedIn()) return;
  const sent = await outbox.flush(store.me.user.id).catch(() => 0);
  if (sent) toast(t('uploads_sent', { n: sent }));
}

window.addEventListener('online', () => {
  drawBanner();
  syncOutbox();
});
window.addEventListener('offline', drawBanner);

async function boot() {
  const main = $('main');
  await setLanguage(initialLanguage(), { remember: false });
  replace(main, skeletons(3));
  try {
    store.config = await api('/config');
    await refreshMe();
  } catch (error) {
    return replace(main, failure(error, boot));
  }
  await followAccountLanguage();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('service worker', e));
  await render(history.state || {});
  syncOutbox();
  setInterval(() => {
    syncOutbox();
    refreshInboxCount();
  }, 30_000);
}

boot();
