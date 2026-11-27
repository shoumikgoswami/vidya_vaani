// The demo school: a judge can run the whole cross-language flow with no phone, printer or key.
// Transcripts and translations are stored here, so nothing calls an AI service.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config, ROOT } from '../config.js';
import { get, all, run, insert, update, tx } from './index.js';
import { now, randomToken } from '../lib/util.js';
import { findOrCreateUser } from '../auth/users.js';
import { nameKey } from '../nlp/names.js';
import { todayIst, addDays } from '../nlp/dates.js';
import { lang } from '../../client/lib/languages.js';
import { academicYear } from '../routes/auth.js';

const exec = promisify(execFile);
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
 * Real recordings in demo/sample-notes/<key>.webm win. Otherwise a computer voice (espeak-ng) is
 * generated once, and a short silent clip is the last resort when that is not installed.
 */
async function sampleAudio(key, text, code) {
  const real = path.join(ROOT, 'demo', 'sample-notes', `${key}.webm`);
  if (fs.existsSync(real)) return real;
  const dir = path.join(config.dataDir, 'demo-audio');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${key}.webm`);
  if (fs.existsSync(out)) return out;
  const wav = path.join(dir, `${key}.wav`);
  const encode = (input) => exec('ffmpeg', ['-loglevel', 'error', '-y', ...input, '-ac', '1', '-c:a', 'libopus', '-b:a', '24k', out]);
  try {
    await exec('espeak-ng', ['-v', code, '-s', '135', '-w', wav, text]);
    await encode(['-i', wav]);
  } catch {
    await encode(['-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '3']);
  } finally {
    fs.rmSync(wav, { force: true });
  }
  return out;
}

function removeDemo() {
  const school = get('SELECT id FROM school WHERE is_demo = 1');
  if (!school) return;
  fs.rmSync(path.join(config.dataDir, 'audio', String(school.id)), { recursive: true, force: true });
  tx(() => {
    run('DELETE FROM school WHERE id = ?', school.id);
    run(
      `DELETE FROM user WHERE is_demo = 1 AND id NOT IN (SELECT user_id FROM membership)
       AND id NOT IN (SELECT user_id FROM guardian_link)`,
    );
  });
}

function seedRows() {
  const year = academicYear();
  const schoolId = insert('school', {
    name: data.school.name, address: data.school.address, qr_mode: 'per_student', school_token: randomToken(),
    default_lang: data.school.defaultLang, enabled_langs: JSON.stringify(['hi', 'ta', 'bn', 'te', 'or', 'en']),
    academic_year: year, is_demo: 1, created_at: now(),
  });

  const users = {};
  const members = {};
  for (const p of data.people) {
    const user = findOrCreateUser({ phone: p.phone, name: p.name, isDemo: 1 });
    update('user', user.id, { ui_lang: p.lang });
    users[p.key] = user.id;
    if (p.role === 'admin' || p.role === 'teacher') {
      members[p.key] = insert('membership', {
        user_id: user.id, school_id: schoolId, role: p.role, admin_level: p.role === 'admin' ? 'owner' : null,
        speak_lang: p.lang, subjects: JSON.stringify(p.subjects || []), created_at: now(),
      });
    }
  }

  const classes = {};
  const students = {};
  for (const cls of data.classes) {
    const classId = insert('class', {
      school_id: schoolId, name: cls.name, section: cls.section, academic_year: year,
      class_teacher_id: members[cls.classTeacher], created_at: now(),
    });
    classes[`${cls.name}${cls.section}`] = { id: classId, students: [] };
    for (const key of cls.teachers) {
      const subjects = data.people.find((p) => p.key === key).subjects;
      insert('class_teacher', { class_id: classId, membership_id: members[key], subjects: JSON.stringify(subjects) });
    }
    cls.students.forEach((name, index) => {
      const parent = data.people.find((p) => p.child === name && p.role === 'parent');
      const id = insert('student', {
        school_id: schoolId, class_id: classId, name, name_normalised: nameKey(name), roll_no: String(index + 1),
        parent_phone: parent?.phone || null, token: randomToken(), created_at: now(),
      });
      insert('student_history', { student_id: id, class_id: classId, academic_year: year, from_date: now() });
      students[name] = id;
      classes[`${cls.name}${cls.section}`].students.push(id);
    });
  }

  for (const p of data.people.filter((x) => x.child)) {
    const pending = p.role === 'pending';
    insert('guardian_link', {
      student_id: students[p.child], user_id: users[p.key], relation: pending ? 'uncle' : 'parent', read_lang: p.lang,
      status: pending ? 'pending' : 'active', auto_verified: pending ? 0 : 1, consent_at: pending ? null : now(), created_at: now(),
    });
  }

  const audio = [];
  const noteIds = {};
  const addNote = (sample, { classId, recipients, kind, parentNoteId = null }) => {
    const created = ago(sample.hoursAgo);
    const id = insert('note', {
      school_id: schoolId, class_id: classId, author_user_id: users[sample.author], kind, parent_note_id: parentNoteId,
      audio_mime: 'audio/webm', duration_ms: Math.max(3000, sample.raw.length * 75), lang_hint: sample.lang,
      transcript_raw: sample.audioOnly ? null : sample.raw,
      transcript_clean: sample.audioOnly ? null : sample.clean || null,
      transcript_lang: sample.lang, tier: lang(sample.lang).tier,
      status: sample.audioOnly ? 'audio_only' : 'ready',
      stt_provider: sample.audioOnly ? null : 'sample', published_at: created, created_at: created,
      capture_ms: 9000 + sample.hoursAgo * 60, client_uuid: `demo-${sample.key}-${randomToken(8)}`,
    });
    const relative = path.join('audio', String(schoolId), 'demo', `${id}.webm`);
    update('note', id, { audio_path: relative });
    audio.push({ key: sample.key, text: sample.raw, lang: sample.lang, target: path.join(config.dataDir, relative) });
    for (const studentId of recipients) insert('note_recipient', { note_id: id, student_id: studentId });
    for (const tag of sample.tags || []) {
      insert('note_tag', { note_id: id, type: tag.type, subject: tag.subject || null, due_date: dueDate(tag.due), source: 'teacher' });
    }
    for (const [code, text] of Object.entries(sample.translations)) {
      insert('note_translation', { note_id: id, lang: code, text, provider: 'sample', created_at: created });
    }
    return id;
  };

  for (const sample of data.notes) {
    const cls = classes[sample.class];
    const recipients = sample.to === 'class' ? cls.students : sample.to.map((n) => students[n]);
    noteIds[sample.key] = addNote(sample, { classId: cls.id, recipients, kind: 'teacher_note' });
    for (const key of sample.heardBy || []) {
      const child = students[data.people.find((p) => p.key === key).child];
      if (recipients.includes(child)) {
        insert('listen_receipt', {
          note_id: noteIds[sample.key], student_id: child, user_id: users[key], first_played_at: ago(sample.hoursAgo - 1),
        });
      }
    }
  }
  for (const reply of data.replies) {
    const original = get('SELECT class_id FROM note WHERE id = ?', noteIds[reply.about]);
    addNote(reply, {
      classId: original.class_id, recipients: [students[reply.child]], kind: 'parent_reply', parentNoteId: noteIds[reply.about],
    });
  }
  return audio;
}

async function writeAudio(items) {
  for (const item of items) {
    try {
      const source = await sampleAudio(item.key, item.text, item.lang);
      fs.mkdirSync(path.dirname(item.target), { recursive: true });
      fs.copyFileSync(source, item.target);
    } catch (error) {
      console.warn(`demo audio ${item.key} not created: ${error.message}`);
    }
  }
}

/** Seeds the demo school once; `reset` rebuilds it. */
export async function seedDemo({ reset = false } = {}) {
  if (reset) removeDemo();
  if (get('SELECT 1 FROM school WHERE is_demo = 1')) {
    // Heal missing audio, for example after an interrupted first start.
    const missing = all(
      `SELECT n.audio_path, n.transcript_lang AS lang, n.client_uuid, n.transcript_raw AS raw FROM note n
       JOIN school s ON s.id = n.school_id WHERE s.is_demo = 1 AND n.client_uuid LIKE 'demo-%'`,
    ).filter((n) => !fs.existsSync(path.join(config.dataDir, n.audio_path)));
    const samples = [...data.notes, ...data.replies];
    await writeAudio(missing.map((n) => {
      const sample = samples.find((s) => n.client_uuid.startsWith(`demo-${s.key}-`));
      return { key: sample.key, text: sample.raw, lang: sample.lang, target: path.join(config.dataDir, n.audio_path) };
    }));
    return;
  }
  const audio = tx(seedRows);
  await writeAudio(audio);
}
