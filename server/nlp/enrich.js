// One LLM call cleans the transcript and pulls out tags, dates and details (spec 5.3 and 5.4).
import { z } from 'zod';
import { completeJson, llmAvailable } from '../providers/llm.js';
import { lang } from '../../client/lib/languages.js';
import { ruleExtract, TAG_TYPES } from './tags.js';
import { isIsoDate, todayIst } from './dates.js';
import { numbersIn, numberAmbiguities } from './numbers.js';
import { transliterate } from './names.js';

const text = z.coerce.string();
const strings = z.array(text).catch([]).default([]);

export const enrichSchema = z.object({
  clean: z.string().min(1),
  changes: strings,
  tags: z.array(z.object({
    type: z.enum(TAG_TYPES),
    subject: z.string().nullable().catch(null).default(null),
    dueDate: z.string().nullable().catch(null).default(null),
  })).catch([]).default([]),
  entities: z.object({ amounts: strings, pages: strings, dates: strings, names: strings })
    .catch({ amounts: [], pages: [], dates: [], names: [] }).default({}),
  ambiguities: z.array(z.object({ what: text.catch('number'), options: z.array(text).min(2).max(3) })).catch([]).default([]),
});

const SYSTEM = `You tidy a school teacher's spoken note and extract its details.
Return one JSON object: {"clean": string, "changes": string[], "tags": [{"type": "homework"|"fee"|"exam"|"event"|"holiday"|"notice", "subject": string|null, "dueDate": "YYYY-MM-DD"|null}], "entities": {"amounts": string[], "pages": string[], "dates": string[], "names": string[]}, "ambiguities": [{"what": string, "options": [string, string]}]}
Rules for "clean": remove filler words and false starts, and fix obvious recognition errors using the class context. Keep the speaker's language, script, tone and any mixed-in English words. Do not translate. Do not add information. Never change a number, amount, date or name.
Rules for dates: today's date is given. In a homework, fee or exam context "kal" means tomorrow.
Rules for "ambiguities": only when the speaker gave two possible values for one number or date.`;

/** The clean text must keep every number and every student name that was in the raw text. */
export function mismatchBetween(raw, clean, rosterNames = []) {
  const a = new Set(numbersIn(raw));
  const b = new Set(numbersIn(clean));
  if ([...a].some((n) => !b.has(n)) || [...b].some((n) => !a.has(n))) return true;
  const has = (haystack, name) => {
    const first = name.split(/\s+/)[0].toLowerCase();
    return haystack.toLowerCase().includes(first) || transliterate(haystack).toLowerCase().includes(transliterate(first).toLowerCase());
  };
  return rosterNames.some((name) => has(raw, name) && !has(clean, name));
}

export async function enrich(raw, { langCode, today = todayIst(), names = [], school = '', subjects = [], recentTags = [] } = {}) {
  const rules = ruleExtract(raw, today);
  const fromRules = {
    clean: null,
    changes: [],
    tags: rules.tags.map((t) => ({ ...t, source: 'rules' })),
    entities: rules.entities,
    ambiguities: rules.ambiguities,
    mismatch: false,
    llmModel: null,
  };
  if (!llmAvailable()) return fromRules;

  const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const context = [
    `Today: ${today} (${weekday}).`,
    langCode ? `Language: ${lang(langCode).name}.` : '',
    school ? `School: ${school}.` : '',
    // First names only, to send the model as little as possible.
    names.length ? `Students: ${names.slice(0, 40).map((n) => n.split(/\s+/)[0]).join(', ')}.` : '',
    subjects.length ? `Teacher's subjects: ${subjects.join(', ')}.` : '',
    recentTags.length ? `Recent note types: ${recentTags.join(', ')}.` : '',
  ].filter(Boolean).join('\n');

  try {
    const { data, model } = await completeJson({
      system: SYSTEM,
      user: `${context}\n\nSpoken note:\n${raw}`,
      schema: enrichSchema,
    });
    const tags = data.tags.map((t) => ({
      type: t.type,
      subject: t.subject || null,
      dueDate: isIsoDate(t.dueDate) ? t.dueDate : null,
      source: 'llm',
    }));
    return {
      clean: data.clean.trim(),
      changes: data.changes,
      tags: tags.length ? tags : fromRules.tags,
      entities: data.entities,
      ambiguities: data.ambiguities.length ? data.ambiguities : numberAmbiguities(raw),
      mismatch: mismatchBetween(raw, data.clean, names),
      llmModel: model,
    };
  } catch (error) {
    // Rate limits and outages never block the teacher: rules answer now.
    return { ...fromRules, llmError: error.message };
  }
}
