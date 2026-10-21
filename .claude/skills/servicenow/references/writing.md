# Writing: story updates and timesheet hours

Every write: resolve → preview → Matt's explicit "yes" → re-check → write → verify → resync.

- Preview with `mcp__arco__request_approval` (title + markdown preview), then end your turn. Never ask for a yes in
  text. Write only in the turn started by Matt clicking Approve ("Yes, go ahead: …"); the app's guard blocks writes in
  any other turn. One card can cover a batch that was previewed together. If anything changes, preview again.
- Edited fields and work notes follow "What goes in story text" in SKILL.md: link the source record, no personal
  data, no pasted SQL or scripts.
- After writing, compare what ServiceNow returns with what you intended (business rules can override fields
  silently), report anything that didn't take, then re-run the matching snapshot from reading.md.

## Story updates (lane moves and work notes)

Allowed: `state` to 2 (Work in progress) or -7 (Ready for testing), and `work_notes` (appends; overwrites nothing).

1. Resolve:

```js
const [s] = await SN(`/api/now/table/rm_story?sysparm_query=number=STRY0024070&sysparm_display_value=all&sysparm_fields=sys_id,number,short_description,state,sys_updated_on`);
({
  sys_id: s.sys_id.value.replace(/^(.{8})(.{4})(.{4})(.{4})/, "$1-$2-$3-$4-"),
  number: s.number.value,
  title: s.short_description.display_value,
  state: s.state.display_value,
  updated: s.sys_updated_on.value,
});
```

2. Preview (Story | Title | Before → After, plus the exact work note) with request_approval, then end your turn.
3. After "yes", re-check and PATCH (remove the dashes from the sys_id first):

```js
const id = "<sys_id without dashes>",
  previewUpdated = "<updated from step 1>";
const [cur] = await SN(`/api/now/table/rm_story?sysparm_query=sys_id=${id}&sysparm_fields=sys_updated_on`);
if (cur.sys_updated_on !== previewUpdated) throw new Error("Changed since preview: re-preview");
await SN(`/api/now/table/rm_story/${id}?sysparm_display_value=true&sysparm_fields=number,state`, {
  method: "PATCH",
  body: JSON.stringify({ state: "2", work_notes: "<exact text>" }),
});
```

4. Verify that the returned state is the intended lane, link the story, then re-run the board snapshot.

## Editing a story's fields

Fields you may change, when Matt asks: `short_description`, `description`, `acceptance_criteria`, `story_points`,
`priority`, `assigned_to`, `sprint`, `epic`, `product`, `blocked` / `blocked_reason`. You may also make the lane
moves and add the work notes above. Never change `assignment_group` (the guard only allows the team's own group),
`number`, or a lane outside 2 and -7. Cancelling and Complete are Matt's.

1. Resolve: read the story with the fields you'll change plus `sys_updated_on` (`sysparm_display_value=all`). For
   reference fields (`assigned_to`, `sprint`, `epic`, `product`), look up the new record's sys_id: people as in
   creating.md, sprints with `rm_sprint?sysparm_query=state=2` for the current sprint (`state=-6` for the next one),
   epics with `rm_epic?sysparm_query=product=<product>^stateNOT IN3,4`.
2. Preview with request_approval, then end your turn:
   - Title: `STRY00xxxxx: edit <fields>`
   - A Field | Before | After table for the short fields.
   - For `description` and `acceptance_criteria`, show the full new text exactly as it will be saved. If Matt asked
     to add to them, keep the existing text and append; say "appends" or "replaces" in the table.
   - One card can cover several fields, or several stories edited together.
3. After "Yes, go ahead": check that nothing changed since the preview, then PATCH only the previewed fields. These
   two text fields are HTML in ServiceNow, so turn line breaks into `<br>` (or keep the existing HTML when you
   append):

```js
const id = "<sys_id without dashes>",
  previewUpdated = "<sys_updated_on from step 1>";
const [cur] = await SN(`/api/now/table/rm_story?sysparm_query=sys_id=${id}&sysparm_fields=sys_updated_on`);
if (cur.sys_updated_on !== previewUpdated) throw new Error("Changed since preview: re-preview");
const html = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
await SN(`/api/now/table/rm_story/${id}?sysparm_display_value=true&sysparm_fields=number,short_description,story_points,priority,assigned_to,sprint`, {
  method: "PATCH",
  body: JSON.stringify({ short_description: "<new title>", story_points: "5", acceptance_criteria: html("<full new criteria>") }),
});
```

4. Verify that the returned values match. Then run the **story snapshot** from reading.md for each edited story: it
   updates the app's copy, descriptions included. If you changed the sprint, also run the board snapshot.

## Timesheet hours

Each entry SETS one day's hours on one row. For "add 2 hours", compute the new total and show before → after.
Matt's own sheet only, Pending only, quarter-hour steps, at most 24h a day. Never submit; never change a card's
state or the time_sheet record.

1. Resolve the sheet and rows for the week (W = that week's Sunday, YYYY-MM-DD):

```js
const [sheet] = await SN(
  `/api/now/table/time_sheet?sysparm_query=user=javascript:gs.getUserID()^week_starts_on=${W}&sysparm_fields=sys_id,user,state&sysparm_display_value=all&sysparm_limit=1`,
);
const cards = await SN(
  `/api/now/table/time_card?sysparm_query=time_sheet=${sheet.sys_id.value}&sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_fields=sys_id,task,task.number,category,wednesday,total,state`,
);
```

Match the row by task number (and category if there are several). If the task has no row, add one (3b). If a
task has two rows, ask Matt which one to use.

2. Preview (Row | Day | before → after) with request_approval, then end your turn.
3a. After "yes", update the row:

```js
await SN(`/api/now/table/time_card/<card sys_id>?sysparm_display_value=true&sysparm_fields=task,category,wednesday,total,state`, {
  method: "PATCH",
  body: JSON.stringify({ wednesday: "4" }),
});
```

3b. After "yes", add a row (copy the raw category value from an existing row with that label):

```js
await SN(`/api/now/table/time_card?sysparm_display_value=true&sysparm_fields=task,category,wednesday,total,state`, {
  method: "POST",
  body: JSON.stringify({ time_sheet: "<sheet sys_id>", user: "<sheet user>", week_starts_on: W, task: "<task sys_id>", category: "<raw category>", wednesday: "4" }),
});
```

4. Verify that the returned day value and total match, then re-run the timesheet snapshot.
