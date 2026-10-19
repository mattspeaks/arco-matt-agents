# ABS PBI Brandbook: layout, chrome, backgrounds

Source of truth: `ABS PBI Brandbook.pbip` in the D&A project folder (ask the D&A team for a copy)
(pages "ABS KPIs", "ABS No KPIs", "Safety KPIs", "Safety No KPIs"). Live reference implementation of the
scrolling/top-slicer variant: `C:\SNOW Logic\IT Timecard Analytics.Report`. Clone visuals from these rather than
inventing styles. The PBIR visual templates in `assets/visual-templates/` came from IT Timecard Analytics.

## Brand tokens
| Token | Hex | Use |
|---|---|---|
| Navy (theme 0) | `#003865` | header band, section bars, table headers via theme, chart series 1 |
| Ink navy | `#042433` | SVG outlines |
| Rail grey | `#F2F2F2` | left rail / slicer band |
| KPI band charcoal | `#3A3A3A` | KPI strip on "KPIs" backgrounds |
| Slate | `#6B8F9C` | theme 1: lines, rail divider, gridlines |
| Text | `#252423` / secondary `#605E5C` | body text on white |
| Font | Arial everywhere (theme textClasses); section bars use Segoe UI Semibold 9pt white |

Theme file: `assets/theme/ABS_Custom_Theme.json` (Arial, dataColors navy, slate, orange, purple, pink, violet, gold, red;
default black 4-side outline on tableEx/pivotTable). Register it as the report's customTheme.

## Canvas and chrome (1280 x 720 pages FitToPage; taller scrolling pages ActualSize)
Brandbook "ABS KPIs" positions (x, y, w, h):
- Title textbox: 179, 0, 480, 50; "Dashboard Name" 24pt bold white.
- Credit textbox: 179, 41, 298, 31; "Created By: ABS Data & Analytics Team" Arial 11pt white.
- Last refresh card: 992, 8, 287, 32; measure `Last Refresh Label` 11pt (DAX pattern: `"Last Refreshed: " & FORMAT(MAX(Last_Refresh[Last Refresh]), "MM/DD/YY hh:mm AM/PM") & " CT"`).
- Page navigator: ~780, 39, 490, 27; tabCutTopCorners, bold, theme fills.
- Left rail (0-179 wide): Reset Filters button (bookmark, icon `reset`) at 15, 63; Clear All Filters button (`ClearAllSlicers`) at 15, 90; slate line shape at 0, 108; slicers from y 131 (Dropdown, header Arial 10 bold slate, items 8pt).
- **Page navigator (user rule 2026-10-02)**: every tab label fully visible (no "Current &..." truncation) and the tabs sit
  exactly on the header separator: navigator bottom = separator - 1 px (+-0.3), so the tab's own 1 px bottom outline lands on the band
  edge; within +-1.5 px still spilled visibly onto the KPI / filter bar (user 2026-10-04, ANH Workforce). Same rule on every page, so tabs
  never jump between pages. Screenshot-check at actual size: no tab outline below the navy band. Fixer: `HR Dashboards/build/nav_align.py <PBIP name>`.
  - Separator y = SVG y 236.5 mapped to the page: background scaling `Fit` stretches (y = 236.5 x pageHeight / svgHeight;
    e.g. 1110 px Timecard pages on the 3111 px Scroll SVG = 84.4), `Fill` keeps aspect (y = 236.5 x max(W/svgW, H/svgH) minus the
    centered crop; 720 px pages on the KPIs/Small SVGs = 68.4). Set navigator `y = separator - height`.
  - Size the tabs from the longest visible page name: `powerbi-report-author text measure "<longest name>" --font Arial --size <pt> --bold`
    gives the width; navigator width = n x (that width) + gaps. Fit it between the title/help block and the right edge (x <= 1268);
    if it can't fit, drop the font to 10-11pt, then shorten page names (never let tabs truncate).
  - `check_pbir.py` warns NAVPOS / NAVTEXT. Always confirm on the screenshot.
