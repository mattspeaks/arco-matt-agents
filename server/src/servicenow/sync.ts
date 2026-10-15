import { publish } from '../bus.js';
import { config } from '../config.js';
import { finishRun } from '../claude/runner.js';
import { addEvent, createRun, type Run } from '../runs.js';
import { runChromeScript, runChromeUiTask } from './chrome.js';
import { syncSnippet, SYNC_MARKER } from './snippets.js';
import { getStory, saveSync, stateValueFor, type SyncPayload } from './store.js';

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

/** Makes an approved story update through the story form in the ServiceNow UI, then verifies the lane with a sync. */
export async function applyStoryUpdate(req: StoryUpdateRequest, approvalId: string): Promise<SyncOutcome> {
  const problem = await validateStoryUpdate(req);
  const run = await createRun({ kind: 'sn_write', title: `Update ${req.story_number}`, storyNumber: req.story_number, meta: { approvalId, ...req } });
  if (problem) {
    await finishRun(run.id, { ok: false, cancelled: false, result: '', error: problem }, { ok: false });
    return { runId: run.id, ok: false, summary: problem };
  }
  const story = (await getStory(req.story_number))!;
  const sn = config.servicenow;
  const changes = [req.new_state && `set State to "${req.new_state}"`, req.work_note && 'add the work note below'].filter(Boolean).join(' and ');
  const steps = [
    `2. Check the form is story ${req.story_number} ("${story.short_description}"). If not, reply FAILED.`,
    req.new_state && `3. Set the "State" field to "${req.new_state}". Change no other field.`,
    req.work_note &&
      `4. Find the "Work notes" field (in the activity / notes section; NOT "Additional comments", which the customer can see) and type exactly this text:\n---\n${req.work_note}\n---`,
    `5. Click the form's "Save" button (or "Update"). Confirm there's no error message and the form shows the change${req.work_note ? ' (the note appears in the activity stream)' : ''}.`,
  ]
    .filter(Boolean)
    .join('\n');

  const ui = await runChromeUiTask(run.id, {
    change: `On ServiceNow story ${req.story_number}: ${changes}.`,
    approvalId,
    landingUrl: `${sn.instanceUrl}/${sn.storyTable}.do?sys_id=${story.sys_id}`,
    steps,
  });
  if (ui.status !== 'DONE') {
    const error = ui.status === 'LOGIN_REQUIRED' ? 'ServiceNow login required: log in in Chrome, then approve again.' : ui.detail;
    await finishRun(run.id, ui.run, { ok: false, error });
    return { runId: run.id, ok: false, summary: error };
  }

  let summary = `${req.story_number}: ${ui.detail}`;
  if (req.new_state) {
    await addEvent(run.id, 'text', `Browser session reports: ${ui.detail}. Verifying the lane with a sync…`);
    const sync = await (await startSync(run.id)).done;
    const fresh = await getStory(req.story_number);
    if (sync.ok && fresh && fresh.state_label !== req.new_state) {
      const error = `The browser session reported success, but ServiceNow shows ${req.story_number} in "${fresh.state_label}" (expected "${req.new_state}").`;
      await finishRun(run.id, ui.run, { ok: false, error });
      return { runId: run.id, ok: false, summary: error };
    }
    summary = sync.ok ? `${req.story_number} moved to ${req.new_state} (verified)${req.work_note ? ' + work note added' : ''}` : `${summary} (couldn't verify: ${sync.summary})`;
  }
  await finishRun(run.id, { ...ui.run, result: summary }, { ok: true });
  publish('board', { syncedAt: new Date().toISOString() });
  return { runId: run.id, ok: true, summary };
}
