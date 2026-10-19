# How To Guide page (required in EVERY report)

Every report ships with a hidden **How To Guide** page, reached from a "?" help button (template `assets/visual-templates/help.json`,
action PageNavigation) on every visible page, with a Back button (`back.json`) on the guide. Readers are business users.
- **Guide title = the report's dashboard title** (e.g. "Technology Portfolio Health"), with "How to use this report" in the
  subtitle line; never the PBIP / project file name (user 2026-10-02).
- **The Back button never overlaps the guide's lines or text**: place it top right above the header rule (PMO guide: rule at y 68,
  button y 9 x 34 tall), styled as in brandbook.md "Back buttons". Check it on a full-page screenshot.

## Reference formats (copy these; screenshots + source SVGs in `assets/how-to-guides/`)
| Format | Screenshot | Live report | Use when |
|---|---|---|---|
| **Quadrant guide (preferred)**, 1280 x 720 | `assets/how-to-guides/timecard_guide_1280x720.png` | `C:\SNOW Logic\IT Timecard Analytics.Report` (page "How To Guide", image `timecard_guide_1280x720.svg`) | 2-4 report pages: one panel per page |
| **Two-column reference**, 1280 x 720 | `assets/how-to-guides/travel_guide_1280x720.png` | `C:\SNOW Logic\Travel Report\International Travel Exposure.Report` (`Travel_How_To_Guide.svg`) | rules-heavy reports: states, counting rules, indicator legend, who owns the fix |
| **Tall guide**, 1280 x 1000+ (FitToWidth) | `assets/how-to-guides/pmo_guide_1280x1000.png` | `C:\SNOW Logic\PMO Projects\SNOW Projects & Time.Report` (`pmo_guide_1280x1000.svg`) | rating rules tables (e.g. PMO RAG swim lanes) |
Generator to copy: `guide_svg()` in `Claude DWH Directory\PMO Projects\build\gen_report.py`.

## Layout (quadrant guide)
- Dark navy background `#0F2744`; Arial; title 22pt bold white "<Report>: How to use this report"; subtitle "Created by ABS Data & Analytics Team" `#8AA0BC`.
- **Key terms** row: rounded pills, colored dot + "Term: plain definition" (e.g. "Productivity Index: 100 = team target = goal").
- **Colors** row: chart legend swatches (the palette actually used) + "Table shading: on target / watch / needs attention".
  If the report uses indicator badges, show the badges (`assets/icons/`) with ACT / WATCH / OK / CHECK meanings.
- **Filters** line: which slicers sit on every page and what Reset / Clear does.
- One **panel per report page**: page-name pill in that page's accent color, a question headline ("Are time cards in, complete and approved?"),
  3-4 bullets (bold visual name + one plain line on what it shows / how to read it), and a shaded **Tip** box (1-2 lines: where to start, a common misread).
- Footer: "Data refreshes daily; check Last Refreshed at the top right of each page." and "Questions? Contact the ABS Data & Analytics Team."

## Content rules
- **Plain business language.** Name source SYSTEMS only (ServiceNow, Vista / Viewpoint, UKG, Procore, Textura, Concur, Keystyle, the GL).
  NEVER table, schema, view, column, measure or database names (no bronze_servicenow, Dim_Associate_Public, Fact_..., gold, silver, DAX).
- Say what a number means and how it's counted (distinct people vs records, as-of date, what is excluded) in one line each.
- Thresholds behind colors / badges, stated simply ("amber past 7 days, red past 14").
- Who owns the fix for each kind of flag (role or team, not a system).
- Use the house vocabulary: **Family > Division** (never "cohort" or "business unit"), associates, jobs / projects, GC companies.
  Owner roles: "<name> (IT support)" for the assigned ServiceNow person, "<group> (IT queue)" when unassigned; never "fulfiller".
- Same text rules as the report: short lines, no em/en dashes, no "SO WHAT / NOW WHAT", never say data has bugs.
- Keep it to one screen when possible (1280 x 720); go taller only for rules tables.

## Build mechanics
- Generate the guide as an SVG with Python (no BOM), register it in RegisteredResources, set it as the page background
  (scaling Fit, transparency 0), page `visibility: HiddenInViewMode`, displayOption FitToPage when 720 high, ActualSize when taller (house rule 2026-10-08; was FitToWidth for tall guides 2026-10-07).
- Render a PNG to check it before shipping:
  `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --hide-scrollbars --window-size=1280,720 --screenshot=out.png file:///<guide.svg>`
- `check_pbir.py` errors if a report has no How To Guide page and warns on table/system names or "cohort" in guide text.

## Back button on the guide
Use the house pill button (brandbook.md "Pill buttons"): `add_back(page, "back", x, y)` at top right ABOVE the header rule
(x 1150, y 14 on a 1280-wide guide). Never the Power BI button icon (crammed and pixelated, user 2026-10-06).
- A calculations panel ("How the Numbers Are Calculated": term = formula, two columns) belongs on the guide of every finance report;
  make the guide taller (e.g. 960) rather than cramming it.
