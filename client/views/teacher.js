// S7 class dashboard, S8 voice inbox, adding students (J2) and S15 sticker sheets.
import { h, add, icon, replace } from '../lib/dom.js';
import { api, post, patch, del } from '../lib/api.js';
import { t, languageOf, formatDate } from '../lib/i18n.js';
import { voiceCapture } from '../lib/capture.js';
import * as outbox from '../lib/outbox.js';
import { store, navigate, membershipFor, speakLanguage, adminSchoolId } from '../lib/state.js';
import {
  guide, button, sheet, confirmSheet, skeletons, failure, showError, toast, notice, empty, avatar, field, form, segmented,
  tagChip, player,
} from '../lib/ui.js';
import { voiceReply } from './reply.js';
import { words, markListened } from './note.js';
import { speak } from '../lib/speak.js';

const reload = () => navigate(location.pathname + location.search, { replace: true });

async function load(ctx, path, draw) {
  const holder = h('div', { class: 'view' }, skeletons(3));
  add(ctx.root, holder);
  try {
    const data = await api(path);
    if (!ctx.alive()) return;
    holder.textContent = '';
    draw(data, holder);
  } catch (error) {
    if (ctx.alive()) replace(holder, failure(error, reload));
  }
}

const noteRow = (note) =>
  h('li', {}, h('a', { class: 'item', href: note.publishedAt ? `/t/note/${note.id}` : `/t/confirm/${note.id}` },
    icon(note.publishedAt ? 'play' : 'clock', { size: 28 }),
    h('span', { class: 'grow' },
      h('strong', { dir: 'auto' }, note.text ? `${note.text.slice(0, 60)}${note.text.length > 60 ? '…' : ''}` : t('listen_only')),
      h('span', { class: 'muted small' }, [
        note.recipients?.length > 2 ? t('n_students', { n: note.recipients.length }) : note.recipients?.join(', '),
        formatDate(note.createdAt),
        note.publishedAt ? note.heard && t('heard_by', { heard: note.heard.heard, total: note.heard.total }) : t('not_saved_yet'),
      ].filter(Boolean).join(' · '))),
    icon('caret-right', { flip: true })));

export function teacherHome(ctx) {
  const teacher = membershipFor('teacher');
  add(ctx.root,
    guide('qr-code', 'teacher_home_guide'),
    button(t('scan_qr'), { iconName: 'qr-code', kind: 'primary big block', href: '/scan' }));

  const uploads = h('div', {});
  add(ctx.root, uploads);
  outbox.pending().then((entries) => {
    const mine = entries.filter((e) => e.userId === store.me.user.id);
    if (!mine.length) return;
    replace(uploads, notice('upload-simple', [h('p', {}, t('uploads_waiting', { n: mine.length })),
      button(t('send_now'), { kind: 'outline small', onClick: async () => { await outbox.flush(store.me.user.id); reload(); } })], 'warn'));
  });

  const drafts = h('div', {});
  add(ctx.root, drafts);
  api('/drafts').then((data) => {
    if (data.drafts.length) replace(drafts, h('section', { class: 'stack' }, h('h2', {}, t('not_saved_yet')), h('ul', { class: 'list' }, data.drafts.map(noteRow))));
  }).catch(() => {});

  add(ctx.root, h('h2', {}, t('my_classes')));
  return load(ctx, `/classes?school=${teacher.schoolId}`, ({ classes }, box) => {
    const mine = classes.filter((c) => c.teaches);
    if (!mine.length) return add(box, empty('chalkboard-teacher', 'no_classes'));
    add(box, h('ul', { class: 'list' }, mine.map((c) => h('li', {}, h('a', { class: 'item', href: `/t/class/${c.id}` },
      h('span', { class: 'avatar' }, `${c.name}${c.section}`),
      h('span', { class: 'grow' }, h('strong', {}, `${t('class')} ${c.name}${c.section}`),
        h('span', { class: 'muted small' }, `${t('n_students', { n: c.students })} · ${c.academicYear}`)),
      c.pending > 0 && h('span', { class: 'chip warn' }, t('n_requests', { n: c.pending })),
      icon('caret-right', { flip: true }))))));
  });
}

/* ---------- One class ---------- */

