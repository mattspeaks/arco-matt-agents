import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { query, queryOne } from './db/index.js';
import { publish } from './bus.js';
import { createApproval, type Approval } from './approvals.js';
import { CONFIRM_SN, archiveConversation, postApprovalCard, postAppNote, postChecklistCard, sendMessage, type Conversation } from './orchestrator.js';
import { waitForRun } from './runs.js';
import { askTimeEntry } from './timesheet.js';
import { git, pullRequestStatus, repoPath } from './pbi/repo.js';

// Close-out: Matt's own definition of done for a story (default items in config.closeoutChecklist). The app ticks an
// item only where it can prove it (a PR that completed in Azure DevOps); everything else is Matt's tick. When every
// item is done, the Close story card writes a final work note, cleans up the agent's worktree and archives the chat.
// Moving the story to Complete stays Matt's, in ServiceNow.

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  doneAt?: string;
  doneBy?: 'matt' | 'app';
  note?: string;
  /** pr: ticked by the app when the story's PR completes. */
  auto?: 'pr';
}

export interface Checklist {
  story_number: string;
  items: ChecklistItem[];
  created_at: string;
  closed_at: string | null;
}

interface Row {
  story_number: string;
  items: string;
  created_at: string;
  closed_at: string | null;
}

const toChecklist = (r: Row): Checklist => ({ ...r, items: JSON.parse(r.items) as ChecklistItem[] });

async function load(story: string): Promise<Checklist | undefined> {
  const row = await queryOne<Row>('SELECT * FROM dbo.story_checklists WHERE story_number = ?', [story]);
  return row ? toChecklist(row) : undefined;
}

async function save(story: string, items: ChecklistItem[]): Promise<Checklist> {
  await query('UPDATE dbo.story_checklists SET items = ? WHERE story_number = ?', [JSON.stringify(items), story]);
  const c = (await load(story))!;
  publish('checklist', c);
  return c;
}

const storyChat = (story: string) =>
  queryOne<Conversation>('SELECT TOP 1 * FROM dbo.conversations WHERE story_number = ? ORDER BY created_at', [story]);

/** The story's report workflow, if it has one (PR link, worktree, publish result). */
async function flowData(story: string) {
  const row = await queryOne<{ data: string }>('SELECT data FROM dbo.story_flows WHERE story_number = ?', [story]);
  return row ? (JSON.parse(row.data) as { prUrl?: string; worktree?: string; branch?: string; reportName?: string; published?: { workspaceName: string; reportUrl: string } }) : undefined;
}

/** Starts the checklist from the template (once per story) and puts it in the story chat. */
export async function startCloseout(story: string): Promise<Checklist> {
  const existing = await load(story);
  if (existing) return existing;
  const items: ChecklistItem[] = config.closeoutChecklist.map((i) => ({ id: randomUUID(), label: i.label, done: false, auto: i.auto }));
  await query('INSERT INTO dbo.story_checklists (story_number, items) VALUES (?, ?)', [story, JSON.stringify(items)]);
  const conv = await storyChat(story);
  if (conv) await postChecklistCard(conv.id, story);
  const c = (await load(story))!;
  publish('checklist', c);
  return c;
}

const prChecked = new Map<string, number>();

/** The checklist, after ticking anything the app can verify (PR completed), at most once a minute per story. */
export async function getChecklist(story: string): Promise<Checklist | null> {
  const c = await load(story);
  if (!c) return null;
  const prItem = c.items.find((i) => i.auto === 'pr' && !i.done);
  if (!prItem || c.closed_at || Date.now() - (prChecked.get(story) ?? 0) < 60_000) return c;
  prChecked.set(story, Date.now());
  const pr = (await flowData(story))?.prUrl;
  if (!pr) return c;
  const status = await pullRequestStatus(pr).catch(() => undefined);
  if (status !== 'completed') return c;
  return save(
    story,
    c.items.map((i) => (i.id === prItem.id ? { ...i, done: true, doneAt: new Date().toISOString(), doneBy: 'app' as const, note: `PR ${pr.split('/').pop()} completed in Azure DevOps` } : i)),
  );
}

export async function setItem(story: string, itemId: string, patch: { done?: boolean; note?: string }): Promise<Checklist> {
  const c = await load(story);
  if (!c) throw new Error(`${story} has no close-out checklist`);
  if (c.closed_at) throw new Error(`${story} is already closed`);
  if (!c.items.some((i) => i.id === itemId)) throw new Error('No such item');
  return save(
    story,
    c.items.map((i) => {
      if (i.id !== itemId) return i;
      const next = { ...i, ...(patch.note !== undefined ? { note: patch.note.slice(0, 500) || undefined } : {}) };
      if (patch.done !== undefined) Object.assign(next, patch.done ? { done: true, doneAt: new Date().toISOString(), doneBy: 'matt' } : { done: false, doneAt: undefined, doneBy: undefined });
      return next;
    }),
  );
}

export async function addItem(story: string, label: string): Promise<Checklist> {
  const c = await load(story);
  if (!c) throw new Error(`${story} has no close-out checklist`);
  if (c.closed_at) throw new Error(`${story} is already closed`);
  const text = label.trim().slice(0, 200);
  if (!text) throw new Error('Enter the item');
  return save(story, [...c.items, { id: randomUUID(), label: text, done: false }]);
}

export async function removeItem(story: string, itemId: string): Promise<Checklist> {
  const c = await load(story);
  if (!c) throw new Error(`${story} has no close-out checklist`);
  if (c.closed_at) throw new Error(`${story} is already closed`);
  return save(story, c.items.filter((i) => i.id !== itemId));
}

