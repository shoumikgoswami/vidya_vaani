// S11 school settings, S12 teachers and classes, S13 moving students, S14 metrics.
import { h, add, icon, replace } from '../lib/dom.js';
import { api, post, patch } from '../lib/api.js';
import { t, formatDate, childCount } from '../lib/i18n.js';
import { voiceCapture } from '../lib/capture.js';
import { LANGUAGES } from '../lib/languages.js';
import { navigate, adminSchoolId, refreshMe, speakLanguage } from '../lib/state.js';
import {
  guide, button, sheet, confirmSheet, skeletons, failure, toast, showError, empty, avatar, field, form, segmented,
  languageSelect, nativeName, reveal,
} from '../lib/ui.js';

const reload = () => navigate(location.pathname + location.search, { replace: true });

async function section(ctx, loader, draw) {
  const holder = h('div', { class: 'view' }, skeletons(3));
  add(ctx.root, holder);
  try {
    const data = await loader(adminSchoolId());
    if (!ctx.alive()) return;
    holder.textContent = '';
    reveal(holder);
    draw(data, holder);
  } catch (error) {
    if (ctx.alive()) replace(holder, failure(error, reload));
  }
}

const radio = (name, value, current, title, help) =>
  h('label', { class: 'card check' }, h('input', { type: 'radio', name, value, checked: value === current }),
    h('span', {}, h('strong', {}, title), h('br'), h('span', { class: 'muted small' }, help)));

export function school(ctx) {
  add(ctx.root, h('h1', {}, t('school_settings')));
  return section(ctx, (id) => api(`/school?school=${id}`), (data, box) => {
    const checks = h('div', { class: 'grid' }, LANGUAGES.map((l) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'enabled', value: l.code, checked: data.enabledLangs.includes(l.code) }),
      h('span', { lang: l.code }, l.native))));
    add(box, h('div', { class: 'split' }, h('div', { class: 'split-col' },
      form(async (values, el) => {
        await patch(`/school?school=${data.id}`, {
          name: values.name, address: values.address, qrMode: values.qrMode, defaultLang: values.defaultLang,
          retentionYears: Number(values.retentionYears),
          enabledLangs: [...el.querySelectorAll('input[name=enabled]:checked')].map((i) => i.value),
        });
        await refreshMe();
        toast(t('settings_saved'));
      },
      field(t('school_name'), h('input', { name: 'name', value: data.name, required: true })),
      field(t('address_optional'), h('input', { name: 'address', value: data.address || '' })),
      h('fieldset', { class: 'stack plain' }, h('legend', {}, h('strong', {}, t('qr_mode'))),
        radio('qrMode', 'per_student', data.qrMode, t('qr_per_student'), t('qr_per_student_help')),
        radio('qrMode', 'per_school', data.qrMode, t('qr_per_school'), t('qr_per_school_help'))),
      field(t('default_language'), languageSelect('defaultLang', data.defaultLang)),
      h('details', { class: 'card' }, h('summary', {}, h('strong', {}, t('enabled_languages'))), checks),
      field(t('keep_notes'), h('input', { name: 'retentionYears', type: 'number', min: 0, max: 10, value: data.retentionYears }), t('keep_notes_help')),
      button(t('save'), { iconName: 'check', kind: 'primary big block', type: 'submit' }))),
      h('div', { class: 'split-col' },
        button(t('stickers_all'), { iconName: 'printer', kind: 'outline block', href: '/admin/stickers' }),
        button(t('school_qr'), { iconName: 'qr-code', kind: 'outline block', href: '/admin/school-qr' }),
        button(t('configuration'), { iconName: 'sliders-horizontal', kind: 'quiet block', href: '/admin/config' }))));
  });
}

/* ---------- Teachers and classes ---------- */

/** The code is shown once. Closing the sheet brings the list up to date. */
function showCode(name, code) {
  const address = `${location.host}/register/teacher`;
  sheet(t('code_title', { name }), (close) => [
    h('output', { class: 'code-show' }, code),
    h('p', {}, t('code_help', { address })),
    button(t('copy_code'), {
      iconName: 'copy', kind: 'primary big block',
      onClick: async () => {
        await navigator.clipboard.writeText(code);
        toast(t('code_copied'));
      },
    }),
    button(t('close'), { kind: 'outline block', onClick: close }),
  ]);
  [...document.querySelectorAll('dialog.sheet')].at(-1)?.addEventListener('close', reload);
}

