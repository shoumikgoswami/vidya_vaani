// Web Push. The VAPID keys are generated on first start, so no outside account is needed.
import * as webpush from 'web-push';
import { config } from '../config.js';
import { all, run, getSetting, setSetting } from '../db/index.js';

function vapidKeys() {
  let publicKey = getSetting('vapid_public');
  let privateKey = getSetting('vapid_private');
  if (!publicKey || !privateKey) {
    ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
    setSetting('vapid_public', publicKey);
    setSetting('vapid_private', privateKey);
  }
  return { publicKey, privateKey };
}

export const vapidPublicKey = () => vapidKeys().publicKey;

const subject = () =>
  config.publicBaseUrl.startsWith('https://') ? config.publicBaseUrl : 'mailto:notifications@vidyavaani.invalid';

export async function sendToUser(userId, message) {
  const subs = all('SELECT * FROM push_subscription WHERE user_id = ?', userId);
  if (!subs.length) return 0;
  const { publicKey, privateKey } = vapidKeys();
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
      if (error.statusCode === 404 || error.statusCode === 410) run('DELETE FROM push_subscription WHERE id = ?', sub.id);
    }
  }));
  return sent;
}
