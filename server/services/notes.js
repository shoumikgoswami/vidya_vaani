// Creating, publishing and presenting voice notes.
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { get, all, run, insert, update, tx } from '../db/index.js';
import { fail, now, parseJson } from '../lib/util.js';
import { lang, isLang } from '../../client/lib/languages.js';
import { enqueue } from '../jobs/queue.js';
import { todayIst } from '../nlp/dates.js';

export const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } }).single('audio');

const EXTENSIONS = {
  'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
};

const optionalNumber = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().finite().nullable()).catch(null);

export const noteFields = z.object({
  client_uuid: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
  lang_hint: z.string().max(8).optional(),
  browser_preview_text: z.string().max(6000).optional(),
  duration_ms: optionalNumber,
  snr_db: optionalNumber,
  capture_ms: optionalNumber,
  // The typed fallback, for a phone whose microphone is refused (spec 7).
  typed_text: z.string().trim().max(6000).optional(),
});

export const audioPathOf = (note) => (note.audio_path ? path.join(config.dataDir, note.audio_path) : null);

/** Saves the audio first, then queues the AI work. Re-sending the same client_uuid is harmless. */
export function createNote({ file, fields, classRow, authorId, kind, recipients, parentNoteId = null, publish = false }) {
  const existing = get('SELECT * FROM note WHERE client_uuid = ?', fields.client_uuid);
  if (existing) {
    if (existing.author_user_id !== authorId) fail(409, 'duplicate_upload');
    return { note: existing, duplicate: true };
  }
  const typed = !file && fields.typed_text;
  if (!typed && !file?.buffer?.length) fail(400, 'audio_missing');
  const mime = typed ? null : file.mimetype.split(';')[0].toLowerCase();
  const extension = typed ? null : EXTENSIONS[mime];
  if (!typed && !extension) fail(415, 'audio_type');
  if (!typed && fields.duration_ms != null && fields.duration_ms < 800) fail(400, 'too_short');
  if (fields.duration_ms != null && fields.duration_ms > (config.maxNoteSeconds + 5) * 1000) fail(413, 'too_long');

  const hint = isLang(fields.lang_hint) ? fields.lang_hint : null;
  const created = now();
  const id = tx(() => {
    const noteId = insert('note', {
      school_id: classRow.school_id,
      class_id: classRow.id,
      author_user_id: authorId,
      kind,
      parent_note_id: parentNoteId,
      audio_mime: mime === 'video/webm' ? 'audio/webm' : mime,
      duration_ms: fields.duration_ms,
      snr_db: fields.snr_db,
      lang_hint: hint,
      browser_preview_text: typed || fields.browser_preview_text?.trim() || null,
      tier: lang(hint || 'hi').tier,
      capture_ms: fields.capture_ms,
      client_uuid: fields.client_uuid,
      created_at: created,
    });
    for (const studentId of recipients) insert('note_recipient', { note_id: noteId, student_id: studentId });
    if (typed) return noteId;
    const relative = path.join('audio', String(classRow.school_id), created.slice(0, 4), created.slice(5, 7), `${noteId}.${extension}`);
    fs.mkdirSync(path.dirname(path.join(config.dataDir, relative)), { recursive: true });
    fs.writeFileSync(path.join(config.dataDir, relative), file.buffer);
    update('note', noteId, { audio_path: relative });
    return noteId;
  });

  enqueue('process_note', { noteId: id });
  if (publish) publishNote(id);
  return { note: get('SELECT * FROM note WHERE id = ?', id), duplicate: false };
}

export function publishNote(noteId, { captureMs } = {}) {
  const note = get('SELECT * FROM note WHERE id = ?', noteId);
  if (!note || note.published_at) return false;
  update('note', noteId, { published_at: now(), capture_ms: captureMs ?? note.capture_ms });
  if (note.transcript_raw && note.status !== 'transcribing') enqueue('translate_note', { noteId });
  enqueue(note.kind === 'parent_reply' ? 'notify_reply' : 'notify_note', { noteId });
  return true;
}

export function deleteNoteFiles(notes) {
  for (const note of notes) {
    const file = audioPathOf(note);
    if (file) fs.rmSync(file, { force: true });
  }
}

export const recipientsOf = (noteId) =>
  all('SELECT s.id, s.name FROM note_recipient nr JOIN student s ON s.id = nr.student_id WHERE nr.note_id = ? ORDER BY s.name', noteId);

export const tagsOf = (noteId) =>
  all('SELECT id, type, subject, due_date AS dueDate, source FROM note_tag WHERE note_id = ? ORDER BY id', noteId);

export function setTags(noteId, tags, source) {
  run('DELETE FROM note_tag WHERE note_id = ?', noteId);
  for (const tag of tags) {
    insert('note_tag', {
      note_id: noteId, type: tag.type, subject: tag.subject || null, due_date: tag.dueDate || null, source: tag.source || source,
    });
  }
}

