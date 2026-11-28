// Recordings and read-aloud audio, kept in the database so no server needs a disk.
import { get, run } from '../db/index.js';
import { now } from '../lib/util.js';

/** Bytes travel as base64, which every database driver passes through unchanged. */
export async function saveMedia(key, { mime, data, noteId = null }) {
  await run(
    `INSERT INTO media (key, note_id, mime, data, created_at) VALUES (?, ?, ?, decode(?, 'base64'), ?)
     ON CONFLICT (key) DO UPDATE SET mime = excluded.mime, data = excluded.data`,
    key, noteId, mime, data.toString('base64'), now(),
  );
}

export async function loadMedia(key) {
  if (!key) return null;
  const row = await get(`SELECT mime, encode(data, 'base64') AS data FROM media WHERE key = ?`, key);
  return row ? { mime: row.mime, data: Buffer.from(row.data, 'base64') } : null;
}

/** Sends audio with byte ranges, which iPhone Safari needs before it will play anything. */
export function sendAudio(req, res, { mime, data }, { maxAge }) {
  res.set({ 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': `private, max-age=${maxAge}` });
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!range || (!range[1] && !range[2])) return res.set('Content-Length', String(data.length)).end(data);
  const size = data.length;
  // "bytes=-500" means the last 500 bytes.
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) return res.status(416).set('Content-Range', `bytes */${size}`).end();
  const part = data.subarray(start, end + 1);
  return res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(part.length) }).end(part);
}
