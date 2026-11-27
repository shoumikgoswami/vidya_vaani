// S11 settings and AI status, S12 teachers and classes, S13 promotion, S14 metrics.
import { h, add, icon, replace } from '../lib/dom.js';
import { api, post, patch } from '../lib/api.js';
import { t, formatDate, childCount } from '../lib/i18n.js';
import { voiceCapture } from '../lib/capture.js';
import { LANGUAGES, lang as languageInfo } from '../lib/languages.js';
import { navigate, adminSchoolId, refreshMe, speakLanguage } from '../lib/state.js';
import {
  guide, button, sheet, confirmSheet, skeletons, failure, toast, notice, empty, avatar, field, form, segmented,
  languageSelect, nativeName,
} from '../lib/ui.js';
import { schoolPoster } from './teacher.js';

const reload = () => navigate(location.pathname + location.search, { replace: true });

async function section(ctx, loader, draw) {
  const holder = h('div', { class: 'view' }, skeletons(3));
  add(ctx.root, holder);
  try {
    const data = await loader(adminSchoolId());
    if (!ctx.alive()) return;
    holder.textContent = '';
    draw(data, holder);
  } catch (error) {
    if (ctx.alive()) replace(holder, failure(error, reload));
  }
}

const radio = (name, value, current, title, help) =>
  h('label', { class: 'card check' }, h('input', { type: 'radio', name, value, checked: value === current }),
    h('span', {}, h('strong', {}, title), h('br'), h('span', { class: 'muted small' }, help)));

const SPEECH_LABEL = {
  parakeet: ['check-circle', 'status_parakeet'], whisper: ['check-circle', 'status_whisper'],
  approximate: ['info', 'status_approximate'], browser: ['globe', 'status_browser'], audio_only: ['play', 'status_audio_only'],
};

function providerPanel() {
  const box = h('div', { class: 'card' }, h('h2', {}, t('ai_status')), skeletons(1));
  api('/school/providers').then((status) => {
    const detail = (label, value) => h('span', { class: 'muted small' }, `${label}: ${value}`);
    replace(box,
      h('h2', {}, t('ai_status')),
      notice(status.nvidia ? 'check-circle' : 'info', [h('p', {}, t(status.nvidia ? 'ai_on' : 'ai_off')),
        status.llmModels.length ? h('p', { class: 'small models' }, status.llmModels.join(', ')) : h('p', { class: 'small' }, t('ai_off_help'))],
      status.nvidia ? '' : 'warn'),
      h('ul', { class: 'lang-status' }, status.languages.map((l) => h('li', {},
        h('span', { class: 'tier', title: t('tier') }, l.tier),
        h('span', { class: 'grow' },
          h('strong', {}, l.name, ' ', h('span', { class: 'muted', lang: l.code }, l.native)),
          h('span', { class: 'row' }, icon(SPEECH_LABEL[l.speech][0], { size: 18 }), detail(t('status_speech'), t(SPEECH_LABEL[l.speech][1]))),
          detail(t('status_translation'), l.translation === 'browser' ? t('status_key_missing') : `${l.translation}${l.machineWarning ? ` (${t('may_be_wrong')})` : ''}`),
          detail(t('status_voice'), l.tts === 'magpie' ? 'NVIDIA' : t('status_phone_voice')))))));
  }).catch((error) => replace(box, failure(error)));
  return box;
}

export function school(ctx) {
  add(ctx.root, h('h1', {}, t('school_settings')));
  return section(ctx, (id) => api(`/school?school=${id}`), (data, box) => {
    const checks = h('div', { class: 'grid' }, LANGUAGES.map((l) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'enabled', value: l.code, checked: data.enabledLangs.includes(l.code) }),
      h('span', { lang: l.code }, l.native))));
    add(box,
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
      button(t('save'), { iconName: 'check', kind: 'primary big block', type: 'submit' })),
      button(t('school_qr'), { iconName: 'qr-code', kind: 'outline block', href: '/admin/school-qr' }),
      providerPanel());
  });
}