function studentSheet(data, student) {
  const classId = data.class.id;
  const perStudent = data.school.qrMode === 'per_student';
  sheet(student.name, (close) => {
    const go = (path) => () => {
      close();
      navigate(path);
    };
    return [
      h('p', { class: 'muted' }, [student.rollNo && `${t('roll_no')} ${student.rollNo}`, student.parentPhone, student.parentEmail,
        t(student.guardians ? 'parent_linked' : 'no_parent_linked')].filter(Boolean).join(' · ')),
      data.class.teaches && button(t('record_note'), { iconName: 'microphone', kind: 'primary big block', onClick: go(`/t/record?class=${classId}&student=${student.id}`) }),
      perStudent && h('img', { class: 'qr-preview', src: `/api/qr/${student.token}.svg`, alt: t('qr_of', { name: student.name }) }),
      button(t('edit_details'), { iconName: 'pencil-simple', kind: 'outline block', onClick: () => { close(); editStudent(student); } }),
      perStudent && button(t('new_qr'), {
        iconName: 'arrows-clockwise', kind: 'outline block',
        onClick: async () => {
          if (!(await confirmSheet(t('new_qr'), t('new_qr_confirm', { name: student.name }), t('new_qr')))) return;
          await post(`/students/${student.id}/rotate-token`);
          close();
          toast(t('new_qr_done'));
          reload();
        },
      }),
      adminSchoolId() === data.school.id && button(t('delete_student'), {
        iconName: 'trash', kind: 'danger block',
        onClick: async () => {
          if (!(await confirmSheet(t('delete_student'), t('delete_student_confirm', { name: student.name }), t('delete_student'), { danger: true }))) return;
          await del(`/students/${student.id}`);
          close();
          reload();
        },
      }),
    ];
  });
}

const studentFields = (value = {}) => [
  field(t('child_name'), h('input', { name: 'name', value: value.name || '', required: true, lang: speakLanguage(), autocomplete: 'off' })),
  field(t('parent_phone'), h('input', { name: 'parentPhone', type: 'tel', inputmode: 'tel', value: value.parentPhone || value.phone || '' })),
  field(t('parent_email'), h('input', { name: 'parentEmail', type: 'email', value: value.parentEmail || value.email || '' }), t('parent_email_help')),
  field(t('roll_optional'), h('input', { name: 'rollNo', inputmode: 'numeric', value: value.rollNo || '' })),
];

function editStudent(student) {
  sheet(t('edit_details'), (close) => form(async (values) => {
    await patch(`/students/${student.id}`, values);
    close();
    reload();
  }, studentFields(student), button(t('save'), { iconName: 'check', kind: 'primary big block', type: 'submit' })));
}

export function classView(ctx) {
  const id = Number(ctx.params.id);
  return load(ctx, `/classes/${id}`, (data, box) => {
    const { class: cls, students, approvals, notes, school } = data;
    const name = `${cls.name}${cls.section}`;
    const decide = (linkId, action) => async () => {
      await post(`/approvals/${linkId}`, { action });
      reload();
    };
    add(box,
      h('div', {}, h('h1', {}, `${t('class')} ${name}`), h('p', { class: 'muted' }, `${t('n_students', { n: students.length })} · ${cls.academicYear}`)),
      cls.teaches && button(t('note_whole_class'), { iconName: 'microphone', kind: 'primary big block', href: `/t/record?class=${id}` }),
      h('div', { class: 'pair' },
        button(t('add_students'), { iconName: 'plus', kind: 'outline', href: `/t/class/${id}/add` }),
        button(t('print_stickers'), { iconName: 'printer', kind: 'outline', href: `/t/stickers/${id}` })),
      approvals.length > 0 && h('section', { class: 'stack' }, h('h2', {}, t('approvals')),
        approvals.map((a) => h('div', { class: 'card' },
          h('p', {}, t('approval_ask', { parent: a.parentName || a.phone || a.email, relation: t(['mother', 'father'].includes(a.relation) ? a.relation : 'other_relative'), child: a.studentName })),
          h('p', { class: 'muted small' }, [a.phone, a.email].filter(Boolean).join(' · ')),
          h('div', { class: 'pair' },
            button(t('approve'), { iconName: 'check', kind: 'primary', onClick: decide(a.linkId, 'approve') }),
            button(t('reject'), { iconName: 'x', kind: 'outline', onClick: decide(a.linkId, 'reject') }))))),
      students.length
        ? h('div', { class: 'grid' }, students.map((s) => h('button', { type: 'button', class: 'tile', onclick: () => studentSheet(data, s) },
          avatar(s.name), h('strong', {}, s.name),
          h('span', { class: 'muted small' }, t(s.guardians ? 'parent_linked' : 'no_parent_linked')))))
        : empty('student', 'class_empty', button(t('add_students'), { kind: 'primary', href: `/t/class/${id}/add` })),
      notes.length > 0 && h('section', { class: 'stack' }, h('h2', {}, t('recent_notes')), h('ul', { class: 'list' }, notes.map(noteRow))),
      school.qrMode === 'per_school' && notice('qr-code', [h('p', {}, t('school_qr_mode_note'))]));
  });
}

