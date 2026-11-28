// The demo school: a judge can run the whole cross-language flow with no phone, printer or key.
// Transcripts, translations and recordings ship with the app, so nothing calls an AI service.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';
import { get, run, insert, update, tx } from './index.js';
import { now, randomToken } from '../lib/util.js';
import { findOrCreateUser } from '../auth/users.js';
import { saveMedia } from '../services/media.js';
import { nameKey } from '../nlp/names.js';
import { todayIst, addDays } from '../nlp/dates.js';
import { lang } from '../../client/lib/languages.js';
import { academicYear } from '../routes/auth.js';

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo', 'sample-data.json'), 'utf8'));

export const DEMO_PERSONAS = data.people
  .filter((p) => p.role !== 'pending')
  .map(({ key, phone, name, role, lang: code, child }) => ({ key, phone, name, role, lang: code, child: child || null }));

function dueDate(spec) {
  if (!spec) return null;
  const today = todayIst();
  if (spec.startsWith('+')) return addDays(today, Number(spec.slice(1)));
  const wanted = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(spec);
  const current = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, (wanted - current + 7) % 7 || 7);
}

const ago = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();

/**
 * Real recordings in demo/sample-notes/<key>.webm win over the synthetic voices in demo/audio
 * (made once by scripts/make-demo-audio.js).
 */
function sampleAudio(key) {
  const file = ['sample-notes', 'audio']
    .map((folder) => path.join(ROOT, 'demo', folder, `${key}.webm`))
    .find((candidate) => fs.existsSync(candidate));
  return file ? fs.readFileSync(file) : null;
}

async function removeDemo() {
  // Notes, recordings, classes and students all go with the school.
  await run('DELETE FROM school WHERE is_demo = 1');
  await run(
    `DELETE FROM app_user WHERE is_demo = 1 AND id NOT IN (SELECT user_id FROM membership)
     AND id NOT IN (SELECT user_id FROM guardian_link)`,
  );
}

async function seedRows() {
  const year = academicYear();
  const schoolId = await insert('school', {
    name: data.school.name, address: data.school.address, qr_mode: 'per_student', school_token: randomToken(),
    default_lang: data.school.defaultLang, enabled_langs: JSON.stringify(['hi', 'ta', 'bn', 'te', 'or', 'en']),
    academic_year: year, is_demo: 1, created_at: now(),
  });

  const users = {};
  const members = {};
  for (const p of data.people) {
    const user = await findOrCreateUser({ phone: p.phone, name: p.name, isDemo: 1 });
    await update('app_user', user.id, { ui_lang: p.lang });
    users[p.key] = user.id;
    if (p.role === 'admin' || p.role === 'teacher') {
      members[p.key] = await insert('membership', {
        user_id: user.id, school_id: schoolId, role: p.role, admin_level: p.role === 'admin' ? 'owner' : null,
        speak_lang: p.lang, subjects: JSON.stringify(p.subjects || []), created_at: now(),
      });
    }
  }

  const classes = {};
  const students = {};
  for (const cls of data.classes) {
    const classId = await insert('class', {
      school_id: schoolId, name: cls.name, section: cls.section, academic_year: year,
      class_teacher_id: members[cls.classTeacher], created_at: now(),
    });
    classes[`${cls.name}${cls.section}`] = { id: classId, students: [] };
    for (const key of cls.teachers) {
      const subjects = data.people.find((p) => p.key === key).subjects;
      await insert('class_teacher', { class_id: classId, membership_id: members[key], subjects: JSON.stringify(subjects) });
    }
    for (const [index, name] of cls.students.entries()) {
      const parent = data.people.find((p) => p.child === name && p.role === 'parent');
      const id = await insert('student', {
        school_id: schoolId, class_id: classId, name, name_normalised: nameKey(name), roll_no: String(index + 1),
        parent_phone: parent?.phone || null, token: randomToken(), created_at: now(),
      });
      await insert('student_history', { student_id: id, class_id: classId, academic_year: year, from_date: now() });
      students[name] = id;
      classes[`${cls.name}${cls.section}`].students.push(id);
    }
  }

  for (const p of data.people.filter((x) => x.child)) {
    const pending = p.role === 'pending';
    await insert('guardian_link', {
      student_id: students[p.child], user_id: users[p.key], relation: pending ? 'uncle' : 'parent', read_lang: p.lang,
      status: pending ? 'pending' : 'active', auto_verified: pending ? 0 : 1, consent_at: pending ? null : now(), created_at: now(),
    });
  }

  const noteIds = {};
  const addNote = async (sample, { classId, recipients, kind, parentNoteId = null }) => {
    const created = ago(sample.hoursAgo);
    const id = await insert('note', {
      school_id: schoolId, class_id: classId, author_user_id: users[sample.author], kind, parent_note_id: parentNoteId,
      audio_mime: 'audio/webm', duration_ms: sample.durationMs || Math.max(3000, sample.raw.length * 75), lang_hint: sample.lang,
      transcript_raw: sample.audioOnly ? null : sample.raw,
      transcript_clean: sample.audioOnly ? null : sample.clean || null,
      transcript_lang: sample.lang, tier: lang(sample.lang).tier,
      status: sample.audioOnly ? 'audio_only' : 'ready',
      stt_provider: sample.audioOnly ? null : 'sample', published_at: created, created_at: created,
      capture_ms: 9000 + sample.hoursAgo * 60, client_uuid: `demo-${sample.key}-${randomToken(8)}`,
    });
    const audio = sampleAudio(sample.key);
    if (audio) {
      const key = `note/${id}`;
      await saveMedia(key, { mime: 'audio/webm', data: audio, noteId: id });
      await update('note', id, { audio_path: key });
    } else {
      console.warn(`demo audio ${sample.key} is missing`);
    }
    for (const studentId of recipients) await insert('note_recipient', { note_id: id, student_id: studentId });
    for (const tag of sample.tags || []) {
      await insert('note_tag', { note_id: id, type: tag.type, subject: tag.subject || null, due_date: dueDate(tag.due), source: 'teacher' });
    }
    for (const [code, text] of Object.entries(sample.translations)) {
      await insert('note_translation', { note_id: id, lang: code, text, provider: 'sample', created_at: created });
    }
    return id;
  };

  for (const sample of data.notes) {
    const cls = classes[sample.class];
    const recipients = sample.to === 'class' ? cls.students : sample.to.map((n) => students[n]);
    noteIds[sample.key] = await addNote(sample, { classId: cls.id, recipients, kind: 'teacher_note' });
    for (const key of sample.heardBy || []) {
      const child = students[data.people.find((p) => p.key === key).child];
      if (recipients.includes(child)) {
        await insert('listen_receipt', {
          note_id: noteIds[sample.key], student_id: child, user_id: users[key], first_played_at: ago(sample.hoursAgo - 1),
        });
      }
    }
  }
  for (const reply of data.replies) {
    const original = await get('SELECT class_id FROM note WHERE id = ?', noteIds[reply.about]);
    await addNote(reply, {
      classId: original.class_id, recipients: [students[reply.child]], kind: 'parent_reply', parentNoteId: noteIds[reply.about],
    });
  }
}

/** Seeds the demo school once; `reset` rebuilds it. Safe to call from two places at once. */
export function seedDemo({ reset = false } = {}) {
  return tx(async () => {
    await run('SELECT pg_advisory_xact_lock(727402)');
    if (reset) await removeDemo();
    if (!await get('SELECT 1 FROM school WHERE is_demo = 1')) await seedRows();
  });
}
