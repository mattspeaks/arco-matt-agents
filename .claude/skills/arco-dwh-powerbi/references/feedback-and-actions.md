# Every page needs quick, visual issue indicators

Goal: problems bubble up and are visible in 3 seconds, mostly through **icons, color and counts**, not sentences.
Real estate is always tight, so text is short and the long explanation lives in the "?" tooltip and the How To Guide.
Do NOT use "SO WHAT: / NOW WHAT:" phrasing or paragraph banners (user, 2026-10-02).

## Indicator icon set: real badge images, NOT text chips (user, 2026-10-02: text chips rejected)
Use the ARCO badge icons (`assets/icons/`, drawn by `scripts/make_indicator_icons.py`; see `assets/icons/preview.svg`).
Shape AND glyph carry the meaning, so it works for the color-blind CIO. Never use Unicode text (▲ ◆ ● ⓘ) as the indicator.
| Level | Badge | File | Badge color | Cell / card fill | Label |
|---|---|---|---|---|---|
| 3 Act | red octagon, white ! | `act.svg` | `#D64550` | `#FFC7CE` | ACT |
| 2 Watch | amber triangle, dark ! | `watch.svg` | `#E3B505` | `#FFEB9C` | WATCH |
| 1 OK | green circle, white check | `ok.svg` | `#2E7D32` | `#C6EFCE` | OK |
| 4 Check (process / data quality, never changes RAG) | slate circle, white i | `check.svg` | `#6B8F9C` | `#D6E1EA` | CHECK |
| 0 No data | gray circle, dash | `nodata.svg` | `#A6A6A6` | `#FFFFFF` | - |
Trend badges `trend_up_good`, `trend_down_bad`, `trend_up_bad`, `trend_down_good`: color by good/bad, not by direction.
In charts keep the CIO palette (attention = orange `#E66C37`).

## Building blocks (every visible page needs at least one, usually 1 + 2 + 3)
1. **Issue tiles** (top of page, under the KPI band): white rounded tile, colored left accent bar, big badge, big number,
   2-4 word label (see preview). Worst first; green hidden (visual filter Level > 1); one "All clear" OK tile when nothing fires.
   Build either as a `{X} Tile` SVG image measure (whole tile is one image; `make_indicator_icons.py dax ...` prints it) shown in a
   cardVisual image / one-row table, or as a cardVisual with its image bound to the `{X} Icon` measure + value + label. "?" tooltip holds the rule.
2. **KPI cards**: on the grey KPI band use the brandbook card (`kpi_band.json`: white text, transparent, no border) with a badge image
   beside the value for status; on pages without the band, the Timecard card: value + background/accent bound to a color measure, badge or trend badge image beside the value,
   navy title 10pt one line, "?" hover definition (template `assets/visual-templates/kpi.json`). White when nothing to flag.
3. **Badge column in the main table**: first column = `{X} Icon` image measure (grid imageHeight/imageWidth 18-20), table sorted
   by severity; RAG cell fill only on the cell that is out of line, not the whole row.
4. **Action Queue** (when there are owned follow-ups): Badge, Item, Issue (short), Owner, Next step (short), Days open; Act first.
5. **Signal tiles** on drill-through pages: badge + lane name + value + one short reason.
6. **Mini visuals in grids** when trend or progress matters: SVG progress / bullet bar, sparkline, data bars.

## Every action has an owner (user, 2026-10-02: "clearly needs to show who owns the action")
- Owner wording (user 2026-10-02): ServiceNow assignee = "<name> (IT support)"; unassigned request = "<group> (IT queue)". Never "fulfiller".
- Wording (user 2026-10-02): the approver over a person is the **org manager** ("org mgr"), never "line manager"; staff are **associates**, never "employees" or "persons".
- An indicator without an owner is not actionable. Every ACT / WATCH / CHECK item names **who acts**: a person plus role
  ("Keith Johnson (org mgr)", "Neil Zambrzuski (PM)", "<associate> (submit)") or a team when no person applies
  ("PMO: no approver routed", "SNOW admin: reprocess", "Finance: reverse duplicate").
- **Split statuses until each maps to one owner.** Don't lump different blockers into one bucket. Example (ServiceNow time cards):
  Partially Approved -> the approver still outstanding (usually the org manager), Awaiting Approval -> listed approvers,
  No Approver -> PMO, Approved Not Posted -> SNOW admin, Not Submitted -> the associate, Posted Twice -> Finance.
  Give the status a sort-order column so it lists the most actionable first.
