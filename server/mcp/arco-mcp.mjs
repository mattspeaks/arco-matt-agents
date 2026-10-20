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
    description: "Draft a lesson from Matt's feedback for a worker's lessons file. Matt approves it in the UI before it's saved. Use worker 'arco-data' for facts about ARCO data itself (X is really column Y, a source is retired / never to be ingested, what a column means): every data bot reads that file. One lesson per fact.",
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
      "Story chats only. Puts the start card for report work in Matt's Approvals: the plan, the branch, the move to Work in progress, the builder/QC loop, then the Review card. Start from Fabric (workspace + report: pulled into the repo first) or from the repo as it is on main (repo_report only). If the report already exists in the repo under a different name, pass repo_report along with workspace + report so the pull lands in that folder. Replaces any earlier workflow for the story. END YOUR TURN after calling it.",
    inputSchema: {
      workspace: z.string().optional().describe('Fabric source: workspace id or name the report lives in'),
      report: z.string().optional().describe('Fabric source: report id or name'),
      repo_report: z.string().optional().describe('Repo path (from list_repo_reports) of the X.Report folder or .pbip, e.g. "Accounting/ARandAP to GL Report/APARtoGLReportv2.pbip"'),
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
      "Story chats only. Puts a rebuild card in Matt's Approvals: the changes, optionally text to append to the acceptance criteria, then another builder/QC loop on the same branch and a new Review card. Use it after Not ready (once you've interviewed him), after a stop or failure, or whenever he wants more changes. END YOUR TURN after calling it.",
    inputSchema: {
      changes: z.string().describe('Markdown: the complete, numbered list of changes, specific enough for the builder'),
      acceptance_criteria: z.string().optional().describe('Text to append to the story acceptance criteria, exactly as it will be written'),
    },
  },
  (args) => call('submit_revision', args),
);

server.registerTool(
  'list_repo_reports',
  {
    description: 'PowerBI repo, read-only, as it is on main: the reports (X.Report folders) under a folder, with their display names. Use it to find repo_report.',
    inputSchema: { folder: z.string().optional().describe('e.g. "Accounting"; omit for the whole repo') },
  },
  (args) => call('list_repo_reports', args),
);

server.registerTool(
  'attach_report_work',
  {
    description:
      "Story chats only. Takes over a branch of the PowerBI repo that was built outside the workflow (by Matt, or in an earlier detour), so the Review and Publish cards work for it. No card: it sets up the app's own worktree on that branch. If the branch is checked out in Matt's own checkout, he has to switch that away first (tell him). Then call request_review or submit_revision.",
    inputSchema: {
      branch: z.string().describe('e.g. agent/STRY0024370-apar-gl-disclaimer-banner'),
      repo_report: z.string().optional().describe('The X.Report folder or .pbip, if the branch changes more than one report'),
      plan: z.string().optional().describe("What the branch does, if the story's workflow doesn't already have a plan"),
    },
  },
  (args) => call('attach_report_work', args),
);

server.registerTool(
  'request_review',
  {
    description: "Story chats only. Puts a Review report card up now for the story's branch as it is (Open in Desktop, then Approve → Publish card, or Not ready). Use it whenever a report is ready for Matt to look at and no Review card is pending. END YOUR TURN after calling it.",
    inputSchema: { summary: z.string().optional().describe("What changed, for the card and the Ready for testing work note, if the last builder run's summary isn't right any more") },
  },
  (args) => call('request_review', args),
);

server.registerTool(
  'start_closeout',
  {
    description:
      "Story chats only. Puts Matt's close-out checklist in the chat (his definition of done: app published for business review, PRs completed, published to production, sign-off). It appears on its own after a publish; use this when he wants to start wrapping up a story without the report workflow. Matt ticks the items himself, and when they're all done he closes the story from the card.",
  },
  () => call('start_closeout'),
);

server.registerTool(
  'ask_time_entry',
  {
    description:
      "Puts a Timesheet card in the chat: this week's days, each with a box for hours to add to a story, next to what's already logged. Matt fills it in; his Add click starts a turn that asks you to add the hours (servicenow skill, timesheet recipe). Use it when he wants to log time on a story, instead of asking for numbers in text. In a story chat the story is implied.",
    inputSchema: { story_number: z.string().optional() },
  },
  (args) => call('ask_time_entry', args),
);

server.registerTool(
  'request_publish',
  {
    description:
      "Story chats only. Puts a Publish card up for the story's report as it is now, e.g. to publish it again or to production after Acceptance. Matt picks the workspace (production ones need his extra tick) and the report to update. If anything changed since the last final QC, QC runs first and the card follows. Never publishes an app. END YOUR TURN after calling it.",
  },
  () => call('request_publish'),
);

server.registerTool(
  'start_gap_design',
  {
    description:
      "In a 'Data Gaps for - STRY…' story's chat. Starts dwh-gap-designer (read-only): for each gap it separates name confusion from real gaps and writes text proposals (gold column additions, new gold / silver tables, with sources and why). Nothing is written to the DWH. Its proposal comes back as a card in this chat; approving it adds a work note to the gaps story and sends approved name mappings to the original report. END YOUR TURN after calling it.",
    inputSchema: {
      origin_story: z.string().optional().describe('The report story the gaps came from, if the title does not say'),
      notes: z.string().optional().describe('Anything Matt said to focus on'),
    },
  },
  (args) => call('start_gap_design', args),
);

server.registerTool(
  'stop_report_work',
  {
    description: "Story chats only. Stops the story's running builder/QC loop (e.g. Matt says wait, or something's wrong). The branch keeps what was committed. No card needed.",
    inputSchema: { reason: z.string().optional() },
  },
  (args) => call('stop_report_work', args),
);

server.registerTool('get_report_flow', { description: "Story chats only. Where this story's Power BI report workflow is: stage, branch, paths, last builder/QC results, PR." }, () =>
  call('get_report_flow'),
);

await server.connect(new StdioServerTransport());
