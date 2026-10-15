// stdio MCP server that gives the orchestrator its tools. Each tool is a thin call to the local app API,
// so every action lands in SQL Server and shows up live in the web UI.
// Plain JS (no build step) because claude.exe launches it directly with node.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API = process.env.ARCO_API ?? 'http://127.0.0.1:4317';
const PARENT_RUN_ID = process.env.ARCO_PARENT_RUN_ID ?? null;

async function call(path, body = {}) {
  const res = await fetch(`${API}/api/agent/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, parentRunId: PARENT_RUN_ID }),
  });
  const text = await res.text();
  if (!res.ok) return { content: [{ type: 'text', text: `Error ${res.status}: ${text}` }], isError: true };
  return { content: [{ type: 'text', text }] };
}

const server = new McpServer({ name: 'arco', version: '0.1.0' });

server.registerTool(
  'list_stories',
  {
    description:
      'List stories from the local copy of the ServiceNow VTB (synced from the board). Filter by lane label, routing domain (pbi/dwh), or search text. Returns compact rows.',
    inputSchema: {
      lane: z.string().optional().describe('Lane label, e.g. "Ready"'),
      domain: z.enum(['pbi', 'dwh']).optional().describe('Routing domain from hashtags'),
      search: z.string().optional(),
    },
  },
  (args) => call('list_stories', args),
);

server.registerTool(
  'get_story',
  {
    description: 'Full details of one story (description, acceptance criteria, lane, tags), plus hours logged against it this week and recent agent runs.',
    inputSchema: { number: z.string().describe('e.g. STRY0024265') },
  },
  (args) => call('get_story', args),
);

server.registerTool(
  'get_timesheet',
  { description: "Matt's current-week ServiceNow timesheet (rows per task with daily hours). Read it before proposing a timesheet entry." },
  () => call('get_timesheet'),
);

server.registerTool(
  'sync_servicenow',
  {
    description:
      'Refresh the local board + timesheet copy from ServiceNow through the browser (~1 min). Use when data may be stale (see synced_at) or after Matt changes the board.',
  },
  () => call('sync_servicenow'),
);

server.registerTool('list_workers', { description: 'Available worker agents, what they do, and whether they need approval to start.' }, () =>
  call('list_workers'),
);

server.registerTool(
  'start_worker',
  {
    description:
      'Start a worker agent on a task. Read-only workers (QC) start immediately; write-capable workers (builders) wait for Matt to approve in the UI. Returns a run_id; use wait_for_run or get_run for the result.',
    inputSchema: {
      worker: z.string().describe('Worker name, e.g. pbi-qc'),
      brief: z.string().describe('Precise brief: goal, acceptance criteria, target files, constraints, what to return'),
      story_number: z.string().optional(),
      project_path: z.string().optional().describe('Absolute path to the PBIP/SQL project folder'),
    },
  },
  (args) => call('start_worker', args),
);

server.registerTool(
  'get_run',
  { description: 'Status and result of a run (worker, sync, or ServiceNow write).', inputSchema: { run_id: z.string() } },
  (args) => call('get_run', args),
);

server.registerTool(
  'wait_for_run',
  {
    description: 'Block until a run finishes (or timeout). Returns its status and result.',
    inputSchema: { run_id: z.string(), timeout_seconds: z.number().int().min(5).max(840).optional() },
  },
  (args) => call('wait_for_run', args),
);

server.registerTool(
  'propose_servicenow_update',
  {
    description:
      'Propose moving a story to another lane and/or adding a work note. Creates an approval card for Matt; nothing changes in ServiceNow until he approves. Agents may never move stories to Done-type lanes.',
    inputSchema: {
      story_number: z.string(),
      new_state: z.string().optional().describe('Target lane label'),
      work_note: z.string().optional().describe('Use the work note template from the servicenow skill'),
    },
  },
  (args) => call('propose_servicenow_update', args),
);

server.registerTool(
  'propose_timesheet_entry',
  {
    description:
      "Propose setting the hours for one day on one row of Matt's own ServiceNow timesheet (current or previous week). Updates the matching row or creates it. `hours` is the day's NEW TOTAL for that row, not an amount to add: read get_timesheet first and add to the current value if Matt says 'add'. Creates an approval card; nothing changes until Matt approves. Never submits the timesheet.",
    inputSchema: {
      task_number: z.string().optional().describe('Story/task number, e.g. STRY0024063. Omit for non-task rows.'),
      category: z.string().optional().describe('Row category label, e.g. "Task work" (default for tasks), "Admin", "Meeting". Required when task_number is omitted.'),
      day: z.string().describe('Weekday name for this week (e.g. "wednesday"), "today", or YYYY-MM-DD'),
      hours: z.number().min(0).max(24).describe('New total hours for that day on that row, quarter-hour steps'),
    },
  },
  (args) => call('propose_timesheet_entry', args),
);

server.registerTool(
  'propose_lesson',
  {
    description: "Draft a lesson from Matt's feedback for a worker's lessons file. Matt approves it in the UI before it's saved.",
    inputSchema: {
      worker: z.string(),
      rule: z.string(),
      why: z.string().optional(),
      applies_to: z.string().optional().describe('Comma-separated worker names'),
      source_story: z.string().optional(),
    },
  },
  (args) => call('propose_lesson', args),
);

server.registerTool('list_approvals', { description: 'Pending approval cards waiting on Matt.' }, () => call('list_approvals'));

await server.connect(new StdioServerTransport());
