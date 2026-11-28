// Periodic work: due-date reminders and the data retention rule (spec J8 and 13).
import { all, run } from '../db/index.js';
import { todayIst, addDays, hourIst } from '../nlp/dates.js';
import { sendDueReminders } from './handlers.js';
import { audit } from '../lib/util.js';

/** Notes are kept for the academic year (ending 31 March) plus the school's retention years. */
export async function purgeExpiredNotes(today = todayIst()) {
  const rows = await all(
    `SELECT n.id, n.school_id, c.academic_year, s.retention_years FROM note n
     JOIN class c ON c.id = n.class_id JOIN school s ON s.id = n.school_id`,
  );
  const expired = rows.filter((r) => {
    const startYear = Number(r.academic_year.slice(0, 4));
    return startYear && today > `${startYear + 1 + r.retention_years}-03-31`;
  });
  for (const note of expired) {
    await run('DELETE FROM note WHERE id = ?', note.id);
    await audit(null, 'note.expired', { schoolId: note.school_id, entity: 'note', entityId: note.id });
  }
  return expired.length;
}

export async function reminderTick(at = Date.now()) {
  const hour = hourIst(at);
  if (hour < 18 || hour >= 21) return 0;
  return sendDueReminders(addDays(todayIst(at), 1));
}

/** Expired sign-ins and old counters. */
export async function sweep() {
  await run('DELETE FROM session WHERE expires_at < ?', Date.now());
  await run('DELETE FROM throttle WHERE window_start < ?', Date.now() - 86_400_000);
}

export function startSchedules() {
  const safely = (fn) => () => Promise.resolve(fn()).catch((e) => console.error('schedule failed:', e.message));
  setInterval(safely(() => reminderTick()), 5 * 60_000).unref();
  setInterval(safely(() => purgeExpiredNotes()), 12 * 3_600_000).unref();
  setInterval(safely(sweep), 12 * 3_600_000).unref();
  setTimeout(safely(() => reminderTick()), 5000).unref();
}
