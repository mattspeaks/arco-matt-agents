// PreToolUse hook for the orchestrator's Claude in Chrome javascript_tool calls.
// Hard guardrails on ServiceNow writes, whatever the model writes (ARCHITECTURE.md §9):
//   - no DELETE/PUT, and writes only to rm_story and time_card
//   - story state only to the allow-listed lanes (config: servicenow.agentAllowedStateValues); a new story may
//     start only in servicenow.agentCreateStateValues, and is created in its own call
//   - never change the time_sheet record or a time card's state (submitting is Matt's)
//   - a story's assignment_group can only ever be the team's group (config: servicenow.assignmentGroup)
//   - no form submits from script
//   - only in the turn Matt started by typing yes to a ServiceNow preview card (asks the app: /api/agent/write_permit)
// Exit 2 blocks the call and shows the reason to Claude. Reads pass straight through.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(here, '../../config/app.config.json'), 'utf8'));
const allowedStates = new Set((config.servicenow.agentAllowedStateValues ?? []).map(String));
const createStates = new Set((config.servicenow.agentCreateStateValues ?? []).map(String));

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let code = '';
  try {
    const event = JSON.parse(input);
    code = String(event.tool_input?.text ?? event.tool_input?.code ?? '');
  } catch {
    process.exit(0);
  }
  const block = (why) => {
    process.stderr.write(`Blocked by the app's ServiceNow write guard: ${why}. Tell Matt; don't work around it.`);
    process.exit(2);
  };

  if (/gsftSubmit|g_form\s*\.\s*(submit|save)|\.submit\s*\(/.test(code)) block('scripts may not submit forms');
  const methods = [...code.matchAll(/method\s*:\s*['"`](\w+)['"`]/gi)].map((m) => m[1].toUpperCase());
  if (/XMLHttpRequest|sendBeacon/.test(code)) block('use fetch through the SN helper only');
  const writes = methods.filter((m) => m !== 'GET');
  if (!writes.length) process.exit(0);

  if (writes.some((m) => m !== 'PATCH' && m !== 'POST')) block(`${writes.join('/')} is not allowed (only PATCH and POST)`);
  const tables = new Set([...code.matchAll(/\/api\/now\/table\/(\w+)/g)].map((m) => m[1]));
  const readOnly = new Set(['time_sheet', 'task', 'sys_user']);
  for (const t of tables) if (t !== 'rm_story' && t !== 'time_card' && !readOnly.has(t)) block(`writes may not touch table ${t}`);
  if (/\/api\/now\/(?!table\/)/.test(code)) block('only the Table API is allowed in a write');
  if (/\/api\/now\/table\/time_sheet\//.test(code)) block('the time_sheet record itself is never changed (Matt submits)');
  // Lookup tables may be queried (?sysparm_query=...) in a write snippet, never addressed by record path.
  if (/\/api\/now\/table\/(task|sys_user)\//.test(code)) block('task and sys_user records are read-only');

  // Stories stay on the team's board: assignment_group, if written at all, must be the team's group.
  const team = String(config.servicenow.assignmentGroup ?? '');
  for (const m of code.matchAll(/['"]?\bassignment_group['"]?\s*:\s*(['"`]?)([^'"`,}\s]*)\1/g)) {
    if (tables.has('rm_story') && m[2].replace(/-/g, '') !== team) block(`stories stay in the ABS Data and Analytics group (write assignment_group only as the literal id ${team}); reassigning to another group is Matt's call`);
  }

  // Creating a story: POST to the rm_story collection (no record id), kept apart from updates to existing stories.
  const creatingStory = writes.includes('POST') && /\/api\/now\/table\/rm_story(?![\/\w])/.test(code);
  if (creatingStory && (writes.includes('PATCH') || /\/api\/now\/table\/rm_story\//.test(code))) block('create stories in their own call, separate from updates to existing stories');
  const laneSet = creatingStory ? createStates : allowedStates;

  // Reading a result back (`state: r.state` in the summary a script returns) isn't a write. It's exempt only when it
  // reads from a ServiceNow response (a variable assigned from `await SN(` or a .map callback parameter) and sits
  // outside every JSON.stringify(...) request body. Anything else that says `state:` is checked as a write.
  const responseVars = new Set([
    ...[...code.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*await\s+SN\s*\(/g)].map((m) => m[1]),
    ...[...code.matchAll(/\.map\s*\(\s*\(?\s*(\w+)/g)].map((m) => m[1]),
  ]);
  const bodies = [];
  for (const m of code.matchAll(/JSON\.stringify\s*\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < code.length && depth) depth += code[i] === '(' ? 1 : code[i] === ')' ? -1 : 0, i++;
    bodies.push([m.index, i]);
  }
  const inBody = (at) => bodies.some(([a, b]) => at >= a && at < b);
  const checked = code.replace(/(['"]?\bstate['"]?\s*:\s*)(\w+)\s*(\?\.|\.)\s*state\b/g, (all, key, v, _dot, at) =>
    responseVars.has(v) && !inBody(at) ? 'readback' : all,
  );

  const states = [...checked.matchAll(/['"]?\bstate['"]?\s*:\s*['"`]?(-?\d+)/g)].map((m) => m[1]);
  if (tables.has('time_card') && /['"]?\bstate['"]?\s*:/.test(checked)) block("a time card's state is never changed (Matt submits)");
  for (const s of states) if (!laneSet.has(s)) block(creatingStory ? `a new story may only start in states ${[...createStates].join(', ')}` : `story state ${s} is Matt's lane; agents may only set ${[...allowedStates].join(', ')}`);
  if (tables.has('rm_story') && /['"]?\bstate['"]?\s*:\s*[^'"`\-\d\s]/.test(checked)) block('write story state as a literal value so it can be checked');

  // Writes only happen in the turn Matt started by typing yes to the preview (request_approval).
  const api = process.env.ARCO_API ?? 'http://127.0.0.1:4317';
  const runId = process.env.ARCO_RUN_ID;
  if (!runId) block('no app run id, so the approval can\'t be checked');
  fetch(`${api}/api/agent/write_permit?run=${encodeURIComponent(runId)}`)
    .then((r) => r.json())
    .then((permit) => {
      if (permit?.ok) process.exit(0);
      block(permit?.reason ?? 'no approved card for this change');
    })
    .catch(() => block("couldn't reach the app to check the approval"));
});