/* ---------- Adding students ---------- */

export function addStudents(ctx) {
  const id = Number(ctx.params.id);
  let mode = 'speak';
  const area = h('div', { class: 'stack' });
  const added = h('div', { class: 'stack', 'aria-live': 'polite' });
  const created = [];

  async function submit(list, force = false) {
    const result = await post(`/classes/${id}/students`, { students: list, force });
    created.push(...result.created);
    if (result.created.length) {
      replace(added, notice('check-circle', [
        h('p', {}, t('students_added', { names: created.map((s) => s.name).join(', ') })),
        h('p', {}, t('qr_ready')),
        button(t('print_stickers'), { iconName: 'printer', kind: 'primary small', href: `/t/stickers/${id}` }),
      ]));
      speak(t('qr_ready'), languageOf('qr_ready'));
    }
    if (result.invalid.length) toast(t('students_invalid', { names: result.invalid.map((s) => s.name).join(', ') }), true);
    for (const { input, existing } of result.duplicates) {
      sheet(t('duplicate_title'), (close) => [
        h('p', {}, t('duplicate_message', { name: input.name, existing: existing.map((e) => e.name).join(', ') })),
        button(t('same_child'), { kind: 'primary big block', onClick: close }),
        button(t('different_child'), { kind: 'outline big block', onClick: async () => { await submit([input], true); close(); } }),
      ]);
    }
    return result;
  }

  const entryForm = (value, after) => form(async (values) => {
    if (!values.name.trim()) return toast(t('name_needed'), true);
    const result = await submit([values]);
    if (!result.invalid.length) after();
  }, studentFields(value), button(t('add_this_student'), { iconName: 'check', kind: 'primary big block', type: 'submit' }));

  function speakMode() {
    const result = h('div', { class: 'stack' });
    replace(area,
      guide('microphone', 'add_speak_guide'),
      voiceCapture({
        language: speakLanguage(), label: t('tap_to_speak'), onLeave: ctx.onLeave,
        onDone: async (heard) => {
          const body = new FormData();
          body.set('kind', 'student');
          body.set('lang', speakLanguage());
          body.set('text', heard.previewText);
          body.set('audio', heard.blob, 'student.webm');
          const filled = await api('/formfill', { method: 'POST', form: body }).catch((error) => {
            if (error.code !== 'nothing_heard') throw error;
            return { text: '', people: [] };
          });
          replace(result,
            filled.text ? h('p', { class: 'live' }, filled.text) : notice('info', [h('p', {}, t('voice_form_unavailable'))], 'warn'),
            entryForm(filled.people[0] || {}, () => result.replaceChildren()));
        },
      }),
      result);
  }

  function typeMode() {
    replace(area, entryForm({}, typeMode));
  }

  function pasteMode() {
    const preview = h('div', { class: 'stack' });
    replace(area,
      guide('clipboard-text', 'add_paste_guide'),
      form(async ({ text }) => {
        if (!text.trim()) return;
        const body = new FormData();
        body.set('kind', 'list');
        body.set('text', text);
        const { people } = await api('/formfill', { method: 'POST', form: body });
        replace(preview,
          h('ul', { class: 'list' }, people.map((p) => h('li', { class: 'item static' }, avatar(p.name),
            h('span', { class: 'grow' }, h('strong', {}, p.name), h('span', { class: 'muted small' }, p.phone || p.email || t('no_phone')))))),
          button(t('add_n_students', { n: people.length }), {
            iconName: 'check', kind: 'primary big block',
            onClick: async () => {
              await submit(people.map((p) => ({ name: p.name, parentPhone: p.phone, parentEmail: p.email, rollNo: p.rollNo })));
              preview.textContent = '';
            },
          }));
      },
      field(t('paste_label'), h('textarea', { name: 'text', rows: 7, lang: speakLanguage(), placeholder: 'Ravi Kumar, 98765 43210' })),
      button(t('check_list'), { iconName: 'list-bullets', kind: 'outline block', type: 'submit' })),
      preview);
  }

  const modes = { speak: speakMode, type: typeMode, paste: pasteMode };
  add(ctx.root,
    h('h1', {}, t('add_students')),
    segmented([['speak', t('speak')], ['type', t('type')], ['paste', t('paste_list')]], mode, (m) => { mode = m; modes[m](); }),
    added, area,
    button(t('back_to_class'), { iconName: 'arrow-left', kind: 'block', href: `/t/class/${id}` }));
  modes[mode]();
}

