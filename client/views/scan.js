// S4 scanner, the pick-from-list fallback, and what a scanned sticker leads to (J5, J9).
import { h, add, icon, replace } from '../lib/dom.js';
import { api, post, ApiError } from '../lib/api.js';
import { t, language, languageOf, childCount } from '../lib/i18n.js';
import { speak, stopSpeaking } from '../lib/speak.js';
import { startScanner } from '../lib/qr-scan.js';
import { store, signedIn, navigate, setRole, currentRole, refreshMe, membershipFor } from '../lib/state.js';
import {
  guide, button, sheet, avatar, skeletons, showError, speakButton, notice, empty, failure, languageTiles, segmented,
} from '../lib/ui.js';
import { chooseLanguage } from '../app-language.js';
import { simulateScan } from './home.js';
import { consentCard } from './consent.js';
import { PARENT_PATH } from './register.js';

const nameRow = (name, detail, onPick) =>
  h('div', { class: 'row' },
    h('button', { type: 'button', class: 'item grow', onclick: onPick }, avatar(name),
      h('span', { class: 'grow' }, h('strong', {}, name), detail && h('span', { class: 'muted small' }, detail))),
    speakButton(name, language()));

/** "Can't scan? Pick from list", with names read aloud. */
export function pickFromList() {
  sheet(t('pick_from_list'), (close) => {
    const box = h('div', { class: 'stack' });
    const go = (path) => {
      close();
      navigate(path);
    };
    const teacher = membershipFor('teacher');
    if (!signedIn()) {
      add(box, h('p', {}, t('login_to_continue')), button(t('sign_in'), { kind: 'primary block', onClick: () => go('/login?next=/scan') }));
    } else if (teacher && currentRole() !== 'parent') {
      const showStudents = async (cls) => {
        replace(box, skeletons(3));
        const { students } = await api(`/classes/${cls.id}/students`);
        replace(box,
          button(t('note_whole_class'), { iconName: 'users-three', kind: 'primary block', onClick: () => go(`/t/record?class=${cls.id}`) }),
          h('div', { class: 'list' }, students.map((s) => nameRow(s.name, s.rollNo && `${t('roll_no')} ${s.rollNo}`, () => go(`/t/record?class=${cls.id}&student=${s.id}`)))));
      };
      replace(box, skeletons(2));
      api(`/classes?school=${teacher.schoolId}`).then(({ classes }) => {
        const mine = classes.filter((c) => c.teaches);
        replace(box, h('div', { class: 'grid' }, mine.map((c) =>
          h('button', { type: 'button', class: 'tile', onclick: () => showStudents(c).catch(showError) },
            h('span', { class: 'name' }, `${c.name}${c.section}`), h('span', { class: 'muted small' }, childCount(c.students))))));
      }).catch(showError);
    } else {
      const children = store.me.children.filter((c) => c.status === 'active');
      add(box, children.length
        ? h('div', { class: 'list' }, children.map((c) => nameRow(c.name, `${t('class')} ${c.className}`, () => go(`/p?child=${c.studentId}`))))
        : h('p', {}, t('no_children')));
    }
    return box;
  });
}

export async function scan(ctx) {
  const video = h('video', { 'aria-label': t('camera_view') });
  const torch = h('button', { type: 'button', class: 'iconbtn soft torch', 'aria-label': t('torch'), hidden: true }, icon('flashlight'));
  const status = h('div', { class: 'stack', 'aria-live': 'polite' });
  add(ctx.root,
    guide('qr-code', 'scan_guide'),
    h('div', { class: 'scanner' }, video, h('div', { class: 'frame' }), torch),
    status,
    h('div', { class: 'actions' },
      button(t('cant_scan'), { iconName: 'list-bullets', kind: 'outline big block', onClick: pickFromList }),
      store.config.demoMode && button(t('demo_simulate'), { iconName: 'hand-tap', kind: 'block', onClick: simulateScan })));

  const notFound = (reason) => {
    replace(status, notice('warning', [h('strong', {}, t(reason)), h('span', {}, t('scan_try_again'))], 'warn'));
    speak(t(reason), languageOf(reason));
  };
  const timeout = setTimeout(() => notFound('qr_not_found'), 10_000);
  ctx.onLeave(() => clearTimeout(timeout));

  try {
    let warned = 0;
    const skip = JSON.parse(sessionStorage.getItem('vv.skip') || 'null');
    const scanner = await startScanner(video, {
      ignore: (path) => skip?.path === path && Date.now() < skip.until,
      onCode: (path) => {
        clearTimeout(timeout);
        sessionStorage.setItem('vv.lastScan', path);
        navigate(path, { state: { fromScanner: true } });
      },
      onOther: () => {
        if (Date.now() - warned > 5000) {
          warned = Date.now();
          notFound('qr_not_ours');
        }
      },
    });
    if (!ctx.alive()) return scanner.stop();
    ctx.onLeave(() => scanner.stop());
    if (scanner.torchAvailable) {
      torch.hidden = false;
      torch.addEventListener('click', () => scanner.toggleTorch().catch(showError));
    }
  } catch (error) {
    clearTimeout(timeout);
    const blocked = error?.name === 'NotAllowedError';
    replace(status, notice('camera', [
      h('strong', {}, t(blocked ? 'camera_blocked' : 'camera_missing')),
      button(t('help_title'), { kind: 'outline small', href: '/help' }),
    ], 'bad'));
  }
}

