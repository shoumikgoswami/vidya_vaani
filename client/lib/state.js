// Who is signed in, which role they are acting in, and moving between screens.
import { api, post } from './api.js';

export const store = { config: null, me: { user: null } };

export async function refreshMe() {
  store.me = await api('/me');
  return store.me;
}

export const signedIn = () => Boolean(store.me?.user);

export function roles() {
  const me = store.me;
  if (!me?.user) return [];
  const list = [];
  if (me.memberships.some((m) => m.role === 'teacher')) list.push('teacher');
  if (me.children.length) list.push('parent');
  if (me.memberships.some((m) => m.role === 'admin')) list.push('admin');
  return list;
}

export function currentRole() {
  const available = roles();
  const saved = localStorage.getItem('vv.role');
  return available.includes(saved) ? saved : available[0] || null;
}

export const setRole = (role) => localStorage.setItem('vv.role', role);

export const homeFor = (role = currentRole()) => ({ teacher: '/t', parent: '/p', admin: '/admin' })[role] || (signedIn() ? '/p' : '/');

export const membershipFor = (role) => store.me?.memberships?.find((m) => m.role === role) || null;

export function adminSchoolId() {
  const mine = store.me?.memberships?.filter((m) => m.role === 'admin') || [];
  const saved = Number(localStorage.getItem('vv.school'));
  return (mine.find((m) => m.schoolId === saved) || mine[0])?.schoolId || null;
}

export const speakLanguage = () => membershipFor('teacher')?.speakLang || store.me?.user?.uiLang || 'hi';

export function navigate(path, { replace = false, state = {} } = {}) {
  window.dispatchEvent(new CustomEvent('navigate', { detail: { path, replace, state } }));
}

/* ---------- Clerk, loaded only when the server has keys ---------- */

let clerkLoading = null;

function script(src, attributes = {}) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.crossOrigin = 'anonymous';
    for (const [k, v] of Object.entries(attributes)) el.setAttribute(k, v);
    el.onload = resolve;
    el.onerror = () => reject(new Error('offline'));
    document.head.append(el);
  });
}

export function loadClerk() {
  const { clerk } = store.config;
  if (!clerk) return Promise.resolve(null);
  clerkLoading ||= (async () => {
    const base = `https://${clerk.frontendApi}/npm/@clerk`;
    await script(`${base}/ui@1/dist/ui.browser.js`);
    await script(`${base}/clerk-js@6/dist/clerk.browser.js`, { 'data-clerk-publishable-key': clerk.publishableKey });
    await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
    return window.Clerk;
  })().catch((error) => {
    clerkLoading = null;
    throw error;
  });
  return clerkLoading;
}

export async function logout() {
  try {
    const clerk = await loadClerk();
    await clerk?.signOut();
  } catch {
    // Signing out of our own session still happens.
  }
  await post('/auth/logout');
  // Cached pages belong to the person who just left a shared phone.
  await window.caches?.delete('vv-data');
  localStorage.removeItem('vv.role');
  await refreshMe();
}