/* ---------- Stickers ---------- */

export const qrImage = (svg, alt) => h('img', { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt });

export function schoolPoster(data) {
  return h('div', { class: 'poster' }, h('h1', {}, data.school.name), qrImage(data.svg, 'QR'),
    h('h2', {}, 'Vidya Vaani'), h('p', {}, t('poster_line')));
}

export function stickers(ctx) {
  const id = Number(ctx.params.id);
  return load(ctx, `/classes/${id}/stickers`, async (data, box) => {
    if (data.school.qrMode === 'per_school') {
      const school = await api(`/school-qr?school=${data.school.id}`);
      return add(box, h('div', { class: 'no-print stack' }, h('h1', {}, t('school_qr')), guide('printer', 'print_guide'),
        button(t('print_or_pdf'), { iconName: 'printer', kind: 'primary big block', onClick: () => window.print() })), schoolPoster(school));
    }
    let perPage = 12;
    const sheets = h('div', { class: 'stack' });
    const draw = () => {
      const pages = [];
      for (let i = 0; i < data.students.length; i += perPage) pages.push(data.students.slice(i, i + perPage));
      replace(sheets, pages.map((page) => h('div', { class: `sheet-page per-${perPage}` }, page.map((s) =>
        h('div', { class: 'sticker' }, qrImage(s.svg, ''), h('b', {}, s.name),
          h('span', {}, `${t('class')} ${data.className}${s.rollNo ? ` · ${s.rollNo}` : ''}`),
          h('span', {}, data.school.name),
          h('span', { class: 'row' }, h('img', { src: '/img/icon.svg', alt: '', class: 'logo-dot' }), 'Vidya Vaani'))))));
    };
    draw();
    add(box,
      h('div', { class: 'no-print stack' },
        h('h1', {}, `${t('print_stickers')} ${data.className}`),
        guide('printer', 'print_guide'),
        segmented([[12, t('per_page', { n: 12 })], [24, t('per_page', { n: 24 })]], perPage, (n) => { perPage = n; draw(); }),
        button(t('print_or_pdf'), { iconName: 'printer', kind: 'primary big block', onClick: () => window.print() })),
      data.students.length ? sheets : empty('student', 'class_empty'));
  });
}

/* ---------- Voice inbox ---------- */

export function inbox(ctx) {
  add(ctx.root, h('h1', {}, t('replies')));
  return load(ctx, '/inbox', ({ replies }, box) => {
    if (!replies.length) return add(box, empty('chat-circle', 'inbox_empty'));
    add(box, replies.map((r) => {
      const answer = h('div', {});
      return h('article', { class: `card${r.heard ? '' : ' unheard'}` },
        h('div', { class: 'row' }, avatar(r.student?.name),
          h('div', { class: 'grow' }, h('strong', {}, t('parent_of', { child: r.student?.name || '' })), h('br'),
            h('span', { class: 'muted small' }, `${t('class')} ${r.className} · ${formatDate(r.createdAt)}`))),
        r.about && h('p', { class: 'muted small', dir: 'auto' }, `${t('about_note')}: ${r.about}`),
        r.audioUrl && player(r.audioUrl, { durationMs: r.durationMs, onLeave: ctx.onLeave, onPlay: () => markListened(r.id) }),
        words(r),
        r.tags.length > 0 && h('div', { class: 'chips' }, r.tags.map((x) => tagChip(x))),
        answer,
        button(t(r.answered ? 'answer_again' : 'answer_by_voice'), {
          iconName: 'microphone', kind: 'outline block',
          onClick: () => replace(answer, voiceReply({ noteId: r.id, language: speakLanguage(), onLeave: ctx.onLeave, label: t('answer_by_voice') })),
        }));
    }));
  });
}