- **Owner bridge table**: one row per open item per owner (an item waiting on two people has two rows), related many-to-one to
  the item table on its key so page slicers still flow. Measures: `Owner $ = SUMX(Bridge, RELATED(Item[Amount]))`, `Owner Items`,
  `Owner Oldest`, and `Action Owners = CONCATENATEX(VALUES(Bridge[Owner]), ...)` for a "Waiting On" column in project tables.
  Reference build: `PMO Projects\build\sql\fact_time_card_action_owner.sql` + `owner_pass.py`.
- Each page with owned follow-ups gets a **"Who owns the action"** bar chart (one bar per owner, $ or count, series = role,
  sorted desc, tooltip = items + oldest date) and an **Action Owner** column in its detail table. This is the chase list.

## Reported status vs calculated indicators (user, 2026-10-02)
- When the source system has a **reported status** (PM health color, owner-entered RAG), it stays the **headline**. Calculated
  indicators (SPI, CPI, rules engines, guideline ratings) are **checks against it**, never a replacement.
- Call out disagreement compactly: a "Calc Differs" count card, and a check cell such as `SPI Red, Guideline Red` or `Agrees`
  (fill: green = agrees, amber = a calculated color differs, red = a calculated Red the reporter does not show).
  On drill-through pages, color the status tile by agreement, not by the reported color.
- **Only auto-rate what the data can measure.** If a guideline dimension can't be read from the data (e.g. "is the scope change
  mandatory", "skills never scoped"), show it as `PM judgment` (gray) with the supporting facts (CR counts, tasks past due).
  Never invent a proxy rating. Ask the user which dimensions are programmatic before building a rules engine.
- Use the business's own guideline thresholds when one exists (ABS PMO RAG guideline: ~10% Yellow, 20%+ Red on schedule slip
  vs approved duration and budget trend). Projected slip (% complete vs time used) counts because source end dates are rarely
  moved. Add an **alert** for silent changes, e.g. an end date moved more than 10% of the baseline with no change request.
- Process / data-quality checks (missing note, unposted time, duplicate posting, no baseline) use CHECK and never change the color.
- **Issues / Risks never derive Yellow or Red** (user 2026-10-02): open issues and risks are CHECK items in the action list
  ("needs a resolution path" = Critical / 14+ days past due / high risk with no mitigation, owner PM / Sponsor; "being worked" =
  any other open item, owner PM). They count in the process-check tile and never feed the guideline color or the "differs" test.

- **Never hard-code a tile green** (user 2026-10-03: overall gender gap -19% showed a green check because the tile was bound to a constant `Flag Good`). Any tile that shows a number with a meaningful threshold gets a real level measure (e.g. gap: under 5% ok, 5% to under 10% watch, 10%+ act, same thresholds as the grid shading) and a level-based badge. Constant flags are only for purely informational tiles (counts with no good/bad direction).

## Text budget (hard limits)
| Element | Limit |
|---|---|
| Status label | 1-2 words (ACT, WATCH, OK, CHECK) |
| Tile / card label | 2-4 words + the number |
| Reason / issue text in a tile or table cell | one line, <= ~60 characters, numbers first ("Slip 18% vs baseline") |
| Next step | starts with a verb, <= ~45 characters ("Approve 14 time cards") |
| Anything longer | "?" tooltip (`visualHeaderTooltip`) or the How To Guide page |

Adding the "?" tooltip: set only `showTooltipButton` + the tooltip; keep every default header icon (drill up / down, show
next level, expand, focus, more options). See pbir-rules.md.
Name top offenders only when it fits (`CONCATENATEX(TOPN(3, ...))`, truncated). Guard every measure with IFERROR / blank handling.
No em/en dashes. Never "Gold has a bug" in report text; use a CHECK indicator ("data not yet available"). Placeholder targets get a CHECK badge note.

