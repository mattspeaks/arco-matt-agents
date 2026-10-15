import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publish } from './bus.js';
import { API_BASE, config, REPO_ROOT } from './config.js';
import { finishRun, isRunActive, runClaude, type StreamMessage } from './claude/runner.js';
import { query, queryOne } from './db/index.js';
import { addEvent, createRun, type RunKind } from './runs.js';
import { findMarked, resultTexts, withChrome } from './servicenow/chrome.js';
import { saveBoardSnapshot, saveTimesheetSnapshot, type BoardSnapshot, type TimesheetSnapshot } from './servicenow/store.js';

export interface Conversation {
  id: string;
  title: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

const MCP_SCRIPT = resolve(REPO_ROOT, 'server/mcp/arco-mcp.mjs');
const WRITE_GUARD = resolve(REPO_ROOT, 'server/hooks/sn-write-guard.mjs').replace(/\\/g, '/');
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
        hooks: [{ type: 'command', command: `"${process.execPath.replace(/\\/g, '/')}" "${WRITE_GUARD}"` }],
      },
    ],
  },
};
const busy = new Map<string, string>(); // conversationId -> runId

export async function createConversation(title = 'New conversation'): Promise<Conversation> {
  const id = randomUUID();
  await query('INSERT INTO dbo.conversations (id, title) VALUES (?, ?)', [id, title]);
  const conv = (await getConversation(id))!;
  publish('conversation', conv);
  return conv;
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

async function addMessage(conversationId: string, role: 'user' | 'assistant' | 'error', content: string, runId?: string) {
  const [row] = await query(
    `INSERT INTO dbo.chat_messages (conversation_id, role, content, run_id)
     OUTPUT inserted.id, inserted.conversation_id, inserted.role, inserted.content, inserted.run_id, inserted.created_at
     VALUES (?, ?, ?, ?)`,
    [conversationId, role, content, runId],
  );
  await query('UPDATE dbo.conversations SET updated_at = SYSUTCDATETIME() WHERE id = ?', [conversationId]);
  publish('chat_message', row);
}

function systemPrompt(): string {
  const base = readFileSync(resolve(REPO_ROOT, 'prompts/orchestrator.md'), 'utf8');
  const sn = config.servicenow;
  return `${base}

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
        const snap = findMarked<BoardSnapshot | TimesheetSnapshot>(text, ['board-v2', 'timesheet-v2']);
        if (!snap) continue;
        const save =
          snap.__arco === 'board-v2'
            ? saveBoardSnapshot(snap).then((n) => `Saved board snapshot (${n} stories)`)
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
export async function requestRefresh(): Promise<{ runId: string; conversationId: string }> {
  const conv = (await queryOne<Conversation>('SELECT TOP 1 * FROM dbo.conversations WHERE title = ? ORDER BY updated_at DESC', [REFRESH_TITLE])) ??
    (await createConversation(REFRESH_TITLE));
  const running = busy.get(conv.id);
  if (running && isRunActive(running)) return { runId: running, conversationId: conv.id };
  const { runId } = await sendMessage(conv.id, 'Sync ServiceNow: refresh the board and timesheet snapshots for the app.', { kind: 'sync' });
  return { runId, conversationId: conv.id };
}

/** One orchestrator turn: a headless Claude session resumed per conversation, with the arco MCP tools and Chrome. */
export async function sendMessage(conversationId: string, text: string, opts: { kind?: RunKind } = {}): Promise<{ runId: string }> {
  const conv = await getConversation(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404 });
  const running = busy.get(conversationId);
  if (running && isRunActive(running)) throw Object.assign(new Error('The orchestrator is still working on the previous message'), { statusCode: 409 });

  if (conv.title === 'New conversation') {
    await query('UPDATE dbo.conversations SET title = ? WHERE id = ?', [text.slice(0, 80), conversationId]);
    publish('conversation', await getConversation(conversationId));
  }

  const run = await createRun({ kind: opts.kind ?? 'orchestrator', title: text.slice(0, 120), conversationId, prompt: text });
  busy.set(conversationId, run.id);
  await addMessage(conversationId, 'user', text, run.id);

  // Chrome turns run one at a time (one Chrome connection on Windows).
  void withChrome(() => runClaude({
    runId: run.id,
    prompt: text,
    cwd: REPO_ROOT,
    model: config.claude.orchestratorModel,
    appendSystemPrompt: systemPrompt(),
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
    env: { MCP_TOOL_TIMEOUT: '900000' },
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
