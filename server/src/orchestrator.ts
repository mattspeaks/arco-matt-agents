import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publish } from './bus.js';
import { API_BASE, config, REPO_ROOT } from './config.js';
import { finishRun, isRunActive, runClaude, type StreamMessage } from './claude/runner.js';
import { query, queryOne } from './db/index.js';
import { addEvent, createRun, type RunKind } from './runs.js';
import { findMarked, resultTexts, withChrome } from './servicenow/chrome.js';
import { saveBoardSnapshot, saveStorySnapshot, saveTimesheetSnapshot, type BoardSnapshot, type StorySnapshot, type TimesheetSnapshot } from './servicenow/store.js';

export interface Conversation {
  id: string;
  title: string;
  session_id: string | null;
  story_number: string | null; // set for a story chat; NULL for the main chat(s)
  created_at: string;
  updated_at: string;
}

const MCP_SCRIPT = resolve(REPO_ROOT, 'server/mcp/arco-mcp.mjs');
const NODE = process.execPath.replace(/\\/g, '/');
const WRITE_GUARD = resolve(REPO_ROOT, 'server/hooks/sn-write-guard.mjs').replace(/\\/g, '/');
const RESYNC_CHECK = resolve(REPO_ROOT, 'server/hooks/sn-resync-check.mjs').replace(/\\/g, '/');
const REFRESH_TITLE = 'ServiceNow refresh';

// Chrome tools for the servicenow skill. No form_input/uploads: writes go through previewed, guarded API calls.
const CHROME_TOOLS = ['tabs_context_mcp', 'tabs_create_mcp', 'tabs_close_mcp', 'navigate', 'javascript_tool', 'get_page_text', 'read_page', 'find', 'computer'].map(
  (t) => `mcp__claude-in-chrome__${t}`,
);
const SESSION_SETTINGS = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'mcp__claude-in-chrome__javascript_tool',
        hooks: [{ type: 'command', command: `"${NODE}" "${WRITE_GUARD}"` }],
      },
    ],
    // A turn that changed ServiceNow can't finish until it has re-read the board/timesheet for the app's copy.
    Stop: [{ hooks: [{ type: 'command', command: `"${NODE}" "${RESYNC_CHECK}"` }] }],
  },
};
const busy = new Map<string, string>(); // conversationId -> runId

export async function createConversation(title = 'New conversation', storyNumber?: string): Promise<Conversation> {
  const id = randomUUID();
  await query('INSERT INTO dbo.conversations (id, title, story_number) VALUES (?, ?, ?)', [id, title, storyNumber ?? null]);
  const conv = (await getConversation(id))!;
  publish('conversation', conv);
  return conv;
}

/** The story's own chat: reopened every time "Discuss with orchestrator" is clicked for that story. */
export async function openStoryConversation(storyNumber: string): Promise<Conversation & { created: boolean }> {
  const existing = await queryOne<Conversation>('SELECT TOP 1 * FROM dbo.conversations WHERE story_number = ? ORDER BY created_at', [storyNumber]);
  if (existing) return { ...existing, created: false };
  const story = await queryOne<{ short_description: string | null }>('SELECT short_description FROM dbo.stories WHERE number = ?', [storyNumber]);
  const title = `${storyNumber}${story?.short_description ? ` · ${story.short_description}` : ''}`.slice(0, 200);
  return { ...(await createConversation(title, storyNumber)), created: true };
}

export async function getConversation(id: string) {
  return queryOne<Conversation>('SELECT * FROM dbo.conversations WHERE id = ?', [id]);
}

export async function listConversations() {
  return query<Conversation & { busy_run_id?: string }>('SELECT TOP 50 * FROM dbo.conversations ORDER BY updated_at DESC').then((rows) =>
    rows.map((c) => ({ ...c, busy_run_id: busy.get(c.id) })),
  );
}

export async function getMessages(conversationId: string) {
  return query('SELECT id, conversation_id, role, content, run_id, created_at FROM dbo.chat_messages WHERE conversation_id = ? ORDER BY id', [
    conversationId,
  ]);
}

/** An approval card inside the chat (content = approval id). No run id, so it doesn't end the "working" state. */
export async function postApprovalCard(conversationId: string, approvalId: string) {
  await addMessage(conversationId, 'approval', approvalId);
}

/** A progress note from the app itself (the Power BI workflow). It doesn't start a turn. */
export async function postAppNote(conversationId: string, text: string) {
  await addMessage(conversationId, 'app', text);
}

async function addMessage(conversationId: string, role: 'user' | 'assistant' | 'error' | 'approval' | 'app', content: string, runId?: string) {
  const [row] = await query(
    `INSERT INTO dbo.chat_messages (conversation_id, role, content, run_id)
     OUTPUT inserted.id, inserted.conversation_id, inserted.role, inserted.content, inserted.run_id, inserted.created_at
     VALUES (?, ?, ?, ?)`,
    [conversationId, role, content, runId],
  );
  await query('UPDATE dbo.conversations SET updated_at = SYSUTCDATETIME() WHERE id = ?', [conversationId]);
  publish('chat_message', row);
}

