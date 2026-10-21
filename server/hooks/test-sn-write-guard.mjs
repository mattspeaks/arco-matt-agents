// Regression test for sn-write-guard.mjs: `npm run test:guard`.
// 1. Every write snippet in the servicenow skill's recipes must pass the guard's rules. With no ARCO_RUN_ID set, a
//    snippet that passes every rule stops at the approval check ("no app run id"); any other block means a recipe and
//    the guard disagree, and every real write following that recipe would be blocked.
// 2. Writes the guard exists to stop must still be stopped, each for the expected reason.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const guard = join(here, 'sn-write-guard.mjs');
const skill = resolve(here, '../../.claude/skills/servicenow');
const env = { ...process.env };
delete env.ARCO_RUN_ID;

function run(code) {
  const r = spawnSync(process.execPath, [guard], { input: JSON.stringify({ tool_input: { text: code } }), env, encoding: 'utf8' });
  return { allowed: r.status === 0, reason: r.stderr.replace(/^Blocked by the app's ServiceNow write guard: /, '').replace(/\. Tell Matt.*$/s, '') };
}

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};

console.log('Recipe write snippets pass the rules (stop only at the approval check):');
const files = [join(skill, 'SKILL.md'), ...readdirSync(join(skill, 'references')).map((f) => join(skill, 'references', f))];
for (const file of files) {
  const md = readFileSync(file, 'utf8');
  // Recipes may have Windows line endings (writing.md does).
  for (const [i, m] of [...md.replace(/\r\n/g, '\n').matchAll(/```js\n([\s\S]*?)```/g)].entries()) {
    const code = m[1];
    if (!/method\s*:\s*['"`](PATCH|POST|PUT|DELETE)['"`]/i.test(code)) continue;
    const label = `${file.slice(skill.length + 1)} snippet ${i + 1}`;
    const r = run(code);
    if (!r.allowed && /no app run id/.test(r.reason)) ok(label);
    else fail(`${label}: ${r.allowed ? 'allowed with no run id' : r.reason}`);
  }
}

console.log('Real approved writes pass the rules (stop only at the approval check):');
const approved = {
  // 2026-10-21: Tuesday hours on two cards plus two new rows; the last line reads state back for the summary.
  'timesheet hours with a state read-back': `const F = 'sysparm_display_value=true&sysparm_fields=task,category,tuesday,total,state';
const out = [];
out.push(await SN(\`/api/now/table/time_card/0b3a?\${F}\`, { method: 'PATCH', body: JSON.stringify({ tuesday: '1' }) }));
out.push(await SN(\`/api/now/table/time_card?\${F}\`, { method: 'POST', body: JSON.stringify({ time_sheet: '8b3a', task: '6fc1', category: 'task_work', tuesday: '0.5' }) }));
out.map(r => ({ task: r.task?.display_value ?? r.task, cat: r.category, tue: r.tuesday, total: r.total, state: r.state }))`,
  'story edit with a state read-back': `const r = await SN('/api/now/table/rm_story/abc?sysparm_fields=number,state', { method: 'PATCH', body: JSON.stringify({ work_notes: 'note' }) });
({ number: r.number, state: r.state })`,
};
for (const [name, code] of Object.entries(approved)) {
  const r = run(code);
  if (!r.allowed && /no app run id/.test(r.reason)) ok(name);
  else fail(`${name}: ${r.allowed ? 'allowed with no run id' : r.reason}`);
}

console.log('Forbidden writes are still blocked:');
const blocked = {
  'move to Complete': [`await SN('/api/now/table/rm_story/abc', { method: 'PATCH', body: JSON.stringify({ state: '3' }) })`, /Matt's lane/],
  'move to Ready': [`await SN('/api/now/table/rm_story/abc', { method: 'PATCH', body: JSON.stringify({ state: '1' }) })`, /Matt's lane/],
  'state from a variable': [`const s = '3'; await SN('/api/now/table/rm_story/abc', { method: 'PATCH', body: JSON.stringify({ state: s }) })`, /literal value/],
  'create in Complete': [`await SN('/api/now/table/rm_story', { method: 'POST', body: JSON.stringify({ state: '3' }) })`, /new story may only start/],
  'create mixed with an update': [`await SN('/api/now/table/rm_story', { method: 'POST', body: '{}' }); await SN('/api/now/table/rm_story/abc', { method: 'PATCH', body: '{}' })`, /own call/],
  'other team': [`await SN('/api/now/table/rm_story/abc', { method: 'PATCH', body: JSON.stringify({ assignment_group: '981ec19a879ac31030670e16cebb35c5' }) })`, /Data and Analytics group/],
  'epic': [`await SN('/api/now/table/rm_epic', { method: 'POST', body: '{}' })`, /table rm_epic/],
  'DELETE': [`await SN('/api/now/table/rm_story/abc', { method: 'DELETE' })`, /not allowed/],
  'submit the timesheet': [`await SN('/api/now/table/time_sheet/abc', { method: 'PATCH', body: JSON.stringify({ state: 'Submitted' }) })`, /time_sheet record/],
  "time card state": [`await SN('/api/now/table/time_card/abc', { method: 'PATCH', body: JSON.stringify({ state: 'Submitted' }) })`, /time card's state/],
  'time card state copied into a body': [`const r = await SN('/api/now/table/time_card/abc'); await SN('/api/now/table/time_card/def', { method: 'PATCH', body: JSON.stringify({ state: r.state }) })`, /time card's state/],
  'time card state from a non-response variable': [`const t = { state: 'submitted' }; await SN('/api/now/table/time_card/abc', { method: 'PATCH', body: JSON.stringify({ hours: 1, state: t.state }) })`, /time card's state/],
  'story lane copied from another story': [`const o = await SN('/api/now/table/rm_story/done'); await SN('/api/now/table/rm_story/abc', { method: 'PATCH', body: JSON.stringify({ state: o.state }) })`, /literal value/],
  'form submit': [`g_form.submit()`, /submit forms/],
};
for (const [name, [code, expect]] of Object.entries(blocked)) {
  const r = run(code);
  if (!r.allowed && expect.test(r.reason)) ok(name);
  else fail(`${name}: ${r.allowed ? 'allowed' : `blocked for another reason: ${r.reason}`}`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll guard checks passed');
process.exit(failures ? 1 : 0);
