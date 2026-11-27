import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

export const db = new Database(path.join(config.dataDir, 'vidya.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const migrationsDir = path.join(import.meta.dirname, 'migrations');

export function migrate() {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const current = db.pragma('user_version', { simple: true });
  files.forEach((file, index) => {
    const version = index + 1;
    if (version <= current) return;
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      db.pragma(`user_version = ${version}`);
    })();
  });
}

migrate();

const statements = new Map();
const prepare = (sql) => {
  let s = statements.get(sql);
  if (!s) {
    s = db.prepare(sql);
    statements.set(sql, s);
  }
  return s;
};

export const get = (sql, ...args) => prepare(sql).get(...args);
export const all = (sql, ...args) => prepare(sql).all(...args);
export const run = (sql, ...args) => prepare(sql).run(...args);
export const tx = (fn) => db.transaction(fn)();

export function insert(table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return Number(prepare(sql).run(...keys.map((k) => row[k])).lastInsertRowid);
}

export function update(table, id, patch) {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  prepare(sql).run(...keys.map((k) => patch[k]), id);
}

export const getSetting = (key) => get('SELECT value FROM setting WHERE key = ?', key)?.value;
export const setSetting = (key, value) =>
  run('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
