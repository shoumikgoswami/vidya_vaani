// Web Push subscription and the "add to home screen" prompt.
import { post } from './api.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushState = () => (pushSupported() ? Notification.permission : 'unsupported');

const toBytes = (base64) => {
  const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

export async function enablePush(publicKey) {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;
  const registration = await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    || (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) }));
  await post('/push/subscribe', subscription.toJSON());
  return 'granted';
}

let installEvent = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installEvent = event;
});

export const canInstall = () => Boolean(installEvent);

export async function install() {
  if (!installEvent) return false;
  installEvent.prompt();
  const choice = await installEvent.userChoice;
  installEvent = null;
  return choice.outcome === 'accepted';
}