/** The words a parent reads and translations start from: clean text unless it changed a detail. */
export const shownText = (note) =>
  (note.mismatch || !note.transcript_clean ? note.transcript_raw : note.transcript_clean) || '';

/** Every language this note must be translated into. */
export function translationTargets(note) {
  const school = get('SELECT default_lang FROM school WHERE id = ?', note.school_id);
  let rows;
  if (note.kind === 'parent_reply') {
    rows = all(
      `SELECT COALESCE(u.ui_lang, m.speak_lang) AS code FROM class c
       JOIN membership m ON m.school_id = c.school_id AND m.role = 'teacher'
         AND (m.id = c.class_teacher_id OR m.user_id = (SELECT author_user_id FROM note WHERE id = ?))
       JOIN user u ON u.id = m.user_id WHERE c.id = ?`,
      note.parent_note_id, note.class_id,
    );
  } else {
    rows = all(
      `SELECT COALESCE(gl.read_lang, u.ui_lang) AS code FROM note_recipient nr
       JOIN guardian_link gl ON gl.student_id = nr.student_id AND gl.status = 'active'
       JOIN user u ON u.id = gl.user_id WHERE nr.note_id = ?`,
      note.id,
    );
  }
  return [...new Set([...rows.map((r) => r.code || school.default_lang), 'en'])]
    .filter((code) => isLang(code) && code !== note.transcript_lang);
}

export const heardSummary = (noteId) =>
  get(
    `SELECT COUNT(*) AS total,
       COUNT(CASE WHEN EXISTS (SELECT 1 FROM listen_receipt lr JOIN note n ON n.id = lr.note_id
         WHERE lr.note_id = nr.note_id AND lr.student_id = nr.student_id AND lr.user_id != COALESCE(n.author_user_id, 0))
       THEN 1 END) AS heard
     FROM note_recipient nr WHERE nr.note_id = ?`,
    noteId,
  );

export function translationOf(noteId, code) {
  const row = get('SELECT * FROM note_translation WHERE note_id = ? AND lang = ?', noteId, code);
  return row ? { lang: row.lang, text: row.text, provider: row.provider, machineWarning: Boolean(row.machine_warning) } : null;
}

export function hasPendingJob(type, noteId) {
  return Boolean(get(
    `SELECT 1 FROM job WHERE type = ? AND status != 'failed' AND json_extract(payload, '$.noteId') = ?`, type, noteId,
  ));
}

export function summarise(note) {
  const author = get('SELECT name FROM user WHERE id = ?', note.author_user_id);
  const cls = get('SELECT name, section, academic_year FROM class WHERE id = ?', note.class_id);
  return {
    id: note.id,
    kind: note.kind,
    parentNoteId: note.parent_note_id,
    classId: note.class_id,
    className: `${cls.name}${cls.section}`,
    academicYear: cls.academic_year,
    authorName: author?.name || null,
    createdAt: note.created_at,
    publishedAt: note.published_at,
    status: note.status,
    durationMs: note.duration_ms,
    text: shownText(note) || note.browser_preview_text || '',
    lang: note.transcript_lang || note.lang_hint,
    audioUrl: note.audio_path ? `/api/notes/${note.id}/audio` : null,
    tags: tagsOf(note.id),
  };
}

const NOISY_BELOW_DB = 12;

export function presentNote(note, { viewLang, forTeacher = false } = {}) {
  const words = parseJson(note.words, null);
  const base = summarise(note);
  const translation = viewLang && viewLang !== base.lang ? translationOf(note.id, viewLang) : null;
  const out = {
    ...base,
    recipients: forTeacher ? recipientsOf(note.id) : undefined,
    transcript: {
      raw: note.transcript_raw,
      clean: note.transcript_clean,
      preview: note.browser_preview_text,
      lang: base.lang,
      words,
      provider: note.stt_provider,
      model: note.stt_model,
      llmModel: note.llm_model,
      mismatch: Boolean(note.mismatch),
      approximate: Boolean(note.approximate),
    },
    ambiguities: parseJson(note.ambiguities, []),
    flags: {
      noisy: note.snr_db != null && note.snr_db < NOISY_BELOW_DB,
      lowConfidence: (note.transcript_conf != null && note.transcript_conf < 0.6) || parseJson(note.changes, []).length > 5,
      keyMissing: !config.nvidia.apiKey,
    },
    viewLang: viewLang || null,
    translation,
    translationPending: Boolean(viewLang && !translation && hasPendingJob('translate_note', note.id)),
    english: viewLang !== 'en' ? translationOf(note.id, 'en') : null,
  };
  if (forTeacher) {
    out.heard = heardSummary(note.id);
    out.today = todayIst();
  }
  return out;
}
