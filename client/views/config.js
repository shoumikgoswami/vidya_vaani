// The school office's technical page: services, models, languages and usage. Everything about
// speech, keys and models lives here and nowhere else. It shows whether a key is set, never the key.
import { h, add, icon, replace } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { t, formatDate } from '../lib/i18n.js';
import { lang as languageInfo } from '../lib/languages.js';
import { adminSchoolId, navigate } from '../lib/state.js';
import { skeletons, failure, notice, reveal } from '../lib/ui.js';

const SPEECH_LABEL = {
  parakeet: ['check-circle', 'status_parakeet'], whisper: ['check-circle', 'status_whisper'],
  approximate: ['info', 'status_approximate'], browser: ['globe', 'status_browser'], audio_only: ['play', 'status_audio_only'],
};

const table = (headings, rows) => h('div', { class: 'table-wrap' }, h('table', {},
  h('thead', {}, h('tr', {}, headings.map((x) => h('th', {}, x)))),
  h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c ?? '-')))))));

const card = (title, ...children) => h('section', { class: 'card' }, h('h2', {}, title), ...children);

const facts = (rows) => h('dl', { class: 'readback' }, rows.map(([label, value]) => [h('dt', {}, label), h('dd', {}, value)]));

const key = (on) => h('span', { class: on ? 'pill-ok' : 'pill-warn' }, t(on ? 'config_set' : 'config_not_set'));

function services({ system, nvidia, openrouter }) {
  return card(t('config_services'),
    facts([
      [t('config_nvidia'), key(nvidia)],
      [t('config_openrouter'), key(openrouter)],
      [t('config_sign_in'), t(system.signIn === 'clerk' ? 'config_sign_in_clerk' : system.signIn === 'demo' ? 'config_sign_in_demo' : 'config_not_set')],
      [t('config_database'), t(system.database === 'hosted' ? 'config_database_hosted' : 'config_database_builtin')],
      [t('config_address'), system.publicBaseUrl],
      [t('config_demo'), t(system.demoMode ? 'config_on' : 'config_off')],
      system.demoMode && [t('config_demo_limit'), system.demoAiDailyLimit || t('config_no_limit')],
    ].filter(Boolean)),
    h('p', { class: 'muted small' }, t('config_keys_help')));
}

const models = ({ llmModels, speech }) =>
  card(t('config_models'),
    facts([
      [t('config_text_models'), llmModels.length ? h('span', { class: 'models' }, llmModels.join(', ')) : t('config_not_set')],
      [t('status_speech'), h('span', { class: 'models' }, speech.asr.join(', ') || t('config_not_set'))],
      [t('status_voice'), h('span', { class: 'models' }, speech.voice || t('status_phone_voice'))],
    ]));

const languages = (status) =>
  card(t('ai_status'), h('ul', { class: 'lang-status' }, status.languages.map((l) => {
    const detail = (label, value) => h('span', { class: 'muted small' }, `${label}: ${value}`);
    return h('li', {},
      h('span', { class: 'tier', title: t('tier') }, l.tier),
      h('span', { class: 'grow' },
        h('strong', {}, l.name, ' ', h('span', { class: 'muted', lang: l.code }, l.native)),
        h('span', { class: 'row' }, icon(SPEECH_LABEL[l.speech][0], { size: 18 }), detail(t('status_speech'), t(SPEECH_LABEL[l.speech][1]))),
        detail(t('status_translation'), l.translation === 'browser' ? t('status_key_missing') : `${l.translation}${l.machineWarning ? ` (${t('may_be_wrong')})` : ''}`),
        detail(t('status_voice'), l.tts === 'magpie' ? 'NVIDIA' : t('status_phone_voice'))));
  })));

const usage = ({ aiUsage }) =>
  card(t('ai_calls'), aiUsage.length
    ? table([t('date'), t('model'), t('calls'), t('errors_429'), t('errors_other')], aiUsage.map((u) => [formatDate(u.day), u.model, u.calls, u.errors429, u.errorsOther]))
    : h('p', { class: 'muted' }, t('nothing_yet')));

const quality = ({ quality: rows }) =>
  card(t('quality'), rows.length
    ? table([t('language'), t('metric_notes'), t('low_conf_pct'), t('edited_pct')], rows.map((q) => [
      languageInfo(q.lang).name, q.notes, q.lowPercent == null ? null : `${q.lowPercent}%`, q.editedPercent == null ? null : `${q.editedPercent}%`]))
    : h('p', { class: 'muted' }, t('nothing_yet')));

export async function configuration(ctx) {
  const holder = h('div', { class: 'view' }, skeletons(3));
  add(ctx.root, h('h1', {}, t('configuration')), h('p', { class: 'muted' }, t('config_intro')), holder);
  try {
    const status = await api(`/school/config?school=${adminSchoolId()}`);
    if (!ctx.alive()) return;
    holder.textContent = '';
    reveal(holder);
    add(holder,
      !status.nvidia && notice('info', [h('p', {}, t('config_without_nvidia'))], 'warn'),
      h('div', { class: 'split' },
        h('div', { class: 'split-col' }, services(status), models(status), usage(status), quality(status)),
        h('div', { class: 'split-col' }, languages(status))));
  } catch (error) {
    if (ctx.alive()) replace(holder, failure(error, () => navigate(location.pathname, { replace: true })));
  }
}
