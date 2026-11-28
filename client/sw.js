// Offline shell, remembered diary pages and push notifications.
// Pages and data are network first (always fresh when there is a network), vendor files cache first.

const SHELL = 'vv-shell-v3';
const DATA = 'vv-data';
const VENDOR = 'vv-vendor-v2';

const SHELL_FILES = [
  '/', '/css/app.css', '/app.js', '/app-language.js', '/manifest.webmanifest', '/vendor/fonts.css', '/i18n/en.json',
  '/img/icon.svg', '/img/icon-192.png', '/img/badge-96.png',
  ...['api', 'capture', 'dom', 'i18n', 'install', 'languages', 'outbox', 'push', 'qr-scan', 'recorder', 'speak', 'state', 'translator-fallback', 'ui']
    .map((n) => `/lib/${n}.js`),
  ...['account', 'admin', 'auth', 'confirm', 'consent', 'home', 'note', 'parent', 'record', 'reply', 'scan', 'stickers', 'teacher']
    .map((n) => `/views/${n}.js`),
];

const CACHEABLE_API = [/^\/api\/(config|me|inbox|drafts)$/, /^\/api\/classes(\/\d+(\/students)?)?$/, /^\/api\/children\/\d+\/(notes|summary)$/, /^\/api\/notes\/\d+(\/audio)?$/];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA, VENDOR].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName, fallbackKey = request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.status === 200) cache.put(fallbackKey, response.clone());
    // Signing out or losing access removes the remembered copy.
    if (response.status === 401 || response.status === 403) cache.delete(fallbackKey);
    return response;
  } catch (error) {
    const cached = await cache.match(fallbackKey);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VENDOR);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.status === 200) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (!request.headers.has('range') && CACHEABLE_API.some((r) => r.test(url.pathname))) {
      event.respondWith(networkFirst(request, DATA));
    }
    return;
  }
  if (url.pathname.startsWith('/vendor/') && url.pathname !== '/vendor/fonts.css') {
    event.respondWith(cacheFirst(request));
    return;
  }
  // Every page address is the same single-page app.
  event.respondWith(networkFirst(request, SHELL, request.mode === 'navigate' ? '/' : request));
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() || { title: 'Vidya Vaani', body: '' };
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, tag: data.tag, icon: '/img/icon-192.png', badge: '/img/badge-96.png', data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows[0];
    return open ? open.focus().then(() => open.navigate(target)) : self.clients.openWindow(target);
  }));
});
