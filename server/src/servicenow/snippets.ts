// JavaScript executed inside Matt's logged-in ServiceNow tab via Claude in Chrome's javascript_tool.
// The tool evaluates with top-level await and returns the last expression (objects come back as JSON).
// Every snippet is generated here, from vetted code; agents never write their own ServiceNow requests.
// All injected values go through JSON.stringify, never string concatenation.
//
// The extension truncates results over 50KB, so every snippet returns through chunked(): the full JSON is
// stashed on window and handed back in parts ({__arco, part, parts, chunk}); window.__arcoPart(i) returns part i.
// The extension also blanks text that looks like cookies/query strings, so = & ; ? are written as JSON \uXXXX
// escapes. Those characters only occur inside JSON strings, so JSON.parse restores them exactly.
// And it truncates any single string value at 1000 chars, so each chunk is an array of short pieces.

export const SYNC_MARKER = 'arco-sync-v1';
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const CHUNK_SIZE = 18000;
const PIECE_SIZE = 900;

function chunked(marker: string, body: string, resultExpr: string): string {
  return `${body}
{
  const json = JSON.stringify(${resultExpr}).replace(/[=&;?]/g, (c) => '\\\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const parts = Math.max(1, Math.ceil(json.length / ${CHUNK_SIZE}));
  const pieces = (s) => s.match(/[\\s\\S]{1,${PIECE_SIZE}}/g) || [];
  window.__arcoPart = (i) => ({ __arco: ${JSON.stringify(marker)}, part: i, parts, chunk: pieces(json.slice(i * ${CHUNK_SIZE}, (i + 1) * ${CHUNK_SIZE})) });
}
window.__arcoPart(0)`;
}

const PRELUDE = `
const H = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-UserToken': window.g_ck || (window.NOW && NOW.g_ck) };
const get = async (path) => {
  const r = await fetch(path, { headers: H, credentials: 'same-origin' });
  if (!r.ok) return { error: r.status };
  return { result: (await r.json()).result };
};
const dv = (f) => (f && typeof f === 'object' ? f.display_value : f) ?? '';
const vv = (f) => (f && typeof f === 'object' ? f.value : f) ?? '';
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + ' …[truncated]' : s);
const plain = (html) => {
  if (!html || !/[<&]/.test(html)) return html;
  const marked = html.replace(/<br\\s*\\/?>/gi, '\\n').replace(/<\\/(p|div|li|h[1-6]|tr)>/gi, '\\n').replace(/<li[^>]*>/gi, '- ');
  return (new DOMParser().parseFromString(marked, 'text/html').body.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim();
};
const q = encodeURIComponent;`;

export function syncSnippet(p: { boardSysId: string; storyTable: string }): string {
  return chunked(SYNC_MARKER, `${PRELUDE}
const BOARD = ${JSON.stringify(p.boardSysId)};
const TABLE = ${JSON.stringify(p.storyTable)};
const errors = [];
const board = await get('/api/now/table/vtb_board/' + BOARD + '?sysparm_fields=name,table,field,filter&sysparm_display_value=all');
if (board.error) errors.push('board:' + board.error);
const filter = vv(board.result?.filter);
const fields = 'sys_id,number,short_description,description,acceptance_criteria,state,priority,assigned_to,sprint,story_points,sys_updated_on';
const st = await get('/api/now/table/' + TABLE + '?sysparm_query=' + q((filter ? filter + '^' : '') + 'ORDERBYnumber') +
  '&sysparm_fields=' + fields + '&sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_limit=500');
if (st.error) errors.push('stories:' + st.error);
const ch = await get('/api/now/table/sys_choice?sysparm_query=' + q('name=' + TABLE + '^element=state^inactive=false^language=en^ORDERBYsequence') +
  '&sysparm_fields=value,label,sequence&sysparm_limit=100');
if (ch.error) errors.push('choices:' + ch.error);
const d = new Date(); d.setDate(d.getDate() - d.getDay());
const weekStart = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const ts = await get('/api/now/table/time_sheet?sysparm_query=' + q('user=javascript:gs.getUserID()^week_starts_on=' + weekStart) +
  '&sysparm_fields=sys_id,week_starts_on,week_ends_on,state,total_hours&sysparm_display_value=all&sysparm_limit=1');
if (ts.error) errors.push('timesheet:' + ts.error);
const sheet = ts.result?.[0];
let cards = [];
if (sheet) {
  const tc = await get('/api/now/table/time_card?sysparm_query=' + q('time_sheet=' + vv(sheet.sys_id)) +
    '&sysparm_fields=sys_id,task,top_task,category,sunday,monday,tuesday,wednesday,thursday,friday,saturday,total,state&sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_limit=200');
  if (tc.error) errors.push('time_cards:' + tc.error);
  cards = tc.result || [];
  const taskIds = [...new Set(cards.map((c) => vv(c.task)).filter(Boolean))];
  let tasks = {};
  if (taskIds.length) {
    const tk = await get('/api/now/table/task?sysparm_query=' + q('sys_idIN' + taskIds.join(',')) + '&sysparm_fields=sys_id,number,short_description,sys_class_name&sysparm_limit=200');
    for (const t of tk.result || []) tasks[t.sys_id] = t;
  }
  cards = cards.map((c) => {
    const t = tasks[vv(c.task)] || {};
    return {
      sys_id: vv(c.sys_id), task_number: t.number || dv(c.task) || null, task_class: t.sys_class_name || null,
      task_short_description: t.short_description || null, top_task_number: dv(c.top_task) || null, category: dv(c.category),
      sunday: +vv(c.sunday) || 0, monday: +vv(c.monday) || 0, tuesday: +vv(c.tuesday) || 0, wednesday: +vv(c.wednesday) || 0,
      thursday: +vv(c.thursday) || 0, friday: +vv(c.friday) || 0, saturday: +vv(c.saturday) || 0, total: +vv(c.total) || 0,
      state: dv(c.state),
    };
  });
}`, `({
  __arco: ${JSON.stringify(SYNC_MARKER)},
  errors,
  board: { name: dv(board.result?.name), filter },
  choices: (ch.result || []).map((c) => ({ value: c.value, label: c.label, sequence: +c.sequence || 0 })),
  stories: (st.result || []).map((s) => ({
    sys_id: vv(s.sys_id), number: vv(s.number), short_description: dv(s.short_description),
    description: clip(plain(dv(s.description)), 12000), acceptance_criteria: clip(plain(dv(s.acceptance_criteria)), 12000),
    state_value: vv(s.state), state_label: dv(s.state), priority: dv(s.priority), assigned_to: dv(s.assigned_to),
    sprint: dv(s.sprint), story_points: dv(s.story_points), sys_updated_on: vv(s.sys_updated_on),
  })),
  timesheet: sheet ? { sys_id: vv(sheet.sys_id), week_starts_on: vv(sheet.week_starts_on), week_ends_on: vv(sheet.week_ends_on),
    state: dv(sheet.state), total_hours: +vv(sheet.total_hours) || 0 } : null,
  time_cards: cards,
})`);
}

