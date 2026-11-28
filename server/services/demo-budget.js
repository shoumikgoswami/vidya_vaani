// A public demo is open to anyone, so its sample school may only spend so much AI a day.
// Real schools are never limited. Past the limit the demo behaves as it does without a key.
import { config } from '../config.js';
import { get } from '../db/index.js';
import { allow } from '../lib/util.js';

export async function aiAllowed(schoolId) {
  if (!config.demoAiDailyLimit) return true;
  if (!(await get('SELECT 1 FROM school WHERE id = ? AND is_demo = 1', schoolId))) return true;
  return allow('demo-ai', config.demoAiDailyLimit, 86_400_000);
}

/** For requests that name no school, such as filling a form by voice. */
export async function aiAllowedFor(userId) {
  const row = await get('SELECT school_id FROM membership WHERE user_id = ? AND active = 1 LIMIT 1', userId);
  return row ? aiAllowed(row.school_id) : true;
}
