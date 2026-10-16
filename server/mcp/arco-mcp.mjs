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
  { description: "The app's local copy of Matt's current-week timesheet (rows per task with daily hours). Read live with the servicenow skill before changing hours." },
  () => call('get_timesheet'),
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
  'request_approval',
  {
    description:
      "Show Matt an Approve / Reject card in the chat for a ServiceNow change you've prepared (the preview step of the servicenow skill). After calling it, END YOUR TURN. His answer arrives as his next message. Make the change only after he says yes.",
    inputSchema: {
      title: z.string().describe('One line, e.g. "STRY0024070 → Work in progress + work note" or "Timesheet: STRY0024063 Wed 0 → 4h"'),
      preview: z.string().describe('Markdown: the before → after table and the exact work note text, exactly as it will be written'),
    },
  },
  (args) => call('request_approval', args),
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

// ---- Power BI report workflow (story chats only) ----
server.registerTool(
  'list_fabric_items',
  {
    description: 'Fabric, read-only. With no workspace: the workspaces Matt can access. With a workspace (id or name): its reports and semantic models, and the PowerBI repo folder it maps to.',
    inputSchema: { workspace: z.string().optional() },
  },
  (args) => call('list_fabric_items', args),
);

server.registerTool(
  'propose_report_work',
  {
    description:
      "Story chats only. Puts the start card for changing an existing Power BI report in Matt's Approvals: the plan, the pull from Fabric into the PowerBI repo, the move to Work in progress, the builder/QC loop, and the Review card. END YOUR TURN after calling it.",
    inputSchema: {
      workspace: z.string().describe('Workspace id or name the report lives in'),
      report: z.string().describe('Report id or name'),
      plan: z.string().describe('Markdown: what will change and how, the builder brief in Matt-readable form'),
      work_note: z.string().describe('The exact Work in progress work note, in the standard [Agent: Power BI Manager] format'),
    },
  },
  (args) => call('propose_report_work', args),
);

server.registerTool(
  'submit_revision',
  {
    description:
      'Story chats only, after Matt clicks Not ready and you have interviewed him. Puts the revision card in his Approvals: the changes, the text to append to the acceptance criteria, then another builder/QC loop. END YOUR TURN after calling it.',
    inputSchema: {
      changes: z.string().describe('Markdown: the complete, numbered list of changes, specific enough for the builder'),
      acceptance_criteria: z.string().describe('Text to append to the story acceptance criteria, exactly as it will be written'),
    },
  },
  (args) => call('submit_revision', args),
);

server.registerTool('get_report_flow', { description: "Story chats only. Where this story's Power BI report workflow is: stage, branch, paths, last builder/QC results, PR." }, () =>
  call('get_report_flow'),
);

await server.connect(new StdioServerTransport());
