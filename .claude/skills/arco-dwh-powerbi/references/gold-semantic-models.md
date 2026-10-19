# Gold semantic models: catalog, deploy, describe, gotchas

Load `powerbi-authoring:semantic-model-authoring` too for generic TMDL/DAX rules. This file holds the ARCO-specific rules.

## Catalog (ARCO DWH workspace `7edf4894-85d9-4c6f-a06d-300bbaa66edb`, folder **Endorsed Semantic Models**)

13 models, all DirectQuery to `gold`:
- Shared Dimensions, Financials, Job Cost, Safety, Textura, Expenses, Legal, HR, Payroll, Master Client Prospect List, Time Off, IT Operations (renamed from ServiceNow Time 2026-10-08, then from IT Time Tracking 2026-10-11 by the user in the Fabric UI; same model id 0e2e8dc8-224a-4bbc-8702-702ce19a5c8b; 2026-10-11 expanded to 27 tables: service desk incidents / requested items / catalog tasks, satisfaction surveys, IT project portfolio; fact-to-fact links INACTIVE by design (active ones create ambiguous paths); ticket dates are Central via native query; UKG Employee ID + work-log Comments removed; the other 12 models' shared-dimension descriptions still list 'IT Time Tracking': fix at each model's next deploy), Talent Acquisition (Greenhouse data, created 2026-10-08; restricted to the greenhouse gold reader role).
- **Naming (user rule 2026-10-08):** name models and domains by business area ("Gold Talent Acquisition"), never by source system or with "(System)" appended.
- **Gold Shared Dimensions** owns Dim_Project, Dim_Company, Dim_Vendor, Dim_Date, Dim_Department and Dim_Associate_Public. The other models pull them through `expression 'DirectQuery to AS - Gold Shared Dimensions'` (entity partitions with `sourceLineageTag`). Those relationships are **limited** (cross source group).
- **New models** go into the Endorsed Semantic Models folder (`POST items/{id}/move` with `targetFolderId f45337e2-147f-4f1e-8618-9fff02972fa1`). The create API lands them at the workspace root.

## Identity: viewer SSO only (never a stored credential)

- **gold SQL source:** `connectivityType: Automatic`. It runs as the viewer, so viewers need schema access: `gold_analytics_reader`, or the ukg/payroll readers for HR, Payroll and Time Off.
- **Shared Dims link:** an AnalysisServices connection with `credentialType SingleSignOn` and `singleSignOnType MicrosoftEntraID`.
- **Never** bind to stored-OAuth connections (e.g. `fabric-gold`).
- `scripts/deploy_model.py` asserts both before and after every deploy.

## Deploy (always `scripts/deploy_model.py`)

1. **Pull:** `fab.get_definition(model_id, folder)` the live definition into a working folder. Never edit a stale local copy.
2. **Edit:** write TMDL with Python, keeping each file's existing line endings (some Legal tables are CRLF). Never use PowerShell Set-Content (it adds a BOM).
3. **Check:** `python scripts/deploy_model.py <folder> --lint-only`.
4. **Deploy:** `python scripts/deploy_model.py <folder> [--check "EVALUATE ROW(...)"]`. It backs up, records before/after row counts of every owned table, deploys atomically (a rejected import changes nothing) and re-checks identity.
   - Add a `--check` for every number the change should move or keep (totals, matched counts).
5. **Verify:** compare the new numbers with SQL (`scripts/gold_checks.py`) before calling it done.
6. **Approval:** these models are shared. Deploy only with the user's explicit go-ahead in the current turn, and never retry a blocked deploy another way.

**Order:** when removing or renaming a shared column, deploy every downstream model first and Gold Shared Dimensions last.

## Gotchas that failed real deploys

- **Measure names are unique across the WHOLE model,** not per table. Prefix per table, e.g. `ACC Latest Snapshot Revised Budget`.
- **No `///` above a `relationship`:** "Property 'description' is unknown". Put relationship notes on the key columns.
- **A relationship's columns must exist in the model:** facts often omit source columns (e.g. `[PayPeriod Number]`, `[Paystub Number]`). Add them hidden.
- **Blank keys across limited relationships:** a BLANK FK matches every dim row with a blank key. Use a sentinel, e.g. `IF(ISBLANK(x), -1, INT(x))`.
- **Timestamps vs Dim_Date:** a datetime column joined to `Dim_Date[date_value]` matches almost nothing (Safety showed 9 of 4,539 incidents). Add a hidden `DATE(YEAR(x), MONTH(x), DAY(x))` calc column and relate that.
- **DirectQuery calc columns:** INT, TRIM, MID, IF, ISBLANK, DATE/YEAR/MONTH/DAY and COMBINEVALUES all work. COMBINEVALUES keys need identical formatting on both sides.
- **Many-to-many:** use it when a dim key isn't unique (`fromCardinality: many`, `toCardinality: many`, single direction). First check the view isn't dropping a source key column.
- **Two active filter paths to one table are rejected,** e.g. Company -> GL Account -> P&L plus Company -> P&L. Make one inactive.
- **Native query on a fact** works in DirectQuery: `Value.NativeQuery(Source, "SELECT f.*, ...", null, [EnableFolding = true])`. Verify the row count is unchanged.

## Verified keys (don't re-derive)

