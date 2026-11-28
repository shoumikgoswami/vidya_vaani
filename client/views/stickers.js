// S15: sticker sheets for one class or the whole school, and the school's single QR poster.
// The pages on screen are the pages that print.
import { h, add, replace } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { t } from '../lib/i18n.js';
import { adminSchoolId, navigate } from '../lib/state.js';
import { guide, button, skeletons, failure, empty, segmented, notice, reveal } from '../lib/ui.js';

const LAYOUTS = [8, 12, 24];
/** The printed page, 194mm wide, in screen pixels. */
const PAGE_PX = (194 / 25.4) * 96;

export const qrImage = (svg, alt) =>
  h('img', { class: 'code', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt });

const mast = () => h('span', { class: 'mast' }, h('img', { src: '/img/icon.svg', alt: '' }), 'Vidya Vaani');

const sticker = (student, sheet) =>
  h('div', { class: 'sticker' },
    mast(),
    qrImage(student.svg, t('qr_of', { name: student.name })),
    h('b', { dir: 'auto' }, student.name),
    h('span', { class: 'meta' }, [`${t('class')} ${sheet.className}`, student.rollNo && `${t('roll_no')} ${student.rollNo}`].filter(Boolean).join(' · ')),
    h('span', { class: 'meta school', dir: 'auto' }, sheet.school.name),
    h('span', { class: 'how' }, t('app_tagline')));

export const schoolPoster = (data) =>
  h('div', { class: 'poster' }, mast(), h('h1', { dir: 'auto' }, data.school.name), qrImage(data.svg, t('school_qr')),
    h('p', { class: 'how' }, t('app_tagline')), h('p', {}, t('poster_line')));

/** Waits for fonts and codes, and names the saved PDF after what is on it. */
async function print(title) {
  await document.fonts?.ready;
  await Promise.all([...document.querySelectorAll('main img')].map((img) => img.decode().catch(() => {})));
  const usual = document.title;
  document.title = title;
  window.addEventListener('afterprint', () => { document.title = usual; }, { once: true });
  window.print();
}

const printButton = (title) =>
  button(t('print_or_pdf'), { iconName: 'printer', kind: 'primary big block', onClick: () => print(title()) });

/** Shrinks the A4 preview to the width of the screen. Printing ignores this. */
function fitPages(ctx, holder) {
  const fit = () => holder.style.setProperty('--zoom', Math.min(1, holder.clientWidth / PAGE_PX).toFixed(3));
  const watcher = new ResizeObserver(fit);
  watcher.observe(holder);
  ctx.onLeave(() => watcher.disconnect());
}

/** `sheets` is one entry per class; each class starts on a new page. */
function sheetControls(ctx, box, sheets, title, extras) {
  let perPage = Number(sessionStorage.getItem('vv.perPage')) || 12;
  if (!LAYOUTS.includes(perPage)) perPage = 12;
  const pages = h('div', { class: 'sheets' });
  const summary = h('p', { class: 'muted center', role: 'status' });
  let shown = sheets;

  function draw() {
    const built = [];
    for (const sheet of shown) {
      for (let i = 0; i < sheet.students.length; i += perPage) {
        built.push(h('div', { class: `sheet-page per-${perPage}` }, sheet.students.slice(i, i + perPage).map((s) => sticker(s, sheet))));
      }
    }
    const count = shown.reduce((sum, sheet) => sum + sheet.students.length, 0);
    summary.textContent = t('stickers_summary', { n: count, pages: built.length });
    replace(pages, built.length ? built : empty('student', 'class_empty'));
  }

  const picker = sheets.length > 1 && h('div', { class: 'chips', role: 'group', 'aria-label': t('classes') });
  const pick = (chosen) => {
    shown = chosen ? [chosen] : sheets;
    replace(picker, [null, ...sheets].map((sheet) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(sheet === chosen), onclick: () => pick(sheet),
    }, sheet ? `${t('class')} ${sheet.className}` : t('all_classes'))));
    draw();
  };

  add(box,
    h('div', { class: 'no-print stack sheet-tools' },
      extras,
      guide('printer', 'print_guide'),
      picker,
      segmented(LAYOUTS.map((n) => [n, t('per_page', { n })]), perPage, (n) => {
        perPage = n;
        sessionStorage.setItem('vv.perPage', n);
        draw();
      }),
      printButton(() => title(shown)),
      h('p', { class: 'muted small center' }, t('print_scale')),
      summary),
    pages);
  if (picker) pick(null);
  else draw();
  fitPages(ctx, pages);
}

async function load(ctx, work) {
  const holder = h('div', { class: 'view' }, skeletons(2, true));
  add(ctx.root, holder);
  try {
    const draw = await work();
    if (!ctx.alive()) return;
    holder.textContent = '';
    reveal(holder);
    draw(holder);
  } catch (error) {
    if (ctx.alive()) replace(holder, failure(error, () => navigate(location.pathname, { replace: true })));
  }
}

const fileName = (...parts) => ['Vidya Vaani', ...parts].join(' - ');

export function classStickers(ctx) {
  const id = Number(ctx.params.id);
  return load(ctx, async () => {
    const sheet = await api(`/classes/${id}/stickers`);
    return (box) => {
      add(box, h('h1', { class: 'no-print center' }, `${t('print_stickers')} ${sheet.className}`));
      sheetControls(ctx, box, [sheet], () => fileName(sheet.school.name, sheet.className),
        sheet.school.qrMode === 'per_school' && notice('qr-code', [
          h('p', {}, t('stickers_school_mode')),
          adminSchoolId() === sheet.school.id && button(t('school_qr'), { kind: 'outline small', href: '/admin/school-qr' }),
        ]));
    };
  });
}

export function allStickers(ctx) {
  add(ctx.root, h('h1', { class: 'no-print center' }, t('stickers_all')));
  return load(ctx, async () => {
    const { classes } = await api(`/classes?school=${adminSchoolId()}`);
    const sheets = await Promise.all(classes.filter((c) => c.students > 0).map((c) => api(`/classes/${c.id}/stickers`)));
    return (box) => {
      if (!sheets.length) return add(box, empty('student', 'no_classes_yet'));
      sheetControls(ctx, box, sheets, (shown) => fileName(sheets[0].school.name, shown.map((s) => s.className).join(' ')), null);
    };
  });
}

export function schoolQr(ctx) {
  return load(ctx, async () => {
    const data = await api(`/school-qr?school=${adminSchoolId()}`);
    return (box) => add(box,
      h('div', { class: 'no-print stack' }, h('h1', {}, t('school_qr')), guide('printer', 'print_guide'),
        printButton(() => fileName(data.school.name, t('school_qr')))),
      schoolPoster(data));
  });
}
