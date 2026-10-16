import Fastify, { type FastifyError } from 'fastify';
import websocket from '@fastify/websocket';
import { bus } from './bus.js';
import { config } from './config.js';
import { cancelClaudeRun } from './claude/runner.js';
import { initDb, query } from './db/index.js';
import { createApproval, decide, getApproval, listApprovals, supersedeChatApprovals } from './approvals.js';
import { proposeLesson } from './lessons.js';
import { createConversation, getConversation, getMessages, listConversations, openStoryConversation, postApprovalCard, requestRefresh, sendMessage } from './orchestrator.js';
import { getRun, listRunEvents, listRuns, parseMeta, recoverInterruptedRuns, waitForRun, withoutBodies, type Run } from './runs.js';
import { getCurrentTimesheet, getLanes, getStory, lastSyncAt, listStories } from './servicenow/store.js';
import { listWorkers, requestWorker } from './workers.js';

await initDb();
await recoverInterruptedRuns();

const app = Fastify({ logger: { level: 'warn' } });
await app.register(websocket);

app.setErrorHandler((err: FastifyError, _req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (status >= 500) console.error(err);
  void reply.code(status).send({ error: err.message });
});

const bad = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });

// Browsers attach Origin to cross-site requests and websocket upgrades; only our own UI may call in.
// The MCP server (Node fetch) sends no Origin.
app.addHook('onRequest', async (req, reply) => {
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return reply.code(403).send({ error: 'Forbidden origin' });
  }
});

// ---- live updates -------------------------------------------------------------------------------
app.get('/ws', { websocket: true }, (socket) => {
  const forward = (e: unknown) => socket.send(JSON.stringify(e));
  bus.on('live', forward);
  socket.on('close', () => bus.off('live', forward));
});

// ---- UI API -------------------------------------------------------------------------------------
app.get('/api/board', async () => {
  const [stories, lanes, syncedAt] = await Promise.all([listStories(), getLanes(), lastSyncAt()]);
  return { stories, lanes, syncedAt, laneMapping: config.servicenow.lanes, instanceUrl: config.servicenow.instanceUrl };
});

app.get('/api/timesheet', async () => getCurrentTimesheet());

// Matt's Sync button: posts a visible request from him into the "ServiceNow refresh" chat, and the orchestrator
// reads the board and timesheet there. Nothing reads ServiceNow without a message from Matt.
app.post('/api/sync', async () => requestRefresh());

app.get<{ Querystring: { limit?: string } }>('/api/runs', async (req) => listRuns(Number(req.query.limit ?? 60)));

app.get<{ Params: { id: string } }>('/api/runs/:id', async (req) => {
  const run = await getRun(req.params.id);
  if (!run) throw bad('Run not found', 404);
  return { run, events: await listRunEvents(run.id) };
});

app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (req) => ({ cancelled: cancelClaudeRun(req.params.id) }));

app.get('/api/conversations', async () => listConversations());
app.post<{ Body: { title?: string } }>('/api/conversations', async (req) => createConversation(req.body?.title));
app.get<{ Params: { id: string } }>('/api/conversations/:id/messages', async (req) => getMessages(req.params.id));
app.post<{ Params: { id: string }; Body: { text: string } }>('/api/conversations/:id/messages', async (req) => {
  const text = req.body?.text?.trim();
  if (!text) throw bad('text is required');
  return sendMessage(req.params.id, text);
});

app.get<{ Querystring: { status?: string } }>('/api/approvals', async (req) => listApprovals(req.query.status));
app.post<{ Params: { id: string }; Body: { approve: boolean; note?: string } }>('/api/approvals/:id/decision', async (req) =>
  decide(req.params.id, Boolean(req.body?.approve), req.body?.note),
);

app.get('/api/workers', async () => listWorkers());

// ---- Agent API (called only by the arco MCP server the orchestrator runs) ---------------------
type AgentBody = Record<string, unknown> & { parentRunId?: string | null };
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function runSummary(run: Run | undefined) {
  if (!run) return { error: 'Run not found' };
  const { meta, ...rest } = withoutBodies(run);
  return { ...rest, meta: meta ? JSON.parse(meta) : null, result: run.result };
}

app.post<{ Body: AgentBody }>('/api/agent/list_stories', async (req) => {
  const rows = await listStories({ lane: str(req.body.lane), domain: str(req.body.domain), search: str(req.body.search) });
  return {
    synced_at: await lastSyncAt(),
    count: rows.length,
    stories: rows.map((s) => ({ number: s.number, title: s.short_description, lane: s.state_label, domain: s.domain, tags: s.tags, assigned_to: s.assigned_to, points: s.story_points })),
  };
});