function qrError(ctx, error) {
  const inactive = error.code === 'qr_inactive';
  const text = t(inactive ? 'qr_inactive' : 'qr_not_found');
  stopSpeaking();
  add(ctx.root, empty('qr-code', inactive ? 'qr_inactive' : 'qr_not_found',
    h('div', { class: 'actions' },
      button(t('cant_scan'), { iconName: 'list-bullets', kind: 'primary block', onClick: pickFromList }),
      button(t('scan_qr'), { iconName: 'qr-code', kind: 'outline block', href: '/scan' }))));
  speak(text, language());
}

/** A new parent: welcome read aloud, language tiles, then sign-in (J5). */
function welcome(ctx, path, schoolName) {
  // Someone who came through "I am a parent" has chosen a language already.
  const chosen = sessionStorage.getItem(PARENT_PATH) === '1';
  const key = chosen ? 'parent_signin_guide' : 'welcome_pick_language';
  add(ctx.root,
    h('div', { class: 'page-head' }, h('h1', {}, t('welcome_title')), schoolName && h('p', { class: 'muted' }, schoolName)),
    guide(chosen ? 'phone' : 'translate', key),
    !chosen && languageTiles(language(), (code) => chooseLanguage(code)),
    h('div', { class: 'sticky-actions' },
      button(t('continue'), { iconName: 'arrow-right', kind: 'primary big block', onClick: () => navigate(`/login?next=${encodeURIComponent(path)}`) }),
      chosen && button(t('parent_change_language'), { iconName: 'globe', kind: 'quiet block', href: '/register/parent' })));
  speak(t(key), languageOf(key));
}

function askToLink(ctx, token, student) {
  let relation = 'mother';
  add(ctx.root,
    h('div', { class: 'stage' }, avatar(student.name, true), h('h1', {}, student.name), h('p', { class: 'muted' }, `${t('class')} ${student.className}`)),
    guide('users', 'link_guide', { child: student.name }),
    segmented([['mother', t('mother')], ['father', t('father')], ['other', t('other_relative')]], relation, (v) => { relation = v; }),
    button(t('link_ask'), {
      iconName: 'paper-plane-tilt', kind: 'primary big block',
      onClick: async () => {
        await post('/links/request', { token, relation, readLang: language() });
        await refreshMe();
        navigate(location.pathname, { replace: true });
      },
    }));
}

export async function sticker(ctx) {
  const { token } = ctx.params;
  add(ctx.root, skeletons(3));
  let result;
  try {
    result = await api(`/resolve/s/${token}${currentRole() === 'parent' ? '?as=parent' : ''}`);
  } catch (error) {
    if (!ctx.alive()) return;
    ctx.root.textContent = '';
    if (error instanceof ApiError) return qrError(ctx, error);
    return add(ctx.root, failure(error, () => navigate(location.pathname, { replace: true })), button(t('cant_scan'), { kind: 'outline block', onClick: pickFromList }));
  }
  if (!ctx.alive()) return;
  ctx.root.textContent = '';
  const { access, student } = result;

  if (access === 'login') return welcome(ctx, `/s/${token}`);
  if (access === 'record') {
    setRole('teacher');
    return navigate(`/t/record?class=${student.classId}&student=${student.id}`, { replace: true, state: { autostart: ctx.state.fromScanner } });
  }
  if (access === 'listen') {
    setRole('parent');
    await refreshMe().catch(() => {});
    return navigate(`/p?child=${result.studentId}`, { replace: true, state: { autoplay: true } });
  }
  if (access === 'consent') {
    return add(ctx.root, consentCard({ linkId: result.linkId, child: student.name, onDone: () => navigate(location.pathname, { replace: true }) }));
  }
  if (access === 'pending') {
    add(ctx.root, empty('hourglass', 'link_pending_short'), h('p', { class: 'center' }, t('link_pending', { child: student.name })),
      button(t('check_again'), { iconName: 'arrows-clockwise', kind: 'primary block', onClick: () => navigate(location.pathname, { replace: true }) }));
    speak(t('link_pending', { child: student.name }), languageOf('link_pending'));
    // The screen updates by itself once the teacher approves.
    const timer = setInterval(async () => {
      const next = await api(`/resolve/s/${token}?as=parent`).catch(() => null);
      if (next && next.access !== 'pending' && ctx.alive()) navigate(location.pathname, { replace: true });
    }, 5000);
    return ctx.onLeave(() => clearInterval(timer));
  }
  if (access === 'rejected') return add(ctx.root, empty('lock', 'link_rejected'));
  if (access === 'manage') {
    const office = store.me.portal === 'school';
    return add(ctx.root, empty('chalkboard-teacher', 'admin_cannot_record', office
      ? button(t('open_class'), { kind: 'primary block', href: `/t/class/${student.classId}` })
      : button(t('school_signin'), { kind: 'primary block', href: `/school/login?next=/t/class/${student.classId}` })));
  }
  askToLink(ctx, token, student);
}

export async function schoolSticker(ctx) {
  const { token } = ctx.params;
  let result;
  try {
    result = await api(`/resolve/k/${token}`);
  } catch (error) {
    if (error instanceof ApiError) return qrError(ctx, error);
    return add(ctx.root, failure(error));
  }
  const { access } = result;
  if (access === 'login') return welcome(ctx, `/k/${token}`, result.school.name);
  if (access === 'record') {
    setRole('teacher');
    navigate('/t', { replace: true });
    return setTimeout(pickFromList, 100);
  }
  if (access === 'listen') {
    setRole('parent');
    await refreshMe().catch(() => {});
    return navigate('/p', { replace: true });
  }
  if (access === 'manage') return navigate(store.me.portal === 'school' ? '/admin' : '/school/login', { replace: true });
  add(ctx.root, empty('users', 'school_unlinked'), button(t('scan_qr'), { iconName: 'qr-code', kind: 'primary block', href: '/scan' }));
}
