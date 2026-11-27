// A voice reply: speak, it uploads at once, and it waits on the phone if there is no network (J6, J7).
import { h, replace } from '../lib/dom.js';
import { t, languageOf } from '../lib/i18n.js';
import { voiceCapture } from '../lib/capture.js';
import * as outbox from '../lib/outbox.js';
import { chime, speak } from '../lib/speak.js';
import { store } from '../lib/state.js';
import { notice } from '../lib/ui.js';

export function voiceReply({ noteId, studentId, language, label, onSent, onLeave }) {
  const box = h('div', { class: 'stack' });
  const openedAt = Date.now();
  const capture = voiceCapture({
    language, label: label || t('reply_by_voice'), onLeave,
    onDone: async (result) => {
      const entry = {
        uuid: outbox.newUuid(),
        userId: store.me.user.id,
        path: `/notes/${noteId}/reply`,
        blob: result.blob,
        fields: {
          student_id: studentId, lang_hint: language, browser_preview_text: result.previewText,
          duration_ms: result.durationMs, snr_db: result.snrDb, capture_ms: Date.now() - openedAt,
        },
      };
      await outbox.queue(entry);
      let key = 'reply_sent';
      try {
        await outbox.send(entry);
      } catch (error) {
        if (error.message !== 'offline' && error.status < 500) throw error;
        key = 'offline_saved';
      }
      chime();
      replace(box, notice('check-circle', [h('p', { role: 'status' }, t(key))]), capture);
      speak(t(key), languageOf(key));
      onSent?.();
    },
  });
  box.append(capture);
  return box;
}