/** Close-out progress for the board and the chat list. */
export async function closeoutSummary(): Promise<Record<string, { done: number; total: number; closed: boolean }>> {
  const rows = await query<Row>('SELECT * FROM dbo.story_checklists');
  return Object.fromEntries(rows.map((r) => {
    const items = JSON.parse(r.items) as ChecklistItem[];
    return [r.story_number, { done: items.filter((i) => i.done).length, total: items.length, closed: !!r.closed_at }];
  }));
}

const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '');

/** All items done: the Close story card (final work note + cleanup + archive), in the chat and in Approvals. */
export async function requestClose(story: string): Promise<{ approval_id: string }> {
  const c = await getChecklist(story);
  if (!c) throw new Error(`${story} has no close-out checklist`);
  if (c.closed_at) throw new Error(`${story} is already closed`);
  const open = c.items.filter((i) => !i.done);
  if (open.length) throw new Error(`Still open: ${open.map((i) => i.label).join('; ')}`);
  const conv = await storyChat(story);
  if (!conv) throw new Error(`${story} has no story chat`);
  const flow = await flowData(story);
  const workNote = [
    `[Agent: Power BI Manager] Story ${story}`,
    `Summary:   Closed out.${flow?.published ? ` ${flow.reportName ?? 'Report'} published to ${flow.published.workspaceName}: ${flow.published.reportUrl}` : ''}`,
    `Close-out: ${c.items.map((i) => `✓ ${i.label}${i.doneAt ? ` (${shortDate(i.doneAt)})` : ''}${i.note ? `: ${i.note}` : ''}`).join('\n           ')}`,
    `Branch/PR: ${flow?.prUrl ?? flow?.branch ?? 'none'}`,
    `Needs:     Nothing from the agents. Matt moves the story to Complete.`,
  ].join('\n');
  const preview = [
    `**Everything on ${story}'s close-out list is done.** Approving closes the story chat:`,
    `1. **ServiceNow work note** on ${story}, exactly as below. The lane doesn't change: moving it to Complete is yours.\n\n\`\`\`\n${workNote}\n\`\`\``,
    `2. **Timesheet card:** one last chance to log time on the story.`,
    flow?.worktree ? `3. **Clean up** the agent's worktree for \`${flow.branch}\`, if its PR is completed (the branch stays on the server).` : '3. No agent worktree to clean up.',
    `4. **Archive this chat.** It moves to Archived in the chat list. Nothing is deleted, and you can reopen it.`,
  ].join('\n\n');
  const approval = await createApproval({
    kind: 'story_close',
    title: `${story}: close out`,
    payload: { conversationId: conv.id, storyNumber: story, preview, workNote },
    requestedByRunId: null,
  });
  await postApprovalCard(conv.id, approval.id);
  return { approval_id: approval.id };
}

/** Matt's decision on the Close story card. Approve: work note turn, timesheet card, cleanup, then archive. */
export async function decideClose(approval: Approval, approve: boolean): Promise<string> {
  if (!approve) return 'Not closed';
  const p = JSON.parse(approval.payload) as { conversationId: string; storyNumber: string; workNote: string };
  const story = p.storyNumber;
  const { runId } = await sendMessage(
    p.conversationId,
    `Close out ${story}: it needs this final work note in ServiceNow (don't change its lane). ${CONFIRM_SN} Then resync.\n\n\`\`\`\n${p.workNote}\n\`\`\``,
  );
  await query('UPDATE dbo.story_checklists SET closed_at = SYSUTCDATETIME() WHERE story_number = ?', [story]);
  publish('checklist', await load(story));
  void (async () => {
    const cleanup = await cleanupWorktree(story).catch((err) => `Couldn't clean up the worktree: ${err instanceof Error ? err.message : err}`);
    await waitForRun(runId, 15 * 60_000);
    await askTimeEntry(p.conversationId, story).catch(() => undefined);
    await postAppNote(p.conversationId, `**${story} closed out.** ${cleanup} This chat is archived now (Archived, in the chat list); sending a message reopens it. Moving the story to Complete is yours.`);
    await archiveConversation(p.conversationId, true);
  })();
  return 'Closing: work note, then archive';
}

/** Removes the agent's worktree and local branch once the PR is completed (or the branch is in main). */
async function cleanupWorktree(story: string): Promise<string> {
  const flow = await flowData(story);
  if (!flow?.worktree || !flow.branch) return '';
  const status = flow.prUrl ? await pullRequestStatus(flow.prUrl).catch(() => undefined) : undefined;
  const repo = repoPath();
  const merged =
    status === 'completed' ||
    (await git(repo, ['fetch', 'origin'])
      .then(() => git(repo, ['merge-base', '--is-ancestor', flow.branch!, 'origin/HEAD']))
      .then(
        () => true,
        () => false,
      ));
  if (!merged) return `Kept the worktree for \`${flow.branch}\`: its PR isn't completed yet.`;
  try {
    await git(repo, ['worktree', 'remove', flow.worktree]);
  } catch (err) {
    return `Kept the worktree for \`${flow.branch}\`: it has uncommitted changes (${err instanceof Error ? err.message.slice(0, 120) : err}).`;
  }
  await git(repo, ['branch', '-D', flow.branch]).catch(() => undefined);
  return `Removed the agent's worktree and local branch \`${flow.branch}\` (the PR is completed; the branch history is in main).`;
}
