// Creating, publishing and presenting voice notes.
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { get, all, run, insert, update, tx } from '../db/index.js';
import { fail, now, parseJson } from '../lib/util.js';
import { lang, isLang } from '../../client/lib/languages.js';
import { enqueue } from '../jobs/queue.js';
import { todayIst } from '../nlp/dates.js';
import { saveMedia } from './media.js';
import { numbersIn } from '../nlp/numbers.js';

export const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } }).single('audio');

const AUDIO_TYPES = new Set([
  'audio/webm', 'video/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/wav', 'audio/x-wav',
]);

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

const findUpload = async (clientUuid, authorId) => {
  const existing = await get('SELECT * FROM note WHERE client_uuid = ?', clientUuid);
  if (existing && existing.author_user_id !== authorId) fail(409, 'duplicate_upload');
  return existing;
};

const whole = (value) => (value == null ? null : Math.round(value));

/** Saves the audio first, then queues the AI work. Re-sending the same client_uuid is harmless. */
export async function createNote({ file, fields, classRow, authorId, kind, recipients, parentNoteId = null, publish = false }) {
  const existing = await findUpload(fields.client_uuid, authorId);
  if (existing) return { note: existing, duplicate: true };
  const typed = !file && fields.typed_text;
  if (!typed && !file?.buffer?.length) fail(400, 'audio_missing');
  const mime = typed ? null : file.mimetype.split(';')[0].toLowerCase();
  if (!typed && !AUDIO_TYPES.has(mime)) fail(415, 'audio_type');
  if (!typed && fields.duration_ms != null && fields.duration_ms < 800) fail(400, 'too_short');
  if (fields.duration_ms != null && fields.duration_ms > (config.maxNoteSeconds + 5) * 1000) fail(413, 'too_long');

  const hint = isLang(fields.lang_hint) ? fields.lang_hint : null;
  const storedMime = mime === 'video/webm' ? 'audio/webm' : mime;
  let id;
  try {
    id = await tx(async () => {
      const noteId = await insert('note', {
        school_id: classRow.school_id,
        class_id: classRow.id,
        author_user_id: authorId,
        kind,
        parent_note_id: parentNoteId,
        audio_mime: storedMime,
        duration_ms: whole(fields.duration_ms),
        snr_db: fields.snr_db,
        lang_hint: hint,
        browser_preview_text: typed || fields.browser_preview_text?.trim() || null,
        tier: lang(hint || 'hi').tier,
        capture_ms: whole(fields.capture_ms),
        client_uuid: fields.client_uuid,
        created_at: now(),
      });
      for (const studentId of recipients) await insert('note_recipient', { note_id: noteId, student_id: studentId });
      if (typed) return noteId;
      const key = `note/${noteId}`;
      await saveMedia(key, { mime: storedMime, data: file.buffer, noteId });
      await update('note', noteId, { audio_path: key });
      return noteId;
    });
  } catch (error) {
    // The same recording arrived twice at once: the other request saved it.
    const saved = error.code === '23505' && await findUpload(fields.client_uuid, authorId);
    if (saved) return { note: saved, duplicate: true };
    throw error;
  }

  await enqueue('process_note', { noteId: id });
  if (publish) await publishNote(id);
  return { note: await get('SELECT * FROM note WHERE id = ?', id), duplicate: false };
}

export async function publishNote(noteId, { captureMs } = {}) {
  // Only the request that flips the note to published sends the notifications.
  const note = await get(
    `UPDATE note SET published_at = ?, capture_ms = COALESCE(?, capture_ms) WHERE id = ? AND published_at IS NULL RETURNING *`,
    now(), captureMs ?? null, noteId,
  );
  if (!note) return false;
  if (note.transcript_raw && note.status !== 'transcribing') await enqueue('translate_note', { noteId });
  await enqueue(note.kind === 'parent_reply' ? 'notify_reply' : 'notify_note', { noteId });
  return true;
}

