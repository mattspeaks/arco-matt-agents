---
name: servicenow
description: Read and update Matt's ServiceNow work through Claude in Chrome. Covers the ABS Data and Analytics VTB (rm_story stories, lanes, work notes) and Matt's own timesheet (time_sheet / time_card hours). Use whenever Matt asks what's on the board or in a lane, about a STRY number, about his hours, or wants to create a story (including turning notes or a conversation into stories), edit a story (title, description, acceptance criteria, points, priority, assignee, sprint, epic), move a card, add a work note, or log or change time. Also use it to refresh the app's board and timesheet copy.
---
# ServiceNow (ABS Data and Analytics board + Matt's timesheet)

There's no integration API access, so you work through **Matt's logged-in Chrome session**. You run small `fetch`
calls against ServiceNow's Table API from inside a ServiceNow tab, authenticated by the page's session token
`window.g_ck`. This is faster and more accurate than reading the board UI.

**Every write is previewed on an approval card and waits for Matt to click Approve before anything is saved.**

## Facts
- Instance: `https://arcoconstruction.service-now.com`
- Board page (use it as the working tab): `https://arcoconstruction.service-now.com/now/nav/ui/classic/params/target/%24vtb.do%3Fsysparm_board%3D423702ce837b0350cc2a47447daad34e`
- Board: VTB "ABS Data and Analytics: Current Sprint". Cards are `rm_story`, and lanes are `state`
- Assignment group (ABS D&A): `d2ab7f44472d21102a2bef4d646d4329`. Board filter: `sprint.state=2^assignment_group=<G>`
- Story links: `https://arcoconstruction.service-now.com/rm_story.do?sys_id=<sys_id>`

### Lanes (`rm_story.state`)
| Value | Lane | Who moves it |
|---|---|---|
| -10 | Backlog | Matt. The default lane for a story you create |
| -6 | Draft | Matt (a story you create may start here if he says so) |
| 1 | Ready | Matt (a story you create may start here if he says so). Ready + a routing hashtag (#PowerBI, #DWH, …) means "ready for an agent" |
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
- **Writes = resolve → approval card → Matt's Approve → re-check → write → verify → resync.** See `references/writing.md`.
  For the preview, **always call `mcp__arco__request_approval`** (title + markdown preview), which puts an
  Approve / Reject card in Matt's Approvals panel, then **end your turn**. Don't ask "yes or no?" in text. When he
  clicks Approve, his next message is "Yes, go ahead: …", and only that turn can write: the app's guard blocks
  writes anywhere else, including after a typed "yes". If he rejects, or anything changes, prepare a new preview.
  One card can cover a batch.
- **Always finish a write by re-running the matching snapshot** from `references/reading.md`: the story snapshot after a
  story change (the board snapshot too if you created a story or changed a sprint), the timesheet after an hours change. That's how the app's local copy updates. The app won't let the
  turn end without it.
- Never delete records. Never write to tables other than `rm_story` and `time_card`.
- If API calls start failing with 401/403, tell Matt. Don't switch to clicking through the UI unless he asks.
- When you're done with ServiceNow for this reply, **close the tabs you opened** with `tabs_close_mcp`.

## What goes in story text (creates, edits, work notes)
Stories are read by the whole team and outlive the request, so write them lean: what to build and how we'll know
it's done. Link the source record for the details, and don't copy the details in. This keeps personal and
sensitive data in the systems built to hold it, and keeps the writes plain enough that nothing in them looks risky.

- **Link, don't copy.** When the work comes from a RITM, incident or document, name it and link it
  ("Requirements, source SQL and sample: [RITM0052659](https://arcoconstruction.service-now.com/sc_req_item.do?sysparm_query=number=RITM0052659)").
  Attachments stay on the RITM.
- **No personal data:** no names of requesters, employees or other people in the text (the `assigned_to` field
  and the RITM link cover who); no emails, phone numbers, employee IDs, addresses, dates of birth; no pay,
  salary, rate or amount values for individuals.
- **Describe data by field, not by value.** "Hours and earn code by employee and job" is fine. Actual names,
  amounts and row values aren't.
- **No secrets or access details:** no passwords, tokens, connection strings or keys.
- **No code that changes systems.** Don't paste SQL or scripts into a story. If the source SQL contains UPDATE,
  DELETE or similar statements, don't quote or describe them; at most say "the source SQL is read-only reporting
  for this story" when it matters.
- **Delivery to people stays generic.** "Each recipient sees only their own rows" is fine. Who receives what, by
  name or address, belongs in the RITM.
- **Draft it that way from the start**, and show exactly that text on the approval card. If Matt's notes include
  any of the above, leave it out of the draft and say what you left out and why in one line of the preview.
- If a write is still refused, report the facts (the app attaches the run-log record) and offer the manual route.
  Don't reword to get it through. Ask Matt what to change.

## What to read next
- Questions about the board, a story, or hours, or refreshing the app's copy: `references/reading.md`
- Creating stories, including from notes or a conversation: `references/creating.md`
- Editing a story's fields, moving a card, adding a work note, logging or changing hours: `references/writing.md`

## Work note template (agent work)
```
[Agent: Power BI Manager] Story STRY0012345
Summary:   <what was done>
Changed:   <files / workspace items>
QC result: PASS | FAIL (n findings): <excerpt>
Branch/PR: <branch name>
Needs:     <decision or approval required from Matt>
```