function teacherSheet(schoolId, teacher) {
  sheet(t(teacher ? 'edit_details' : 'add_teacher'), (close) => {
    const fields = h('div', { class: 'stack' });
    const draw = (value) => replace(fields,
      field(t('teacher_name'), h('input', { name: 'name', value: value.name || '', required: true })),
      !teacher && field(t('phone_label'), h('input', { name: 'phone', type: 'tel', inputmode: 'tel', value: value.phone || '' })),
      !teacher && field(t('email_label'), h('input', { name: 'email', type: 'email', value: value.email || '' }), t('contact_optional')),
      field(t('speaking_language'), languageSelect('speakLang', value.speakLang || speakLanguage())),
      field(t('subjects'), h('input', { name: 'subjects', value: (value.subjects || []).join(', ') }), t('subjects_help')));
    draw(teacher || {});
    return form(async (values) => {
      const body = {
        name: values.name, speakLang: values.speakLang,
        subjects: values.subjects.split(',').map((s) => s.trim()).filter(Boolean),
      };
      if (teacher) await patch(`/teachers/${teacher.id}`, body);
      else {
        const added = await post('/teachers', { ...body, school: schoolId, phone: values.phone || null, email: values.email || null });
        close();
        // Someone who has not signed in yet gets a code to join with.
        return added.code ? showCode(values.name, added.code) : reload();
      }
      close();
      return reload();
    },
    !teacher && voiceCapture({
      language: speakLanguage(), label: t('add_teacher_voice'),
      onDone: async (heard) => {
        const body = new FormData();
        body.set('kind', 'teacher');
        body.set('lang', speakLanguage());
        body.set('text', heard.previewText);
        body.set('audio', heard.blob, 'teacher.webm');
        const filled = await api('/formfill', { method: 'POST', form: body }).catch((error) => {
          if (error.code !== 'nothing_heard') throw error;
          return { people: [] };
        });
        if (filled.people[0]) draw(filled.people[0]);
        else toast(t('voice_form_unavailable'), true);
      },
    }),
    fields,
    button(t('save'), { iconName: 'check', kind: 'primary big block', type: 'submit' }),
    teacher && teacher.active && !teacher.joined && button(t('new_code'), {
      iconName: 'lock', kind: 'outline block',
      onClick: async () => {
        const { code } = await post(`/teachers/${teacher.id}/code`);
        close();
        showCode(teacher.name, code);
      },
    }),
    teacher && button(t(teacher.active ? 'deactivate' : 'activate'), {
      kind: teacher.active ? 'danger block' : 'outline block',
      onClick: async () => {
        await patch(`/teachers/${teacher.id}`, { active: !teacher.active });
        close();
        reload();
      },
    }));
  });
}

/** A class's name and section. Its teachers are managed on the class card. */
function classSheet(schoolId, cls) {
  sheet(t(cls ? 'edit_class' : 'add_class'), (close) => form(async (values) => {
    const body = { school: schoolId, name: values.name.trim(), section: values.section.trim().toUpperCase() };
    if (cls) await patch(`/classes/${cls.id}`, body);
    else await post('/classes', body);
    close();
    reload();
  },
  h('div', { class: 'pair' },
    field(t('class_number'), h('input', { name: 'name', value: cls?.name || '', required: true, inputmode: 'numeric' })),
    field(t('section'), h('input', { name: 'section', value: cls?.section || '' }))),
  button(t('save'), { iconName: 'check', kind: 'primary big block', type: 'submit' })));
}

/** Who teaches a class: add or remove a teacher, and choose the class teacher. */
function classTeacherList(cls, teachers) {
  const active = teachers.filter((x) => x.active);
  const listed = new Set([...cls.teachers.map((x) => x.membershipId), cls.classTeacherId]);
  const members = active.filter((x) => listed.has(x.id));
  const label = `${cls.name}${cls.section}`;
  const save = async (ids, classTeacherId) => {
    await patch(`/classes/${cls.id}`, {
      classTeacherId,
      teachers: ids.map((id) => ({
        membershipId: id,
        subjects: cls.teachers.find((x) => x.membershipId === id)?.subjects || active.find((x) => x.id === id)?.subjects || [],
      })),
    });
    reload();
  };
  const ids = members.map((x) => x.id);
  const current = ids.includes(cls.classTeacherId) ? cls.classTeacherId : null;
  const others = active.filter((x) => !listed.has(x.id));
  return h('div', { class: 'stack' },
    h('h3', {}, t('class_teachers')),
    members.length
      ? h('ul', { class: 'list' }, members.map((x) => h('li', { class: 'member' }, h('strong', {}, x.name),
        x.id === current
          ? h('span', { class: 'pill-ok' }, t('class_teacher'))
          : button(t('make_class_teacher'), { kind: 'quiet small', onClick: () => save(ids, x.id) }),
        h('button', {
          type: 'button', class: 'iconbtn', 'aria-label': t('remove_from_class', { name: x.name }), title: t('remove'),
          onclick: async () => {
            if (!(await confirmSheet(t('remove'), t('remove_confirm', { name: x.name, class: label }), t('remove'), { danger: true }))) return;
            await save(ids.filter((id) => id !== x.id), x.id === current ? null : current).catch(showError);
          },
        }, icon('x')))))
      : h('p', { class: 'muted small' }, t('no_class_teachers')),
    button(t('add_to_class'), {
      iconName: 'plus', kind: 'outline small',
      onClick: () => sheet(`${t('add_to_class')}: ${label}`, (close) => (others.length
        ? h('div', { class: 'list' }, others.map((x) => h('button', {
          type: 'button', class: 'item',
          onclick: () => {
            close();
            // The first teacher of an empty class is its class teacher.
            save([...ids, x.id], current ?? (ids.length ? null : x.id)).catch(showError);
          },
        }, avatar(x.name), h('span', { class: 'grow' }, h('strong', {}, x.name),
          x.subjects.length ? h('span', { class: 'muted small' }, x.subjects.join(', ')) : null), icon('plus'))))
        : h('p', {}, t(active.length ? 'all_teachers_added' : 'no_teachers')))),
    }));
}

