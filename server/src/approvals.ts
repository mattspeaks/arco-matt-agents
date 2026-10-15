import { randomUUID } from 'node:crypto';
import { publish } from './bus.js';
import { query, queryOne } from './db/index.js';
import { approveLesson, rejectLesson } from './lessons.js';
import { updateRun } from './runs.js';
import { applyStoryUpdate, type StoryUpdateRequest } from './servicenow/sync.js';
import { startWorkerRun } from './workers.js';

export type ApprovalKind = 'start_worker' | 'sn_write' | 'lesson';

export interface Approval {
  id: string;
  kind: ApprovalKind;
  title: string;
  payload: string;
  status: 'pending' | 'approved' | 'rejected';
  outcome: string | null;
  requested_by_run_id: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export async function createApproval(p: {
  kind: ApprovalKind;
  title: string;
  payload: object;
  requestedByRunId?: string | null;
}): Promise<Approval> {
  const id = randomUUID();
  await query('INSERT INTO dbo.approvals (id, kind, title, payload, status, requested_by_run_id) VALUES (?, ?, ?, ?, ?, ?)', [
    id,
    p.kind,
    p.title.slice(0, 400),
    p.payload,
    'pending',
    p.requestedByRunId,
  ]);
  const approval = (await getApproval(id))!;
  publish('approval', approval);
  return approval;
}

export async function getApproval(id: string): Promise<Approval | undefined> {
  return queryOne<Approval>('SELECT * FROM dbo.approvals WHERE id = ?', [id]);
}

export async function listApprovals(status?: string): Promise<Approval[]> {
  return status
    ? query<Approval>('SELECT TOP 100 * FROM dbo.approvals WHERE status = ? ORDER BY created_at DESC', [status])
    : query<Approval>('SELECT TOP 100 * FROM dbo.approvals ORDER BY created_at DESC');
}

async function setOutcome(id: string, outcome: string) {
  await query('UPDATE dbo.approvals SET outcome = ? WHERE id = ?', [outcome, id]);
  publish('approval', await getApproval(id));
}

/** Matt's decision. Approval executes the action; nothing in the agent layer can call this. */
export async function decide(id: string, approve: boolean, note?: string): Promise<Approval> {
  const approval = await getApproval(id);
  if (!approval) throw new Error('Approval not found');
  if (approval.status !== 'pending') throw new Error(`Approval already ${approval.status}`);
  await query('UPDATE dbo.approvals SET status = ?, decision_note = ?, decided_at = SYSUTCDATETIME() WHERE id = ?', [
    approve ? 'approved' : 'rejected',
    note,
    id,
  ]);
  const payload = JSON.parse(approval.payload);

  if (approval.kind === 'start_worker') {
    if (approve) {
      await updateRun(payload.runId, { status: 'queued' });
      void startWorkerRun(payload.runId);
      await setOutcome(id, 'Worker started');
    } else {
      await updateRun(payload.runId, { status: 'cancelled', error: `Rejected by Matt${note ? `: ${note}` : ''}`, ended: true });
    }
  } else if (approval.kind === 'sn_write') {
    if (approve) {
      void applyStoryUpdate(payload as StoryUpdateRequest, id)
        .then((r) => setOutcome(id, r.summary))
        .catch((err) => setOutcome(id, `Failed: ${err instanceof Error ? err.message : err}`));
    }
  } else if (approval.kind === 'lesson') {
    if (approve) await setOutcome(id, await approveLesson(payload.lessonId));
    else await rejectLesson(payload.lessonId);
  }

  const updated = (await getApproval(id))!;
  publish('approval', updated);
  return updated;
}
