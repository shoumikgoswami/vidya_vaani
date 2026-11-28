// Background work: transcribe, enrich, translate, notify (spec 5.8).
import { get, all, update, run } from '../db/index.js';
import { parseJson } from '../lib/util.js';
import { lang } from '../../client/lib/languages.js';
import { register, enqueue, RetryLater } from './queue.js';
import { transcribe } from '../providers/asr.js';
import { translate } from '../providers/translate.js';
import { enrich } from '../nlp/enrich.js';
import { sendToUser } from '../services/push.js';
import { t } from '../services/i18n.js';
import { setTags, shownText, translationTargets, recipientsOf, saveTranslation } from '../services/notes.js';
import { loadMedia } from '../services/media.js';
import { aiAllowed } from '../services/demo-budget.js';
import { tokens } from '../nlp/text.js';

const noteById = (id) => get('SELECT * FROM note WHERE id = ?', id);

/**
 * Amber words: low model confidence, or disagreement with the browser's own live transcript.
 * The browser is only trusted as a second opinion when the two mostly agree.
 */
export function markUncertain(text, words, preview) {
  const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
  const list = words?.length ? words : tokens(text).map((w) => ({ w, conf: null }));
  const heard = new Set(tokens(preview).map(norm));
  const overlap = list.length ? list.filter((x) => heard.has(norm(x.w))).length / list.length : 0;
  return list.map((x) => ({
    w: x.w,
    conf: x.conf,
    uncertain: (x.conf != null && x.conf < 0.7) || (overlap >= 0.5 && !heard.has(norm(x.w))),
  }));
}

/** The browser's live text, used when NVIDIA is not available for this note. */
function browserResult(note) {
  if (!note.browser_preview_text) return null;
  return { text: note.browser_preview_text, words: null, conf: null, language: note.lang_hint, provider: 'browser', model: 'web-speech', approximate: false };
}

async function saveTranscript(note, result, status) {
  const school = await get('SELECT name FROM school WHERE id = ?', note.school_id);
  const author = await get(
    `SELECT subjects FROM membership WHERE user_id = ? AND school_id = ? AND role = 'teacher'`, note.author_user_id, note.school_id,
  );
  const transcriptLang = result.language || note.lang_hint;
  const extracted = await enrich(result.text, {
    langCode: transcriptLang,
    names: (await recipientsOf(note.id)).map((r) => r.name),
    school: school.name,
    subjects: parseJson(author?.subjects, []),
  });
  const fresh = await noteById(note.id);
  if (!fresh) return;
  const patch = {
    stt_provider: result.provider,
    stt_model: result.model,
    status,
    approximate: result.approximate ? 1 : 0,
    transcript_lang: transcriptLang,
    tier: lang(transcriptLang || 'hi').tier,
  };
  // A teacher who has already corrected the note keeps their words.
  if (!fresh.edited) {
    Object.assign(patch, {
      transcript_raw: result.text,
      transcript_clean: extracted.clean,
      transcript_conf: result.conf,
      words: JSON.stringify(markUncertain(result.text, result.words, note.browser_preview_text)),
      changes: JSON.stringify(extracted.changes),
      ambiguities: JSON.stringify(extracted.ambiguities),
      mismatch: extracted.mismatch ? 1 : 0,
      llm_model: extracted.llmModel,
    });
    if (!await get(`SELECT 1 FROM note_tag WHERE note_id = ? AND source = 'teacher'`, note.id) && note.kind === 'teacher_note') {
      await setTags(note.id, extracted.tags);
    }
  }
  await update('note', note.id, patch);
  if (fresh.published_at && status !== 'transcribing') await enqueue('translate_note', { noteId: note.id });
}

async function processNote({ noteId }) {
  const note = await noteById(noteId);
  if (!note) return;
  await update('note', noteId, { status: 'transcribing' });

  if (!note.audio_path) {
    // Typed into the form because the microphone was refused.
    const typed = { ...browserResult(note), provider: 'typed', model: null };
    await saveTranscript(note, typed, 'ready');
    return;
  }

  let result;
  try {
    const audio = await loadMedia(note.audio_path);
    result = audio && await aiAllowed(note.school_id) && await transcribe(audio.data, { languageHint: note.lang_hint });
  } catch (error) {
    const fallback = browserResult(note);
    if (error.transient) {
      // Show the browser's text meanwhile and try NVIDIA again later (spec 7).
      if (fallback && !note.transcript_raw) await saveTranscript(note, fallback, 'transcribing');
      throw new RetryLater(error.message);
    }
    if (fallback) await saveTranscript(note, fallback, 'transcript_failed');
    else await update('note', noteId, { status: 'transcript_failed' });
    return;
  }

  result ||= browserResult(note);
  if (!result) {
    await update('note', noteId, { status: 'audio_only' });
    return;
  }
  await saveTranscript(note, result, 'ready');
}

async function translateNote({ noteId, langs }) {
  const note = await noteById(noteId);
  if (!note) return;
  const source = shownText(note);
  if (!source) return;
  const have = new Set((await all('SELECT lang FROM note_translation WHERE note_id = ?', noteId)).map((r) => r.lang));
  const targets = (langs?.length ? langs : await translationTargets(note)).filter((c) => !have.has(c));
  if (!targets.length || !await aiAllowed(note.school_id)) return;

  const school = await get('SELECT name FROM school WHERE id = ?', note.school_id);
  const names = (await recipientsOf(noteId)).flatMap((r) => [r.name, r.name.split(/\s+/)[0]]);
  let result;
  try {
    result = await translate(source, note.transcript_lang, targets, { protectTerms: [...names, school.name] });
  } catch (error) {
    if (error.transient) throw new RetryLater(error.message);
    return;
  }
  for (const [code, value] of Object.entries(result)) await saveTranslation(noteId, code, value);
}

