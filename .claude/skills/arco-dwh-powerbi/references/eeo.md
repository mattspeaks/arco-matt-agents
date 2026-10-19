# EEO reporting pattern (HR Analytics "EEO" tab, user redesign 2026-10-06)

Reference scripts in `HR Dashboards\build` in the D&A project folder:
`eeo_model.py` (calculated table 'EEO Snapshot' + measures) and `eeo_page.py` (the EEO page).

## The standard: employee grain + export-ready detail (NOT an EEO-1 form mock-up)
- The first design (hidden "EEO Check" page laid out like the EEO-1 form: columns A to N + O total, Previous Year Total row,
  VETS-4212 veteran grid, people list, plus a hidden "EEO by Associate" badge grid opened from a button on Actives) was
  **rejected by the user as not the standard and deleted**. Do not rebuild a form replica or badge grid.
- What HR wants: a regular, visible "EEO" tab (last tab in the nav) at the **EMPLOYEE grain**:
  - Top: "EEO by Department" matrix, rows = Department, columns = EEO Category (14 race / ethnicity x sex categories + Not Given),
    totals both ways.
  - Bottom: "EEO Detail" table, one row per associate in the snapshot, with **every column needed to count from an export
    without merging anything**: Employee ID, Associate, Family, Division, Department, Job Title, Work Location, Hire Date, FT / PT,
    Pay Basis, FLSA, Population, Gender, Race / Ethnicity, Hispanic or Latino, EEO Category, each veteran category, Veteran
    Self-ID, Disability (Self-ID), Snapshot, As Of. HR pivots it in Excel (More options > Export data).
  - Left rail: Reset / Clear, Family > Division, Department, Location, Population. Population defaults to ALL populations here
    (EEO counts every associate), unlike the Core default on the other HR pages.

## Snapshots (year ends + current)
- Snapshot buttons, single select, default Current: YE 2023, YE 2024, YE 2025, Current.
- Built as ONE calculated table: `GENERATE` over a snapshot list (`DATATABLE` of year-end dates `UNION` a `ROW` for `TODAY ()`)
  x `FILTER ( 'Employment Period', Period Start <= _d && Period End Excl > _d )`, so **department, job, division and location are
  as of the snapshot date**. Exclude non-associates (no Employment Current row), matching Actives.
- **Self-ID fields (gender, ethnicity, veteran, disability) are the CURRENT UKG values** (UKG keeps no history). Say so on the
  page and in the guide. Recently Separated is measured against each snapshot's date.
- Relate the snapshot table's Employee ID to 'Employment Current' so the family / HRBP RLS roles flow through.

## Category rules
- EEO Category from UKG Person Ethnicity + Gender (M / F): Hispanic or Latino, White, Black or African American, Asian, NHPI,
  AIAN, Two or More Races, each " Male" / " Female"; **blank / unmapped ethnicity or gender not M / F = Not Given**. Exactly one
  category per person, so the grid totals equal headcount.
- **Grid columns come from a real category column** (plus a short header twin, e.g. "Hisp. Male", "NHPI Female", sorted by a
  numeric sort column), not from measures per column. Then clicking a department, a number or a header **filters the detail table
  natively** (no drill-through, bookmarks or helper measures).
- **EEO-1 job categories (1.1 to 9) are NOT in the data.** They need an HR-supplied job title to category mapping; say so instead
  of guessing from titles.

## Veterans (VETS-4212 fields as detail columns)
- UKG veteran flags are **Y / N / D (declined) / blank (never answered)**. Detail columns: Protected, Disabled, Wartime / Campaign
  Badge, Service Medal, Recently Separated (Yes / No) and Veteran Self-ID = Answered / Declined / Never Answered.
- **Recently Separated** = Military Separation Date (text yyyy-mm-dd, parse it) within 3 years (36 months) of the snapshot date.
- **Protected** = any of disabled, wartime / campaign badge, service medal, recently separated. Categories overlap, so never sum them.

## Wide export table (approved exception)
- The detail table is intentionally wider than the page (horizontal scroll). **House-rule exception approved by the user
  2026-10-06 for export tables only**: every column must be present so the export needs no merging. check_pbir.py reports it as a
  WIDTH warning; that one is expected. Say "scroll right, or More options > Export data" on the page and guide.

## Access
- Names + ethnicity = HR leadership only: every EEO measure is BLANK unless the viewer can see Executives / RMs (the HRBP RLS
  roles exclude those groups), so HRBP roles see blanks. Verify with DAX impersonation per role.

## Personal data pulls (person-level extracts)
- A person-level extract with names + gender + ethnicity is blocked by Claude Code's auto-mode PII check even after the user
  approves in chat. The user must switch to manual (ask) permission mode; each step is then approved individually. Don't try to
  route around the block.
- Write the workbook to the user's folder, marked **CONFIDENTIAL** (file name + header), and delete person-level intermediates
  (CSV, scratch files) afterwards. Never put the values in replies, tickets or skill files (PII policy, gold-semantic-models.md).

## Model lessons
- **A calculated column used as sortByColumn must not be derived from the column it sorts** (e.g. a calculated `EEO Category Sort`
  = `SWITCH ( 'EEO Snapshot'[EEO Category], ... )` with EEO Category sorted by it): the deploy fails with a circular dependency.
  Compute both the label and its sort key inside the calculated TABLE expression (`ADDCOLUMNS ( _out, "EEO Category Sort", ... )`).
- MAX / MIN on booleans, leaf-only matrices and headless exportData debugging: see the EEO lessons in `pbir-rules.md`.
