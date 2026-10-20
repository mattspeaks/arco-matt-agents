import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, REPO_ROOT } from '../config.js';
import { ONTOLOGY_DIR } from './ontology.js';

// The data bots' read-only query tool (dwh_query). Bots never get a connection: they send one SELECT, the app checks it
// here, and server/scripts/dwh_query.py runs it inside a transaction that is always rolled back, returning a few rows.
// The signed-in identity can write to gold and silver, so every rule below matters:
// - one SELECT / WITH statement; no write, DDL, EXEC or session keywords; no `;` chains
// - only the catalog's databases (gold, silver, source bronze), never bronze_confidential or anything else, including
//   through three-part names
// - columns the ontology flags sensitive (and config.dwh.query.blockedColumnPatterns) only inside COUNT(...)
// - capped rows, a timeout, and a per-run limit. Each call shows in the bot's run log (tool call + result).

const SCRIPT = resolve(REPO_ROOT, 'server/scripts/dwh_query.py');

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|DENY|INTO|BULK|OPENROWSET|OPENDATASOURCE|OPENQUERY|OPENXML|DBCC|BACKUP|RESTORE|KILL|SHUTDOWN|RECONFIGURE|DECLARE|SET|WAITFOR|USE|COPY|BEGIN|COMMIT|ROLLBACK|SAVE|GOTO|PRINT|RAISERROR|THROW)\b|\b(sp|xp)_\w+/i;

const IDENT = String.raw`(?:\[[^\]]+\]|"[^"]+"|[A-Za-z_][\w$#@]*)`;
const CHAIN = new RegExp(`${IDENT}(?:\\s*\\.\\s*${IDENT}){2,}`, 'g');
const unquote = (s: string) => s.trim().replace(/^\[|\]$/g, '').replace(/^"|"$/g, '');

function qcfg() {
  return config.dwh.query;
}

export function allowedDatabases(): string[] {
  const blocked = new Set(qcfg().blockedDatabases.map((d) => d.toLowerCase()));
  return config.dwh.catalogDatabases.filter((d) => !blocked.has(d.toLowerCase()));
}

/** Comments out, string literals emptied. Identifiers kept. */
function stripLiterals(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/N?'(?:[^']|'')*'/g, "''");
}

/** Text with every COUNT(...) argument removed: what's left is what the query would actually show. */
function outsideCounts(sql: string): string {
  let s = sql;
  for (;;) {
    const m = /\bCOUNT(?:_BIG)?\s*\(/i.exec(s);
    if (!m) return s;
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < s.length && depth) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      i++;
    }
    s = s.slice(0, m.index) + ' __count__ ' + s.slice(i);
  }
}

/** Every SELECT list in the query (the text from SELECT to its own FROM, at the same nesting level). */
function selectLists(sql: string): string[] {
  const lists: string[] = [];
  const re = /\bSELECT\b/gi;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    let depth = 0;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < sql.length; i++) {
      const ch = sql[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && !/[\w\]]/.test(sql[i - 1] ?? ' ') && /^FROM\b/i.test(sql.slice(i))) break;
    }
    lists.push(sql.slice(start, i));
  }
  return lists;
}

interface Sensitive {
  table: string;
  column: string;
}
let sensitiveCache: { at: number; list: Sensitive[] } | null = null;

/** Gold columns the ontology marks sensitive or personal ("Sensitive:", "PERSONAL DATA", "Personal identifier"). */
export function sensitiveColumns(): Sensitive[] {
  if (sensitiveCache && Date.now() - sensitiveCache.at < 3600_000) return sensitiveCache.list;
  const list: Sensitive[] = [];
  const dir = join(ONTOLOGY_DIR, 'entities');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      for (const line of readFileSync(join(dir, f), 'utf8').split(/\r?\n/)) {
        if (!/\/\/\//.test(line) || !/sensitive|personal data|personal identifier/i.test(line)) continue;
        const m = /Gold column:\s*([\w]+)\.([\w ]+)\[([^\]]+)\]/i.exec(line);
        if (m) list.push({ table: m[2].trim(), column: m[3].trim() });
      }
    }
  }
  sensitiveCache = { at: Date.now(), list };
  return list;
}

export type QueryCheck = { ok: true; sql: string } | { ok: false; reason: string };

