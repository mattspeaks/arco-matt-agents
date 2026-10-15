import { randomUUID } from 'node:crypto';
import { publish } from './bus.js';
import { query, queryOne } from './db/index.js';

export type RunKind = 'sync' | 'orchestrator' | 'worker' | 'sn_write';
export type RunStatus = 'queued' | 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export const TERMINAL: RunStatus[] = ['succeeded', 'failed', 'cancelled'];

export interface Run {
  id: string;
  kind: RunKind;
  worker: string | null;
  story_number: string | null;
  title: string | null;
  status: RunStatus;
  parent_run_id: string | null;
  conversation_id: string | null;
  session_id: string | null;
  prompt: string | null;
  result: string | null;
  error: string | null;
  meta: string | null;
  cost_usd: number | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface RunEvent {
  run_id: string;
  ts: string;
  type: string;
  summary: string | null;
  data?: unknown;
}

const LIST_COLUMNS =
  'id, kind, worker, story_number, title, status, parent_run_id, conversation_id, session_id, error, meta, cost_usd, created_at, started_at, ended_at';

export async function createRun(p: {
  kind: RunKind;
  title: string;
  status?: RunStatus;
  worker?: string;
  storyNumber?: string;
  parentRunId?: string | null;
  conversationId?: string;
  prompt?: string;
  meta?: object;
}): Promise<Run> {
  const id = randomUUID();
  await query(
    `INSERT INTO dbo.runs (id, kind, worker, story_number, title, status, parent_run_id, conversation_id, prompt, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, p.kind, p.worker, p.storyNumber, p.title.slice(0, 400), p.status ?? 'queued', p.parentRunId, p.conversationId, p.prompt, p.meta],
  );
  const run = (await getRun(id))!;
  publish('run', withoutBodies(run));
  return run;
}

const UPDATABLE = ['status', 'session_id', 'result', 'error', 'meta', 'cost_usd', 'prompt'] as const;
type Updatable = (typeof UPDATABLE)[number];

export async function updateRun(
  id: string,
  patch: Partial<Pick<Run, Updatable>> & { started?: boolean; ended?: boolean },
): Promise<Run | undefined> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of UPDATABLE) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(patch[key]);
    }
  }
  if (patch.started) sets.push('started_at = SYSUTCDATETIME()');
  if (patch.ended) sets.push('ended_at = SYSUTCDATETIME()');
  if (sets.length) await query(`UPDATE dbo.runs SET ${sets.join(', ')} WHERE id = ?`, [...(params as string[]), id]);
  const run = await getRun(id);
  if (run) publish('run', withoutBodies(run));
  return run;
}

export async function getRun(id: string): Promise<Run | undefined> {
  return queryOne<Run>('SELECT * FROM dbo.runs WHERE id = ?', [id]);
}

export async function listRuns(limit = 50): Promise<Run[]> {
  return query<Run>(
    `SELECT TOP (${Math.min(Math.max(limit, 1), 500)}) ${LIST_COLUMNS}
     FROM dbo.runs WHERE kind <> 'orchestrator' OR status IN ('running','queued')
     ORDER BY created_at DESC`,
  );
}

export async function listRunEvents(runId: string): Promise<RunEvent[]> {
  return query<RunEvent>('SELECT run_id, ts, type, summary, data FROM dbo.run_events WHERE run_id = ? ORDER BY id', [runId]);
}

// Events for a run are written strictly in order: each insert waits for the previous one.
const eventQueues = new Map<string, Promise<unknown>>();

export function addEvent(runId: string, type: string, summary: string, data?: unknown): Promise<unknown> {
  const ev: RunEvent = { run_id: runId, ts: new Date().toISOString(), type, summary: summary.slice(0, 4000) };
  publish('run_event', { ...ev, data });
  const prev = eventQueues.get(runId) ?? Promise.resolve();
  const next = prev
    .then(() =>
      query('INSERT INTO dbo.run_events (run_id, type, summary, data) VALUES (?, ?, ?, ?)', [
        runId,
        type,
        ev.summary,
        data === undefined ? null : JSON.stringify(data).slice(0, 20000),
      ]),
    )
    .catch((err) => console.error('[runs] failed to store event', err));
  eventQueues.set(runId, next);
  return next;
}

export async function flushEvents(runId: string): Promise<void> {
  await eventQueues.get(runId);
  eventQueues.delete(runId);
}

/** Runs left "running" by a previous server process can never finish; mark them failed on boot. */
export async function recoverInterruptedRuns(): Promise<void> {
  await query(
    `UPDATE dbo.runs SET status = 'failed', error = 'Interrupted: server restarted', ended_at = SYSUTCDATETIME()
     WHERE status IN ('running', 'queued')`,
  );
}

export function withoutBodies(run: Run): Omit<Run, 'prompt' | 'result'> {
  const { prompt: _p, result: _r, ...rest } = run;
  return rest;
}

export function parseMeta<T = Record<string, unknown>>(run: Pick<Run, 'meta'>): T {
  try {
    return (run.meta ? JSON.parse(run.meta) : {}) as T;
  } catch {
    return {} as T;
  }
}

export async function waitForRun(id: string, timeoutMs: number): Promise<Run | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await getRun(id);
    if (!run || TERMINAL.includes(run.status) || Date.now() >= deadline) return run;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