export function schoolQr(ctx) {
  return section(ctx, (id) => api(`/school-qr?school=${id}`), (data, box) => {
    add(box, h('div', { class: 'no-print stack' }, h('h1', {}, t('school_qr')), guide('printer', 'print_guide'),
      button(t('print_or_pdf'), { iconName: 'printer', kind: 'primary big block', onClick: () => window.print() })), schoolPoster(data));
  });
}

/* ---------- Teachers and classes ---------- */

function teacherSheet(schoolId, teacher) {
  sheet(t(teacher ? 'edit_details' : 'add_teacher'), (close) => {
    const fields = h('div', { class: 'stack' });
    const draw = (value) => replace(fields,
      field(t('teacher_name'), h('input', { name: 'name', value: value.name || '', required: true })),
      !teacher && field(t('phone_label'), h('input', { name: 'phone', type: 'tel', inputmode: 'tel', value: value.phone || '' })),
      !teacher && field(t('email_label'), h('input', { name: 'email', type: 'email', value: value.email || '' }), t('phone_or_email')),
      field(t('speaking_language'), languageSelect('speakLang', value.speakLang || speakLanguage())),
      field(t('subjects'), h('input', { name: 'subjects', value: (value.subjects || []).join(', ') }), t('subjects_help')));
    draw(teacher || {});
    return form(async (values) => {
      const body = {
        name: values.name, speakLang: values.speakLang,
        subjects: values.subjects.split(',').map((s) => s.trim()).filter(Boolean),
      };
      if (teacher) await patch(`/teachers/${teacher.id}`, body);
      else await post('/teachers', { ...body, school: schoolId, phone: values.phone || null, email: values.email || null });
      close();
      reload();
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

function classSheet(schoolId, teachers, cls) {
  const active = teachers.filter((x) => x.active);
  sheet(t(cls ? 'edit_class' : 'add_class'), (close) => form(async (values, el) => {
    const chosen = [...el.querySelectorAll('input[name=teacher]:checked')].map((i) => Number(i.value));
    const classTeacherId = values.classTeacherId ? Number(values.classTeacherId) : null;
    const body = {
      school: schoolId, name: values.name.trim(), section: values.section.trim().toUpperCase(), classTeacherId,
      teachers: [...new Set([...chosen, ...(classTeacherId ? [classTeacherId] : [])])]
        .map((id) => ({ membershipId: id, subjects: active.find((x) => x.id === id)?.subjects || [] })),
    };
    if (cls) await patch(`/classes/${cls.id}`, body);
    else await post('/classes', body);
    close();
    reload();
  },
  h('div', { class: 'pair' },
    field(t('class_number'), h('input', { name: 'name', value: cls?.name || '', required: true, inputmode: 'numeric' })),
    field(t('section'), h('input', { name: 'section', value: cls?.section || '' }))),
  field(t('class_teacher'), h('select', { name: 'classTeacherId', value: cls?.classTeacherId ?? '' },
    h('option', { value: '' }, t('none')), active.map((x) => h('option', { value: x.id }, x.name)))),
  h('fieldset', { class: 'plain' }, h('legend', {}, h('strong', {}, t('subject_teachers'))),
    active.map((x) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: 'teacher', value: x.id, checked: cls?.teachers.some((y) => y.membershipId === x.id) }),
      h('span', {}, x.name, x.subjects.length ? h('span', { class: 'muted small' }, ` · ${x.subjects.join(', ')}`) : null)))),
  button(t('save'), { iconName: 'check', kind: 'primary big block', type: 'submit' })));
}

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
            !x.active && h('span', { class: 'chip warn' }, t('inactive')), icon('pencil-simple')))))
          : empty('users-three', 'no_teachers')),
      classes: () => replace(area,
        button(t('add_class'), { iconName: 'plus', kind: 'primary big block', onClick: () => classSheet(data.id, data.teachers) }),
        data.classes.length
          ? data.classes.map((c) => h('div', { class: 'card' },
            h('div', { class: 'row' }, h('span', { class: 'avatar' }, `${c.name}${c.section}`),
              h('div', { class: 'grow' }, h('strong', {}, `${t('class')} ${c.name}${c.section} · ${c.academicYear}`), h('br'),
                h('span', { class: 'muted small' }, [childCount(c.students),
                  c.teachers.find((x) => x.membershipId === c.classTeacherId)?.name].filter(Boolean).join(' · ')))),
            h('div', { class: 'pair' },
              button(t('open_class'), { kind: 'outline small', href: `/t/class/${c.id}` }),
              button(t('edit_class'), { kind: 'outline small', onClick: () => classSheet(data.id, data.teachers, c) })),
            c.students > 0 && button(t('promote'), { iconName: 'arrow-up', kind: 'small', href: `/admin/promote/${c.id}` })))
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

export function promote(ctx) {
  const classId = Number(ctx.params.id);
  add(ctx.root, h('h1', {}, t('promote')));
  return section(ctx, async (schoolId) => {
    const [detail, teachers, classes] = await Promise.all([
      api(`/classes/${classId}`), api(`/teachers?school=${schoolId}`), api(`/classes?school=${schoolId}`),
    ]);
    return { ...detail, teachers: teachers.teachers.filter((x) => x.active), current: classes.classes.find((c) => c.id === classId) };
  }, (data, box) => {
    const cls = data.class;
    const start = Number(cls.academicYear.slice(0, 4)) + 1;
    const year = `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
    const nextName = /^\d+$/.test(cls.name) ? String(Number(cls.name) + 1) : cls.name;
    const decisions = Object.fromEntries(data.students.map((s) => [s.id, 'promote']));
    add(box,
      guide('arrow-up', 'promote_guide'),
      form(async (values) => {
        const staying = Object.values(decisions).filter((d) => d === 'promote').length;
        const target = `${values.name}${values.section}`;
        if (!(await confirmSheet(t('promote'), t('promote_confirm', { n: staying, from: `${cls.name}${cls.section}`, to: target, year: values.year }), t('promote')))) return;
        const result = await post(`/classes/${classId}/promote`, {
          name: values.name, section: values.section, year: values.year, decisions,
          classTeacherId: values.classTeacherId ? Number(values.classTeacherId) : null,
        });
        toast(t('promoted', { n: result.counts.promote }));
        navigate('/admin/people', { replace: true });
      },
      h('div', { class: 'pair' },
        field(t('new_class'), h('input', { name: 'name', value: nextName, required: true })),
        field(t('section'), h('input', { name: 'section', value: cls.section }))),
      field(t('academic_year'), h('input', { name: 'year', value: year, required: true })),
      field(t('class_teacher'), h('select', { name: 'classTeacherId', value: data.current?.classTeacherId ?? '' },
        h('option', { value: '' }, t('none')), data.teachers.map((x) => h('option', { value: x.id }, x.name)))),
      h('ul', { class: 'list' }, data.students.map((s) => h('li', { class: 'card' }, h('strong', {}, s.name),
        segmented([['promote', t('move_up')], ['hold', t('hold_back')], ['left', t('has_left')]], 'promote', (v) => { decisions[s.id] = v; })))),
      button(t('promote'), { iconName: 'arrow-up', kind: 'primary big block', type: 'submit' })));
  });
}

/* ---------- Metrics ---------- */

const stat = (label, value, detail) => h('div', { class: 'stat' }, h('span', { class: 'muted small' }, label), h('b', {}, value ?? '-'), h('span', { class: 'muted small' }, detail || ''));
const pct = (m) => (m.percent == null ? null : `${m.percent}%`);
const table = (headings, rows) => h('div', { class: 'table-wrap' }, h('table', {},
  h('thead', {}, h('tr', {}, headings.map((x) => h('th', {}, x)))),
  h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c ?? '-')))))));

export function reports(ctx) {
  add(ctx.root, h('h1', {}, t('reports')));
  return section(ctx, async (id) => {
    const [metrics, log, classes] = await Promise.all([api(`/metrics?school=${id}`), api(`/audit?school=${id}`), api(`/classes?school=${id}`)]);
    return { id, metrics, log: log.entries, classes: classes.classes };
  }, ({ id, metrics: m, log, classes }, box) => {
    const target = (v, unit = '%') => t('target', { value: `${v}${unit}` });
    add(box,
      h('div', { class: 'stats' },
        stat(t('metric_heard_24h'), pct(m.heardIn24h), target(m.heardIn24h.target)),
        stat(t('metric_capture'), m.medianCaptureSeconds.value == null ? null : `${m.medianCaptureSeconds.value}s`, target(m.medianCaptureSeconds.target, 's')),
        stat(t('metric_teachers'), pct(m.activeTeachers), target(m.activeTeachers.target)),
        stat(t('metric_replies'), pct(m.parentsReplied), target(m.parentsReplied.target)),
        stat(t('metric_before_due'), pct(m.heardBeforeDue), ''),
        stat(t('metric_notes'), m.notes, '')),
      h('div', { class: 'card' }, h('h2', {}, t('quality')), m.quality.length
        ? table([t('language'), t('metric_notes'), t('low_conf_pct'), t('edited_pct')], m.quality.map((q) => [
          languageInfo(q.lang).name, q.notes, q.lowPercent == null ? null : `${q.lowPercent}%`, q.editedPercent == null ? null : `${q.editedPercent}%`]))
        : h('p', { class: 'muted' }, t('nothing_yet'))),
      h('div', { class: 'card' }, h('h2', {}, t('ai_calls')), m.aiUsage.length
        ? table([t('date'), t('model'), t('calls'), t('errors_429'), t('errors_other')], m.aiUsage.map((u) => [formatDate(u.day), u.model, u.calls, u.errors429, u.errorsOther]))
        : h('p', { class: 'muted' }, t('nothing_yet'))),
      h('div', { class: 'card' }, h('h2', {}, t('outcomes')), h('p', { class: 'muted' }, t('outcomes_help')),
        form(async (v, el) => {
          const number = (x) => (x === '' ? null : Number(x));
          await post('/metrics/outcomes', {
            school: id, classId: number(v.classId), period: v.period,
            homeworkDonePct: number(v.homework), feeMissedCount: number(v.fees),
          });
          el.reset();
          reload();
        },
        field(t('class'), h('select', { name: 'classId' }, h('option', { value: '' }, t('whole_school')),
          classes.map((c) => h('option', { value: c.id }, `${c.name}${c.section} (${c.academicYear})`)))),
        field(t('period'), h('input', { name: 'period', required: true, placeholder: 'Nov 2026' })),
        h('div', { class: 'pair' },
          field(t('homework_done'), h('input', { name: 'homework', type: 'number', min: 0, max: 100 })),
          field(t('fee_missed'), h('input', { name: 'fees', type: 'number', min: 0 }))),
        button(t('save'), { iconName: 'check', kind: 'outline block', type: 'submit' })),
        m.outcomes.length > 0 && table([t('period'), t('class'), t('homework_done'), t('fee_missed')],
          m.outcomes.map((o) => [o.period, o.className || t('whole_school'), o.homeworkDonePct == null ? null : `${o.homeworkDonePct}%`, o.feeMissedCount]))),
      h('details', { class: 'card' }, h('summary', {}, h('strong', {}, t('audit_log'))),
        log.length ? table([t('date'), t('action'), t('person')], log.map((e) => [formatDate(e.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), e.action, e.actor]))
          : h('p', { class: 'muted' }, t('nothing_yet'))));
  });
}