- **Vista payroll person:** `CAST(ukg Dim_Associate[Company Code] AS int)` + `[Viewpoint Employee ID]` (unique). Never the ID alone (it repeats in up to 7 companies and fans out), and never `[GL Company Code]` (26% match).
- **Pay period:** `Fact_Payroll_Earnings[PayPeriod Number]` joins `Dim_PayPeriod[Pay Period Key]`, not `[PayPeriod Number]`.
- **Safety:** the "Project Number" / "Vendor Number" columns hold **Procore IDs**. Join them to `[Procore ID]` / `[Procore Vendor ID]`.
- **Textura:** `[Vendor ID]` = Vista vendor in group 1, so join on `Vendor ID & "-1"` (15,612 of 15,613). The General Construction contract (blank Vendor ID) rolls up the subs: filter `Vendor ID <> ""`.
- **myCOI:** join on Project + `[Contract Unique Id]` (the Vista SL) to Dim_ProjectVendor (99.9%), never the `VP` digits (they match vendors with the wrong names).
- **MCPL:** `[Viewpoint Company ID] & "-1"` = Dim_Customer (856 of 857). The source is ARCO Hub, not Salesforce.
- **Paystub detail codes:** `[Payroll Company] & "-" & INT(TRIM([Code]))` (Code is space-padded text).
- **Job cost -> project / phase (re-keyed 2026-10-09, bug 6010, Director approved, Gold Financials deployed):** `Fact_Direct_Cost[Ops Project Number]` -> `Dim_Project[Project Number]` (BLANK for overhead, bonus and allocation job cost, which stays in totals; 16,692,710 filled, 10,066,730 of 19,237,237 rows match Dim_Project, $35.36B). Never attribute cost on the raw `[Project Number]` (23100 First Park: $259.6M raw vs $0 Ops). `Fact_Direct_Cost[ProjectPhase Number]` -> `Dim_ProjectPhase[ProjectPhase Number]` (PK '<Project>-<Company>-<Phase>-<Phase Group>', e.g. 'M1146-76-11-8000--11', unique on 16,645,612 rows; 100% match) many-to-one, single direction. The old many-to-many on the COMBINEVALUES 'Project Phase Key' calc columns is gone (it also missed rows whose fact [Phase Number] carries padded spaces, e.g. M1146 $7,358). Only Fact_Direct_Cost carries these columns; it is only in Gold Financials.
- **Dim_Date:** `date_value` is the relationship key; `date_key` is yyyymmdd and matches ServiceNow and time-off date keys.
- **ServiceNow people:** Dim_Associate_Public has no Employee ID, so join on `[ServiceNow Sys Id]`.
- **Procore vendor -> Vista vendor (2026-10-08):** `Dim_Vendor[Procore Vendor ID]` only covers Procore vendors with `synced_to_erp`
  (silver.procore.vendors, company 39265). Add unsynced ones via `origin_code` 'V#####' -> '#####-1', then a cleaned-name match (strip
  ' - City, ST', punctuation; unique Vista name only). Coverage of sub activity goes ~80% -> 95-98%. Procore manpower / observation
  `[Project Number]` holds the Procore project id: join `Dim_Project[Procore ID]`. SQL: `Subcontractor 360uild\sql\procore_vendor_xwalk.sql`.

## PII policy

- **Remove (not hide) from models.** Hidden columns are still readable by DAX, MCP and agents. Removed so far:
  - vendor bank account, routing number and tax IDs;
  - Textura organization tax ID;
  - AP invoice notes;
  - paystub home address, W4 and filing fields, SSN last 4 and pay rate;
  - Procore project-user phones and addresses;
  - Time Off associate birth day, gender and home location.
- **Person-level extracts** (names + gender / ethnicity): need manual permission mode, CONFIDENTIAL workbook, intermediates deleted (2026-10-06; `eeo.md`).
- **Keep business free text** (expense purpose, comments, matter and injury narratives), but flag it Sensitive in the description.
- **To remove a column:** delete the column block (and its `///`) from every model copy, confirm no relationship or measure uses it, and log the gold-side fix in an ETL ticket.

## Descriptions (every table, column and measure)

**Format:** `///` lines directly above `table` / `column` / `measure`. The model overview goes at the top of the hub table's description.

**Each table covers:**
- purpose;
- grain ("one row per ...");
- source system;
- keys and joins, with **verified** match rates;
- additive vs point-in-time;
- `TRAPS:` (numbered).

**Each column:** one sentence. Key columns give format + example + uniqueness + join target. Flag mostly-null, derived, duplicate and Sensitive columns.

**Style:**
- No em/en dashes. "Family" not "cohort", "IT support" not "fulfiller", owners are teams.
- Never reproduce sensitive values; describe them generically with counts only.
- **Copy shared-table descriptions into every downstream model copy.** Downstream copies don't inherit them, and an MCP connected to Gold Safety only sees Safety's copy.

**Drafting at scale:** run one background subagent per model, all at once. Give each:
- its owned tables and the verified facts above;
- the approved review docs as the style reference;
- read-only SQL;
- these outputs: (1) an edited copy of the definition, (2) a review doc (overview; per table description, TRAPS and a Column | Flag | Description table; then facts verified, corrections, data-quality and security findings, open questions), (3) a validation script.

The validation script must prove:
- every owned object is described;
- the files are byte-identical once `///` lines are stripped;
- there's no `///` above a relationship;
- shared tables are unchanged;
- there are no dashes.

Merge all decisions into one question round with recommendations, then deploy.
