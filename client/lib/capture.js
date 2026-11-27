// A big microphone button: tap, speak, it stops by itself. Used for replies, re-speaking a word
// and filling forms by voice. The main recording screen has its own richer version.
import { h, icon, replace } from './dom.js';
import { t } from './i18n.js';
import { startRecording, recordingSupported } from './recorder.js';
import { stopSpeaking, chime } from './speak.js';
import { toast, button } from './ui.js';
import { navigate } from './state.js';

export function micError(error) {
  if (['NotAllowedError', 'SecurityError'].includes(error?.name)) {
    toast(t('mic_blocked'), true);
    return navigate('/help');
  }
  toast(t('mic_missing'), true);
}

export function voiceCapture({ language, label, onDone, onLeave, compact = true }) {
  let session = null;
  let busy = false;
  const live = h('div', { class: 'live', 'aria-live': 'polite', hidden: true });
  const caption = h('p', {}, label);
  const glyph = h('span', { style: 'display:grid' }, icon('microphone'));

  async function finish() {
    if (!session || busy) return;
    busy = true;
    const active = session;
    session = null;
    mic.classList.remove('recording');
    replace(glyph, icon('hourglass'));
    caption.textContent = t('processing');
    try {
      const result = await active.stop();
      if (result.durationMs < 800 || (!result.heardSpeech && !result.previewText)) {
        chime(false);
        toast(t('retry_short'), true);
      } else {
        await onDone(result);
      }
    } catch (error) {
      console.warn(error);
      toast(error.message === 'offline' ? t('err_offline') : t('err_generic'), true);
    } finally {
      busy = false;
      replace(glyph, icon('microphone'));
      caption.textContent = label;
      live.hidden = true;
    }
  }

  async function begin() {
    if (busy) return;
    if (session) return finish();
    if (!recordingSupported()) return micError();
    stopSpeaking();
    busy = true;
    try {
      session = await startRecording({
        language,
        onLevel: (level) => mic.style.setProperty('--level', level.toFixed(2)),
        onPreview: (text) => {
          live.hidden = !text;
          live.textContent = text;
        },
        onEnd: finish,
      });
      mic.classList.add('recording');
      replace(glyph, icon('stop'));
      caption.textContent = t('listening');
    } catch (error) {
      micError(error);
    } finally {
      busy = false;
    }
  }

  const mic = h('button', { type: 'button', class: `mic${compact ? ' compact' : ''}`, 'aria-label': label, onclick: begin }, glyph);
  onLeave?.(() => session?.cancel());
  return h('div', { class: 'stage' }, mic, caption, live);
}

export const micHelpButton = () => button(t('help_title'), { iconName: 'info', kind: 'outline', href: '/help' });