const guardiansOf = (noteId) =>
  all(
    `SELECT DISTINCT gl.user_id, gl.student_id, s.name AS child,
       COALESCE(u.ui_lang, gl.read_lang, sc.default_lang) AS lang
     FROM note_recipient nr
     JOIN student s ON s.id = nr.student_id
     JOIN school sc ON sc.id = s.school_id
     JOIN guardian_link gl ON gl.student_id = s.id AND gl.status = 'active' AND gl.consent_at IS NOT NULL
     JOIN app_user u ON u.id = gl.user_id
     WHERE nr.note_id = ?`,
    noteId,
  );

export async function pushNewNote(noteId, { userFilter } = {}) {
  const seen = new Set();
  return Promise.all((await guardiansOf(noteId))
    .filter((g) => (!userFilter || userFilter(g)) && !seen.has(g.user_id) && seen.add(g.user_id))
    .map((g) => sendToUser(g.user_id, {
      title: 'Vidya Vaani',
      body: t(g.lang, 'parent_new_note', { child: g.child.split(' ')[0] }),
      url: `/p/note/${noteId}?child=${g.student_id}`,
      tag: `note-${noteId}`,
    })));
}

async function notifyReply({ noteId }) {
  const note = await noteById(noteId);
  if (!note) return;
  const target = await get(
    `SELECT u.id, u.ui_lang, c.school_id FROM class c
     LEFT JOIN note original ON original.id = ?
     LEFT JOIN membership m ON m.id = c.class_teacher_id
     JOIN app_user u ON u.id = COALESCE(original.author_user_id, m.user_id)
     WHERE c.id = ?`,
    note.parent_note_id, note.class_id,
  );
  if (!target) return;
  const child = (await recipientsOf(noteId))[0]?.name.split(' ')[0] || '';
  await sendToUser(target.id, {
    title: 'Vidya Vaani',
    body: t(target.ui_lang || 'en', 'push_reply', { child }),
    url: '/t/inbox',
    tag: `reply-${noteId}`,
  });
}

async function notifyApproval({ linkId }) {
  const row = await get(
    `SELECT s.name AS child, m.user_id, u.ui_lang, s.class_id FROM guardian_link gl
     JOIN student s ON s.id = gl.student_id JOIN class c ON c.id = s.class_id
     JOIN membership m ON m.id = c.class_teacher_id JOIN app_user u ON u.id = m.user_id
     WHERE gl.id = ? AND gl.status = 'pending'`,
    linkId,
  );
  if (!row) return;
  await sendToUser(row.user_id, {
    title: 'Vidya Vaani',
    body: t(row.ui_lang || 'en', 'push_approval', { child: row.child.split(' ')[0] }),
    url: `/t/class/${row.class_id}`,
    tag: `approval-${linkId}`,
  });
}

async function notifyLinked({ linkId }) {
  const row = await get(
    `SELECT gl.user_id, s.name AS child, COALESCE(u.ui_lang, gl.read_lang) AS lang FROM guardian_link gl
     JOIN student s ON s.id = gl.student_id JOIN app_user u ON u.id = gl.user_id WHERE gl.id = ?`,
    linkId,
  );
  if (row) {
    await sendToUser(row.user_id, {
      title: 'Vidya Vaani', body: t(row.lang || 'en', 'push_approved', { child: row.child.split(' ')[0] }), url: '/p', tag: `linked-${linkId}`,
    });
  }
}

/** 6 pm the day before a homework, fee or exam deadline (spec J8). */
export async function sendDueReminders(tomorrow) {
  const due = await all(
    `SELECT DISTINCT n.id AS "noteId", nt.type FROM note n JOIN note_tag nt ON nt.note_id = n.id
     WHERE n.kind = 'teacher_note' AND n.published_at IS NOT NULL AND nt.due_date = ? AND nt.type IN ('homework','fee','exam')`,
    tomorrow,
  );
  let count = 0;
  for (const { noteId, type } of due) {
    for (const g of await guardiansOf(noteId)) {
      const first = await run(
        'INSERT INTO reminder_sent (note_id, user_id, due_date) VALUES (?,?,?) ON CONFLICT DO NOTHING', noteId, g.user_id, tomorrow,
      );
      if (!first.changes) continue;
      count += 1;
      await sendToUser(g.user_id, {
        title: 'Vidya Vaani',
        body: t(g.lang, 'parent_due_tomorrow', { tag: t(g.lang, `tag_${type}`) }),
        url: `/p/note/${noteId}?child=${g.student_id}`,
        tag: `due-${noteId}`,
      });
    }
  }
  return count;
}

export function registerHandlers() {
  register('process_note', processNote, {
    onGiveUp: ({ noteId }) => update('note', noteId, { status: 'transcript_failed' }),
  });
  register('translate_note', translateNote);
  register('notify_note', ({ noteId }) => pushNewNote(noteId));
  register('notify_reply', notifyReply);
  register('notify_approval', notifyApproval);
  register('notify_linked', notifyLinked);
}