- **Filter buttons (required, user rule 2026-10-02)**, always top left directly under the ARCO logo, stacked, same width (~161 px, x 10-15):
  - **Clear All Filters on EVERY visible page** (action `ClearAllSlicers`, icon `clearAllSlicers`, template `clear.json`).
  - **Reset Filters on every page that has pre-set filters** (default slicer selections, e.g. Travel state = Current + Pending,
    a default year, single-select as-of month): action `Bookmark` pointing to a page bookmark that captures those defaults
    (data only, current page, selected visuals = the slicers), icon `reset`, template `reset.json`. Reset sits above Clear.
    Pages with no defaults get Clear only (don't add a Reset that does the same thing).
  - **Icon and text centered inside the button box**: icon `placement 'left'`, icon and text `horizontalAlignment 'center'`
    and `verticalAlignment 'middle'` on the default selector (the skill templates already carry this). Outline off; bold text.
  - On top-slicer (IT Timecard style) pages they sit in the same top-left spot under the logo (Timecard: Clear at 2, 98).
- **Spacing between visuals (user rule 2026-10-06)**: framed visuals (grids, charts, tiles, cards) that face each other are at
  least 10 px apart, top-to-bottom and side-to-side (the drop shadow alone eats ~4 px; 1-7 px reads as 'almost touching').
  Tiles in one row and KPI-band numbers are laid out by their own grid. Fix by trimming the larger visual on the facing side,
  never by moving tiles (badges and click overlays sit on them). `check_pbir.py` reports SPACING; `HR Dashboards/build/spacing_pass.py` fixes.
- **Dropdown width = longest value (user rule 2026-10-03)**: the open dropdown list is exactly as wide as the slicer visual, so long values
  (e.g. Division "212 - ARCO National Cleveland, a division of ARCO National Holding") get cut to "..." if the slicer is sized only for its header.
  Before placing any dropdown: (1) get the distinct values (DAX `VALUES()` / SQL DISTINCT on the slicer field, every hierarchy level);
  (2) measure the longest with `powerbi-report-author text measure "<value>" --font Arial --size <items textSize>` and add ~40 px
  (checkbox + hierarchy indent + scrollbar; the tool's recommendedButtonWidthPx is a good target); (3) set the slicer width to at least that;
  (4) rebalance the row: shrink the other slicers toward their header width (~0.83 px per char per pt + 22 px), keep equal gaps.
  If the row still can't hold everything: drop item text to 8pt, then shorten labels only within house rules (never cut HQCO - Company Name
  to an abbreviation without asking), and as a last resort give the long slicer its own row / wider bar. Confirm on a screenshot with the
  dropdown open. Reference: ANH CEO Dashboard Family > Division = 370 px (build\fix_visuals.py).
  When the whole row cannot fit (measure the total first), ASK the user: two slicer rows vs dropping slicers vs accepting "..." on
  free-text fields. (ANH CEO 2026-10-03: user kept one row; Family > Division and Type full width, Project Name / Customer truncate.)
- **Slicers in the grey filter bar: fit to height and centered horizontally AND vertically** (user rule 2026-10-02). No blank room under
  them: container padding top/bottom 0, height = header + dropdown (60 px for a 10pt header; never the 72-76 px default box).
  y = bar center - height/2. Bar on the 720 TopFilters SVG and the tall Scroll copies: SVG y 234.5..437.5 scaled to the page
  (`Fit`: x pageHeight/svgHeight; tall PMO/Timecard pages = y 83.7..156.1, center 119.9). Spread the slicer row with equal gaps and
  center it between the filter-button divider and the right limit (page edge, or a definitions textbox sharing the bar). Size each
  slicer so its header is fully visible (~0.83 px per char per pt + 22 px for Arial bold); drop the row to 9pt before truncating.
  Other single-row bar items (cards, buttons) are centered vertically too. Reference: `PMO Projects\build\slicer_band_pass.py`.
- **Banners (navy section bars) get the same 10 px rounded corners as the visual frames** (user rule 2026-10-02): border show, color
  navy `#003865` (invisible edge), radius 10 (template `section.json` carries it). Applies to every banner on every page.
- KPI cards (KPIs backgrounds only): y 72, h 47, w 131 at x 214 / 442 / 670 / 898 / 1126 (up to 6 cards: spread evenly across the band).
- **Content starts at least 10 px below the navy header / nav bar** (user 2026-10-06: 'visual is sitting on top of the nav bar,
  needs separation'). On white-content backgrounds (Small, NoFilters_NoKPIs) the first KPI card / tile / chart top >= separator + 10.
  Cards inside the charcoal KPI band (KPIs / NoFilters backgrounds) and slicers in the grey filter band are exempt. Fix:
  `HR Dashboards/build/header_gap_pass.py` (shifts the content area, keeps the bottom edge), then spacing_pass + badge_anchor_pass.
  `check_pbir.py` reports HEADERGAP.
- **KPI cards inside the grey/charcoal KPI band use the brandbook card exactly** (template `kpi_band.json`, cloned from the
  Brandbook "ABS KPIs" page): legacy card, **no background, no border, no navy title band, no shadow**; title 12pt bold white,
  centered; thin white divider; value 12pt bold white; category label off. Status shows as a badge image (`assets/icons/`) placed
  just right of the value inside the band, NOT as a RAG background fill (fills break the band look). Add only the "?" tooltip.
  The IT Timecard-style card (navy title band on a white box, RAG fill, template `kpi.json`) is for pages WITHOUT the KPI band
  (TopFilters / Scroll backgrounds). User correction 2026-10-02: don't migrate band KPIs away from the brandbook style.
- Content area starts x 223, y ~149 (No KPIs: y ~105). Visual frame: title 12pt on theme navy band, border radius 10, shadow on.
- **Every visual has a black line border WITH the drop shadow** (user rule 2026-10-02): charts, tables, matrices, KPI / content cards and
  issue-tile image visuals: `border` show + `#000000` + radius 10, `dropShadow` show. Tiles: the image visual gets a white background +
  the black border + shadow, and the tile SVG is generated WITHOUT its own outline (strip `stroke='#000000'` from
  `make_indicator_icons.tile()` output) so the line isn't doubled. Size every tile visual to the SVG's 240 x 72 shape (3.33:1, e.g. 220 x 66) and
  spread the row with equal gaps; any other shape letterboxes the image and the accent bar floats inside the border (`tile_aspect_pass.py`). Not for header chrome, slicers, buttons, page nav, banners, textboxes.
  Reference: `PMO Projects\build\black_border_pass.py`.
- Tables: header backColor navy, font white 9pt, values/totals 9pt, slate gridlines, black outline (house rule).

IT Timecard / PMO variant (scrolling, slicers across the top): title 180,6; credit 180,53; help button 888,4 (96x50); refresh 991,17;
page nav 498,56 (770 wide); slicer band y 80 h 76 from x 150 to 1268; navy section bars y 160 h 22; KPI cards y 184 h 56
(title 10pt one line); content from y ~250, full width x 12..1268.

## Backgrounds (`assets/backgrounds/`, all 4405 px wide = 1280 canvas)
| File | Layout | Use when |
|---|---|---|
| `ABS_Background_KPIs.svg` | navy header + grey left rail + charcoal KPI band | standard page with left-rail slicers and a KPI row |
| `ABS_Background_Small.svg` | navy header + grey left rail | left-rail slicers, no KPI band |
| `ABS_Background_NoFilters.svg` | navy header + KPI band, no rail | full-width page with KPI band, no slicers |
| `ABS_Background_NoFilters_NoKPIs.svg` | navy header + full-width grey band | full-width, light top band |
| `ABS_Background_TopFilters.svg` | navy header + full-width grey slicer band | slicers across the top (IT Timecard style), 720 high |
| `ABS_Background_Scroll.svg` | same as TopFilters, 3111 high | scrolling pages; generate per-height copies with `make_tall_background.py` (svg height = 2480 x H / 720, header stays ~68 px) |
| `Safety_Background_KPIs.svg` / `_Small.svg` | Safety logo variant | Safety reports |
| (see `assets/how-to-guides/`) | How To Guide formats + screenshots | the required HELP page |

**Scrolling pages put the slicers on TOP, never in the left rail** (user rule 2026-10-02). Any page taller than 720 (FitToWidth / ActualSize) uses the `ABS_Background_Scroll.svg` layout (`make_tall_background.py scroll <H>`): navy header, full-width grey slicer bar (Clear All / Reset at the left under the logo, slicers across), content full width x 12..1268, KPI cards off-band (template `kpi.json`, navy title, badge or RAG). The KPIs / Small left-rail backgrounds are only for single-screen 720 pages: a left rail scrolls away with the page and leaves a grey strip down the whole report.

Scrolling pages: never stretch a 720 background (the header "looks terrible"). Generate a taller copy with
`scripts/make_tall_background.py scroll|kpis|small <pageHeight> <RegisteredResources dir>`, set page `height`, displayOption
**Display option (user rule 2026-10-08, final; replaces 10-05 / 10-07): decided by page height, on every page type** (report,
drill-through, list, How To Guide):
- **No scroll (1280 x 720, 16:9): `FitToPage`**: the whole page fills the screen.
- **Scrolling page (taller than 720): `ActualSize`** (100%). Never `FitToWidth`: on ARCO's external monitors it blew the 1280 canvas
  up ~40% ("loads giant", too much scrolling, never everything in one view); FitToPage on a tall page shrinks it to ~45%.
Keep scrolling pages short (height budget ~1,100 px, the key block in the top ~650 px) so a monitor shows most of it. `check_pbir.py` DISPLAY.
image scaling `Fit`, and register it in report.json `resourcePackages`. `check_pbir.py` reports DISPLAY for any other value.

## Layout rules that users have asked for
- Most important thing first: KPI band, then the main table directly under the KPIs, then supporting charts.
- Every page has: title, credit, last refresh, page nav, clear/reset filters, help ("?") button to a HELP / How To Guide page,
  RAG feedback (see feedback-and-actions.md).
- Drill-through detail pages are hidden (`HiddenInViewMode`, not in the page nav) and reached ONLY by drill through: no slicers,
  no Reset / Clear on them (user rule 2026-10-02); a Back button top left in the grey bar styled like the page's link buttons (user rule 2026-10-02:
  navy `#003865` rounded fill, white bold text + white back icon, ~110 x 34); never the template's white-on-grey text. Put the drilled item's title + status line in the bar instead.
- **Drill-through must be discoverable** (user rule 2026-10-02: right-click drill is new to business users): every source table
  gets a navy banner directly above it saying how ("CLICK A PROJECT ROW, THEN OPEN PROJECT HEALTH (OR RIGHT-CLICK THE ROW >
  DRILL THROUGH > PROJECT HEALTH)") plus an **"Open <Page> ➜" button** at the banner's right end: actionButton, visualLink type
  `Drillthrough`, `drillthroughSection` = target page id, tooltip explaining it. Power BI shows it disabled (gray) until a row is
  selected. The How To Guide states both ways in. Reference: `PMO Projects\build\action_buttons_pass.py`.
- **In-page action buttons** (drill-through, Open in ServiceNow / source system, Export...) share one style (user 2026-10-02):
  button shape `tileShape 'rectangleRounded'` + `roundEdge 10L` (two `shape` entries: geometry in the no-selector entry, tileShape
  only in the `default` entry) so the fill is rounded in EVERY state incl. disabled; container background, border and shadow OFF
  (they draw a square box behind the rounded fill). Enabled fill = CIO action orange `#E66C37` (hover `#C9541F`, pressed `#A8441A`),
  disabled `#D9D9D9`; black bold 11pt text and black `rightArrow` icon in every state, icon left, centered; ~200-214 x 28-32 px.
  Not navy (it disappears among the navy banners). Not for the filter Reset / Clear buttons or the header Help button.
- **Back buttons** (drill-through pages and the How To Guide; user rule 2026-10-02; every Back button is now the house pill button, see "Pill buttons" below, user rule 2026-10-06) look like a real button: same rounded shape
  (`rectangleRounded`, roundEdge 10, container background / border / shadow off) but NAVY `#003865` fill with WHITE bold 11pt text
  and white `back` icon, thin white outline (so it reads on the dark guide), hover slate `#6B8F9C`, pressed `#042433`; ~110-114 x 34.
  On drill-through pages it sits centered in the filter box under the logo; on the How To Guide it sits top right ABOVE the header
  rule line (never on top of a line or text in the guide SVG).
- **Org slicer = one hierarchical "Family > Division" slicer** (Division label = "HQCO - Company Name", e.g. "18 - ARCO National Construction - KC, LLC",
  built in SQL as CAST([Company Number] AS varchar) + ' - ' + [Company Legal Name], sortByColumn = the HQCO number; user rule 2026-10-03;
  projections Company Family then company/Division in the same slicer,
  expandable). Never separate Family and Division slicers; never label anything "business unit" or "cohort".
- Slicers never show a blank member (filter `null` out of the slicer visual); sync slicers across pages with a syncGroup when the report is one story.
- Refreshing an existing report the users like = light touch (patch the original pages; see pbir-rules.md). Ask before any redesign.

## Chart data labels (user rule 2026-10-02)
Every chart shows data labels wherever there is room: bar / column charts always; line charts with a label density (~60) so Power BI
drops labels that would collide; small multi-series charts at 8pt. Label font is always BLACK `#000000` (8-9pt Arial), never the
series color or gray. Only skip labels on dense scatter / map visuals; say so in the tooltip if a chart has none.

- **When the slicer row can't fit every longest value (user rule 2026-10-03, Project Health)**: it's OK to cut a little off the long
  lists (e.g. Division) to give room for the others, as long as NO slicer loses more than 70% of its longest value unless it has to.
  Method: short fixed lists (stage, role, dept) at full width; share the rest pro rata across the long ones (Project Health: Family >
  Division 249, Project Manager 128, Project 247 = ~64% of each longest value). Slicer headers must always show in full.

## Pill buttons: ONE style for every Back, link and drill button (user rule 2026-10-06, validated on ARCO Bonding Schedule)
Applies to Back buttons (How To Guide, drill-through pages), drill-through buttons ("Open Flagged Jobs"), "Open in ServiceNow /
Procore" links, the header Help button and any other navigation / hyperlink button. Not to Reset / Clear filter buttons or page nav.
- **Look**: fully rounded pill (radius = height / 2), Arial 15 bold label, a stroked arrow (2.4 px, round caps / joins), thin outline.
  Back = navy `#003865` fill, white text + white left arrow, white outline (opacity 0.85). Action / link / drill = CIO orange `#E66C37`
  fill, black text + black right arrow. Typical size 104 x 34 (Back) and ~210 x 30 (action).
- **Build**: the pill is vector SVG in an image visual (data URI, drawn at 2x, fit) and an INVISIBLE actionButton sits exactly on top
  with the action (`visualLink` Back / Drillthrough / PageNavigation / WebUrl + tooltip): icon and text off; outline off on the base AND
  default / hover / press / disabled selectors (else a grey ring shows); fill white at transparency 100 / 80 hover / 65 press / 35
  disabled (a drill button that needs a row selected washes out until one is picked); shape rectangleRounded with roundEdge = h/2;
  container background / border / shadow / header off. Never use the Power BI button icon (renders crammed and pixelated).
- **Crisp text (user rule 2026-10-11)**: never `textLength` / `lengthAdjust='spacingAndGlyphs'` on the label (it stretches the
  glyphs and looks pixelated on wide pills); label at natural width, `text-anchor='middle'`, centered in the space beside the
  arrow; size the pill to the label (Arial 15 bold ~9 px/char + 60 px) rather than stretching text to the pill. Declare the SVG at
  **4x** the visual size (was 2x; blurs at ActualSize / high DPI). Run `scripts/pill_crisp_pass.py <PBIP>` as the LAST build step
  on every report (idempotent); it also fixes older pills in place.
- **Code**: copy `pill_svg()`, `pill_image()`, `pill_overlay()`, `add_pill()`, `add_back()` from `Bonding Schedule\build\gen_report.py`.
  Existing reports: `HR Dashboards\build\pill_pass.py` converts every Back button in place (run it LAST, after any generator that copies a plain Back button).
- **Help button** (user 2026-10-06; in generators use `add_help()` from `Bonding Scheduleuild\gen_report.py`): the header Help button is the same navy pill, 88 x 32 at x 886, y 4 (clear of Last Refreshed and the page nav): white circle with a navy bold "?" 6 px before bold "Help", invisible PageNavigation overlay to the How To Guide. Built by `HR Dashboards\build\help_pill_pass.py` (idempotent; run after any generator that copies a plain Help button).
- **Never place a pill on top of another visual** (user 2026-10-06): clicking a table row brings that visual to the front and buries the
  pill. Shrink the source visual and put the hint + pill on the open page just below it (Bonding Summary: table bottom 660, pill y 670).
- **Drill-through discoverability**: put "Click a <row>, then:" (10pt bold black) left of the action pill, directly under the source table,
  and keep the right-click route in the pill tooltip and the How To Guide.
