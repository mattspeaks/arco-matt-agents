---
name: servicenow
description: Read and update Matt's ServiceNow work through Claude in Chrome. Covers the ABS Data and Analytics VTB (rm_story stories, lanes, work notes) and Matt's own timesheet (time_sheet / time_card hours). Use whenever Matt asks what's on the board or in a lane, about a STRY number, about his hours, or wants to move a card, add a work note, or log or change time. Also use it to refresh the app's board and timesheet copy.
---
# ServiceNow (ABS Data and Analytics board + Matt's timesheet)

There's no integration API access, so you work through **Matt's logged-in Chrome session**. You run small `fetch`
calls against ServiceNow's Table API from inside a ServiceNow tab, authenticated by the page's session token
`window.g_ck`. This is faster and more accurate than reading the board UI.

**Every write is previewed in chat and waits for Matt's explicit "yes" to that preview before anything is saved.**

## Facts
- Instance: `https://arcoconstruction.service-now.com`
- Board page (use it as the working tab): `https://arcoconstruction.service-now.com/now/nav/ui/classic/params/target/%24vtb.do%3Fsysparm_board%3D423702ce837b0350cc2a47447daad34e`
- Board: VTB "ABS Data and Analytics: Current Sprint". Cards are `rm_story`, and lanes are `state`
- Assignment group (ABS D&A): `d2ab7f44472d21102a2bef4d646d4329`. Board filter: `sprint.state=2^assignment_group=<G>`
- Story links: `https://arcoconstruction.service-now.com/rm_story.do?sys_id=<sys_id>`

### Lanes (`rm_story.state`)
| Value | Lane | Who moves it |
|---|---|---|
| -10 | Backlog | Matt |
| -6 | Draft | Matt |
| 1 | Ready | Matt. Ready + a routing hashtag (#PowerBI, #DWH, …) means "ready for an agent" |
| 2 | Work in progress | **You may move here** (agent started, or needs info, with a work note) |
| -7 | Ready for testing | **You may move here** (agent work done and QC passed). Confirm the PATCH returns "Ready for testing" |
| -8 | Testing | Matt only |
| 10 | Deploy/Launch | Matt only |
| 3 | Complete | Matt only |
| 4 | Cancelled | Matt only |

The app has a hook that blocks writes to any other lane, any DELETE, and any change to `time_sheet` or to a time
card's `state`. If the hook blocks you, tell Matt what was blocked. Don't look for a workaround.

### Timesheet
- `time_sheet`: one per user per week. Weeks start on **Sunday**. `state` Pending means editable.
- `time_card`: one row per task (or category) per week. Fields: `time_sheet`, `task`, `category` (Task work, Admin,
  Meeting, Time off, …), `sunday` … `saturday`, `total`, `state`
- You only ever touch **Matt's own** sheet (`user=javascript:gs.getUserID()`). You **never submit** it: Matt does that.

## Session setup (first ServiceNow call of a turn)
1. `tabs_context_mcp` with `createIfEmpty: true`. If a tab is already on the instance, use it. Otherwise navigate a
   tab to the board page above.
2. If it redirects to `login.microsoftonline.com` or a login page, stop and ask Matt to sign in. Never enter credentials.
3. Define the helper once per page load with `javascript_tool`:
```js
window.SN = async (path, opts = {}) => {
  const r = await fetch(path, {
    ...opts,
    headers: { 'X-UserToken': window.g_ck, 'Accept': 'application/json', 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body).result;
};
'SN ready: ' + !!window.g_ck
```
   If `g_ck` is missing, reload the board page and try again.

## Rules
- **Keep calls small and readable.** Make one purpose per call. Always pass `sysparm_fields`. Map results down
  in-page to what you need before returning them: the extension caps results at about 50KB and string values at
  1000 characters.
- **Write the HTTP method literally** (`method: 'PATCH'`) so the change is obvious to anyone reading it.
- **Writes = resolve → preview → Matt's "yes" → re-check → write → verify.** See `references/writing.md`. Use one
  "yes" per previewed batch. If anything changes after the preview, preview it again.
- Never delete records. Never write to tables other than `rm_story` and `time_card`.
- If API calls start failing with 401/403, tell Matt. Don't switch to clicking through the UI unless he asks.
- When you're done with ServiceNow for this reply, **close the tabs you opened** with `tabs_close_mcp`.

## What to read next
- Questions about the board, a story, or hours, or refreshing the app's copy: `references/reading.md`
- Moving a card, adding a work note, logging or changing hours: `references/writing.md`

## Work note template (agent work)
```
[Agent: Power BI Manager] Story STRY0012345
Summary:   <what was done>
Changed:   <files / workspace items>
QC result: PASS | FAIL (n findings): <excerpt>
Branch/PR: <branch name>
Needs:     <decision or approval required from Matt>
```
