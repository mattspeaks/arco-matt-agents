# Reading the board and timesheet

All snippets assume `window.SN` from SKILL.md is defined. Run them with `javascript_tool`. Top-level `await` works.

## Refreshing the app's copy (board + timesheet snapshot)

The app keeps a local copy for its dashboard. It saves any `javascript_tool` result whose `__arco` field is
`board-v2` or `timesheet-v2`, so return **exactly** these shapes and don't rename fields. Return `sys_id`s in the dashed form shown: the
extension blanks bare 32-character IDs as "encoded data". When Matt asks to sync or refresh, run the board snapshot
and the timesheet snapshot for this week and for last week. After any write, run the matching snapshot (for an
hours change, the week you changed), so the dashboard shows the change. Fetch once and answer follow-up questions
from the result.

### Board snapshot
```js
const G = 'd2ab7f44472d21102a2bef4d646d4329';
const rows = await SN(`/api/now/table/rm_story?sysparm_query=sprint.state=2^assignment_group=${G}^ORDERBYnumber&sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_limit=300&sysparm_fields=sys_id,number,short_description,description,state,priority,assigned_to,sprint,story_points,sys_updated_on`);
const v = (f) => f?.value ?? '', d = (f) => f?.display_value ?? '';
const id = (f) => v(f).replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-'); // dashed, or the extension blanks it
// The sprints' dates, for the app's sprint scoreboard.
const sprintIds = [...new Set(rows.map((s) => v(s.sprint)).filter(Boolean))];
const sprints = sprintIds.length ? await SN(`/api/now/table/rm_sprint?sysparm_query=sys_idIN${sprintIds.join(',')}&sysparm_fields=short_description,start_date,end_date`) : [];
({
  __arco: 'board-v2',
  sprints: sprints.map((p) => ({ name: p.short_description, start: String(p.start_date).slice(0, 10), end: String(p.end_date).slice(0, 10) })),
  stories: rows.map((s) => ({
    sys_id: id(s.sys_id), number: v(s.number), title: d(s.short_description),
    state_value: v(s.state), state_label: d(s.state), priority: d(s.priority), assigned_to: d(s.assigned_to),
    sprint: d(s.sprint), points: d(s.story_points), updated: v(s.sys_updated_on),
    tags: [...new Set(`${d(s.short_description)} ${d(s.description)}`.match(/#[A-Za-z][\w-]*/g) || [])],
  })),
})
```

### Story snapshot (one story in full)
The board snapshot leaves out descriptions and acceptance criteria. Use this snapshot after you change a story (it
counts as the resync for that change), and whenever you read a story's full details: the app then shows the
current text and gives it to the builders. Set `N` to the story number.
```js
const N = 'STRY00xxxxx';
const [s] = await SN(`/api/now/table/rm_story?sysparm_query=number=${N}&sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_fields=sys_id,number,short_description,description,acceptance_criteria,state,priority,assigned_to,sprint,story_points,sys_updated_on`);
const v = (f) => f?.value ?? '', d = (f) => f?.display_value ?? '';
const id = (f) => v(f).replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
// HTML → plain text, then 900-character pieces (the extension cuts strings over 1000 characters).
const plain = (html) => { const el = document.createElement('div'); el.innerHTML = String(html).replace(/<(br|\/p|\/li|\/div)[^>]*>/gi, '\n$&'); return el.textContent.replace(/\n{3,}/g, '\n\n').trim(); };
const pieces = (t) => t.match(/[\s\S]{1,900}/g) || [];
({
  __arco: 'story-v1',
  sys_id: id(s.sys_id), number: v(s.number), title: d(s.short_description),
  state_value: v(s.state), state_label: d(s.state), priority: d(s.priority), assigned_to: d(s.assigned_to),
  sprint: d(s.sprint), points: d(s.story_points), updated: v(s.sys_updated_on),
  tags: [...new Set(`${d(s.short_description)} ${d(s.description)}`.match(/#[A-Za-z][\w-]*/g) || [])],
  description_parts: pieces(plain(v(s.description))),
  acceptance_parts: pieces(plain(v(s.acceptance_criteria))),
})
```

### Timesheet snapshot (one week)
Run it once per week. Each run returns its own snapshot, and the app keeps every week it has seen. **Sync** means
this week and last week. For another week, Matt names it, or the sync message gives its Sunday as `W`.
```js
const WEEKS_BACK = 0; // 0 = this week, 1 = last week
const sun = new Date(); sun.setDate(sun.getDate() - sun.getDay() - 7 * WEEKS_BACK);
const W = sun.toLocaleDateString('en-CA'); // the week's Sunday, YYYY-MM-DD, local time (or set W directly)
const [sheet] = await SN(`/api/now/table/time_sheet?sysparm_query=user=javascript:gs.getUserID()^week_starts_on=${W}&sysparm_fields=sys_id,week_starts_on,week_ends_on,state,total_hours&sysparm_display_value=all&sysparm_limit=1`);
const cards = sheet ? await SN(`/api/now/table/time_card?sysparm_query=time_sheet=${sheet.sys_id.value}&sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_limit=200&sysparm_fields=sys_id,task.number,task.short_description,task.sys_class_name,top_task,category,sunday,monday,tuesday,wednesday,thursday,friday,saturday,total,state`) : [];
const v = (f) => f?.value ?? '', d = (f) => f?.display_value ?? '', n = (f) => +(f?.value ?? 0) || 0;
const id = (f) => v(f).replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-'); // dashed, or the extension blanks it
({
  __arco: 'timesheet-v2',
  sheet: sheet ? { sys_id: id(sheet.sys_id), week_starts_on: v(sheet.week_starts_on), week_ends_on: v(sheet.week_ends_on), state: d(sheet.state), total_hours: n(sheet.total_hours) } : null,
  cards: cards.map((c) => ({
    sys_id: id(c.sys_id), task_number: v(c['task.number']) || null, task_short_description: d(c['task.short_description']) || null,
    task_class: v(c['task.sys_class_name']) || null, top_task_number: d(c.top_task) || null, category: d(c.category),
    sunday: n(c.sunday), monday: n(c.monday), tuesday: n(c.tuesday), wednesday: n(c.wednesday),
    thursday: n(c.thursday), friday: n(c.friday), saturday: n(c.saturday), total: n(c.total), state: d(c.state),
  })),
})
```

## Other questions

Adjust the query, keep `sysparm_fields` tight, and map the result down before returning it.

| Question | Query on `rm_story` |
|---|---|
| One lane on the board | `sprint.state=2^assignment_group=<G>^state=<value>` |
| A story's full details | `number=STRY00xxxxx`, fields `sys_id,number,short_description,description,acceptance_criteria,state,assigned_to,sprint,story_points,sys_updated_on` (descriptions are HTML: strip the tags before reading) |
| Recent work notes on a story | table `sys_journal_field`, `element_id=<sys_id>^element=work_notes^ORDERBYDESCsys_created_on`, fields `value,sys_created_on,sys_created_by`, limit 5 |
| Backlog for the group | `assignment_group=<G>^stateIN-10,-6,1^sprintISEMPTY` |
| When a card actually moved | table `sys_audit`, `documentkey=<sys_id>^fieldname=state` |

The app's local copy (`list_stories`, `get_story`, `get_timesheet`) is fine for quick answers. Check its
`synced_at`, and read live when freshness matters or Matt says something changed.

With `sysparm_display_value=all`, each field is `{ value, display_value }`. `value` is the raw value you PATCH, and
`display_value` is what Matt sees.
