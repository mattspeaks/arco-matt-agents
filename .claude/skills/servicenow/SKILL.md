---
name: servicenow
description: How ARCO's ServiceNow VTB and timesheets map to tables, fields and lanes, and the rules for agent writes. Load when reasoning about stories, lanes, work notes or time.
---
# ServiceNow at ARCO

Instance: `https://arcoconstruction.service-now.com`. Agents never call ServiceNow directly. The app reads and
writes through Matt's browser session. Reads use vetted read-only scripts in `server/src/servicenow/snippets.ts`.
Approved writes are made through the ServiceNow UI, like a person would make them, and then checked with a sync.

## Board
- VTB "ABS Data and Analytics: Current Sprint" (`vtb_board` 423702ce837b0350cc2a47447daad34e), a guided board
- Cards are `rm_story` records. Lanes are the `state` field. Board filter: active sprint + the ABS D&A assignment group
- Lanes: Backlog → Draft → Ready → Work in progress → Ready for testing → Testing → Deploy/Launch → Complete → Cancelled

## Agent state machine (mapped onto existing lanes)
| Concept | Lane | Who moves it |
|---|---|---|
| Ready for agent | Ready + routing hashtag (`#PowerBI`, `#DWH`, …) | Matt |
| Agent in progress | Work in progress | Agent (approved) |
| Needs info | Stays in Work in progress, with a work note | Agent (approved) |
| Agent review | Ready for testing | Agent (approved) |
| Done | Testing / Deploy/Launch / Complete | **Matt only** |

## Timesheets
- `time_sheet`: one per user per week (weeks start Sunday). `time_card`: one row per task per week, with fields
  `sunday`…`saturday`, `total`, `category`, `task` and `top_task`
- Read-only for agents in v1

## Work note template
```
[Agent: Power BI Manager] Story STRY0012345
Summary:   <what was done>
Changed:   <files / workspace items>
QC result: PASS | FAIL (n findings) — <excerpt>
Branch/PR: <link>
Needs:     <decision or approval required from Matt>
```

## Browser quirks (for maintainers)
- The Claude in Chrome extension truncates string values at 1000 chars, caps results at 50KB, and blanks text that
  looks like cookie or query-string data. The scripts work around all three (see `snippets.ts`).
- `sys_choice` reads return 403 for Matt's role, so lane values come from synced stories.
