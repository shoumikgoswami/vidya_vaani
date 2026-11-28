// The site owner's page: schools waiting to join, approved or declined by hand.
import { h, add, replace } from '../lib/dom.js';
import { api, post, del } from '../lib/api.js';
import { t, formatDate } from '../lib/i18n.js';
import { store, navigate, logout } from '../lib/state.js';
import { button, skeletons, failure, notice, empty, toast, confirmSheet, nativeName } from '../lib/ui.js';

const STATUS = { pending: 'pill-warn', approved: 'pill-ok', declined: 'chip' };

function card(request, reload) {
  const who = request.email || request.phone;
  const act = (labelKey, kind, confirmKey, run, doneKey) => button(t(labelKey), {
    kind,
    onClick: async () => {
      const vars = { school: request.schoolName, who };
      if (!(await confirmSheet(t(labelKey), t(confirmKey, vars), t(labelKey), { danger: kind.includes('danger') }))) return;
      await run();
      if (doneKey) toast(t(doneKey, vars));
      await reload();
    },
  });
  const rows = [
    ['your_name', request.contactName],
    ['phone_label', h('a', { href: `tel:${request.phone}`, dir: 'ltr' }, request.phone)],
    request.email && ['email_label', h('a', { href: `mailto:${request.email}`, dir: 'ltr' }, request.email)],
    ['register_town', request.town],
    ['default_language', nativeName(request.lang)],
    ['date', formatDate(request.createdAt)],
  ].filter(Boolean);
  return h('article', { class: 'card' },
    h('div', { class: 'row wrap' }, h('h2', { class: 'grow', dir: 'auto' }, request.schoolName),
      h('span', { class: STATUS[request.status] }, t(`request_${request.status}`))),
    h('dl', { class: 'readback' }, rows.map(([key, value]) => [h('dt', {}, t(key)), h('dd', {}, value)])),
    h('div', { class: 'actions' },
      request.status === 'pending' && act('approve', 'primary block', 'approve_confirm',
        () => post(`/owner/requests/${request.id}/approve`), 'approved_toast'),
      request.status === 'pending' && act('decline', 'outline block', 'decline_confirm',
        () => post(`/owner/requests/${request.id}/decline`)),
      act('delete_request', 'quiet block', 'delete_request_confirm', () => del(`/owner/requests/${request.id}`))));
}

export async function ownerRequests(ctx) {
  add(ctx.root, h('h1', {}, t('school_requests')));
  if (!store.me.owner) {
    return add(ctx.root, notice('lock', [h('p', {}, t('owner_only'))], 'warn'),
      button(t('use_other_account'), {
        kind: 'primary block',
        onClick: async () => {
          await logout();
          navigate('/login?next=/owner');
        },
      }));
  }
  const holder = h('div', { class: 'view' }, skeletons(3));
  add(ctx.root, holder);
  async function load() {
    try {
      const { requests } = await api('/owner/requests');
      if (!ctx.alive()) return;
      replace(holder, requests.length ? requests.map((r) => card(r, load)) : empty('chalkboard-teacher', 'requests_empty'));
    } catch (error) {
      if (ctx.alive()) replace(holder, failure(error, load));
    }
  }
  await load();
}
