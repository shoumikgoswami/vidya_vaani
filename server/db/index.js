// Postgres everywhere. DATABASE_URL points at Neon (the hosted app). Without it, PGlite runs a
// real Postgres inside this process and keeps it in the data folder, so Docker needs no database.
// "memory:" is a throwaway PGlite for tests and scripts.
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const migrationsDir = path.join(import.meta.dirname, 'migrations');
const INT8 = 20;
const NUMERIC = 1700;

/** Inside tx() every query goes to the transaction, without passing a handle around. */
const scope = new AsyncLocalStorage();

let opening;
const driver = () => {
  opening ||= (config.databaseUrl.startsWith('postgres') ? openNeon() : openPglite()).catch((error) => {
    opening = undefined;
    throw error;
  });
  return opening;
};

/** Hosted Postgres: one HTTPS request per query, and a short-lived connection for a transaction. */
async function openNeon() {
  const { neon, Pool, types } = await import('@neondatabase/serverless');
  // Counts and sums come back as numbers, as the rest of the code expects.
  types.setTypeParser(INT8, Number);
  types.setTypeParser(NUMERIC, Number);
  const url = config.databaseUrl;
  const http = neon(url, { fullResults: true });
  return {
    kind: 'neon',
    query: (text, params) => http.query(text, params),
    async transaction(fn) {
      const pool = new Pool({ connectionString: url });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: (text, params) => client.query(text, params),
          exec: (text) => client.query(text),
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
        await pool.end();
      }
    },
    close: async () => {},
  };
}

async function openPglite() {
  // A computed name keeps this large package out of the serverless bundle.
  const name = ['@electric-sql', 'pglite'].join('/');
  const { PGlite } = await import(name);
  const memory = config.databaseUrl === 'memory:';
  const dir = memory ? undefined : path.join(config.dataDir, 'pg');
  if (dir) fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new PGlite(dir, { parsers: { [INT8]: Number, [NUMERIC]: Number } });
  await db.waitReady;
  const wrap = (target) => ({
    query: async (text, params) => {
      const result = await target.query(text, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
    exec: (text) => target.exec(text),
  });
  const pg = {
    kind: 'pglite',
    query: wrap(db).query,
    transaction: (fn) => db.transaction((t) => fn(wrap(t))),
    close: () => db.close(),
  };
  // The built-in database belongs to this process alone, so it is brought up to date on opening.
  await applyMigrations(pg);
  return pg;
}

async function applyMigrations(target) {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  await target.transaction(async (t) => {
    // Two deploys or functions may start at once. Only one of them migrates.
    await t.query('SELECT pg_advisory_xact_lock(727401)', []);
    await t.exec('CREATE TABLE IF NOT EXISTS schema_version (version integer PRIMARY KEY)');
    const { rows } = await t.query('SELECT COALESCE(MAX(version), 0) AS version FROM schema_version', []);
    for (const [index, file] of files.entries()) {
      const version = index + 1;
      if (version <= Number(rows[0].version)) continue;
      await t.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      await t.query('INSERT INTO schema_version (version) VALUES ($1)', [version]);
    }
  });
}

/** Opens the database and applies pending migrations. The hosted build and the server call this. */
export async function migrate() {
  const db = await driver();
  if (db.kind === 'neon') await applyMigrations(db);
}

export async function close() {
  if (!opening) return;
  const db = await opening;
  opening = undefined;
  await db.close();
}

/** Queries are written with ? placeholders; Postgres numbers them. */
const numbered = (sql) => {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
};

async function query(sql, args) {
  const target = scope.getStore() || await driver();
  return target.query(numbered(sql), args.map((v) => (v === undefined ? null : v)));
}

export const get = async (sql, ...args) => (await query(sql, args)).rows[0];
export const all = async (sql, ...args) => (await query(sql, args)).rows;
export const run = async (sql, ...args) => ({ changes: (await query(sql, args)).rowCount });

/** Runs fn in a transaction. A tx() inside another one joins it. */
export async function tx(fn) {
  if (scope.getStore()) return fn();
  const db = await driver();
  return db.transaction((handle) => scope.run(handle, fn));
}

/** Returns the new row's id, for tables that have one. */
export async function insert(table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) RETURNING *`;
  return (await get(sql, ...keys.map((k) => row[k])))?.id;
}

export async function update(table, id, patch) {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  await run(sql, ...keys.map((k) => patch[k]), id);
}

/** Sorts text such as roll numbers and class names by their digits. */
export const byNumber = (column) => `NULLIF(regexp_replace(COALESCE(${column}, ''), '[^0-9]', '', 'g'), '')::bigint NULLS FIRST`;

export const getSetting = async (key) => (await get('SELECT value FROM setting WHERE key = ?', key))?.value;
/** Keeps the first value ever written, so two starting processes agree on it. */
export const initSetting = async (key, value) => {
  await run('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', key, value);
  return getSetting(key);
};
export const setSetting = (key, value) =>
  run('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
