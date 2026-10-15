import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publish } from './bus.js';
import { API_BASE, config, REPO_ROOT } from './config.js';
import { finishRun, isRunActive, runClaude } from './claude/runner.js';
import { query, queryOne } from './db/index.js';
import { createRun } from './runs.js';

export interface Conversation {
  id: string;
  title: string;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

const MCP_SCRIPT = resolve(REPO_ROOT, 'server/mcp/arco-mcp.mjs');
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
- You may only propose moving stories to: ${sn.agentAllowedTargetStates.join(', ')}
- Routing tags: ${Object.entries(sn.routingTags).map(([d, t]) => `${d} = ${t.join(' ')}`).join('; ')}
- Allowed project roots for workers: ${config.projectRoots.join(', ')}`;
}

/** One orchestrator turn: a headless Claude session resumed per conversation, with the arco MCP tools. */
export async function sendMessage(conversationId: string, text: string): Promise<{ runId: string }> {
  const conv = await getConversation(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation not found'), { statusCode: 404 });
  const running = busy.get(conversationId);
  if (running && isRunActive(running)) throw Object.assign(new Error('The orchestrator is still working on the previous message'), { statusCode: 409 });

  if (conv.title === 'New conversation') {
    await query('UPDATE dbo.conversations SET title = ? WHERE id = ?', [text.slice(0, 80), conversationId]);
    publish('conversation', await getConversation(conversationId));
  }

  const run = await createRun({ kind: 'orchestrator', title: text.slice(0, 120), conversationId, prompt: text });
  busy.set(conversationId, run.id);
  await addMessage(conversationId, 'user', text, run.id);

  void runClaude({
    runId: run.id,
    prompt: text,
    cwd: REPO_ROOT,
    model: config.claude.orchestratorModel,
    appendSystemPrompt: systemPrompt(),
    resumeSessionId: conv.session_id,
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
    allowedTools: ['Read', 'Grep', 'Glob', 'mcp__arco__*'],
    // Workers must go through start_worker so they're tracked runs; the manager never edits files itself (§3.1).
    disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Bash', 'Task', 'Agent', 'WebFetch', 'WebSearch'],
    env: { MCP_TOOL_TIMEOUT: '900000' },
  })
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