app.post<{ Body: AgentBody }>('/api/agent/get_story', async (req) => {
  const number = str(req.body.number);
  if (!number) throw bad('number is required');
  const story = await getStory(number);
  if (!story) throw bad(`Story ${number} not found in local copy (sync first?)`, 404);
  const [hours, runs] = await Promise.all([
    query('SELECT category, sunday, monday, tuesday, wednesday, thursday, friday, saturday, total FROM dbo.time_cards WHERE task_number = ? OR top_task_number = ?', [number, number]),
    query('SELECT TOP 10 id, kind, worker, status, title, created_at FROM dbo.runs WHERE story_number = ? ORDER BY created_at DESC', [number]),
  ]);
  return { story, hours_this_week: hours, recent_runs: runs };
});

app.post('/api/agent/get_timesheet', async () => getCurrentTimesheet());


app.post<{ Body: AgentBody }>('/api/agent/start_worker', async (req) => {
  const worker = str(req.body.worker);
  const brief = str(req.body.brief);
  if (!worker || !brief) throw bad('worker and brief are required');
  // In a story chat, workers belong to that story unless told otherwise.
  const parent = req.body.parentRunId ? await getRun(req.body.parentRunId) : undefined;
  const conv = parent?.conversation_id ? await getConversation(parent.conversation_id) : undefined;
  const storyNumber = str(req.body.story_number) ?? conv?.story_number ?? undefined;
  try {
    return await requestWorker({ worker, brief, storyNumber, projectPath: str(req.body.project_path), parentRunId: req.body.parentRunId });
  } catch (err) {
    throw bad((err as Error).message);
  }
});

app.post<{ Body: AgentBody }>('/api/agent/get_run', async (req) => runSummary(await getRun(String(req.body.run_id))));

app.post<{ Body: AgentBody }>('/api/agent/wait_for_run', async (req) => {
  const timeout = Math.min(Number(req.body.timeout_seconds ?? 600), 840) * 1000;
  return runSummary(await waitForRun(String(req.body.run_id), timeout));
});

// The servicenow skill's preview step: an Approve / Reject card inside the chat. Deciding it posts Matt's answer
// into the chat as his message; the orchestrator then writes (or doesn't) in its next turn.
app.post<{ Body: AgentBody }>('/api/agent/request_approval', async (req) => {
  const title = str(req.body.title);
  const preview = str(req.body.preview);
  if (!title || !preview) throw bad('title and preview are required');
  const run = req.body.parentRunId ? await getRun(req.body.parentRunId) : undefined;
  if (!run?.conversation_id) throw bad('request_approval only works inside a chat conversation');
  await supersedeChatApprovals(run.conversation_id); // a new preview replaces any older pending one in this chat
  const approval = await createApproval({
    kind: 'sn_confirm',
    title,
    payload: { conversationId: run.conversation_id, title, preview },
    requestedByRunId: run.id,
  });
  await postApprovalCard(run.conversation_id, approval.id);
  return {
    approval_id: approval.id,
    status: 'pending',
    note: 'The card is in Matt\'s Approvals panel. End your turn now. If he clicks Approve, his next message is "Yes, go ahead: …" and that turn may write. A typed "yes" does not unlock writes.',
  };
});

// Asked by the write guard hook before any ServiceNow write: only the turn started by clicking Approve may write.
app.get<{ Querystring: { run?: string } }>('/api/agent/write_permit', async (req) => {
  const run = req.query.run ? await getRun(req.query.run) : undefined;
  if (!run) return { ok: false, reason: 'unknown run' };
  const approvalId = parseMeta<{ answersApprovalId?: string }>(run).answersApprovalId;
  const approval = approvalId ? await getApproval(approvalId) : undefined;
  if (approval?.kind === 'sn_confirm' && approval.status === 'approved') return { ok: true, approval: approval.title };
  return {
    ok: false,
    reason:
      'no approved card for this turn. Call request_approval with the preview and end your turn; Matt approves it in his Approvals panel, and the turn his click starts may write. A typed "yes" does not count',
  };
});

// "Discuss with orchestrator" on a story: that story's own chat (created on first use).
app.post<{ Params: { number: string } }>('/api/stories/:number/conversation', async (req) => {
  const number = req.params.number.toUpperCase();
  if (!/^[A-Z]+\d+$/.test(number)) throw bad('Invalid story number');
  return openStoryConversation(number);
});

app.post<{ Body: AgentBody }>('/api/agent/propose_lesson', async (req) => {
  const worker = str(req.body.worker);
  const rule = str(req.body.rule);
  if (!worker || !rule) throw bad('worker and rule are required');
  const approval = await proposeLesson({ worker, rule, why: str(req.body.why), appliesTo: str(req.body.applies_to), sourceStory: str(req.body.source_story), parentRunId: req.body.parentRunId });
  return { approval_id: approval.id, status: 'pending' };
});

app.post('/api/agent/list_approvals', async () => listApprovals('pending'));

// Localhost only: this API can drive your browser session and start agents.
await app.listen({ port: config.server.port, host: '127.0.0.1' });
console.log(`ARCO agents server on http://127.0.0.1:${config.server.port}`);