## DAX patterns
```
-- level: 3 act / 2 watch / 1 ok / 4 check / 0 no data
[X Level] = IF(ISBLANK([X]), 0, IF([X] >= [X Red At], 3, IF([X] >= [X Amber At], 2, 1)))
[X Fill]  = SWITCH([X Level], 3, "#FFC7CE", 2, "#FFEB9C", 1, "#C6EFCE", 4, "#D6E1EA", "#FFFFFF")
[X Accent]= SWITCH([X Level], 3, "#D64550", 2, "#E3B505", 1, "#2E7D32", 4, "#6B8F9C", "#A6A6A6")
```
Image measures (badge and tile): generate, don't hand-write:
```
python "%USERPROFILE%\.claude\skills\arco-dwh-powerbi\scripts\make_indicator_icons.py" dax "Projects Red" "[Projects Red]" "[Projects Red Level]" "Red projects"
```
It prints `Projects Red Icon` (24 px badge per level) and `Projects Red Tile` (240 x 72 tile, VALUE / LABEL substituted).
Set `dataCategory: ImageUrl` on both in TMDL. '#' is already encoded as %23; keep single quotes inside the SVG.

Progress / bullet bar (actual vs target, colored by level):
```
[X Bar SVG] =
VAR p = MIN(MAX(DIVIDE([X], [X Target]), 0), 1.5) VAR w = ROUND(p / 1.5 * 100, 0)
VAR c = SUBSTITUTE([X Accent], "#", "%23")
RETURN "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='14'>"
     & "<rect width='100' height='14' rx='3' fill='%23EDEDED'/><rect width='" & w & "' height='14' rx='3' fill='" & c & "'/>"
     & "<rect x='66' y='0' width='2' height='14' fill='%23252423'/></svg>"          -- target tick at 100%
```
PBIR: tables/matrices showing image measures need `grid.imageHeight` / `imageWidth`; keep badge columns centered and narrow.
Static badges (legends, How To Guide, header logos) use the SVG files in `assets/icons/` registered as RegisteredResources images.
Power BI's built-in conditional-formatting icon sets are a fallback only (less legible); if used, build in Desktop and clone the JSON.

## Navigation and help
- "?" help button (template `help.json`, PageNavigation) on every page -> hidden **How To Guide** page (generated SVG: dark navy
  `#0F2744`, white / `#D6E1EA` Arial text, `#7EB6F6` section heads) with the indicator legend (icons + table colors + chart colors),
  how each status is rated, definitions, sources and refresh. Formats and screenshots: `assets/how-to-guides/`, rules in how-to-guide.md.
- Drill-through pages: hidden, Back button (`back.json`), signal tiles + action items for the one entity.
- Clear all slicers / Reset filters buttons in the chrome.


## Ops / PM report rules (user, 2026-10-02, ANH Project Health)
- Ops reports are driven by the **Procore project stage** (default Course of Construction), not Vista department; Vista dept is a secondary
  filter. Always flag Procore vs Vista status mismatches (Procore Warranty / Closed / Lost / pursuit while Vista is 03 WIP; Procore active while Vista closed).
- Issue tables are titled **"Action Needed"**, never "Checks that fired".
- The drill-through helper strip + "Open <Page>" button sits directly above the table it drills from.
- PM detail pages answer "what do I do now": badge tiles for proposed owner bill (Owner Billing rule: posted cost + Keystyle unapproved +
  Textura pending at WIP markup - billed), over/under, net cash, AR 90+, each with a one-line next step naming the owner; plus a
  "how the bill is built" table. Reference: `Project Health\build\gen_measures.py` (Billing Exposure folder).

## Filtering for people who do not know Power BI (user, 2026-10-02)
- Issue tables get a row of **issue buttons** (tile slicer on the issue list, header "Show projects with (click a button to filter,
  click it again to clear):") that drive the project grid, KPI counts and owner chart through an `In Selected Check` measure filter.
  Reset Filters clears them.
- Grids with a natural grouping (trades / CSI divisions) get **trade buttons** that filter ONLY that grid: page.json
  `visualInteractions` = NoFilter from the button slicer to every other visual.
- KPI titles say what the number means in plain words and the value carries its count ("$9.1M on 9 jobs", "74 of 141 jobs");
  e.g. "Earned Not Billed" instead of "Underbilled", "Procore Snapshots 30+ Days Old" instead of "Forecasts 30+ Days".
- Procore budget snapshots are always called **"Procore snapshot"** in visible text (never "forecast").

## Issue buttons: one row, priority checks only (user 2026-10-03)
- The issue-button tile slicer must fit on ONE row with no scroll arrow. Show only the act/watch (priority) checks that fired, using a
  "Check Button" filter measure; process/data checks still fire and still list in the Action Needed table and the project Issues column.
- Many checks x many projects in every visual = slow slicers. Precompute per project x check results in a calculated table at refresh
  (no relationships on it: a calculated table built from measures can't have them, circular dependency) and filter it with TREATAS.