// The Power BI report workflow (pbi/flow.ts). The app pulls, runs the loop and publishes; the orchestrator plans,
// talks to Matt and makes the ServiceNow moves his card clicks authorise.
const REPORT_WORKFLOW = `### Power BI report work in this chat
All Power BI report work for this story goes through the app's report workflow. That's what produces the Review and
Publish cards. You can't start pbi-builder on the PowerBI repo yourself (start_worker refuses), and you never work in
Matt's own checkout. The workflow doesn't have to be linear: use the tools below to change course at any point.
1. Find the report: \`list_repo_reports\` (the repo on main) and/or \`list_fabric_items\` (workspaces → reports). Agree the
   plan with Matt. Prefer starting from the repo (\`repo_report\`) when the report is already there and main is current.
   Start from Fabric when the service copy is the truth. If it's in the repo under another name, pass both.
2. Call \`propose_report_work\` with the source, the plan, and the Work in progress work note, then end your turn.
   The start card covers the whole run.
3. When Matt approves, his message asks you to move the story to Work in progress. Do that (servicenow skill), resync,
   and end the turn. Don't wait for the app: it pulls the report and runs builder ⇄ QC itself, posting notes here.
4. A Review report card follows. When Matt opens it, his message asks you to move the story to Ready for testing
   with the summary he gives you. Write the work note in the standard format.
5. If Matt clicks Not ready: move the story back to Work in progress, then **interview him**. Ask focused questions
   in rounds until you have a complete, unambiguous list of changes. Then call \`submit_revision\` with the changes
   and the text to add to the acceptance criteria, and end your turn. When he approves, update the acceptance
   criteria (append; keep what's there) and resync.
6. Approve on the Review card starts a final pbi-qc run on exactly what will be published, including Matt's own
   Desktop edits. The app posts its report, then a Publish card where Matt picks the workspace, the report and the
   name. The app publishes and opens the PR. Never merge it, and never publish or update an app.

Changing course:
- Matt says wait, or something's wrong mid-build: \`stop_report_work\`. Then fix the plan with him and \`submit_revision\`
  (rebuild on the same branch), or \`propose_report_work\` again to start over (from Fabric or the repo).
- Work exists on a branch the workflow doesn't own (Matt built it, or an earlier detour): \`attach_report_work\`, then
  \`request_review\` or \`submit_revision\`.
- Whenever a report is ready for Matt to look at and no Review card is pending: \`request_review\`. Never leave him
  with a finished build and no Review card.
- Something the workflow can't do: tell Matt before doing anything else, rather than working around it.
\`get_report_flow\` shows where the workflow is.`;

function systemPrompt(conv: Conversation): string {
  const base = readFileSync(resolve(REPO_ROOT, 'prompts/orchestrator.md'), 'utf8');
  const sn = config.servicenow;
  const scope = conv.story_number
    ? `

## This conversation: story chat for ${conv.story_number}
This chat is dedicated to **${conv.story_number}**. Keep everything here about that story: triage, plan, decisions,
workers (start_worker defaults to this story), work notes and lane moves, and time logged against it. If Matt asks
about unrelated work, help briefly, and suggest the main chat or that story's own chat for anything substantial.
Start by reading the story (get_story, then live details via the servicenow skill if you need them).

${REPORT_WORKFLOW}`
    : `

## This conversation: main chat
General work: the board as a whole, timesheet, creating stories (servicenow skill, references/creating.md) and
triaging them, questions. When Matt starts real work
on a specific story, suggest its story chat ("Discuss with orchestrator" on the story) so that story's work stays
together.`;
  return `${base}${scope}

## Live configuration
- Today: ${new Date().toISOString().slice(0, 10)}
- Board lanes (in order): ${sn.laneOrder.join(' → ')}
- Lane mapping: Ready = "${sn.lanes.ready}", agent in progress = "${sn.lanes.agentInProgress}", agent review = "${sn.lanes.agentReview}"
- You may only move stories to: ${sn.agentAllowedTargetStates.join(', ')} (state values ${sn.agentAllowedStateValues.join(', ')})
- Routing tags: ${Object.entries(sn.routingTags).map(([d, t]) => `${d} = ${t.join(' ')}`).join('; ')}
- Allowed project roots for workers: ${config.projectRoots.join(', ')}`;
}

/** Saves board/timesheet snapshots the orchestrator reads with the servicenow skill, as they stream past. */
function captureSnapshots(runId: string) {
  return (msg: StreamMessage) => {
    if (msg.type !== 'user' || !Array.isArray(msg.message?.content)) return;
    for (const block of msg.message.content) {
      if (block.type !== 'tool_result') continue;
      for (const text of resultTexts(block)) {
        const snap = findMarked<BoardSnapshot | TimesheetSnapshot | StorySnapshot>(text, ['board-v2', 'timesheet-v2', 'story-v1']);
        if (!snap) continue;
        const save =
          snap.__arco === 'board-v2'
            ? saveBoardSnapshot(snap).then((n) => `Saved board snapshot (${n} stories)`)
            : snap.__arco === 'story-v1'
              ? saveStorySnapshot(snap).then((n) => `Saved story snapshot (${n})`)
              : saveTimesheetSnapshot(snap).then((n) => `Saved timesheet snapshot (${n} rows)`);
        void save
          .then((note) => addEvent(runId, 'saved', note))
          .then(() => publish('board', { syncedAt: new Date().toISOString() }))
          .catch((err) => addEvent(runId, 'error', `Couldn't save snapshot: ${err instanceof Error ? err.message : err}`));
      }
    }
  };
}

