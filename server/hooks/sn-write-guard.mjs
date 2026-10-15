// PreToolUse hook for the orchestrator's Claude in Chrome javascript_tool calls.
// Hard guardrails on ServiceNow writes, whatever the model writes (ARCHITECTURE.md §9):
//   - no DELETE/PUT, and writes only to rm_story and time_card
//   - story state only to the allow-listed lanes (config: servicenow.agentAllowedStateValues)
//   - never change the time_sheet record or a time card's state (submitting is Matt's)
//   - no form submits from script
// Exit 2 blocks the call and shows the reason to Claude. Reads pass straight through.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(here, '../../config/app.config.json'), 'utf8'));
const allowedStates = new Set((config.servicenow.agentAllowedStateValues ?? []).map(String));

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

  const states = [...code.matchAll(/['"]?\bstate['"]?\s*:\s*['"`]?(-?\d+)/g)].map((m) => m[1]);
  if (tables.has('time_card') && /['"]?\bstate['"]?\s*:/.test(code)) block("a time card's state is never changed (Matt submits)");
  for (const s of states) if (!allowedStates.has(s)) block(`story state ${s} is Matt's lane; agents may only set ${[...allowedStates].join(', ')}`);
  if (tables.has('rm_story') && /['"]?\bstate['"]?\s*:\s*[^'"`\-\d\s]/.test(code)) block('write story state as a literal value so it can be checked');
  process.exit(0);
});
