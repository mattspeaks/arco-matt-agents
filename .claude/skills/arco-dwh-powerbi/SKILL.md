---
name: arco-dwh-powerbi
description: ARCO / ABS Data & Analytics house playbook. Use for ANY work on the ARCO Fabric DWH (querying gold/silver/gold_uat, Gold semantic models, TMDL, work items) or ANY Power BI report/PBIP/PBIR/dashboard build or refresh for ARCO (brandbook layout, SVG backgrounds, standard and CIO color-blind palettes, visual issue indicators (icons, RAG, counts) with short text on every page, table borders, centered numbers, no em dashes) and for construction-finance metrics (WIP, backlog, revenue, gross profit, loss provision, over/under billing, income statement, AR). Also covers the Gold semantic model lifecycle (TMDL edits, descriptions for AI/MCP, safe deploys), the Fabric IQ ontology (ARCO_Gold_Ontology), gold pipeline failures and silver schema drift, surrogate keys and data-quality checks (join match rates, grain, duplicates). Stories, defects and tasks now live in ServiceNow Agile: load the `da-sprint-planning` skill for them (ADO retired 2026-10-09). Also statistics and machine learning deep dives on DWH data (trends, seasonality, change points, outliers, anomaly / fraud / irregular-spend screens, Benford, duplicates, peer comparisons, survival / cycle time, prediction models, forecasting). Triggers: DWH, Fabric, gold, silver, Vista/Viewpoint, Procore, Textura, UKG, ServiceNow data, Power BI, PBIP, report, dashboard, KPI, WIP, backlog, brandbook, semantic model, TMDL, deploy model, model descriptions, ontology, Fabric IQ, data agent, pipeline failed, S2G, schema drift, surrogate key, match rate, ADO story, ADO task, sprint, statistics, machine learning, ML, anomaly, outlier, forecast, trend, deep dive, irregular spend, fraud screen, email, email draft, reply to email, Outlook draft (house email format).
---

# ARCO DWH + Power BI house playbook

Owner: ABS Data & Analytics team. These are standing rules the user has already given; follow them without
re-asking.

**Act as the user's advisor, not an order-taker (user rule 2026-10-03).** When the user proposes an approach or asks "which is
better", do not just agree: state the competing theories, test each with real queries against the DWH (coverage, accuracy against
an independent yardstick such as booked billings / cost / a validated report, dollar impact, worst-case examples), and bring back
the best approach with the evidence table, including where the user's idea wins or loses. Prefer a hybrid when the data says so,
and say plainly when a simpler option is nearly as good. Verify "no side effects" claims with a diff before promising them. Read the reference file for the area you are touching before acting.

| Area | Read |
|---|---|
| Connecting to Fabric SQL, Fabric REST/TMDL, semantic models, Azure DevOps | `references/dwh-connection.md` |
| Report layout, header chrome, KPI band, which SVG background | `references/brandbook.md` |
| Chart vs table colors, CIO color-blind palette, RAG hex, DAX color measures | `references/color-palettes.md` |
| Per-page issue indicators: icon vocabulary, issue strip, RAG cards, icon columns, SVG measures, text budget, help page | `references/feedback-and-actions.md` |
| PBIR/TMDL authoring rules: borders, table sizing, KPI clipping, vocabulary, encoding, Desktop loop, DAX gotchas, refresh-vs-rebuild | `references/pbir-rules.md` |
| Required How To Guide page: formats, screenshots, content rules | `references/how-to-guide.md` |
| EEO reporting (HR): employee-grain EEO tab, snapshot table (year ends + current), EEO category grid + export-ready detail, veteran flags, HR-leadership gate, personal-data extracts | `references/eeo.md` |
| WIP, backlog, revenue, GP, loss provision, billing, financial statements, known Gold bugs | `references/wip-accounting-rules.md` |
| Gold semantic models: catalog, viewer-SSO identity, safe deploy, descriptions for AI/MCP, PII policy, verified join keys, TMDL gotchas | `references/gold-semantic-models.md` |
| Fabric IQ ontology (ARCO_Gold_Ontology): build/push scripts, binding format, entity rules, UI test questions | `references/gold-ontology.md` |
| Gold load pipeline: how it loads, failed runs, silver schema drift, surrogate key rules | `references/gold-pipeline.md` |
| Stories / defects / tasks, sprint planning, capacity: **ServiceNow Agile via the `da-sprint-planning` skill** (ADO retired 2026-10-09; `references/ado-work-items.md` is history plus the ticket-content rules) | `da-sprint-planning` skill |
| Statistics / ML deep dives: trends, change points, peer outliers, anomaly and fraud screens (Benford, duplicates), group comparisons, survival / cycle times, prediction models, forecasts, guardrails, tested lessons | `references/analytics-methods.md` |
| Any email draft / reply: LOCKED format, list markup, Outlook HTML allowlist, skeleton to copy | `references/email-format.md` |