/** Matt's Sync button: a visible request from him in the "ServiceNow refresh" conversation. */
export async function requestRefresh(week?: string): Promise<{ runId: string; conversationId: string }> {
  const conv = (await queryOne<Conversation>('SELECT TOP 1 * FROM dbo.conversations WHERE title = ? ORDER BY updated_at DESC', [REFRESH_TITLE])) ??
    (await createConversation(REFRESH_TITLE));
  const running = busy.get(conv.id);
  if (running && isRunActive(running)) return { runId: running, conversationId: conv.id };
  const text = week
    ? `Sync ServiceNow: refresh the timesheet snapshot for the week of ${week} (Sunday) for the app.`
    : 'Sync ServiceNow: refresh the board snapshot, and the timesheet snapshots for this week and last week, for the app.';
  const { runId } = await sendMessage(conv.id, text, { kind: 'sync' });
  return { runId, conversationId: conv.id };
}

/** One orchestrator turn: a headless Claude session resumed per conversation, with the arco MCP tools and Chrome. */
export async function sendMessage(
  conversationId: string,
  text: string,
  opts: { kind?: RunKind; answersApprovalId?: string } = {},
): Promise<{ runId: string }> {
  const conv = await getConversation(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404 });
  const running = busy.get(conversationId);
  if (running && isRunActive(running)) throw Object.assign(new Error('The orchestrator is still working on the previous message'), { statusCode: 409 });

  if (conv.title === 'New conversation') {
    await query('UPDATE dbo.conversations SET title = ? WHERE id = ?', [text.slice(0, 80), conversationId]);
    publish('conversation', await getConversation(conversationId));
  }

  // answersApprovalId marks the turn Matt started by clicking Approve: the only turn allowed to write (write_permit).
  const run = await createRun({
    kind: opts.kind ?? 'orchestrator',
    title: text.slice(0, 120),
    conversationId,
    storyNumber: conv.story_number ?? undefined,
    prompt: text,
    meta: opts.answersApprovalId ? { answersApprovalId: opts.answersApprovalId } : undefined,
  });
  busy.set(conversationId, run.id);
  await addMessage(conversationId, 'user', text, run.id);

  // Chrome turns run one at a time (one Chrome connection on Windows).
  void withChrome(() => runClaude({
    runId: run.id,
    prompt: text,
    cwd: REPO_ROOT,
    model: config.claude.orchestratorModel,
    appendSystemPrompt: systemPrompt(conv),
    resumeSessionId: conv.session_id,
    chrome: true,
    settings: SESSION_SETTINGS,
    onMessage: captureSnapshots(run.id),
    strictMcp: true,
    mcpConfig: {
      mcpServers: {
        arco: {
          type: 'stdio',
          command: process.execPath,
          args: [MCP_SCRIPT],
          env: { ARCO_API: API_BASE, ARCO_PARENT_RUN_ID: run.id },
        },
      },
    },
    allowedTools: ['Read', 'Grep', 'Glob', 'Skill', 'mcp__arco__*', ...CHROME_TOOLS],
    // Workers must go through start_worker so they're tracked runs; the manager never edits files itself (§3.1).
    disallowedTools: [
      'Edit', 'Write', 'NotebookEdit', 'Bash', 'Task', 'Agent', 'WebFetch', 'WebSearch',
      'mcp__claude-in-chrome__form_input', 'mcp__claude-in-chrome__file_upload', 'mcp__claude-in-chrome__upload_image', 'mcp__claude-in-chrome__shortcuts_execute',
    ],
    // ARCO_RUN_ID / ARCO_API let the write guard hook ask the app whether this turn may write.
    env: { MCP_TOOL_TIMEOUT: '900000', ARCO_RUN_ID: run.id, ARCO_API: API_BASE },
  }))
    .then(async (res) => {
      await finishRun(run.id, res);
      if (res.sessionId) await query('UPDATE dbo.conversations SET session_id = ? WHERE id = ?', [res.sessionId, conversationId]);
      if (res.ok) await addMessage(conversationId, 'assistant', res.result || '(no reply)', run.id);
      else await addMessage(conversationId, 'error', res.error ?? 'The orchestrator run failed.', run.id);
    })
    .catch((err) => addMessage(conversationId, 'error', String(err), run.id))
    .finally(() => {
      busy.delete(conversationId);
      void getConversation(conversationId).then((c) => publish('conversation', c));
    });

  return { runId: run.id };
}