export function checkQuery(database: string, rawSql: string): QueryCheck {
  const db = allowedDatabases().find((d) => d.toLowerCase() === database.trim().toLowerCase());
  if (!db) return { ok: false, reason: `Database "${database}" isn't allowed. Allowed: ${allowedDatabases().join(', ')}` };
  const sql = rawSql.trim().replace(/;\s*$/, '');
  if (!sql) return { ok: false, reason: 'Empty query' };
  if (sql.length > 6000) return { ok: false, reason: 'Query too long (6000 characters max)' };

  const noLiterals = stripLiterals(sql);
  const bare = noLiterals.replace(/\[[^\]]*\]/g, '[x]').replace(/"[^"]*"/g, '"x"');
  if (!/^\s*(SELECT|WITH)\b/i.test(bare)) return { ok: false, reason: 'Only a single SELECT (or WITH … SELECT) is allowed' };
  if (bare.includes(';')) return { ok: false, reason: 'One statement only (no ";")' };
  const bad = FORBIDDEN.exec(bare);
  if (bad) return { ok: false, reason: `"${bad[0]}" isn't allowed: read-only SELECTs only` };

  const lower = noLiterals.toLowerCase();
  for (const b of qcfg().blockedDatabases) if (lower.includes(b.toLowerCase())) return { ok: false, reason: `"${b}" is off limits` };
  const allowed = new Set(allowedDatabases().map((d) => d.toLowerCase()));
  for (const chain of noLiterals.match(CHAIN) ?? []) {
    const first = unquote(chain.split('.')[0]).toLowerCase();
    if (!allowed.has(first)) return { ok: false, reason: `"${chain.trim()}": use two-part names (schema.table, alias.column); three-part names must start with an allowed database` };
  }

  // Sensitive columns: never in what the query shows (its SELECT lists), except inside COUNT(...). Joins, filters and
  // GROUP BY on them are fine. No SELECT *: it would show every column.
  const lists = selectLists(outsideCounts(noLiterals));
  const starItem = /^\s*(?:(?:TOP\s*\(?\s*\d+\s*\)?\s*(?:PERCENT\s+)?)?(?:DISTINCT\s+)?)?(?:(?:\[[^\]]+\]|\w+)\s*\.\s*)*\*\s*$/i;
  if (lists.some((l) => l.split(',').some((item) => starItem.test(item))))
    return { ok: false, reason: 'Name the columns you need instead of * (COUNT(*) is fine)' };
  const shown = lists.join(' , ').toLowerCase().replace(/[[\]"]/g, '');
  for (const s of sensitiveColumns()) {
    if (lower.includes(s.table.toLowerCase()) && new RegExp(`(^|[^\\w])${s.column.toLowerCase().replace(/[.*+?^${}()|\\]/g, '\\$&')}($|[^\\w])`).test(shown))
      return { ok: false, reason: `${s.table}[${s.column}] is sensitive per the ontology: use it only inside COUNT(...) / COUNT(DISTINCT ...)` };
  }
  for (const p of qcfg().blockedColumnPatterns) {
    const m = new RegExp(p, 'i').exec(shown);
    if (m) return { ok: false, reason: `"${m[0]}" looks like personal or pay data: use it only inside COUNT(...)` };
  }
  return { ok: true, sql };
}

export interface QueryResult {
  database: string;
  columns?: string[];
  rows?: unknown[][];
  truncated?: boolean;
  ms?: number;
  error?: string;
  remaining: number;
}

const used = new Map<string, number>();

export async function runQuery(runId: string, database: string, rawSql: string): Promise<QueryResult> {
  const { maxRows, timeoutSeconds, perRunLimit } = qcfg();
  const n = used.get(runId) ?? 0;
  if (n >= perRunLimit) return { database, error: `Query limit reached for this run (${perRunLimit}). Say what's still unchecked.`, remaining: 0 };
  const check = checkQuery(database, rawSql);
  if (!check.ok) return { database, error: `Refused: ${check.reason}`, remaining: perRunLimit - n };
  used.set(runId, n + 1);
  const db = allowedDatabases().find((d) => d.toLowerCase() === database.trim().toLowerCase())!;
  const out = await new Promise<string>((res) => {
    const child = spawn(config.powerbi.lint.python, [SCRIPT, '--db', db, '--max-rows', String(maxRows), '--timeout', String(timeoutSeconds)], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const kill = setTimeout(() => child.kill(), (timeoutSeconds + 60) * 1000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', () => {
      clearTimeout(kill);
      res(stdout.trim() || JSON.stringify({ error: stderr.trim().slice(-600) || 'no output' }));
    });
    child.stdin.end(check.sql);
  });
  let parsed: Omit<QueryResult, 'database' | 'remaining'>;
  try {
    parsed = JSON.parse(out.split(/\r?\n/).pop()!);
  } catch {
    parsed = { error: out.slice(-600) };
  }
  return { database: db, ...parsed, remaining: perRunLimit - n - 1 };
}

/** The result as compact text for the bot. */
export function formatResult(r: QueryResult): string {
  if (r.error) return `${r.error}\n(${r.remaining} queries left this run)`;
  const cols = r.columns ?? [];
  const rows = r.rows ?? [];
  const esc = (v: unknown) => (v === null || v === undefined ? 'NULL' : String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '));
  return [
    `| ${cols.join(' | ')} |`,
    `|${cols.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(esc).join(' | ')} |`),
    '',
    `${rows.length} row${rows.length === 1 ? '' : 's'}${r.truncated ? ` (cut at ${rows.length}; aggregate or filter for the rest)` : ''} · ${r.database} · ${r.ms ?? '?'} ms · ${r.remaining} queries left this run`,
  ].join('\n');
}
