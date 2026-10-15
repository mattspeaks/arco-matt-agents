import { createRequire } from 'node:module';
import { DB_CONNECTION } from '../config.js';
import { SCHEMA } from './schema.js';

// msnodesqlv8 talks ODBC, which is what LocalDB's named pipe needs (tedious can't reach it).
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sql: any = require('msnodesqlv8');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pool: any = null;

type Param = string | number | boolean | null | undefined | Date | object;

function normalize(p: Param): unknown {
  if (p === undefined || p === null) return null;
  if (typeof p === 'boolean') return p ? 1 : 0;
  if (p instanceof Date) return p.toISOString();
  if (typeof p === 'object') return JSON.stringify(p);
  return p;
}

function databaseName(cs: string): string {
  return /Database=([^;]+)/i.exec(cs)?.[1] ?? 'ArcoAgents';
}

/** Creates the database if missing (connecting through master), then applies the idempotent schema. */
export async function initDb(): Promise<void> {
  const dbName = databaseName(DB_CONNECTION);
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error(`Unsafe database name: ${dbName}`);
  const masterCs = DB_CONNECTION.replace(/Database=[^;]+/i, 'Database=master');
  const con = await sql.promises.open(masterCs);
  try {
    await con.promises.query(`IF DB_ID('${dbName}') IS NULL CREATE DATABASE [${dbName}]`);
  } finally {
    await con.promises.close();
  }

  pool = new sql.Pool({ connectionString: DB_CONNECTION, ceiling: 8 });
  await pool.promises.open();
  for (const statement of SCHEMA) await query(statement);
}

export async function query<T = Record<string, unknown>>(text: string, params: Param[] = []): Promise<T[]> {
  if (!pool) throw new Error('Database not initialised; call initDb() first');
  const res = await pool.promises.query(text, params.map(normalize));
  return (res.first ?? []) as T[];
}

export async function queryOne<T = Record<string, unknown>>(text: string, params: Param[] = []): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

export async function closeDb(): Promise<void> {
  if (pool) await pool.promises.close();
  pool = null;
}