/** Where a student can go: the next class (offered first), its other sections, and every class there is. */
export function moveChoices(classes, cls) {
  const next = /^\d+$/.test(cls.name) ? String(Number(cls.name) + 1) : cls.name;
  const labels = new Map();
  const offer = (name, section) => labels.set(`${name}|${section}`, `${name}${section}`);
  offer(next, cls.section);
  for (const section of ['A', 'B', 'C']) offer(next, section);
  for (const c of classes) offer(c.name, c.section);
  const own = `${cls.name}|${cls.section}`;
  labels.delete(own);
  return {
    first: `${next}|${cls.section}`,
    own,
    options: [
      ...[...labels].map(([value, label]) => [value, t('move_to_class', { class: label })]),
      [own, t('move_repeat', { class: `${cls.name}${cls.section}` })],
      ['left', t('move_left')],
    ],
  };
}

export const moveSelect = (name, options, value, extra = {}) =>
  h('select', { name, value, ...extra }, options.map(([v, label]) => h('option', { value: v }, label)));

/** What the server expects for one chosen destination. */
export const destination = (value) => {
  if (value === 'left') return 'left';
  const [name, section] = value.split('|');
  return { name, section };
};

export const yearAfter = (year) => {
  const start = Number(year.slice(0, 4)) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

export function people(ctx) {
  let tab = sessionStorage.getItem('vv.peopleTab') || 'teachers';
  add(ctx.root, h('h1', {}, t('teachers_and_classes')));
  return section(ctx, async (id) => {
    const [teachers, classes] = await Promise.all([api(`/teachers?school=${id}`), api(`/classes?school=${id}`)]);
    return { id, teachers: teachers.teachers, classes: classes.classes };
  }, (data, box) => {
    const area = h('div', { class: 'stack' });
    const views = {
      teachers: () => replace(area,
        button(t('add_teacher'), { iconName: 'plus', kind: 'primary big block', onClick: () => teacherSheet(data.id) }),
        data.teachers.length
          ? h('ul', { class: 'list' }, data.teachers.map((x) => h('li', {}, h('button', { type: 'button', class: 'item', onclick: () => teacherSheet(data.id, x) },
            avatar(x.name), h('span', { class: 'grow' }, h('strong', {}, x.name),
              h('span', { class: 'muted small' }, [x.phone || x.email, nativeName(x.speakLang || 'hi'), x.subjects.join(', ')].filter(Boolean).join(' · '))),
            !x.active ? h('span', { class: 'pill-warn' }, t('inactive')) : !x.joined && h('span', { class: 'pill-warn' }, t('not_joined')),
            icon('pencil-simple')))))
          : empty('users-three', 'no_teachers')),
      classes: () => replace(area,
        button(t('add_class'), { iconName: 'plus', kind: 'primary big block', onClick: () => classSheet(data.id) }),
        data.classes.some((c) => c.students > 0)
          && button(t('stickers_all'), { iconName: 'printer', kind: 'outline block', href: '/admin/stickers' }),
        data.classes.length
          ? data.classes.map((c) => h('div', { class: 'card' },
            h('div', { class: 'row' }, h('span', { class: 'avatar square' }, `${c.name}${c.section}`),
              h('div', { class: 'grow' }, h('strong', {}, `${t('class')} ${c.name}${c.section} · ${c.academicYear}`), h('br'),
                h('span', { class: 'muted small' }, childCount(c.students)))),
            classTeacherList(c, data.teachers),
            h('div', { class: 'pair' },
              button(t('open_class'), { kind: 'outline small', href: `/t/class/${c.id}` }),
              button(t('edit_class'), { kind: 'outline small', onClick: () => classSheet(data.id, c) })),
            c.students > 0 && h('div', { class: 'pair' },
              button(t('print_stickers'), { iconName: 'qr-code', kind: 'quiet small', href: `/t/stickers/${c.id}` }),
              button(t('move_students'), { iconName: 'arrow-up', kind: 'quiet small', href: `/admin/move/${c.id}` }))))
          : empty('chalkboard-teacher', 'no_classes_yet')),
    };
    add(box, segmented([['teachers', t('teachers')], ['classes', t('classes')]], tab, (v) => {
      tab = v;
      sessionStorage.setItem('vv.peopleTab', v);
      views[v]();
    }), area);
    views[tab]();
  });
}

export function move(ctx) {
  const classId = Number(ctx.params.id);
  add(ctx.root, h('h1', {}, t('move_students')));
  return section(ctx, async (schoolId) => {
    const [detail, classes] = await Promise.all([api(`/classes/${classId}`), api(`/classes?school=${schoolId}`)]);
    return { ...detail, classes: classes.classes };
  }, (data, box) => {
    const cls = data.class;
    if (!data.students.length) return add(box, empty('users-three', 'no_students'));
    const choices = moveChoices(data.classes, cls);
    const options = [...choices.options, ['skip', t('move_skip')]];
    const selects = data.students.map((s) => [s, moveSelect(`student-${s.id}`, options, choices.first)]);
    const all = moveSelect('all', options, choices.first, {
      onchange: (event) => selects.forEach(([, select]) => { select.value = event.target.value; }),
    });
    return add(box,
      guide('arrow-up', 'move_guide'),
      form(async (values) => {
        const moves = selects.filter(([, select]) => select.value !== 'skip')
          .map(([student, select]) => ({ studentId: student.id, to: destination(select.value) }));
        if (!moves.length) return toast(t('nothing_to_move'), true);
        const year = values.year.trim();
        if (!(await confirmSheet(t('move_students'), t('move_confirm', { n: moves.length, year }), t('move_now')))) return undefined;
        const { counts } = await post(`/classes/${classId}/move`, { year, moves });
        toast(t('moved_toast', counts));
        return navigate('/admin/people', { replace: true });
      },
      field(t('academic_year'), h('input', { name: 'year', value: yearAfter(cls.academicYear), required: true, dir: 'ltr' })),
      field(t('set_all'), all),
      h('ul', { class: 'steps' }, selects.map(([student, select]) => h('li', { class: 'card' }, field(student.name, select)))),
      button(t('move_students'), { iconName: 'arrow-up', kind: 'primary big block', type: 'submit' })));
  });
}

/* ---------- Metrics ---------- */

/** One figure. A percentage also shows how far it has got. */
const stat = (label, value, detail, share) => h('div', { class: 'stat' }, h('span', { class: 'muted small' }, label),
  h('b', {}, value ?? '-'), share != null && h('span', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: `--v:${share}` })),
  h('span', { class: 'muted small' }, detail || ''));
