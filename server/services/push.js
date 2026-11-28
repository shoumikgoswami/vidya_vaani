// Web Push. The VAPID keys are generated on first start, so no outside account is needed.
import * as webpush from 'web-push';
import { config } from '../config.js';
import { all, run, getSetting, initSetting } from '../db/index.js';

let cached;

/** One key pair for the whole deployment, kept in the database. */
async function vapidKeys() {
  cached ||= JSON.parse(await getSetting('vapid') || await initSetting('vapid', JSON.stringify(webpush.generateVAPIDKeys())));
  return cached;
}

export const vapidPublicKey = async () => (await vapidKeys()).publicKey;

const subject = () =>
  config.publicBaseUrl.startsWith('https://') ? config.publicBaseUrl : 'mailto:notifications@vidyavaani.invalid';

export async function sendToUser(userId, message) {
  const subs = await all('SELECT * FROM push_subscription WHERE user_id = ?', userId);
  if (!subs.length) return 0;
  const { publicKey, privateKey } = await vapidKeys();
  let sent = 0;
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: JSON.parse(sub.keys) },
        JSON.stringify(message),
        { TTL: 86_400, timeout: 8000, vapidDetails: { subject: subject(), publicKey, privateKey } },
      );
      sent += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) await run('DELETE FROM push_subscription WHERE id = ?', sub.id);
    }
  }));
  return sent;
}
