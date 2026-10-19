# PBIP / PBIR / TMDL authoring rules and gotchas

## House formatting rules ("now and forever")
- **Black outline on ALL sides of EVERY grid, always** (every tableEx and pivotTable, every page, every report, including
  drill-through and tooltip pages and any grid you add, clone or patch): `objects.grid` (no selector) `outlineStyle 15D`
  (top+bottom+left+right), `outlineColor '#000000'`, `outlineWeight 1D`; black gridlines; outline 15/black on columnHeaders,
  values, total. Also put it in the theme (`visualStyles.tableEx` / `pivotTable`) but never rely on the theme alone: set it
  on the visual too. Legacy `table` type doesn't support outlineStyle: convert to tableEx.
- **No horizontal scroll in tables/matrices.** Size every grid so all columns are visible at the visual's width
  (users don't know Focus mode). Unless truly impossible:
  - set explicit `columnWidth` per column (selector metadata = queryRef) so the sum of column widths (plus matrix row headers)
    is <= visual width - 36 px (vertical scrollbar + borders + cell padding; 24 px still scrolled in the Travel report); turn off auto-size width growth;
  - header `wordWrap` on so long headers wrap to 2 lines instead of widening the column; short header names via display names;
  - **Wrap only between words, never inside one; never truncate** (user rule 2026-10-02, Employment Stints "Year / s", "Stint / #",
    "T..." total): every column must be at least as wide as the LONGEST SINGLE WORD of its header (Arial bold: ~0.6 x pt x 1.333 px
    per char + 12 px padding; 9pt = ~7.2 px/char) and as wide as its longest typical value (dates MM/DD/YY = 8 chars) and the
    "Total" label in the first column. When the columns can't all fit: shorten display names first ("Hired", "Termed", "Type",
    "Years"), then widen the visual / take width from a neighbour, then drop values to 8pt. Check every grid on the screenshot for
    letters split across lines and "..." cells. `check_pbir.py` warns WRAP.
  - 9pt values; compact formats (MM/DD/YY, $#,0K / $#,0.0M where precision isn't needed); badge / icon columns 28-32 px;
  - matrices: stepped layout for row headers; put rarely used columns in a tooltip page or drill-through instead;
  - widen the visual (full content width) before shrinking text.
  - **Matrices with a Columns field (dates, years, days) multiply the value width by the number of members** (user 2026-10-04, "Who's Out: Next 2 Weeks" scrolled: 167 + 10 x 56 > 704). Count the members from the data (DAX `COUNTROWS` of the column field under the visual's filters) and size so row-header widths + members x value width <= visual width - 36. `check_pbir.py` warns MATRIXCOLS for every matrix with a Columns field; confirm on a screenshot.
  If it's genuinely impossible, keep the most important columns leftmost, add a "?" tooltip noting more columns to the right,
  and tell the user. `check_pbir.py` warns (WIDTH) when declared column widths exceed the visual.
- **Center every number and date column** in every tableEx / pivotTable on every page: `columnFormatting` entries
  `alignment 'Center'` + `styleHeader`, `styleValues`, `styleSubtotals`, `styleTotal` true, selector `metadata` = queryRef.
  Text columns (names, descriptions, codes, invoice numbers, long evidence text) stay left. Apply to the WHOLE report, not one visual.
- **No em dashes (U+2014) or en dashes (U+2013)** anywhere in report text: titles, textboxes, tooltips, measure labels, guide SVGs.
  Use ":" for "Title: subtitle", ";" or parentheses for asides, "-" for ranges. Check by character, not byte grep.
- **Any visual with baked-in logic that isn't obvious from its title gets a "?" help tooltip** (`visualHeaderTooltip`).
  Baked-in logic = visual/page-level filters (e.g. GC only, dept '03', Ops buckets excluded, green hidden, interns excluded),
  thresholds behind a color or icon, derived formulas (CY profit recompute, cost-to-cost % complete, $110/hr valuation),
  as-of / closed-month rules, top-N or sort rules, placeholder targets, data-quality workarounds. Tooltip = 1-3 short lines:
  what it counts, what's excluded, what turns it amber/red. When unsure whether it's intuitive, add the tooltip.
- **Visual headers (user rule 2026-10-07, replaces the 2026-10-02 "never hide header icons" rule for cards):**
  - **KPI cards** (`card`, `cardVisual`, `multiRowCard`, `kpi`: band cards, navy-title cards, value / text cards): no header icons.
    No tooltip: `visualHeader show: false`. With a "?" tooltip: `show: true`, `showTooltipButton: true` and EVERY other icon false:
    showVisualInformationButton, showVisualWarningButton, showVisualErrorButton, showDrillRoleSelector, showDrillUpButton, showDrillToggleButton, showDrillDownLevelButton, showDrillDownExpandButton, showPinButton, showFocusModeButton, showFilterRestatementButton, showOptionsMenu, showCopyVisualImageButton, showSmartNarrativeButton, showSeeDataLayoutToggleButton, showCommentButton, showCopilotSummaryButton, showFollowVisualButton, showPersonalizeVisualButton, showSetAlertButton.
    The skill templates `kpi_band.json` / `kpi.json` carry this exact block; copy it, do not hand-pick flags.
  - **Matrices, tables and charts** (`pivotTable`, `tableEx`, bar / column / line / area / scatter / pie / donut / map / waterfall ...):
    header ALWAYS on with the Power BI defaults (focus mode, more options = export data, drill up / down, show next level, expand).
    Adding a "?" = `visualHeader show: true` + `showTooltipButton: true` + `visualHeaderTooltip` only; never write another `show*`
    flag as false (merge into an existing visualHeader, and strip `false` flags an older generator added).
  - Decorative visuals (textboxes, section bars, shapes, images / badges, buttons, refresh label) keep the header off.
  - `check_pbir.py`: HEADER = a card shows icons other than "?", or a grid / chart hides default icons; NOHEADER = a grid / chart has its header off.
- **KPI cards must never clip the value** (the top of the number gets chopped often). Grey-band brandbook cards: 12pt title +
  12pt value at h 47-48 (as in the Brandbook); keep that size. Navy-title Timecard cards: size height for title + value:
  roughly `title pt x 2 + value pt x 1.95 + 10` px (IT Timecard: title 10pt one line + value 13pt fits in 56 px; 15pt value
  cardVisual + 9pt label needs ~56-60 px). Title wrap off, value word-wrap off, padding <= 4. Long money values bind to the
  "(Card)" text twin with K / M scaling instead of shrinking the font. **Always do a visual check**: take a screenshot of every
  page with KPI cards (powerbi-report-cli preview / screenshot, or ask the user for one) and zoom on the KPI band before saying
  it is done; `check_pbir.py` CLIP warnings are only a first pass.
- **Business vocabulary**: say **Family** (Company Family, associate Family), never "cohort", anywhere (titles, labels, display
  names, measure names users see, tooltips, guide). Readers are business users: name source systems (ServiceNow, Vista, UKG,
  Procore, Textura) but never table/schema/column names in visible text.
- **Org grouping = Family > Division** (user 2026-10-02): Division = the company, always labeled "HQCO - Company Name"
  (e.g. "18 - ARCO National Construction - KC, LLC", sortByColumn = HQCO number; user 2026-10-03; Dim_Company / associate company name),
  Family = Dim_Company[Company Family]. Never "business unit" or "cohort"; never separate Family and Division slicers: one
  hierarchical slicer "Family > Division" (two projections in one slicer); tables show Family then Division side by side.
- **Dropdown slicers** (user 2026-10-02, changed 2026-10-03): every dropdown is multi-select with "Select all" available
  (`selection.selectAllCheckboxEnabled: true`, `singleSelect: false`) and opens with NOTHING selected (no filter = all data).
  Do NOT pre-tick "Select all": never write `objects.data[0].properties.isInvertedSelectionMode: true` (and remove it when
  refreshing older reports, incl. bookmark copies of the slicer state). User 2026-10-03: a ticked Select all makes users untick
  it before they can search and pick a value, which is not intuitive. Preset values only for a business reason (then Reset Filters).
  Nested / hierarchy dropdowns open collapsed: `expansionStates` with every level `isCollapsed: true, isPinned: true`.
  Reference: `Travel Report\build\gen_report.py` `slicer()`.
- **Text color = black (#000000), never theme gray** (user 2026-10-02): legends, data labels, axis labels, slicer headers and
  items, button text, table text, issue-tile labels, numbers and outlines. The skill theme (`assets/theme/ABS_Custom_Theme.json`) now sets
  foreground / foregroundNeutralSecondary / textClasses to black and `make_indicator_icons.py` tile labels, numbers and outline stroke are black; still set
  explicit black on chart `legend.labelColor`, `labels.color`, `categoryAxis/valueAxis.labelColor` and slicer header/items.
  White stays only on navy / charcoal surfaces (title bands, KPI band, header).
- **Screenshots always show the whole page** (user 2026-10-02: "always make sure you can see the whole view"). `powerbi-report-author preview --screenshot` captures only the Desktop viewport, so scrolling pages (ActualSize / FitToWidth, 1110+ px) lose everything below the first screen. Run `scripts/full_page_screenshots.py <Report folder> <out dir>`: it sets every page to FitToPage, reloads, captures all pages, then restores the original displayOption and reloads (restore runs in `finally`). Review every page top to bottom; crop/zoom for detail. The bridge drops the folder (HOST_UNAVAILABLE) for a while after a reload; the script retries, and if it still fails ask the user to click into the report canvas.
- **Date range (Between) slicers need ~130 px height** (header + two date boxes + slider); 80 px clips the second box and the slider (Travel 2026-10-02). Always screenshot-check slicer heights.
- **Date range default that stays current ("Jan 2025 to present")** (tested in Desktop 2026-10-11, Project Accounting Hub): the
  date BOXES read the slicer's `objects.data` `startDate` / `endDate`, not the filter. A filter-only default (even two-sided) left
  the boxes on the data minimum. Pattern: `data` `startDate datetime'2025-01-01T00:00:00'` with NO `endDate`, plus `general.filter`
  `Month >= 2025-01-01` (one Comparison, kind 2). The end box then shows the latest month in the data and moves as months load.
  The Reset bookmark must carry the same startDate + filter (no endDate). Never hard-select a month list (goes stale).
- **Link columns** (WebUrl / link icon) are headed **"URL"**, never "Open" / "Link" (user 2026-10-02).
- **Owner wording**: ServiceNow-owned fixes go to the request's **assignment group** (e.g. "ADB Support Specialist"), not the
  individual assignee (shorter, scales; user 2026-10-02); no group = "Service Desk". Labels say "IT support"; never "fulfiller".
- **Filter buttons**: every visible page has Clear All Filters; every page with pre-set slicer/filter defaults also has Reset
  Filters bound to a bookmark of those defaults. Both top left under the logo, icon + text centered in the box (see brandbook.md).
  (SUPERSEDED 2026-10-06 by 'Reset bookmark = SLICERS ONLY' below.) Old rule: **a generated data bookmark must include EVERY visual on the page that has visual-level filters** (`filters.byExpr` with the
  full `filter` body, plus the slicers): Power BI applies it page-wide and strips the filters of any visual it omits; the next
  save writes the stripped filters (no `filter` body) to disk (Travel report 2026-10-02: Reset wiped the map / table / slicer
  state filters). Reference: `Travel Report\build\gen_report.py` `defaults_bookmark()`.
  Bookmark mechanics: create it in `definition/bookmarks/<id>.bookmark.json` + list it in `bookmarks.json`; capture data only
  (`options.suppressDisplay: true`), target the slicer visuals, and regenerate it whenever slicer defaults change. If a reliable
  bookmark can't be generated, build the button pointing at a named bookmark and have the user capture it in Desktop
  (View > Bookmarks > Add, uncheck Display) once, then verify the button resets the page. `check_pbir.py` reports CLEAR / RESET.
- **Every report has a How To Guide page** + "?" help button on every page (see how-to-guide.md).
- Arial font; brand colors per color-palettes.md; formatting applies across all tabs when requested once.

## File encoding
- Write PBIR/TMDL/SVG only with Python (`open(p, "w", encoding="utf-8", newline="\n")`) or the Write/Edit tools.
  NEVER PowerShell 5.1 `Set-Content` / `Out-File -Encoding UTF8` (adds a BOM; Desktop: "Only text with UTF8 encoding without BOM is supported").
- Before asking the user to open/reload: `python scripts/check_pbir.py "<folder>" --fix-bom`.
- TMDL descriptions are `///` doc comments above the object; a `description:` property line makes the model unparseable (Desktop won't open it). check_pbir.py runs `scripts/check_tmdl.py` on the sibling model (Desktop TmdlSerializer parse + text check) and reports TMDL errors (2026-10-13).

## Where projects live and how they are built
- Live PBIPs go in `C:\SNOW Logic\` (OneDrive sync corrupts/locks PBIP files). Scripts/notes live in the OneDrive
  `DWH stuff\Claude DWH Directory\<Project>\`.
- New reports are built from Python generators in `<Project>\build\` (gen_model.py, gen_measures.py, gen_report.py,
  sql\*.sql, check_refs.py). Regenerate; never hand-edit the generated PBIP.
- **Regen to a temp folder first, swap into live only if the run completes (house rule 2026-10-12, ALL report and model
  generators).** Most generators clear the live `definition\pages` (or tables) before rebuilding, so a crash mid-run leaves the live
  PBIP with no pages ("Definition contains no pages"; it happened on Owner Billing 2026-10-12 after a one-line edit commented out two
  dictionary entries). Pattern: run the generator with OUT_ROOT pointed at a scratch folder (exec the source with the OUT_ROOT line
  replaced, or a `--out` flag), require exit 0 + the expected page / table list + check_pbir 0 errors on the temp copy, THEN write live
  (rerun into live, or copy the temp folder over). Never let a failed run touch the live PBIP or Desktop. Reference runner:
  scratch `ob_gen_temp.py` pattern (exec with OUT_ROOT swapped, then a JSON-normalized diff vs live). The same temp copy doubles as
  the "what will change" diff before overwriting a user-saved baseline.
- Proven helpers to copy:
  `PMO Projects\build\gen_report.py` (patching an existing report, KPI rows, section bars, tables, charts, help page),
  `ANH Executive Board\build\gen_report.py` (cardVisual KPI cards, insight rail, scroll backgrounds),
  `Owner Billings\build\gen_report.py` (brandbook frame, center_columns()).
- **Refresh vs rebuild**: a "refresh" of a report users like = patch the ORIGINAL pages (same visuals and positions) and add
  meat: section bars, RAG card backgrounds + "?" definitions, CIO chart palette where applicable, black outlines, centered numbers,
  HELP page, a few new measures/cards. Template of how much to change: `_old_IT Timecard Analytics.Report_20260928` vs
  `C:\SNOW Logic\IT Timecard Analytics.Report`. Ask before any redesign.

## Dev loop (user override 2026-10-12, later the same day: speed first)
- **Default = local Power BI Desktop testing**: regen temp-first > check_pbir 0 errors > write live > `preview --reload` (or open
  the .pbip with `Start-Process -WindowStyle Minimized`) > `collapse_panes.ps1 -Apply` > screenshots. No need to ask before reloads;
  launch minimized / no-activate where you can, but don't let that slow the loop. A report-only PBIP can open live-connected
  (definition.pbir byConnection to the published model): real data, no local refresh.
- **DEV copies in My workspace only when asked** (MGR / the user). How, when asked:
- Loop: generator to temp (temp-first) > check_pbir 0 errors > write live > `scripts/publish_dev.py "<folder with .Report +
  .SemanticModel>"` > QA on the DEV copy headless:
  - `powerbi-report-author preview --host service --headless` for screenshots / clicks;
  - `reset_test.mjs` and `reconcile.py` against the dev model; `visual.exportData` for exports.
- `publish_dev.py`:
  - creates/updates "DEV - <name>" model + report in the signed-in user's **My workspace** only (it refuses others). Ids are stable,
    so the link stays the same;
  - binds the report byConnection to the dev model, refreshes it and prints the link.
  - Model and report ship together (a model change never goes through a Desktop reopen).
- My workspace is addressed as `/v1.0/myorg/datasets/<id>` in the Power BI REST API (a `groups/<personal id>` URL returns 401).
- Credentials: sources that already have a cloud connection (the Gold models via `powerbi://.../ARCO DWH`) bind on their own.
  A NEW source (e.g. a direct SQL source on the Fabric warehouse) fails with "default data connection without explicit
  connection credentials". The user sets it once in the service (model > Settings > Data source credentials > Edit > OAuth2,
  Organizational, Sign in). Route the step via MGR; never enter tokens into credential settings yourself. The same step is needed
  again when that model first goes to Acceptance / production.
- Acceptance and production publishes still need the user's go (via MGR).

## Desktop round-trip loop (the default build / QA loop again since the 2026-10-12 override)
- **Never steal the user's cursor / focus (user rule 2026-10-12, standing).** Opening / reloading Desktop, collapse_panes and screenshot
  runs were pulling the window to the front while the user typed. Rules:
  1. No SetForegroundWindow / BringWindowToTop / AppActivate / SendKeys / mouse calls in any script, ever (not even to "give focus back").
  2. Read-only steps are always fine: UI Automation FindAll / state reads (`collapse_panes.ps1` without -Apply), file writes, `preview --status`.
  3. `collapse_panes.ps1 -Apply` uses UI Automation ExpandCollapse only and guards with GetForegroundWindow (read-only): if Desktop comes
     forward it stops with FOCUS_CHANGED (exit 3). `full_page_screenshots.py` refuses to run without `--focus-ok` and stops the same way.
  4. Steps that MAY bring Desktop forward: launching Desktop (use `Start-Process <pbip> -WindowStyle Minimized`; Desktop may restore itself),
     `preview --reload`, Desktop `--screenshot`, full_page_screenshots. Run them only after MGR confirms the user has a moment; otherwise
     queue them. If a step reports FOCUS_CHANGED, never rerun it without a new go.
  5. Published reports: prefer `preview --host service --headless` (a hidden browser; never touches the Desktop window).
- Ask the user to Ctrl+S in Desktop BEFORE regenerating files, otherwise their save overwrites generator output.
- Every Desktop refresh sets hasUnsavedChanges, which blocks CLI reloads.
- Adding model tables needs a fresh open; avoid "Apply external changes" when tables are added (has crashed Desktop with PackageSession errors).
  Same for ANY table/column/partition change: never `powerbi-report-author preview --reload-with-model` after it (Travel report
  2026-10-02: "Could not find a PackageSession for the given sessionID"). Close Desktop without saving, set cache.abf aside,
  reopen the .pbip, refresh. `--reload-with-model` / MCP measure updates are only for measure-only changes.
- In PBIR `ThemeDataColor ColorId 0` is the white slot of the theme grid, not navy: use the hex (`#003865`) or ColorId 2.
- Power Query errors become silent NULLs when the model has `returnErrorValuesAsNull`; check for unexpected blanks after refresh.
- DAX: `shape` and `top` are reserved words (VAR shape / VAR top fail: "The syntax for top is incorrect", and every measure referencing it shows SYNTAXERROR); `SWITCH ( BLANK (), 0, ... )` matches 0, so guard blanks before a SWITCH on a code; azureMap needs Category (location) + lat/long aggregated (Avg) when both are used.
- A saved `cache.abf` blocks structural TMDL partition changes (PFE_TM_DDL_CHANGED_PARTITION_FROM_OR_TO_CALC): rename it to .bak on regen.
- Patch measures/partitions live through the powerbi-modeling MCP when possible.
- Azure map blank with "Unable to access Azure Maps" in Desktop: a Desktop session issue, not the report; user fix is save + restart
  the PC. Blank maps in CLI captures right after a report-only reload are render timing; recapture after a fresh open.
- **Once the user saves their own edits in Desktop, the live PBIP is the baseline.** Diff it against a fresh generator run
  (into a temp folder) to see what they changed, snapshot it (`_user_saved_<timestamp>`), and from then on apply changes with
  in-place, idempotent patch scripts (`PMO Projects\build\format_pass.py`, `owner_pass.py`: check-before-add, dry-run on a temp
  copy, run twice to prove idempotence). Never regenerate over it. Before model-file edits: user Ctrl+S, then closes Desktop.
- **Evaluate every measure before asking the user to open**: generate `EVALUATE ROW("m0", [M0], ...)` over all measures (chunks of
  ~60) and run it through the MCP; a Desktop refresh fails the whole transaction on one bad measure. Caught 2026-10-02:
  DAX has no `PROPER()`, and `MAX()` on a boolean column errors (use `MAXX(T, IF(T[Flag], 1, 0))`; see DAX gotchas below).
- Preview CLI "no open instance has this report's folder open" right after an open/reload: ask the user to click into the report page, then capture.

## Every series on hover (user rule 2026-10-08)
Users expect the line chart behavior everywhere: hover a month and see every series for it (vertical hover line + all values).
- **Line / area charts** already do this (tested in the service on HR Analytics "Monthly Hires: This Year vs Last Year").
- **Combo charts (columns + lines) and multi-series column / bar charts never draw the line** and the default tooltip shows only the
  hovered column / marker (user video 2026-10-08, SNOW Survey "Monthly Responses and Average Rating").
- **Do NOT put the series in the Tooltips well**: tested, the hovered series is listed twice ("Hires 217" twice).
- **Fix = report-page tooltip per chart**: `scripts/combo_tooltip_pass.py <Report>` adds a hidden Tooltip page (house table: navy
  header, black grid, centered values, width = columns + 60 px so no scrollbar) with the chart's category (+ legend) and every Y / Y2
  measure, and sets the chart's `visualTooltip` to type Canvas -> that page. Hovering a column or a marker shows all values.
  Library `apply(files)` patches downloaded service definitions the same way. Lint: HOVERALL (missing), and tooltip-page tables are
  exempt from NOHEADER (a tooltip can't be hovered or clicked).
- Verify on the published report with a headless hover (embed with the az token, `page.mouse.move` over a column, wait ~4 s for the
  tooltip page to render, screenshot).

## Zeros, not blanks (user rule 2026-10-08, "automatically always")
Rows that belong in a grid or card should read 0 when the calculation nets to zero, never an empty cell (Talent Acquisition:
Overview matrix showed blank Quiet / Hires cells for AMCC and Unassigned; users read blank as "missing data").
- **Pattern (default for every additive measure: counts, sums, dollars, hours):**
  `VAR v = <calc> RETURN IF ( ISBLANK ( v ) && NOT ISEMPTY ( <driving table> ), 0, v )`, where the driving table is the table the
  measure counts / sums, or the visual's row table (e.g. `Dim_Job` for job counts, the fact for application counts). The guard keeps
  BLANK where the row has no data at all, so slicers, cross-filters and "show items with no data" don't suddenly list every
  dimension member (fan-out). A bare `[x] + 0` is acceptable only when every visual using it is already limited to relevant rows by a
  filter or by another non-blank measure in the same visual.
- **Never zero-fill**: averages, medians, ratios and %, days / durations, as-of / latest values, min / max dates (0 is a false value);
  EEO / small-group suppression measures (blank = suppressed, 0 would disclose); badge / icon / image / color / label / "(Card)"
  text measures (they have their own "-" or neutral rule); measures used as a ranked chart's value (a zero bar per member is
  clutter: keep the chart on the guarded measure AND add a visual filter measure > 0, or bind the chart to the raw measure).
- **Generators**: wrap in one helper (e.g. `zero(dax, table)` in gen_measures.py) so new measures get it by default; list the
  exclusions explicitly next to the helper.
- **Verify before claiming done**: for each visual using a changed measure, compare row counts before vs after with the visual's
  own filters (DAX `COUNTROWS ( SUMMARIZECOLUMNS ( <row cols>, <visual filters>, "m", [measure] ) )`); any increase = fan-out, fix the
  guard. Then screenshot the grids (zeros centered like other numbers) and re-run reconcile.py totals (zero-fill must not change them).

## DAX / Power Query gotchas
- **Badge / image measures used as a table column must return BLANK when the row's table is filtered out**
  (`IF(ISEMPTY(<row table>), BLANK(), <badge>)`). A "no data" image is a non-blank value, so the table keeps every row and
  map / slicer cross-filters appear not to work (Travel report 2026-10-02: map click trimmed Countries but not Travelers).
- No `formatStringDefinition` with scaling commas (renders ",,,B"); a measure can't have both formatString and formatStringDefinition.
  Money KPI cards bind to "(Card)" text twins (`FORMAT(...)` strings) instead.
- A measure can't be used directly inside a CALCULATE boolean filter: assign it to a VAR first.
- Power Query: never reuse a step/parameter name inside nested function scopes.
- Field-value color measures return hex strings; return white/neutral rather than BLANK so cards don't go transparent.
- Labels with "blank = latest" semantics for as-of slicers; never show a blank slicer member.
- **MAX / MIN do not accept boolean columns** (found 2026-10-02, again 2026-10-06 EEO page): `INT ( MAX ( 'T'[Bool] ) )` made a
  whole table visual fail with 'Error running visual data query' (the measure evaluates fine on its own in some contexts). Count
  with `COUNTROWS ( FILTER ( <table>, 'T'[Bool] ) )` (or `MAXX ( T, IF ( T[Bool], 1, 0 ) )` for a flag) instead.

- **Model keys are case-insensitive, the DWH is not** (found 2026-10-07, Concur Expense): SQL DISTINCT returned job codes 'c794' and
  'C794' as two rows, and the refresh failed with "contains a duplicate value ... one side of a many-to-one relationship". UPPER()
  (and trim) text keys in the SQL on BOTH sides of the relationship, and check keys with `str.upper().duplicated()` before refresh.
- **Bar chart category labels truncate** ("Resubmit (Ass...") at the default axis width: set `categoryAxis.maxMarginFactor` (e.g. 45L)
  on horizontal bar charts with long category names.

## Data access / security
- Prefer `analytics.Dim_Associate_Public` for people; restricted schemas (ukg, confidential) only in restricted workspaces.
- RLS: static roles per Company Family where needed (HR Compensation pattern). Never import vendor bank/tax columns.
- Gold Financials uses Automatic/SSO: viewers need `gold_analytics_reader`.

## Titles are Title Case (user rule 2026-10-02, "always")
Every visual title, KPI card title, fact-card label, table column header, slicer header and legend name is Title Case
(Capitalize Each Word; small words a / an / and / of / by / for / in / on / or / the / to / vs / with lower case unless first;
acronyms such as PM, AR, CO, WIP, CSI, URL kept). Navy section banners stay ALL CAPS. Generators route every title through a
`tc()` helper (reference: `Project Health\build\gen_report.py`). The user typed "snake case"; Title Case is what was applied and
accepted; confirm if a report ever needs literal snake_case.

## Tiles, grids and slicers: lessons from the HR Analytics / HR Compensation pass (user 2026-10-02)
- **Tile text wraps, never "..."**: every status tile (cardVisual) sets `objects.value` (selector default) `textWrap: true`. Size the
  tile for label + TWO value lines (9pt bold: ~60 px works once padding is tight). Tight padding: `objects.padding` default
  `paddingSelection 'Custom'` + `paddingUniform 4D`, and the left gap for the accent bar on `objects.cardCalloutArea` default
  (`paddingIndividual true`, `paddingLeft 14D`, `paddingRight/Top/Bottom 2D`). `paddingLeft` on `objects.padding` and
  `customizeSpacing` on `spacing` are NOT valid PBIR (validator errors). A uniform 4 px without the callout-area left padding puts
  the text under the accent bar. If one tile still truncates with wrap on (Power BI sometimes keeps one value line), shorten the
  measure text (e.g. "118 promotions YTD; avg +36%"). Check every tile row on a screenshot for "...".
- **Tile badges: overlay a small image visual, not the cardVisual's built-in image.** `objects.image` on a cardVisual renders the
  badge huge and hides the label. Add a 24 x 24 `image` visual (sourceType imageData, sourceField = `<Flag> Icon` measure,
  background / border / header off) at the tile's top right (x + w - 30, y + 6, z above the tile) and give the tile VCO padding
  right 30 so text never runs under it. Generator: `HR Dashboards\build\tile_badges.py`.
- **Grids never scroll sideways when they could fit**: set `columnHeaders.autoSizeColumnWidth false` on EVERY tableEx / pivotTable
  (auto-size grows columns past the widths you set) and give EVERY column an explicit width (columns without one auto-size).
  When shrinking to fit, never go below the column's longest header word (WRAP rule above); take room from the widest text
  columns and from low-value numeric columns ("Hires" = 1, stint #) first. Generator: `HR Dashboards\build\fix_hscroll.py`
  + `fix_wrap.py`.
- **Center dates and short codes in every grid** (user 2026-10-05): date columns / date measures (Hire Date, Last Time Off, Last Raise,
  Start, End ...) and short code columns (Family, FT/PT, Status, Pay Type / Basis, leave codes, Seq) are centered, same as numbers;
  names, titles, departments, reasons and other free text stay left. `HR Dashboards/build/center_pass.py` applies it from the model
  (dataType dateTime + date formatStrings); `check_pbir.py` reports CENTERCODE.
  **Headers follow their data** (user 2026-10-06): a centered column centers its header (and total) too: columnFormatting
  `alignment 'Center'` + `styleHeader true` + `styleValues true` + `styleTotal true`. `check_pbir.py` reports CENTERHDR.
  **Exception (found 2026-10-07, PMO report):** a column with conditional backColor / fontColor (RAG fills) keeps `styleHeader`
  OFF: with it on, Power BI paints the column's conditional fill into the navy header (pale fill + white text = unreadable).
  CENTERHDR skips those columns.
- **Slicers are styled as slicers, never as KPI tiles** (user 2026-10-04, HR Analytics Time Off page): no own header background band, no rounded border, no drop shadow, no grey item fill. Header Arial 10 bold black, items Arial 8 black, outline off. A slicer sitting on a navy page band keeps white header text, but the band is a shape behind it, not the slicer's own header background. `check_pbir.py` reports SLICERSTYLE; `HR Dashboards/build/slicer_pass.py` normalizes a report.
- **One-person pages keep a strict single-select picker** (user 2026-10-04, HR Analytics Associate Details): the person slicer on a detail page is `strictSingleSelect: true` + `singleSelect: true`, no Select all, preset to one person. The dropdown rule (multi-select + Select all) is for FILTER slicers only; a restyle / normalize pass must never loosen a single-select slicer. `check_pbir.py` reports SINGLESELECT.
- **Slicer header text on a navy header band stays WHITE** (black-text pass must check the header background first).
- After any of these passes: `check_pbir.py` (WRAP / WIDTH clean), validate, reload, screenshot every page and look at every grid,
  tile row and slicer header before handing over.

## Text never truncates in grids (user rule 2026-10-02)
No "..." in any table cell or header: text columns get room AND word wrap on (values.wordWrap = true) so long values (cost code
names, scopes, change order titles, statuses like "Signed after snapshot", names / emails) wrap to a second line. Headers wrap
too (columnHeaders.wordWrap) but size columns so no single header WORD splits (check_pbir WRAP). Turn wrap on for every grid
that shows free text; numeric-only grids can stay single line. Check a screenshot of the widest real values, not the empty state.

## Page height fits the content; screenshot after EVERY change (user rule 2026-10-03)
- Scrolling pages: set page height = lowest visual bottom + ~24 px in the generator (after any banner / section shifts) and
  regenerate the tall background from that height. No blank canvas below the last visual.
- Display option (user rule, restated 2026-10-13): every non-scroll page (height <= 720, 1280 x 720) MUST be `FitToPage` on every page type
  (report, drill-through, list, How To Guide); missing or any other value is a violation. Scroll pages (taller than 720) MUST be `ActualSize`
  (missing or any other value is a violation). check_pbir DISPLAY is an error in both cases; check_pbir exits 1 on any error.
  Tooltip pages (page.json `"type": "Tooltip"` or `pageBinding.type` Tooltip) are exempt from DISPLAY (user decision 2026-10-13).
- Totals never wrap: total rows inherit values.wordWrap (there is no separate total wrap), so size money columns for the largest
  TOTAL (e.g. $9,999,999,999 needs ~110 px at 9pt bold), not just the row values.
- Tile / button slicers: height must fit the longest label (4 lines at 10pt ~ 100 px); shorten labels before they need a 5th line.
- Run the full-page screenshot pass after every layout or label change, before telling the user it is done.


## Scope big fact queries in SQL, not in Power Query (user 2026-10-03: "budget snapshot taking very long to load")
- Filtering to the report's roster in M (`List.Contains(Roster, ...)`) still pulls every row over the wire first. For large gold facts
  (Procore budget snapshots = 3.1M rows across ACC/ANC/ADB/AMNC), put the roster rule in the SQL (a `jobs` CTE + `IN (SELECT pn FROM jobs)`)
  and keep the M filter only as a safety net. Project Health snapshot load went from 3.1M to 610K rows.

## DAX gotcha: never REMOVEFILTERS ( FactTable ) to "reach the job level" (found 2026-10-03, Project Health)
- REMOVEFILTERS / ALL on a fact table clears its EXPANDED table, i.e. the related dimension filters too (project, date). A buyout row
  measure using it read the portfolio % complete (58%) instead of the job's (96%). Clear the fact's own line-level columns instead:
  `REMOVEFILTERS ( Fact[Category], Fact[Cost_Code_L2], ... )`.
- "Latest snapshot" measures must take the job's latest snapshot date with those line-level columns cleared; otherwise a row looks up the
  latest snapshot that still contains that line, and lines the PM dropped resurface from old snapshots (stale "Not started" buyout rows).

## Screenshot QA of drill-through pages: pin a real record first (user 2026-10-03)
- A drill-through page opened without drill context renders portfolio totals or blanks, so a screenshot of it proves nothing about
  clipping, spacing or wrapping. Before the full-page screenshot, temporarily write the drill-through filter's value into page.json
  (filterConfig.filters[n].filter = In [<one record>]), capture, then regenerate the report to remove it. Check every new visual on that
  capture: text not cut off (cards need height for descenders: 10pt text >= 30 px), 12 px gap between stacked visuals, no table scroll.

## Slicers drop measure-based visual filters (found 2026-10-03, Project Health)
- A visual-level filter on a MEASURE inside a slicer (e.g. a tile slicer limited by "Check Projects >= 1") loads once from PBIR but
  Desktop empties it on save, so the slicer shows every item again. Filter slicers on a COLUMN instead (e.g. Checks[Show_Button] = 1).
- After any report change, verify the saved files: every visual-level filter in visual.json still has its `filter` body. Desktop also
  adds condition-less placeholder entries for fields in a visual (harmless); a filter YOU wrote with no body = it was stripped.
- QA the issue-button row at actual size too, and reload the window after a refresh if a tile slicer renders empty with a "<" arrow
  (it kept a scroll page that no longer exists).

## More PBIR / DAX gotchas (Project Health, 2026-10-03)
- **Calculated sort-by columns** must not reference the column they sort (Label sorted by Label_Sort = SWITCH ( [Label] ) is a
  circular dependency). Compute the sort key from the same inputs (rank, score) instead.
- **Floating-point zero**: a break-even snapshot summed to -6E-11 and fired a "loss" check. Compare money with ROUND ( x, 0 ) < 0.
- **100% stacked bar data labels** rendered white on the pastel RAG fills no matter what label color was set. When the labels must be
  readable, use a small table with RAG fills on the % columns (black text) instead.
- **cardVisual text_card wrap** is unreliable on short boxes: a 2-line value ellipsized. Keep one-line card text short, or give a
  multi-line paragraph a framed card at least ~4 lines tall (the Project View executive summary uses UNICHAR(10) bullets).
- **Star ratings in a table**: a wide SVG image is squeezed into the table's square image cell. Use text stars
  (UNICHAR 9733 / 189 / 9734) with a per-column gold font color (#B8860B) instead; keep the SVG stars for standalone image visuals.
- **Calculated tables built from measures can't have relationships** (circular): filter them with TREATAS. To read them from a
  measure that also feeds them, split it: a "Live" measure builds the table, the visible measure reads the table.

## Reset bookmark: byExpr entries need "howCreated": 1 (found 2026-10-03, Project Health) - overrides the Travel reference
- Desktop-made bookmarks (HR Analytics) write each saved visual filter with `"howCreated": 1` (user filter). Generated bookmarks that
  wrote `0` made Reset treat the page's visual filters as auto filters: after Reset + save, EVERY visual-level filter on the page had
  no `filter` body (issue buttons showed all 17 checks with a scroll, the projects table stopped following the issue buttons).
- Always write `"howCreated": 1`. After any user save, scan visual.json files: a filter named by the generator with no `filter` body
  means a bookmark stripped it.
- **Icons in word-wrapped tables get cut off on single-line rows**: the row height follows the text, not the image. Set grid
  rowPadding so one text line + padding >= imageHeight (rowPadding = (imageHeight - 14) / 2 + 1 at 9pt). Even so, 22 px icons still clipped at ActualSize; use 18 px icons in grids (padding 3), and check icon rows at ActualSize, not only FitToPage.
- **Parameter measures inside FILTER: capture in a VAR first.** `FILTER ( T, T[Window] = [Selected Window] )` re-evaluates the
  measure per row with context transition, which can return each row's own value and silently drop the filter (PM Card counted
  "22 of 7 jobs green" across all 4 look-back windows). Write `VAR w = [Selected Window] RETURN ... FILTER ( T, T[Window] = w )`.

## DAX gotcha: label from a "one-side" dimension needs a lookup (found 2026-10-04, Project Health)
- `MAX ( Dim_Company[Division] )` on a drill page filtered to one project returns the max over ALL companies: the filter runs
  Dim_Company -> Dim_Project, not back. Every project showed "94 - ARCO National Pacific Coast". Use
  `LOOKUPVALUE ( Dim_Company[Division], Dim_Company[Company_Number], MAX ( Dim_Project[Company_Number] ) )`. Check every fact card
  on a drill page against two different records before shipping.

## Desktop reload / readable tall-page screenshots (2026-10-04)
- After Desktop has been closed and reopened, `preview --reload` may report LIVE_WINDOW_RELOADED while Desktop only shows the
  "files changed externally / Apply external changes" banner (not reachable via UI Automation). Reliable route: edit files, kill only
  that report's window, reopen the .pbip, RefreshWithXMLA Full, then `preview --screenshot <dir> --all-pages` (retry on HOST_UNAVAILABLE).
- Fit-to-page shots of very tall pages (3,000 px+) are too small to read. For docs/briefs, add temporary 1280x720 "slice" page copies
  (visuals fully inside each 720 px window, shifted up; drop pageBinding), capture, then regenerate the report to remove them.
- Slice pages only carry the slicers that fall inside their window, so preset slicer values (e.g. Procore Stage = Course of
  Construction) are lost on S2+ slices and their numbers jump. Copy the preset slicers' filters into each slice page's filterConfig
  (or check totals against S1) before using slices in a document.

## Generator gotcha: bracket expressions passed into text helpers (found 2026-10-04, Project Health)
- A money()/format helper that inlines `{v} / 1E3` breaks when v is "[A] - [B]": DAX evaluates [A] - [B] / 1E3, which showed
  "$7,795,441K over estimate" on O137 (truth: $195K). Always wrap the argument: `v = f"( {v} )"` inside the helper.

## Drill-through pageBinding names must be unique (found 2026-10-04, Project Health publish)
- Two drill pages both bound as "Pod" loaded fine in Desktop but the Fabric updateDefinition import failed:
  "Values for 'pageBinding.name' property must be unique within the report". Give every drill page its own binding name.

## Visual-level MEASURE filters don't hold on cards (found 2026-10-05, Owner Billing)
- A visual filter like "One Job is 1" on cardVisual / waterfall visuals was ignored: with no job picked, the job pages showed
  company-wide totals ($41.8B). Put the guard in the measures instead: `IF ( [One Job] = 1, <expr> )` with
  `[One Job] = IF ( HASONEVALUE ( Dim[Key] ), 1, 0 )`. Summary pages that iterate jobs (table rows, SUMX over VALUES) are unaffected.
- Image measures need `dataCategory: ImageUrl` in TMDL or grids show the raw SVG text.
- tableEx `total.totals` exists; pivotTable has no `totals` property under `total` (validator error) - turn matrix totals off elsewhere.

## Screenshot QA must include the real, unfiltered view (user 2026-10-05, Owner Billing)
- A pinned-record capture (one job) hides overflow: the summary cards showed "1 job" in QA but "1,570 jo..." for users. Always also
  capture the clean build with the default filters and full data, AFTER the visuals finish loading (wait ~30 s after a refresh;
  spinners in a capture = recapture). Measure the longest REAL card values (`text measure`) before sizing.
- KPI band cards = the brandbook card (`kpi_band.json`) on every band page, including new pages: legacy card, centered title, divider,
  value; no accent bars; status badge on the title line (right edge). Legacy cards print "(Blank)", so bind them to "(Card)" text
  twins that return "-" when there is nothing to show. Image visuals show a broken-image placeholder for BLANK: return a 1 px
  transparent SVG instead.

## Cloned slicers carry the template's sync group (found 2026-10-05, Owner Billing)
- The Brandbook slicer visual has `syncGroup: year_number` (fieldChanges + filterChanges). Every slicer cloned from it joined that
  group, so picking a Project Accountant rewrote the Vista Dept slicer and blanked the table. When cloning a slicer, `pop("syncGroup")`
  and set one only on purpose (e.g. a Job picker synced across pages). Check: grep visual.json files for the template's group name.
- Preset filters can legitimately empty a page (e.g. a PA with no jobs in the default departments): add an empty-state text card
  that says why and which button widens it, instead of a blank table.

## Names behind a warning tile + RLS deployment (HR dashboards, 2026-10-05)
- **Use CLICK, not hover.** User-tested in the service and failed every time: cardVisual Tooltips well (never renders), button
  action tooltip bound to a measure (shows 'Click here to follow'), report-page tooltip on an invisible button, report-page tooltip
  on an invisible classic card (even with page `type: Tooltip`). Nothing appeared. Don't retry hover for tiles.
- **Working pattern:** invisible actionButton over the tile (icon/text/outline/fill/background/border/shadow off, z above tile and
  badge), `visualLink` PageNavigation to a hidden "Who" page + literal tooltip "Click to see who is behind this". The Who page is a
  clone of the report's drill page chrome (background, title = what the list is, credit, black Back button, one-line note) with a
  full-width house table filtered by a 'Who ...' measure > 0 (the tile's own count evaluated per associate), plus HIDDEN copies
  (`isHidden: true`) of the source page's synced slicers so the user's filters carry over. Reference:
  `HR Dashboards/build/tile_names.py` (Who measures), `tile_click_pages.py`. In Desktop the click needs Ctrl+click.
- Never tell the user an interaction works until it has been exercised where they use it (service); render the target page in
  Desktop at minimum.
- **RLS role members in TMDL are dropped by updateDefinition.** Publish the roles from TMDL, then add members in the service
  (model > Security) or over XMLA; service-added members survive later republishes. Viewers who are in no role see NO data, so
  add members in the same sitting and verify with ExportTMDL (includeRestrictedInformation) before the app is updated.
- **One-to-one relationships to an RLS table cannot set securityFilteringBehavior: bothDirections** (deploy fails); 1:1 already
  propagates security both ways (verified: Person rows follow the Employment Current filter).
- Verify every role with DAX impersonation (`dax_query_operations` impersonation.roles): row counts per family and excluded groups.

## Bonding Schedule lessons (2026-10-06)
- **Money format strings with scaling commas do not scale in grids** (`"$#,0.0,,""M"""` printed "$6,763,222,848.2,,M"). Grids bind to
  "<measure> K" twins = DIVIDE ( [m], 1000 ) with `#,0;(#,0);0` and say "(Dollars in Thousands)" in the title (user 2026-10-06: "$000s" is not intuitive), with a one-line example on the How To Guide ("7,622,610 = $7.62 billion"); KPI cards keep the "(Card)" text twins.
- **M `#table(type table [...])` field types are bare** (`#"Name" = text`, `= logical`, `= Int64.Type`), never `type text`: Desktop fails
  the whole PBIP load with "M Engine error: Token ',' expected" and opens "Untitled".
- **Open a matrix fully expanded**: every Rows projection `"active": true` + `expansionStates` levels (all but the last) with
  `isCollapsed: false`, `isPinned: true`, `identityKeys: [field]`. Without `active` the +/- shows expanded but no child rows render.
  Exception: if the value measure is BLANK above the leaf, expansion does not help; flatten the rows (see EEO lessons below).
- **Preset slicers**: a helper that writes `general.filter` must keep `selfFilterEnabled` from the caller (it re-enabled search on a list slicer).
- **List (Basic) slicer with all values visible** (no dropdown): mode Basic, search off, height = header ~34 + ~23 px per item at 9pt;
  keep labels short enough for the 180 px rail (no "...").
- **Warning banner (ANH style, user 2026-10-06)**: amber `#FFEB9C` textbox, black 10pt bold centered text, black 10 px rounded border,
  watch badge image at the left, full content width directly under the KPI band (y 130, h 28); the top content row moves down 26 px.
  One line only. Text names source systems (Vista WIP, the GL), never Fabric / gold / the warehouse. Reference: `Bonding Schedule\build\gen_report.py` `warning_banner()`.
- **No plain white text boxes (user rule 2026-10-09, "never")**: a note, stat or caveat is never a white / transparent box
  with black text and a border. Every text element must use one of the house styles:
  - **Warning / draft / data caveat** = the amber warning banner above (`#FFEB9C`, watch badge, black bold text).
  - **Info / context note** (e.g. "2nd-tier waivers can't be shown by sub yet") = navy section-bar style: `#003865` fill,
    WHITE bold 10-11pt text, 10 px rounded corners, white "i" (check) badge at the left, "?" tooltip for the detail.
  - **A stat or comparison** (e.g. "Approval to paid: 63 days with a waiver issue vs 34 clean") = a KPI card (grey-band
    brandbook card, or navy-title card off the band) or a small two-value card pair, never a sentence in a box.
  - **Drill hints** = the navy banner + orange "Open <Page>" pill (brandbook).
  Keep internal notes ("user decision 10/9") out of visible text; put the rule itself in the How To Guide.
  - **Text is centered both ways inside every banner, info bar, note and text card (user rule 2026-10-09)**: horizontal
    center AND vertical middle. cardVisual / card: set the value/label alignment to center and the vertical alignment to
    middle (no top-anchored text with empty space below); textbox: paragraph `horizontalTextAlignment: center`, and since
    textboxes anchor to the top, size the box to the text (one line ~ font px x 1.6 + equal top/bottom padding) so the line
    sits in the middle; shapes with text: `verticalAlignment: middle`. A badge icon at the left must not push the text off
    center (offset the text box by the badge width on both sides). Check it on the screenshot.
  - **Dynamic (measure) text centered vertically = an actionButton with no action**: button text can bind to a measure and
    has a true middle vertical alignment, unlike a card (top-anchored). Use equal left/right text margins (~36 px) so a left
    badge doesn't push it off center. Reference: `Accounting Wishlist\Original vs Final GP\build\gen_report.py` `info_bar()`.
  `check_pbir.py` warns WHITEBOX on any textbox / shape with no fill or a white fill.

## Population filter + KPI notes (HR dashboards, user 2026-10-06)
- No "All KPIs exclude interns" style notes on pages; the population scope is a visible, synced filter instead.
- A defaulted scope filter (e.g. Population: Core selected; Field Hourly + Intern/Co-op excluded) is a normal synced slicer
  (user 2026-10-06): on left-rail pages a vertical LIST at the bottom of the rail (re-stack rail dropdowns 52-60 px, 6 px gaps)
  so every value shows; on top-band pages a normal DROPDOWN inside the grey filter band (other band dropdowns resized pro rata).
  Keep the value list short (3 values) and named after real groups users know (department-based, not UKG employee-type codes).
  Visual-level 'not blank' filter; every Reset bookmark carries the default.
- When a page note / widget is removed from a KPI bar or tile row, re-spread the remaining KPIs / tiles across the full bar
  (badges and click overlays move with their tile). Reference: `spread()` in `HR Dashboards/build/population_ui_pass.py`.
- **Reset bookmark = SLICERS ONLY, applyOnlyToTargetVisuals (TESTED 2026-10-06, supersedes every older Reset rule here)**.
  User 2026-10-06: Reset emptied 'Salary by Demographic Today', trimmed the Hires matrix to one section, changed the Increases
  view. A headless service test of 6 bookmark variants proved: ANY data bookmark that applies to the whole page (targetVisualNames
  [] or all visuals, with or without the matrix in it, with or without expansionStates / orderBy) resets every matrix's
  expansion, so Section/Item matrices whose measures need the leaf level go EMPTY. The only variant that kept every visual:
  section = page filters + each slicer (its default general.filter, or merge data {} = no selection);
  options = {targetVisualNames: [the slicer names], applyOnlyToTargetVisuals: true, suppressDisplay: true}. Visuals that are not
  slicers are then untouched by Reset, so their own filters / expansion / sort stay as designed (this also replaces the Travel
  "include every filtered visual" rule above). howCreated in byExpr is a number (User = 1). Rebuild after any slicer change with
  `HR Dashboards/build/reset_bookmarks_pass.py` (run last); `check_pbir.py` reports RESETMATCH.
  Name each Reset bookmark `<Page display name> Reset` (e.g. "Bonding Summary Reset"): `reset_test.mjs` finds bookmarks by that
  name and SKIPs pages whose bookmark is called anything else (Bonding Schedule 2026-10-07: "<Page> defaults" = every page skipped).
- **Then PROVE it headlessly (user rule 2026-10-06: after every screenshot QA pass, always)**: publish, then
  `node scripts/reset_test.mjs <workspaceId> <reportId> <outDir>` for each report. Per page it captures the page as loaded,
  clears every slicer, applies the page's Reset bookmark and pixel-compares; any FAIL (emptied grid, collapsed matrix, re-sorted
  table, wrong slicer default) blocks "done". Never click in the user's Desktop window to test (it may land in their other apps).
  It waits on Power BI's 'rendered' event (+1.5 s, +8 s on map pages because Azure map tiles stream in late), so run the
  reports in PARALLEL (one node process each): ~3-4 min for 20 pages. A FAIL on a map page with a blank 'loaded' basemap is
  timing, not Reset; re-run that page (`... <outDir> Map`). The output also shows how much clearing the slicers changed the
  page; 0.0% means the page has no defaults to restore (the test is weak there, check by eye).
- **No catch-all buckets that are always empty** in charts ('No salary', 'Unknown' = 0): filter them out at the visual (user 2026-10-06).
- **Top filter-band slicers fit their content (~50 px) and are centred in the grey band** (header separator .. band bottom);
  60 px slicers starting at the band's top edge read as 'too high'. `HR Dashboards/build/band_center_pass.py`.
- Reset bookmarks: targetVisualNames = the slicers WITH applyOnlyToTargetVisuals true (see the tested rule above). Without that flag a narrowed list still resets the whole page.
- Horizontal classic tile slicers do NOT wrap (min ~140 px per tile, scroll arrow); the button slicer (advancedSlicerVisual) only
  rendered reliably at 1 row x 3 columns in a 60-82 px slot. Reference: `HR Dashboards/build/population_ui_pass.py`.
- Hidden pages built from a template: start the content 10 px below that report's header band (HR Compensation's band is taller).
- **Conditional fill measures for grid cells return BLANK when not flagged** (no white "else"): a "#FFFFFF" else paints over the
  grid's grey banded rows (user 2026-10-06, Bonding Schedule Backlog column). White fallbacks are only for cards / tiles.
- **Brandbook KPI band cards: h 51 at y 70.5 with container padding top 2 / bottom 0** (the template's 47.7 clipped the top of the
  12pt value in the service and Desktop, user 2026-10-06). Check a zoomed screenshot of the band.

## EEO lessons (HR Analytics, found 2026-10-06)
- **The EEO-1 form mock-up was rejected** (hidden "EEO Check" page with A to N columns + Previous Year Total, and the "EEO by
  Associate" badge grid). The standard is a visible "EEO" tab at the employee grain: a Department x EEO Category grid on top and an
  export-ready detail table below, with snapshot buttons (year ends + Current). Data rules: `references/eeo.md`.
- **Matrix whose only value is leaf-only renders BLANK** (found on the rejected badge grid): Rows Department > Name, value = an image
  badge guarded by `ISINSCOPE ( Name )` (BLANK above the leaf). The service showed only the 'Department' header: the visual queries
  the top level first, every value there is blank, so no rows and no columns appear, even with every level `active` and
  expansionStates pinned. Rule of thumb: any matrix whose measures return BLANK above the leaf = a flat table / single-level rows
  (or one flattened label column sorted by a key) instead.
- **Grid columns from a real category column, not one measure per column**: a matrix with Columns = 'EEO Snapshot'[EEO Category
  Short] and one count measure lets a click on a row, cell or header cross-filter the detail table natively.
- **sortByColumn on a calculated column must not depend on the column it sorts**: a calculated `Sort` column computed from the
  label column it sorts gives a circular dependency on deploy. Compute label and sort key together inside the calculated table
  expression (`ADDCOLUMNS`), as `eeo_model.py` does.
- **Export tables may scroll horizontally** (user-approved exception 2026-10-06): when a table exists to be exported and pivoted,
  keep every column even if it is wider than the page; check_pbir's WIDTH warning on it is expected. Tell users to scroll right or
  use More options > Export data.
- **Debug a blank or failing visual headlessly** (never click in the user's Desktop window to test): embed the PUBLISHED report with
  powerbi-client (the report CLI ships playwright + powerbi-client; `chromium.launch({ headless: true, channel: "msedge" })`; AAD
  token from `az account get-access-token --resource https://analysis.windows.net/powerbi/api`, `tokenType: 0`), then per page
  `getVisuals()` and `visual.exportData(0)` on each. 'ExportDataFailed / Error running visual data query' names the broken visual
  (DAX error: run its measures as a DAX query); a successful export with a blank render means a layout / expansion problem, not
  data. Embed boilerplate: `scripts/reset_test.mjs`.
- EEO / VETS-4212 data rules, the HR leadership gate and personal-data pulls: `references/eeo.md`.

## Replacing logic: sweep every old instance, then reconcile (user 2026-10-06, "never miss something this big again")
- What happened: the Population slicer replaced "exclude interns", but 30 page filters + ~150 hidden visual filters on
  Associate Type (HR Analytics 8 + 22, ANH, HR Compensation 7 + 86) kept excluding interns, so Overview "all populations"
  read 2,658 while the UKG Active flag said 2,729. Separately, Employment Period kept 3 people who have job history but no UKG
  employment record (no Active flag), so Headcount was 2,732.
- Rule: a new filter / rule REPLACES the old one everywhere. Before saying done, inventory and clear, in every report + model:
  page filterConfig, visual filterConfig (cards included: invisible to users), measures (grep the rule's field / value),
  titles / notes / tooltips ("Excl. Interns"), bookmarks (rebuild), How To Guide text, Power Query / SQL partitions.
  Script pattern: HR Dashboards/build/population_cleanup_pass.py.
- Then reconcile the headline against the source flag in the published model: `scripts/reconcile.py <ws> <ds> "[Active Headcount]"
  "CALCULATE ( COUNTROWS ( 'Employment Current' ), 'Employment Current'[Employment Status Text] = \"Active\" )"`. Every table
  that feeds a headcount uses the same population as the flag (Employment Period keeps only IDs in Employment Detail, minus
  NonAssociateIDs). Report the reconciliation (source / headline / each page's number) to the user.
- Deliberate exceptions must be named in the measure description and told to the user (turnover-rate measures keep their
  intern exclusion: seasonal interns distort rates; no headcount total uses them).
- `check_pbir.py` HIDDENFILTER: page filters on population fields (Associate Type, Population, Pay Basis, Employee Type, FT / PT)
  and any card / KPI with a hidden category filter. Employment Status = Active is the source flag and is allowed.

## Pay / bonus by demographic (user 2026-10-06, HR Compensation Bonus page)
- Before presenting pay totals, verify them against the payroll source (Vista bPREA, EDLType 'E', RollupRow excluded) by month;
  ARCO bonuses are paid mostly in March and December, so a YTD total can legitimately be ~a third of base pay.
- Suppress any row or cell with fewer than 5 people (blank amount, recipients hidden) so no individual's pay can be read off a
  demographic table; show a Recipients (or Associates) column so averages have their base.
- A men vs women difference of raw averages is role mix, not equity: label it "Raw Gap", no red / amber shading. Same-job gaps
  (Pay Equity page) are the only gaps that get RAG. Titles say what is included (paid YTD incl. leavers, raw averages).
- Reference: HR Dashboards/build/bonus_demo_pass.py.
- **Never write a pinned `expansionStates` on a pivotTable to open it partly expanded** (user 2026-10-07, Textura Sub Pay Times): a single level with `isPinned: true` and no identity values locks the tree in Desktop, and users can no longer expand the other Families to Divisions / Jobs. Let matrices open collapsed (no expansionStates, no `active` flags on the Rows projections), as on the Bonding Summary matrix.
- **KPI band badge placement: measure, never guess, the title width** (user 2026-10-07, Textura Sub Pay Times: badges overlapped 'Unpaid 30+ Days' / 'Final Waivers'). `powerbi-report-author text measure "<title>" --font Arial --size 12 --bold` gives textWidthPx; badge x = card center + width / 2 + 8. Guesses ran 15-20 px short on longer titles.
- **Desktop refresh hangs / 'Container unexpectedly exited 0xE4210002'** (Bonding Schedule 2026-10-07): the Power Query mashup container
  crashed mid-refresh and the XMLA RefreshWithXMLA call never returned (30 min). Not a query error: kill that report's Desktop, reopen
  the .pbip and refresh again (it worked first retry). Prove the queries with fabric_query.py before suspecting the M.

## SVG panels, stars and chart colours (SNOW Survey Responses, 2026-10-08)
- **Every star is gold, never black or white** (user rule 2026-10-08): SVG stars fill `#F5B800` (edge `#D99E00`, empty part pale gold
  `#FDF1C7` with a gold edge); text stars in grids use columnFormatting `fontColor #E8AA00` + `styleHeader false` so values,
  totals and subtotals are gold and the header stays white (a `values` selector with dataViewWildcard leaves the Total row black).
  On the white-text KPI band put a small gold star image beside the value instead of a text star. Guide SVG stars: gold fill / gold outline.
- **A bare `%` inside an SVG data URI turns the whole image black**: Power BI fails the URI decode and drops every `%23` colour.
  Any FORMAT(..., "0.0%") printed into an SVG measure must be `SUBSTITUTE ( FORMAT ( ... ), "%", "%25" )`. Badges without
  numbers were unaffected, which hides the bug until a panel prints a percentage.
- **Column / bar series ignore `dataPoint` selectors by measure** (lines honour them): legend showed slate / orange, columns stayed
  navy. Put the column colour in a selector-less `dataPoint` entry first, then the per-measure selectors for line series.
- **Never put a non-fact badge MEASURE in a table of columns from several dimensions** (Responses page, 2026-10-08): without a fact
  measure SUMMARIZECOLUMNS cross-joins every dimension (technician x submitter x incident) and the visual stays empty / the query
  never ends. Use a calculated image COLUMN on the dimension (e.g. Dim_Rating[Rating Badge], dataCategory ImageUrl) so the table is
  columns-only, like an export table.
- **Response rate by sent month**: blank a month while more than 10% of its surveys are still open, or the latest month spikes to ~100%.

## Scoped copies of a model (e.g. ANH Workforce from HR Analytics): person scope vs row scope (2026-10-08)
- Scope PEOPLE (load only in-scope associates) for privacy; if trend facts must also be row-scoped (e.g. only ANH / ACH periods so
  transferees' ABS years don't count as ANH headcount or turnover), keep a SEPARATE hidden person-level copy without the row filter for
  service, milestones, stints and job history. Otherwise transferees lose prior service (BRE04F00U0K0: 6.8 vs 27.4 yrs) and earlier
  companies show "Unmapped". Look up family / company names from the full Company dimension (no people data), never from the scoped facts.

## Report-level measures on live-connected reports (Safety Scorecard, 2026-10-08)
- When a report is live-connected to a shared model you must not change, add measures in `definition/reportExtensions.json`
  (`{"name": "extension", "entities": [{"name": "<model table>", "measures": [{name, dataType, expression, formatString, references}]}]}`).
  dataType enum has no `Int64` (use `Integer`, `Double`, `Text`).
- Every visual / sort / filter reference to such a measure needs `"SourceRef": {"Schema": "extension", "Entity": "<table>"}`; without
  the Schema the visuals render "Something's wrong with one or more fields". `validate` does not catch it; check a screenshot.
- Relative "This year" date slicer: data `mode 'Relative'`, `relativeRange 'This'`, `relativePeriod 'Years'`, `relativeDuration 1D`, and
  general.filter Between with LowerBound / UpperBound `DateSpan(Now, TimeUnit 3)`; renders "This | 1 | Year" in ~320 px.
- Before adding a "same period last year" or rolling trend, check the filter fields have a full year of history (Safety: Procore
  Responsible Party only from June 2025, so the subcontractor page would read falsely low).

## Worst-first tables: sort on a numeric rank, never the badge image (user 2026-10-10)
- "Worst first" lists (Action Needed, issue lists) sort on a visible "#" rank measure (1 = worst), not on the badge / icon image
  measure: an image measure sorts by its SVG text, which only happens to work and is lost once a user clicks another header.
- Rank key: severity (act 3 > watch 2 > process check 1), then $ impact where the check has one, then project count. Reference:
  `Project Health\build\gen_measures.py` [Check Severity] / [Check Priority].
- RANKX gotcha: rank over `ALL ( <table> )`, not `ALLSELECTED ( <table>[Name] )`, when the name column has a Sort By Column: the visual
  silently groups by the sort-by column too, so the rank sees one row and every row reads 1.

## Tiles as tabs (user 2026-10-10, ANH Project Health Field Activity)
- When a row of issue tiles each has a detail list, make the tiles the tabs: every tile image gets `visualLink` type Bookmark -> a
  display-only bookmark (`suppressData`, `applyOnlyToTargetVisuals`, targets = the detail tables + navy selection frames) that shows its
  table + frame and hides the rest. One fixed table slot under the tiles (no pop-ups over other content); a navy filled textbox 5 px
  larger than the tile, added BEFORE the tile (lower z), marks the selected tab. Default tab = the most actionable list (others
  `isHidden`). Section header says "CLICK A TILE TO SEE ITS DETAIL BELOW"; each tile tooltip ends "Click the tile for its detail list".
  Each list must tie to its tile count. Reference: `Project Health/build/gen_report.py` (fa_tabs), `PA Overtime/build/gen_report.py` (view_bookmark).
- Pictures (Procore photos etc.) are never embedded: file links are signed and expire. Show upload activity + a URL to the tool in the source system.