const marks = (list) => list.map(() => '?').join(',');
const groupBy = (rows, key) => rows.reduce((map, row) => map.set(row[key], [...(map.get(row[key]) || []), row]), new Map());

/** Children of many notes in one query: Map of note id to [{id, name}]. */
export async function recipientsByNote(ids) {
  if (!ids.length) return new Map();
  const rows = await all(
    `SELECT nr.note_id, s.id, s.name FROM note_recipient nr JOIN student s ON s.id = nr.student_id
     WHERE nr.note_id IN (${marks(ids)}) ORDER BY s.name`,
    ...ids,
  );
  return new Map([...groupBy(rows, 'note_id')].map(([id, list]) => [id, list.map(({ id: sid, name }) => ({ id: sid, name }))]));
}

export const recipientsOf = async (noteId) => (await recipientsByNote([noteId])).get(noteId) || [];

export const tagsOf = (noteId) =>
  all('SELECT id, type, subject, due_date AS "dueDate", source FROM note_tag WHERE note_id = ? ORDER BY id', noteId);

export async function setTags(noteId, tags, source) {
  await run('DELETE FROM note_tag WHERE note_id = ?', noteId);
  for (const tag of tags) {
    await insert('note_tag', {
      note_id: noteId, type: tag.type, subject: tag.subject || null, due_date: tag.dueDate || null, source: tag.source || source,
    });
  }
}

export const saveTranslation = (noteId, code, value) =>
  run(
    `INSERT INTO note_translation (note_id, lang, text, provider, model, machine_warning, created_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (note_id, lang) DO UPDATE SET text = excluded.text, provider = excluded.provider, model = excluded.model,
       machine_warning = excluded.machine_warning, created_at = excluded.created_at`,
    noteId, code, value.text, value.provider, value.model, value.machineWarning ? 1 : 0, now(),
  );

/** The words a parent reads and translations start from: clean text unless it changed a detail. */
export const shownText = (note) =>
  (note.mismatch || !note.transcript_clean ? note.transcript_raw : note.transcript_clean) || '';

/** Every language this note must be translated into. */
export async function translationTargets(note) {
  const school = await get('SELECT default_lang FROM school WHERE id = ?', note.school_id);
  let rows;
  if (note.kind === 'parent_reply') {
    rows = await all(
      `SELECT COALESCE(u.ui_lang, m.speak_lang) AS code FROM class c
       JOIN membership m ON m.school_id = c.school_id AND m.role = 'teacher'
         AND (m.id = c.class_teacher_id OR m.user_id = (SELECT author_user_id FROM note WHERE id = ?))
       JOIN app_user u ON u.id = m.user_id WHERE c.id = ?`,
      note.parent_note_id, note.class_id,
    );
  } else {
    rows = await all(
      `SELECT COALESCE(gl.read_lang, u.ui_lang) AS code FROM note_recipient nr
       JOIN guardian_link gl ON gl.student_id = nr.student_id AND gl.status = 'active'
       JOIN app_user u ON u.id = gl.user_id WHERE nr.note_id = ?`,
      note.id,
    );
  }
  return [...new Set([...rows.map((r) => r.code || school.default_lang), 'en'])]
    .filter((code) => isLang(code) && code !== note.transcript_lang);
}

/** How many children's families have played each note: Map of note id to {total, heard}. */
export async function heardByNote(ids) {
  if (!ids.length) return new Map();
  const rows = await all(
    `SELECT nr.note_id, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM listen_receipt lr
         WHERE lr.note_id = nr.note_id AND lr.student_id = nr.student_id AND lr.user_id != COALESCE(n.author_user_id, 0))) AS heard
     FROM note_recipient nr JOIN note n ON n.id = nr.note_id
     WHERE nr.note_id IN (${marks(ids)}) GROUP BY nr.note_id`,
    ...ids,
  );
  return new Map(rows.map((r) => [r.note_id, { total: r.total, heard: r.heard }]));
}

