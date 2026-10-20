import { randomUUID } from 'node:crypto';
import { publish } from './bus.js';
import { query, queryOne } from './db/index.js';
import { approveLesson, rejectLesson } from './lessons.js';
import { updateRun } from './runs.js';
import { startWorkerRun } from './workers.js';

// sn_confirm: a ServiceNow change previewed in chat. Deciding it answers in that chat as Matt, so the orchestrator
// (and anyone reading the conversation) sees his "yes" or "no" right where the change happens.
// pbi_*: the Power BI story workflow's cards (pbi/flow.ts). pbi_start, pbi_review and pbi_revise also authorise the
// lane move and acceptance-criteria update they describe, in the chat turn the click starts.
// time_entry: hours to add to a story's timesheet row, entered on the card (timesheet.ts).
export type ApprovalKind = 'start_worker' | 'sn_write' | 'timesheet_write' | 'sn_confirm' | 'lesson' | 'pbi_start' | 'pbi_review' | 'pbi_revise' | 'pbi_publish' | 'pbi_gaps' | 'pbi_proceed' | 'time_entry' | 'story_close' | 'gap_design';

/** Cards whose click starts a chat turn that may write to ServiceNow (see /api/agent/write_permit). */
export const SN_PERMIT_KINDS: ApprovalKind[] = ['sn_confirm', 'pbi_start', 'pbi_review', 'pbi_revise', 'time_entry', 'story_close', 'gap_design'];
const FLOW_KINDS: ApprovalKind[] = ['pbi_start', 'pbi_review', 'pbi_revise', 'pbi_publish', 'pbi_gaps', 'pbi_proceed'];

export interface Approval {
  id: string;
  kind: ApprovalKind;
  title: string;
  payload: string;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
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

/** A newer preview in the same chat replaces older pending cards, so only the latest can be approved. */
async function forwardDeclined(approval: Approval, note: string) {
  const { conversationId } = JSON.parse(approval.payload) as { conversationId?: string };
  if (!conversationId) return;
  const { forwardNote } = await import('./pbi/flow.js');
  await forwardNote(conversationId, approval.title, note);
}

export async function supersedeChatApprovals(conversationId: string, exceptId?: string) {
  const rows = await query<Approval>(
    `SELECT * FROM dbo.approvals WHERE kind IN ('sn_confirm', 'pbi_start', 'pbi_revise') AND status = 'pending' AND JSON_VALUE(payload, '$.conversationId') = ?`,
    [conversationId],
  );
  for (const a of rows) {
    if (a.id === exceptId) continue;
    await query(`UPDATE dbo.approvals SET status = 'superseded', outcome = 'Replaced by a newer preview', decided_at = SYSUTCDATETIME() WHERE id = ?`, [a.id]);
    publish('approval', await getApproval(a.id));
  }
}

export async function setOutcome(id: string, outcome: string) {
  await query('UPDATE dbo.approvals SET outcome = ? WHERE id = ?', [outcome, id]);
  publish('approval', await getApproval(id));
}

/** Matt's decision. Approval executes the action; nothing in the agent layer can call this. */
export async function decide(
  id: string,
  approve: boolean,
  note?: string,
  extra: { workspaceId?: string; reportId?: string; name?: string; hours?: Record<string, number>; weekStart?: string; confirmProduction?: boolean; sprint?: 'current' | 'backlog'; choice?: 'sources' | 'without' } = {},
): Promise<Approval> {
  const approval = await getApproval(id);
  if (!approval) throw new Error('Approval not found');
  if (approval.status !== 'pending') throw new Error(`Approval already ${approval.status}`);

  if (approval.kind === 'gap_design') {
    const { decideGapDesign } = await import('./pbi/gapdesign.js');
    const outcome = await decideGapDesign(approval, approve, note);
    await query('UPDATE dbo.approvals SET status = ?, decision_note = ?, outcome = ?, decided_at = SYSUTCDATETIME() WHERE id = ?', [approve ? 'approved' : 'rejected', note, outcome, id]);
    const updated = (await getApproval(id))!;
    publish('approval', updated);
    return updated;
  }

  if (approval.kind === 'story_close') {
    const { decideClose } = await import('./closeout.js');
    const outcome = await decideClose(approval, approve);
    if (!approve && note) await forwardDeclined(approval, note);
    await query('UPDATE dbo.approvals SET status = ?, decision_note = ?, outcome = ?, decided_at = SYSUTCDATETIME() WHERE id = ?', [approve ? 'approved' : 'rejected', note, outcome, id]);
    const updated = (await getApproval(id))!;
    publish('approval', updated);
    return updated;
  }

  if (approval.kind === 'time_entry') {
    const { decideTimeEntry } = await import('./timesheet.js');
    const outcome = await decideTimeEntry(approval, approve, extra.hours, extra.weekStart);
    if (!approve && note) await forwardDeclined(approval, note);
    await query('UPDATE dbo.approvals SET status = ?, decision_note = ?, outcome = ?, decided_at = SYSUTCDATETIME() WHERE id = ?', [approve ? 'approved' : 'rejected', note, outcome, id]);
    const updated = (await getApproval(id))!;
    publish('approval', updated);
    return updated;
  }

  if (FLOW_KINDS.includes(approval.kind)) {
    // The flow acts first (and may throw, e.g. the chat is busy); only then is the card marked.
    const { decideFlowCard } = await import('./pbi/flow.js');
    const outcome = await decideFlowCard(approval, approve, note, extra);
    await query('UPDATE dbo.approvals SET status = ?, decision_note = ?, outcome = COALESCE(outcome, ?), decided_at = SYSUTCDATETIME() WHERE id = ?', [
      approve ? 'approved' : 'rejected',
      note,
      outcome,
      id,
    ]);
    const updated = (await getApproval(id))!;
    publish('approval', updated);
    return updated;
  }

  if (approval.kind === 'sn_confirm') {
    // Answer first: if the chat is busy, this throws and the card stays pending.
    const { conversationId, title } = JSON.parse(approval.payload) as { conversationId: string; title: string };
    const reply = approve
      ? `Yes, go ahead: ${title}${note ? ` (${note})` : ''}`
      : `No, don't make this change: ${title}.${note ? ` ${note}` : ''}`;
    const { sendMessage } = await import('./orchestrator.js');
    await sendMessage(conversationId, reply, { answersApprovalId: id });
    await query('UPDATE dbo.approvals SET status = ?, decision_note = ?, outcome = ?, decided_at = SYSUTCDATETIME() WHERE id = ?', [
      approve ? 'approved' : 'rejected',
      note,
      approve ? 'Approved in chat' : 'Rejected in chat',
      id,
    ]);
    const updated = (await getApproval(id))!;
    publish('approval', updated);
    return updated;
  }

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
  } else if (approval.kind === 'sn_write' || approval.kind === 'timesheet_write') {
    // Retired: ServiceNow changes are now previewed in chat and confirmed with Matt's "yes" there.
    await setOutcome(id, 'Retired card type: ask the orchestrator in chat to make this change.');
  } else if (approval.kind === 'lesson') {
    if (approve) await setOutcome(id, await approveLesson(payload.lessonId));
    else await rejectLesson(payload.lessonId);
  }

  const updated = (await getApproval(id))!;
  publish('approval', updated);
  return updated;
}