const pct = (m) => (m.percent == null ? null : `${m.percent}%`);
const table = (headings, rows) => h('div', { class: 'table-wrap' }, h('table', {},
  h('thead', {}, h('tr', {}, headings.map((x) => h('th', {}, x)))),
  h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c ?? '-')))))));

export function reports(ctx) {
  add(ctx.root, h('h1', {}, t('reports')));
  return section(ctx, async (id) => {
    const [metrics, log] = await Promise.all([api(`/metrics?school=${id}`), api(`/audit?school=${id}`)]);
    return { metrics, log: log.entries };
  }, ({ metrics: m, log }, box) => {
    const target = (v, unit = '%') => t('target', { value: `${v}${unit}` });
    add(box,
      h('div', { class: 'stats' },
        stat(t('metric_heard_24h'), pct(m.heardIn24h), target(m.heardIn24h.target), m.heardIn24h.percent),
        stat(t('metric_capture'), m.medianCaptureSeconds.value == null ? null : `${m.medianCaptureSeconds.value}s`, target(m.medianCaptureSeconds.target, 's')),
        stat(t('metric_teachers'), pct(m.activeTeachers), target(m.activeTeachers.target), m.activeTeachers.percent),
        stat(t('metric_replies'), pct(m.parentsReplied), target(m.parentsReplied.target), m.parentsReplied.percent),
        stat(t('metric_before_due'), pct(m.heardBeforeDue), '', m.heardBeforeDue.percent),
        stat(t('metric_notes'), m.notes, '')),
      h('details', { class: 'card' }, h('summary', {}, h('strong', {}, t('audit_log'))),
        log.length ? table([t('date'), t('action'), t('person')], log.map((e) => [formatDate(e.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), e.action, e.actor]))
          : h('p', { class: 'muted' }, t('nothing_yet'))));
  });
}