export const heardSummary = async (noteId) => (await heardByNote([noteId])).get(noteId) || { total: 0, heard: 0 };

const presentTranslation = (row) =>
  (row ? { lang: row.lang, text: row.text, provider: row.provider, machineWarning: Boolean(row.machine_warning) } : null);

export const translationOf = async (noteId, code) =>
  presentTranslation(await get('SELECT * FROM note_translation WHERE note_id = ? AND lang = ?', noteId, code));

/** One language of many notes: Map of note id to translation. */
export async function translationsByNote(ids, code) {
  if (!ids.length) return new Map();
  const rows = await all(`SELECT * FROM note_translation WHERE lang = ? AND note_id IN (${marks(ids)})`, code, ...ids);
  return new Map(rows.map((r) => [r.note_id, presentTranslation(r)]));
}

export async function hasPendingJob(type, noteId) {
  return Boolean(await get(
    `SELECT 1 FROM job WHERE type = ? AND status != 'failed' AND (payload::jsonb ->> 'noteId')::int = ?`, type, noteId,
  ));
}

/** The shared shape of a note in every list, built with three queries however long the list is. */
export async function summariseAll(notes) {
  if (!notes.length) return [];
  const ids = notes.map((n) => n.id);
  const authorIds = [...new Set(notes.map((n) => n.author_user_id).filter(Boolean))];
  const classIds = [...new Set(notes.map((n) => n.class_id))];
  const [authors, classes, tags] = await Promise.all([
    authorIds.length ? all(`SELECT id, name FROM app_user WHERE id IN (${marks(authorIds)})`, ...authorIds) : [],
    all(`SELECT id, name, section, academic_year FROM class WHERE id IN (${marks(classIds)})`, ...classIds),
    all(
      `SELECT note_id, id, type, subject, due_date AS "dueDate", source FROM note_tag WHERE note_id IN (${marks(ids)}) ORDER BY id`,
      ...ids,
    ),
  ]);
  const authorName = new Map(authors.map((a) => [a.id, a.name]));
  const classOf = new Map(classes.map((c) => [c.id, c]));
  const tagsByNote = groupBy(tags, 'note_id');
  return notes.map((note) => {
    const cls = classOf.get(note.class_id);
    return {
      id: note.id,
      kind: note.kind,
      parentNoteId: note.parent_note_id,
      classId: note.class_id,
      className: `${cls.name}${cls.section}`,
      academicYear: cls.academic_year,
      authorName: authorName.get(note.author_user_id) || null,
      createdAt: note.created_at,
      publishedAt: note.published_at,
      status: note.status,
      durationMs: note.duration_ms,
      text: shownText(note) || note.browser_preview_text || '',
      lang: note.transcript_lang || note.lang_hint,
      audioUrl: note.audio_path ? `/api/notes/${note.id}/audio` : null,
      tags: (tagsByNote.get(note.id) || []).map(({ note_id: _n, ...tag }) => tag),
    };
  });
}

export const summarise = async (note) => (await summariseAll([note]))[0];

const NOISY_BELOW_DB = 12;

export async function presentNote(note, { viewLang, forTeacher = false } = {}) {
  const words = parseJson(note.words, null);
  const base = await summarise(note);
  const translation = viewLang && viewLang !== base.lang ? await translationOf(note.id, viewLang) : null;
  const out = {
    ...base,
    recipients: forTeacher ? await recipientsOf(note.id) : undefined,
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
    translationPending: Boolean(viewLang && !translation && await hasPendingJob('translate_note', note.id)),
    english: viewLang !== 'en' ? await translationOf(note.id, 'en') : null,
  };
  if (forTeacher) {
    out.heard = await heardSummary(note.id);
    out.today = todayIst();
    // For the read-back: spoken number words count as numbers too.
    out.numbers = numbersIn(shownText(note));
  }
  return out;
}