## Tools bundled here
- `scripts/fabric_query.py` - run SQL against any DWH database with the user's az identity (`--db`, `--file` GO batches, `--csv`).
- `scripts/gold_checks.py` - data checks before stating any number: `match` (join match rate), `grain` (unique key vs exact duplicate rows), `dupes`, `cols`, `sample`.
- `scripts/fab.py` / `scripts/dax.py` - Fabric REST helpers (list models, getDefinition/updateDefinition, create) and DAX queries against a published model.
- `scripts/deploy_model.py` - safe semantic model deploy: lint (refs resolve, unique measure names, no relationship `///`, no dashes/BOM), viewer-SSO check, backup, before/after row counts + `--check` DAX, atomic deploy.
- `scripts/ontology/build_ontology.py` + `push_ontology.py` - generate and push the Fabric IQ ontology definition (lineage tags synced from live).
- `scripts/pipeline_health.py` - gold load triage: latest vs previous run, missing/failed tables, every source view tested for schema drift.
- `scripts/ado_item.py` - RETIRED 2026-10-09 (ADO is read-only history). New work items go to ServiceNow Agile with the `da-sprint-planning` skill.
- `scripts/make_tall_background.py` - taller brand background for scrolling pages (never stretch the header).
- `scripts/make_indicator_icons.py` - regenerates the badge icons + preview and prints DAX image measures (badge, issue tile) for any metric.
- `scripts/collapse_panes.ps1` - **run after EVERY Power BI Desktop open** (user preference 2026-10-11: Desktop opens with all panes collapsed): `powershell -File collapse_panes.ps1 -TitleLike "<window title>" -Apply -WaitSeconds 120` collapses Visualizations / Data / Bookmarks / Selection / Sync slicers / Performance analyzer in that one window via UI Automation (no clicks, no files, no user settings; pane state is not stored in any file). The Filters pane is a report setting (`report.json` `objects.outspacePane` `expanded false`) that also affects readers: set it in the generator only when approved.
- `scripts/publish_dev.py` - ONLY when asked (user override 2026-10-12: local Desktop testing is the default again): publish a PBIP (model + report) as "DEV - <name>" to My workspace, rebind, refresh, print the link; QA it headless. See pbir-rules.md "Dev loop".
- `scripts/full_page_screenshots.py` - screenshot every page showing the WHOLE page (temporarily FitToPage, reload, capture, restore). Use it for every visual QA pass; the plain CLI screenshot only shows the first screen of a tall page. Runs only with `--focus-ok` (see the focus rule below).
- **NEVER STEAL THE USER'S FOCUS (user rule 2026-10-12, standing):** opening / reloading Power BI Desktop, collapse_panes and screenshot runs must not take the user's cursor or keyboard focus while they type. No SetForegroundWindow / AppActivate / SendKeys / mouse, ever. Both helpers only READ the foreground window and STOP with FOCUS_CHANGED (exit 3) if Desktop comes forward; then don't rerun, tell MGR. Steps that may still bring Desktop forward (launching Desktop, `preview --reload`, Desktop `--screenshot`, full_page_screenshots) need a "user has a moment" go via MGR first (`--focus-ok`). Launch with `Start-Process <pbip> -WindowStyle Minimized` (Desktop may still restore itself, so it still needs the go). For published reports prefer `preview --host service --headless` (hidden browser, never touches Desktop). Details: pbir-rules.md "Desktop round-trip loop".
- `scripts/reset_test.mjs` - headless Reset Filters test on the PUBLISHED report (embed with your az identity, clear slicers, apply each page's Reset bookmark, pixel-compare with the page as loaded). Run after every screenshot QA pass. Its embed boilerplate is also the headless way to debug a blank / failing visual (`visual.exportData(0)` per visual; pbir-rules.md, EEO lessons).
- `scripts/reconcile.py` - headline number vs source-of-truth flag in the published model (DAX, no filters); PASS / FAIL. Run after any filter / population / headcount change.
- `scripts/combo_tooltip_pass.py` - every series on hover: gives each combo (columns + lines) and multi-series column / bar chart a hidden report-page tooltip listing ALL series for the hovered month / year (`apply(files)` also works on downloaded service definitions). Run after generating; lint HOVERALL.
- `scripts/pill_crisp_pass.py` - make pill buttons crisp (no stretched label, centered, SVG at 4x); run LAST on every PBIP build; `--generators` patches generator source. Lint warns PILLBLUR.
- `scripts/check_pbir.py` - lint a PBIP: BOM (`--fix-bom`), em/en dashes, grid outlines, centered numbers, hidden header icons, column widths vs visual width, KPI clipping, missing How To Guide, "cohort", table names in the guide, help button and RAG per page, DISPLAY (non-scroll page not FitToPage or scroll page not ActualSize = error), TMDL (sibling .SemanticModel must parse: Desktop TmdlSerializer + text check via `scripts/check_tmdl.py`; error). Exits 1 on any error. Run before every "please reload in Desktop".
- `scripts/stats_toolkit.py` - statistics for deep dives: `profile`, `peer_outliers` (robust z on log $ + FDR q-values), `benford` / `benford_by_group`, `round_number_rate`, `near_duplicates`, `trend` (STL + Mann-Kendall + Theil-Sen), `changepoints` (PELT), `compare_groups`, `simpson_check`, `anomaly_iforest` (explained drivers), `survival` (Kaplan-Meier). Import it; see analytics-methods.md for which to use.
- `scripts/ml_model.py` - prediction scorecard: out-of-time split, baseline vs gradient boosting, AUC + CI, PR AUC, top-10% precision/recall, calibration, permutation importance; refuses protected attributes.
- `scripts/forecast.py` - monthly forecasts: rolling-origin backtest (seasonal naive, naive, ETS, SARIMA), best model with 80% / 95% intervals.
- `assets/icons/` - indicator badges (act, watch, ok, check, nodata, trend arrows) and `preview.svg` of tiles + table usage.
- `assets/backgrounds/` - ABS / Safety brand SVG backgrounds (KPIs, Small, NoFilters, TopFilters, Scroll).
- `assets/how-to-guides/` - the house How To Guide formats (Timecard quadrant, Travel two-column, PMO tall): PNG screenshots + source SVGs.
- `assets/theme/ABS_Custom_Theme.json` - Arial + brand dataColors + default black table outlines.
- `assets/visual-templates/` - PBIR visual.json templates from IT Timecard Analytics (`kpi_band.json` = brandbook card for the grey KPI band, `kpi.json` = Timecard navy-title card for pages without the band, both with "?" tooltip; section bar, table, column, line, slicer, title, credit, refresh, page nav, help/back/clear/reset buttons, shape). Replace their measure/entity references (e.g. "Capacity Measures") and regenerate `name` ids.

## Companion skills (load them alongside this one; user rule 2026-10-07)
This playbook is the ARCO layer; the companion skills hold the generic how-to. Load the matching one(s) with the Skill tool
before acting, then apply the house rules here on top. **Where they conflict, this skill wins** (brandbook, palettes, viewer SSO,
safe deploy via `deploy_model.py`, no em dashes, PII, "verify, then claim").

| Task | Load |
|---|---|
| New story, defect or task; sprint start / rollover; capacity or points; board labels (ServiceNow Agile, group ABS Data and Analytics) | `da-sprint-planning` |
| Any PBIP/PBIR report build, page design, preview, screenshots, publish, rebind | `powerbi-authoring:powerbi-report-cli` |
| Semantic model / TMDL / DAX / measures / relationships / refresh (use this copy, not the duplicate `fabric-skills:semantic-model-authoring`) | `powerbi-authoring:semantic-model-authoring` |
| Natural-language data question over a Gold model or published report ("what are the top...", "show me...") | `fabric-skills:fabriciq` (FabricIQ MCP, runs as the viewer) or the `fabric-skills:FabricIQ` agent |
| ARCO_Gold_Ontology: entity/relationship types, bindings, lineage, graph walks (still push via `push_ontology.py`) | `fabric-skills:fabriciq-ontology-cli` |
| Warehouse / Lakehouse SQL endpoint DDL, failed or slow queries, Query Insights, CU spikes (queries still run via `fabric_query.py`) | `fabric-skills:sqldw-cli` |
| Bronze/silver/gold design, MLV vs notebook choice, Direct Lake handoff | `fabric-skills:e2e-medallion-architecture` |
| Fabric notebooks, PySpark, failed/OOM Spark runs, Materialized Lake Views | `fabric-skills:spark-cli` |
| Dataflow Gen2 / Power Query M items | `fabric-skills:dataflows-cli` |
| Dev/test/prod promotion; Fabric Git sync to ADO (2027 CI/CD goal) | `fabric-skills:deployment-pipelines-authoring-cli`, `fabric-skills:git-integration-operations-cli` |
| Environment values per stage (connection strings, workspace ids) | `fabric-skills:variable-library-cli` |
| Find a Fabric item when the workspace is unknown | `fabric-skills:search-consumption-cli` |
| Catalog governance: endorsement, labels, descriptions, owners, refresh health across workspaces | `fabric-skills:onelake-catalog-govern-cli` |
| Threshold alerts to Teams/email (e.g. pipeline or KPI breach) | `fabric-skills:activator-cli` |
| Capacity sizing / SKU and cost questions (2027 budget) | `fabric-skills:e2e-fabric-cost-estimation` |
| Cross-workload Fabric work or admin (capacity, access, inventory) | agents `fabric-skills:FabricDataEngineer`, `fabric-skills:FabricAdmin`, `fabric-skills:FabricAppDev` |
| Excel extracts, reconciliations, budget workbooks | `anthropic-skills:xlsx` |
| Word specs / logic docs / ADO attachments, decks, PDFs | `anthropic-skills:docx`, `anthropic-skills:pptx`, `anthropic-skills:pdf` |
| Charts outside Power BI (HTML briefs, PNGs) | `dataviz` (then swap in the house palettes from `references/color-palettes.md`) |
| Recurring checks (pipeline health, refresh failures) | `schedule` / `anthropic-skills:schedule` |
| Multi-source research briefs | `anthropic-skills:deep-research` |
| Statistics / ML deep dive (trend, outliers, anomaly or fraud screen, prediction, forecast) | read `references/analytics-methods.md` and use `stats_toolkit.py` / `ml_model.py` / `forecast.py`; `fabric-skills:spark-cli` to schedule a score in a Fabric notebook; `anthropic-skills:xlsx` for review workbooks; `dataviz` for charts |

Not in the ARCO stack (load only if that work appears): eventhouse/eventstream/eventschemaset (real-time), sqldb-cli,
azmon-mirroredcatalogs, project-osmos, and the Databricks/HDInsight/Synapse/pipeline migration skills.

MCP note: `fabric-skills` ships `.mcp.json` without the az `headersHelper`, so FabricIQ and fabric-sqlendpoint fail OAuth
("no dynamic client registration") until it is copied in from the plugin's `plugin.json`; redo after every plugin update. Its
remote `powerbi-modeling-mcp` returns 403 FeatureNotAvailable in the ARCO tenant; use the local one from `powerbi-authoring`.
Never wire these MCPs to the pipeline-check service principal (read-only, one workspace, bypasses viewer SSO).
The remote 403 server is also declared in the plugin's `.claude-plugin/plugin.json` `mcpServers`, so it loads even when removed
from `.mcp.json`. Startup timeouts: the az token call takes 4-5 s against the default 5 s MCP startup timeout.
**Applied 2026-10-11 (user-approved):** `~/.claude/settings.json` `env.MCP_TIMEOUT = "30000"` (backup `settings.json.bak`), and the
remote `powerbi-modeling-mcp` block removed from fabric-skills 0.3.19 `.claude-plugin/plugin.json` (backup `plugin.json.orig`).
**Re-apply both plugin patches (`.mcp.json` headersHelper + plugin.json removal) after every fabric-skills update** (new version
folder = unpatched files); MCP_TIMEOUT survives updates. Verify in a fresh session: no `plugin:fabric-skills:powerbi-modeling-mcp`
startup notice, FabricIQ and fabric-sqlendpoint connect, and ToolSearch "FabricIQ" returns DiscoverArtifacts / ExecuteQuery.
Which MCP tool for which question (FabricIQ DAX vs `arco-gold-ontology` vs SQL), plus limits (ValueSearch fails on DirectQuery
Gold, `ask_ontology` ~1 min, filter `list_ontology_entities`): `references/dwh-connection.md` "How to query Fabric".

## Non-negotiables (summary; details in references)
1. **DWH**: never ask how to connect; use `fabric_query.py`. Report data comes from Fabric only; SQL1 (Viewpoint SQL) is for validation, never a report source. Collation is case-sensitive. Gold data bugs go into Defect drafts for the D&A sprint (`da-sprint-planning`), never into report text.
2. **Brandbook**: navy `#003865` header, Arial, title 24pt white, "Created By: ABS Data & Analytics Team", last-refresh label, page nav, brand SVG background matching the layout. ****Scrolling (taller than 720) pages: slicers across the top in the Scroll-background grey bar, never a left rail.** **Display option (user rule 2026-10-08, restated 2026-10-13): every non-scroll page (page.json height <= 720, the 1280 x 720 16:9 page) MUST be `FitToPage`; a missing displayOption or any other value (FitToWidth, ActualSize ...) is a violation. Scrolling pages (taller than 720) ship `ActualSize`** (never FitToWidth: it loaded giant on monitors and needed too much scrolling). Applies to every page type (report, drill-through, list, How To Guide); tooltip pages (page.json `"type": "Tooltip"` or `pageBinding.type` Tooltip) are exempt (user decision 2026-10-13). `check_pbir.py` reports DISPLAY as an error in both cases and exits non-zero on any error. Keep scrolling pages within ~1,100 px. **Drill-through pages are hidden, drill-through only: no slicers, black Back button.** Clear All Filters on every page; Reset Filters (bookmark of the page's defaults) on every page with pre-set filters**; both top left under the logo with icon and text centered in the box. **Every Help, Back, drill-through and link button is the house pill** (vector pill image + invisible actionButton overlay; Help = navy pill with a "?" circle at 886,4 88x32; never the plain Power BI button icon; brandbook.md "Pill buttons"; `check_pbir.py` warns PILL; user rule 2026-10-06/07). **Page navigator**: size it so every tab label is fully visible and set its bottom edge exactly on the header separator (brandbook.md has the math).
3. **Colors**: tables, matrices, heat maps and KPI card backgrounds use house RAG (`#C6EFCE` / `#FFEB9C` / `#FFC7CE`). Bar/column/line charts in reports the CIO uses use his color-blind palette (Projects `#F2C811`, Ops `#003865`, attention `#E66C37`, Non-Project `#A4262C`, Off `#A6A6A6`; RAG in charts = orange/slate/navy). Other reports use the theme order.
4. **Issues bubble up visually on every page**: ARCO badge images (`assets/icons/`: red octagon ! act, amber triangle ! watch, green check ok, slate i check) in issue tiles, KPI cards and a badge column, worst first. Never Unicode text chips. Text is short (labels 2-4 words, reasons one line); detail goes in "?" tooltips and the How To Guide. Never use "SO WHAT / NOW WHAT" phrasing or paragraph banners. Every flagged item names **who owns the action** (person + role, or team); split statuses until each has one owner. A reported status (e.g. PM color) stays the headline; calculated indicators are checks that call out where they differ. Only auto-rate what the data can measure; otherwise show "PM judgment" + facts.
5. **Grids**: ALWAYS a black outline on all 4 sides of every table/matrix (every page, every report, set on the visual, not just the theme); every number/date column centered (headers, values, subtotals, totals); text left. **No horizontal scroll, never split a word or cut text off ("Year / s", "T...")**: size column widths so every column shows at the visual's width (users don't know Focus mode); only if truly impossible keep key columns left and say so in the tooltip.
6. **KPI cards and tiles**: tile text wraps (textWrap on, tight padding, never "..."); badges are small overlay images; never let the value's top get chopped; size height for title + value fonts and ALWAYS visually check a screenshot of the KPI band.
7. **Help tooltips + visual headers (user rule 2026-10-07)**: every visual with non-intuitive baked-in logic (hidden filters/exclusions, thresholds behind colors, derived formulas, as-of rules, placeholder targets) gets a short "?" tooltip; when unsure, add one. **KPI cards** (band cards, navy-title cards, text / value cards): header OFF (`visualHeader show false`); if the card has a "?" tooltip, header on with ONLY `showTooltipButton` and every other header icon set false (focus, more options, pin, copy, drill, info / warning ...; the full list is in pbir-rules.md). **Matrices, tables and charts**: ALWAYS keep the header with its default icons (focus mode, export / more options, drill up / down, next level, expand); adding a "?" sets only `showTooltipButton` + the tooltip, never hides the others. `check_pbir.py` reports HEADER (card icons showing, grid/chart icons hidden) and NOHEADER (grid/chart header turned off).
8. **Text and vocabulary**: no em dashes or en dashes anywhere. **All visual text is black #000000, never gray** (legends, data/axis labels, slicers, buttons, tables, tile labels); white only on navy/charcoal. Link columns are headed "URL". Org grouping is always **Family > Division** (Family = Company Family, Division = the company, ALWAYS labeled **"HQCO - Company Name"**, e.g. "18 - ARCO National Construction - KC, LLC", sorted by HQCO; user rule 2026-10-03): never "cohort" or "business unit"; one hierarchical "Family > Division" slicer, never two; tables show Family then Division. **Size every dropdown slicer to its longest value (user rule 2026-10-03)**: query the field's distinct values, measure the longest with `powerbi-report-author text measure "<value>" --font Arial --size <item pt>` (+ ~40 px for checkbox, hierarchy indent and scrollbar), and make the slicer at least that wide (the dropdown list is only as wide as the visual); rebalance the slicer row so every value shows without overflow or "...". Every dropdown slicer is multi-select with a "Select all" option, but opens with NOTHING ticked (shows all data, "Select all" unticked) so users can search and tick right away; never pre-tick "Select all" (user rule 2026-10-03, replaces the 10-02 rule). Preset a value only for a business reason, then add Reset Filters; hierarchy dropdowns open collapsed. Owners: ServiceNow assignee = "<name> (IT support)", unassigned = "<group> (IT queue)"; never "fulfiller". Readers are business users: name source systems (ServiceNow, Vista, UKG, Procore, Textura) but never table/schema/column names in visible text.
8a. **Readable charts or scroll (user rule 2026-10-10, "ALWAYS"; UX is key)**: if fitting a page into 1280 x 720 would make any
   chart or table too small to read (data labels / axis text unreadable, legend hidden by Power BI, tables needing internal
   scroll for a handful of rows, charts under ~200 px tall), ALWAYS make it a scrolling page instead (Scroll background, slicers
   in the top grey bar, ActualSize, within ~1,100 px; drill-through pages too). Never shrink visuals to dodge scrolling.
8b. **No plain white text boxes (user rule 2026-10-09, "never")**: notes, stats and caveats never sit in a white / no-fill box
   with a border. Warnings / drafts / caveats = amber warning banner; info notes = navy info bar (white bold text, white "i" badge,
   "?" tooltip); stats or comparisons = KPI cards. No internal wording ("user decision 10/9") in visible text. Text inside every
   banner / info bar / note / text card is centered horizontally AND vertically (user rule 2026-10-09). Details:
   `references/pbir-rules.md` "No plain white text boxes"; `check_pbir.py` warns WHITEBOX.
9. **How To Guide**: every report has one (hidden page + "?" button on every page), in one of the house formats in `assets/how-to-guides/`; see `references/how-to-guide.md`.
10. **Publishing**: every published model gets a daily scheduled refresh at 6:00 AM Central with failure emails to ABSDataAnalytics@arco1.com (see dwh-connection.md).
11. **Files**: write PBIR/TMDL with Python or Write/Edit only (no BOM). Live PBIPs in `C:\SNOW Logic\`. Build with generators, regenerate rather than hand-edit.
    **TMDL descriptions are `///` doc comments on the line above the object, never a `description:` property** (Desktop will not open the model); `check_pbir.py` parses the sibling model's TMDL and reports TMDL errors before any reload or publish.
12. **Refresh = light touch**: patch the original report's pages; don't re-layout pages users like. Ask before redesigning.
13. **Finance numbers**: before building on gold WIP, read `wip-accounting-rules.md` section 7 (open gold bugs) and apply every open workaround until the fix is proven in the data; follow `wip-accounting-rules.md` (GL is the revenue headline, WIP for project detail, department '03' WIP jobs, GC companies only, last closed month, validated-report alignment).
14. **Identity**: every model and ontology queries as the viewer (SQL source Automatic, Shared Dims link Entra SSO). Never bind to a stored credential.
15. **PII**: remove sensitive columns from models (hiding still exposes them to DAX/MCP/agents); flag business free text as Sensitive in descriptions; never reproduce sensitive values in any file, ticket or reply.
16. **Verify, then claim**: every key, match rate and total in a description, ticket or reply comes from a query (`gold_checks.py`, DAX vs SQL). Shared Fabric items (Gold models, ontology, production gold views) change only with the user's explicit go-ahead in that turn, through `deploy_model.py` / `push_ontology.py`; never work around a blocked deploy.
17. **Questions are not instructions**: when the user asks a question ("can we...?", "should we...?"), answer it with a recommendation and wait; don't start changing files or systems until asked.
18. **Work items (ServiceNow Agile, via `da-sprint-planning`; ADO retired 2026-10-09)**: propose the item(s) and wait for approval; titles verb + business object, Title Case, no "DWH:" prefix; 2 points = 1 day, max 16; every story has epic + product; defects put findings (verified numbers) in Description and the fix + validation in Implementation Plan; attach supporting files to the story and its tasks; never put OneDrive or local paths in a work item.
19. **Emails: LOCKED format (Sean approved 2026-10-06)**: bold Title Case section headers, first bullet directly under its header, no blank lines between items, blank line between sections; lists are indented `<div>` lines (&#8226; / `1.` / sub-point `o`), never `<ul>/<ol>` or tables; one line per item; no style attributes; no typed sign-off (Outlook signature). Copy the skeleton in `references/email-format.md` exactly.
20. **Replace, never layer; then reconcile (user 2026-10-06)**: when new logic replaces old (e.g. the Population slicer replacing
    "exclude interns"), sweep EVERY old instance in EVERY report and model: page filters, visual-level filters (incl. hidden ones
    on cards), measures, titles / notes / tooltips, bookmarks, How To Guide, Power Query steps. Then prove the headline number
    against the source-of-truth flag with `scripts/reconcile.py` (e.g. Active Headcount, all populations = UKG Active flag) and
    show the user the reconciliation table. Missed once: Overview showed 2,658 vs 2,729 Active (150+ hidden intern filters
    across 3 reports + 3 job-history-only people). `check_pbir.py` reports HIDDENFILTER.
21. **Statistics and ML (user 2026-10-07)**: for trend / outlier / anomaly / prediction / forecast work follow `references/analytics-methods.md`: baseline first, out-of-time validation, uncertainty on every number, FDR q-values when screening many people, effect sizes, Simpson check by Family / Division, minimum n, no protected attributes as features, every flag explained and hand-validated, lists naming people stay CONFIDENTIAL. Production scores run in a scheduled Fabric notebook writing a Gold table.
22. **Zeros, not blanks (user 2026-10-08, "always")**: additive measures (counts, sums, dollars) show 0 instead of an empty
    cell on rows that belong in the visual, so a calculation that nets to zero reads "0". Build it in automatically, guarded so it
    never adds rows or fans out: `VAR v = <calc> RETURN IF ( ISBLANK ( v ) && NOT ISEMPTY ( <the measure's own fact / driving table> ), 0, v )`
    (a bare `+ 0` only where the visual's rows are already limited by a filter or another non-blank measure). Never on averages,
    medians, ratios / %, days, as-of values, suppressed small-group (EEO) cells, badge / color / image / label measures, or the measure
    that ranks a chart (filter those charts to measure > 0). Prove it: same visual row counts before and after, then screenshot.
    Details + examples: `references/pbir-rules.md` "Zeros, not blanks".
23. **Every series on hover (user 2026-10-08)**: a line chart already draws the vertical hover line listing every series; combo charts
    (columns + lines) and multi-series column / bar charts show only the hovered series. Give every such chart a report-page
    tooltip listing all its series for that month / year: run `scripts/combo_tooltip_pass.py` on the report (never put the series
    in the Tooltips well: the hovered series then shows twice). `check_pbir.py` warns HOVERALL.
24. **Every SQL query is optimized for Fabric CU usage (user 2026-10-14, "all SQL queries")**: the capacity is shared; our dev
    loops were ~2/3 of gold's weekly load (10/14 review: D&A Team\CU_Review_20261014_DA.md).
    - **Write it once:** never inline or repeat the same subquery / CTE / crosswalk across tables or lanes (Fabric doesn't
      materialize CTEs; Sub 360 inlined its vendor crosswalk 107x). A lookup used by 2+ queries is imported once as its own model
      table and joined in the model. NEVER create any new table, schema, view or proc (any layer) without the user's explicit permission for that object (user 2026-10-15).
      Dev sandbox: schema `gold_uat.dev_stage` holds only the heavy computed pieces during dashboard dev / test (each table OK'd
      by the user); dev models join to existing gold_uat tables. Publish with native optimized SQL, then drop the report's sandbox
      tables. Never stage in prod gold / silver / bronze.
    - **Filter in SQL, not M:** push project / date / company filters into the source query (no "pull everything, filter in
      Power Query"; no M filters that reference another table, which re-run that table's query per partition). Select only the
      needed columns (no SELECT *).
    - **Sargable joins:** no functions on join keys (CAST / CONCAT / TRIM / REPLACE); clean keys once upstream. Read each big fact
      (e.g. bJCCD) once per model, not once per table; roll-ups go in DAX on imported tables.
    - **Before any run:** estimate the cost (warehouse seconds). Dev / QA gets ONE cleared test refresh (off-hours when large):
      no profiling loops, no repeated Desktop / API refreshes, no re-running heavy SQL to time it; probe suspect queries
      with a COUNT(*) first.
    - **If CU warnings appear:** stop all agent queries and refreshes, then report.
    - **Refresh cadence:** match how often the data is used (e.g. weekly + month-end), not daily by default.

## Setup for teammates
- `az login` with your own ARCO account; ODBC Driver 18 for SQL Server; Python with `pyodbc`, pandas, scipy, scikit-learn, statsmodels, ruptures, lifelines, shap (`pip install statsmodels ruptures lifelines shap`).
- Work items: install the companion `da-sprint-planning` skill (needs the Claude in Chrome extension and a ServiceNow login in the ABS Data and Analytics group). The Azure CLI devops extension is only needed to read ADO history.
- Access: ARCO DWH workspace (Contributor to deploy) and the gold reader roles for the schemas you work on (`gold_analytics_reader`; ukg/payroll readers for HR, Payroll, Time Off).
- Ontology scripts write to `./Ontology` under the folder you run them from (override with `ARCO_ONTOLOGY_HOME`); description drafts are read from `./Semantic Models/_staged/descriptions` (override with `ARCO_MODEL_DESCRIPTIONS`).
- Paths like `C:\SNOW Logic\...` and the brandbook PBIP in the references are the skill owner's reference projects; ask Data & Analytics for a copy if you need to clone from them. The bundled `assets/` cover the common cases.

## Workflow for a new report
1. Clarify audience (CIO / IT -> color-blind charts; board / finance -> brand palette), pages, and the decisions each page supports.
2. Validate the data with `fabric_query.py` against the rules before modeling; reconcile to a validated report where one exists.
3. Generate model + measures + report from Python generators (copy helpers from the projects listed in pbir-rules.md); include level, icon, color and short action measures from the start.
4. Run `check_pbir.py --fix-bom` and fix every ERROR; review WARNs.
5. **Visual QA before saying done** (screenshot every page with `scripts/full_page_screenshots.py` so the WHOLE page is in view, top to bottom;
   never judge a page from a viewport-only capture, user rule 2026-10-02): KPI values not clipped; content at least 10 px below the navy header / nav bar (HEADERGAP); no
   horizontal scrollbars in grids; titles not truncated; no overlapping visuals; no empty visuals (show "All clear" / "No items",
   not blank); slicers have no blank member; badges render; nav tab labels not truncated and tabs sit on the header line; slicers fit to height and centered in the grey bar; banners have 10 px rounded corners; every visual has a black border + shadow; drill-through pages reachable by a visible banner hint + "Open <Page>" button (pill style); Clear / Reset buttons top left with icon + text centered (and Reset actually restores the defaults); How To Guide opens from "?" and Back returns. **Reset Filters bookmark regenerated after ANY change that adds a slicer or a visual-level filter** (it must carry every filtered visual on the page, see pbir-rules.md), then click Reset and confirm nothing changes shape (user rule 2026-10-02: Reset cut off the issue buttons). **After the screenshot pass, ALWAYS publish, run `scripts/reconcile.py` on the headline counts, and run the headless Reset test** `node scripts/reset_test.mjs <workspaceId> <reportId> <outDir>` on every report touched; every page must PASS before saying done (user rule 2026-10-06: Reset emptied the demographic matrices). Reset bookmarks target the slicers only with applyOnlyToTargetVisuals (pbir-rules.md).
6. Ask the user to open/reload. Report what was validated and what was not.
7. Save new standing rules the user gives you back into this skill (edit the matching reference file) as well as memory.
