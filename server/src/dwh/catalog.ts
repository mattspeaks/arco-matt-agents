import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, DATA_DIR, REPO_ROOT } from '../config.js';

// A read-only catalog of the DWH (every gold and silver table / view and its columns, as TSV), refreshed by the app
// with one fixed metadata query (server/scripts/dwh_catalog.py). The Power BI builder greps it to tell a column that's
// missing from gold from one that's in gold but not in the semantic model. Agents never get a SQL connection.

export const CATALOG_DBS = ['gold', 'silver'] as const;
const SCRIPT = resolve(REPO_ROOT, 'server/scripts/dwh_catalog.py');
const MAX_AGE_MS = 24 * 3600_000;

export const catalogPath = (db: string) => join(DATA_DIR, 'catalog', `${db}.tsv`);

export function catalogStatus() {
  return CATALOG_DBS.map((db) => {
    const p = catalogPath(db);
    return { db, path: p, asOf: existsSync(p) ? statSync(p).mtime.toISOString() : null };
  });
}

function build(db: string): Promise<string> {
  return new Promise((done, fail) => {
    execFile(config.powerbi.lint.python, [SCRIPT, '--db', db, '--out', catalogPath(db)], { windowsHide: true, timeout: 180_000 }, (err, stdout, stderr) => {
      if (err) fail(new Error(`catalog for ${db} failed: ${(stderr || err.message).toString().trim().slice(0, 300)}`));
      else done(String(stdout).trim());
    });
  });
}

let running: Promise<unknown> | null = null;

/** Rebuilds catalogs older than a day (or all, with force). Never throws: returns what's available. */
export async function ensureCatalog(force = false): Promise<{ db: string; path: string; asOf: string | null; error?: string }[]> {
  if (running) await running.catch(() => undefined);
  const stale = catalogStatus().filter((c) => force || !c.asOf || Date.now() - Date.parse(c.asOf) > MAX_AGE_MS);
  const errors = new Map<string, string>();
  if (stale.length) {
    running = Promise.all(stale.map((c) => build(c.db).catch((e: Error) => errors.set(c.db, e.message))));
    await running;
    running = null;
  }
  return catalogStatus().map((c) => ({ ...c, error: errors.get(c.db) }));
}
