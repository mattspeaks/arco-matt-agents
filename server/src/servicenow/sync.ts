import { publish } from '../bus.js';
import { config } from '../config.js';
import { finishRun } from '../claude/runner.js';
import { addEvent, createRun, type Run } from '../runs.js';
import { runChromeScript } from './chrome.js';
import { storyWriteSnippet, syncSnippet, SYNC_MARKER, WRITE_MARKER } from './snippets.js';
import { getStory, markStoryState, saveSync, stateValueFor, type SyncPayload } from './store.js';

export interface SyncOutcome {
  runId: string;
  ok: boolean;
  summary: string;
}

let inFlight: { runId: string; done: Promise<SyncOutcome> } | null = null;

/** Pulls the board and this week's timesheet into SQL Server. Concurrent callers share one in-flight sync. */
export async function startSync(parentRunId?: string | null): Promise<{ runId: string; done: Promise<SyncOutcome> }> {
  if (inFlight) return inFlight;
  const run = await createRun({ kind: 'sync', title: 'Sync ServiceNow board + timesheet', parentRunId });
  const done = doSync(run).finally(() => {
    inFlight = null;
  });
  inFlight = { runId: run.id, done };
  return inFlight;
}

async function doSync(run: Run): Promise<SyncOutcome> {
  const sn = config.servicenow;
  const code = syncSnippet({ boardSysId: sn.boardSysId, storyTable: sn.storyTable });
  try {
    const { run: res, payload, loginRequired } = await runChromeScript<SyncPayload>(run.id, SYNC_MARKER, code, 'board sync');
    if (!payload) {
      const error = loginRequired
        ? 'ServiceNow login required: log in at ' + sn.instanceUrl + ' in Chrome, then sync again.'
        : res.error ?? 'Sync script result not found in the browser session output.';
      await finishRun(run.id, res, { ok: false, error });
      return { runId: run.id, ok: false, summary: error };
    }
    const saved = await saveSync(payload);
    const summary =
      `Synced "${payload.board.name}": ${saved.stories} stories, ` +
      (payload.timesheet ? `timesheet week of ${payload.timesheet.week_starts_on} (${saved.timeCards} rows, ${payload.timesheet.total_hours}h)` : 'no timesheet this week') +
      (payload.errors.length ? `. Partial errors: ${payload.errors.join(', ')}` : '');
    await addEvent(run.id, 'saved', summary);
    await finishRun(run.id, { ...res, result: summary }, { ok: true, error: payload.errors.length ? payload.errors.join(', ') : undefined });
    publish('board', { syncedAt: new Date().toISOString() });
    return { runId: run.id, ok: true, summary };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await finishRun(run.id, { ok: false, cancelled: false, result: '', error }, { ok: false });
    return { runId: run.id, ok: false, summary: error };
  }
}

export interface StoryUpdateRequest {
  story_number: string;
  new_state?: string;
  work_note?: string;
}

/** Validates against the guardrails (§9): agents may only move cards into the allow-listed lanes. */
export async function validateStoryUpdate(req: StoryUpdateRequest): Promise<string | null> {
  if (!req.new_state && !req.work_note) return 'Nothing to update: provide new_state and/or work_note.';
  const story = await getStory(req.story_number);
  if (!story) return `Story ${req.story_number} is not in the local board copy. Sync first.`;
  if (req.new_state) {
    if (!config.servicenow.agentAllowedTargetStates.includes(req.new_state)) {
      return `Agents may only move stories to: ${config.servicenow.agentAllowedTargetStates.join(', ')}. "${req.new_state}" is Matt's call.`;
    }
    if (!(await stateValueFor(req.new_state))) return `Unknown lane "${req.new_state}" (no state value mapped yet; sync first).`;
  }
  return null;
}

/** Executes an approved story update in the browser session. */
export async function applyStoryUpdate(req: StoryUpdateRequest, approvalId: string): Promise<SyncOutcome> {
  const problem = await validateStoryUpdate(req);
  const run = await createRun({ kind: 'sn_write', title: `Update ${req.story_number}`, storyNumber: req.story_number, meta: { approvalId, ...req } });
  if (problem) {
    await finishRun(run.id, { ok: false, cancelled: false, result: '', error: problem }, { ok: false });
    return { runId: run.id, ok: false, summary: problem };
  }
  const story = (await getStory(req.story_number))!;
  const body: { state?: string; work_notes?: string } = {};
  if (req.new_state) body.state = await stateValueFor(req.new_state);
  if (req.work_note) body.work_notes = req.work_note;

  const code = storyWriteSnippet({ storyTable: config.servicenow.storyTable, sysId: story.sys_id, body });
  const { run: res, payload } = await runChromeScript<{ status: number; state_value: string; state_label: string; error: string | null }>(
    run.id,
    WRITE_MARKER,
    code,
    `approved update to ${req.story_number}`,
  );
  if (!payload || payload.status >= 300) {
    const error = payload?.error ?? res.error ?? 'Write result not found in the browser session output.';
    await finishRun(run.id, res, { ok: false, error });
    return { runId: run.id, ok: false, summary: error };
  }
  if (payload.state_value) await markStoryState(story.sys_id, payload.state_value, payload.state_label);
  const summary = `${req.story_number} updated${req.new_state ? ` → ${payload.state_label}` : ''}${req.work_note ? ' (work note added)' : ''}`;
  await finishRun(run.id, { ...res, result: summary }, { ok: true });
  publish('board', { syncedAt: new Date().toISOString() });
  return { runId: run.id, ok: true, summary };
}
