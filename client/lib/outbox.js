// Audio is saved on the phone before it is uploaded, so a dead network never loses a note.
// Each entry carries a client_uuid, so re-sending it cannot create a duplicate.
import { api, ApiError } from './api.js';

const STORE = 'outbox';
let database;
const memory = new Map(); // used when IndexedDB is unavailable, such as some private modes

function open() {
  database ||= new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    const request = indexedDB.open('vidya-vaani', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'uuid' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return database;
}

async function withStore(mode, run) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const changed = async () => window.dispatchEvent(new CustomEvent('outbox', { detail: (await pending()).length }));

export async function pending() {
  const stored = (await withStore('readonly', (s) => s.getAll())) || [];
  return [...stored, ...memory.values()];
}

export async function queue(entry) {
  try {
    if ((await withStore('readwrite', (s) => s.put(entry))) === null) memory.set(entry.uuid, entry);
  } catch {
    memory.set(entry.uuid, entry);
  }
  await changed();
}

async function remove(uuid) {
  memory.delete(uuid);
  await withStore('readwrite', (s) => s.delete(uuid)).catch(() => {});
  await changed();
}

export const newUuid = () =>
  crypto.randomUUID?.() || `${Date.now().toString(36)}-${[...crypto.getRandomValues(new Uint32Array(4))].map((n) => n.toString(36)).join('')}`;

const inFlight = new Map();

/** Uploads one entry. Throws if it stays in the queue. */
export function send(entry) {
  if (!inFlight.has(entry.uuid)) {
    const job = (async () => {
      const body = new FormData();
      for (const [key, value] of Object.entries(entry.fields)) {
        if (value !== undefined && value !== null && value !== '') body.set(key, value);
      }
      body.set('client_uuid', entry.uuid);
      body.set('audio', entry.blob, `note.${entry.blob.type.includes('mp4') ? 'm4a' : 'webm'}`);
      try {
        const result = await api(entry.path, { method: 'POST', form: body });
        await remove(entry.uuid);
        return result;
      } catch (error) {
        // The server refused this recording for good. Keeping it would only loop forever.
        if (error instanceof ApiError && [400, 403, 404, 409, 413, 415].includes(error.status) && error.code !== 'csrf_failed') {
          await remove(entry.uuid);
        }
        throw error;
      }
    })().finally(() => inFlight.delete(entry.uuid));
    inFlight.set(entry.uuid, job);
  }
  return inFlight.get(entry.uuid);
}

export async function flush(userId) {
  if (!navigator.onLine) return 0;
  let sent = 0;
  for (const entry of await pending()) {
    // A shared phone: only upload what the signed-in person recorded.
    if (entry.userId !== userId) continue;
    try {
      await send(entry);
      sent += 1;
    } catch (error) {
      if (!(error instanceof ApiError)) break;
    }
  }
  await changed();
  return sent;
}
