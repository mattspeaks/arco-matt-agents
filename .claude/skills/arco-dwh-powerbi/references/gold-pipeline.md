# Gold load pipeline: how it works, health checks, schema drift, surrogate keys

## How gold is loaded

- **Pipelines:** `S2G_Full_Daily_PL` / `Gold_UAT_Daily_PL` (ForEach_Table), daily around 07:40-09:55 UTC.
- **Discovery:** every table in the domain schemas (analytics, concur, counsellink, mycoi, ukg, payroll, paystub, servicenow `_analytics`) comes from the view `gold.config_pipeline.gold_objects`. Load order follows `sys.foreign_keys`. `arco_meta_dw.config.gold_objects` is an OLD config; don't edit it.
- **Source:** each table loads from `gold.materialized_etl.<table>_vw` by **TRUNCATE + INSERT**.
  - A new column must be added to the gold table (`ALTER TABLE ... ADD`, nullable, last) **and** the view in the same deploy window.
  - A `_base_vw` alongside is ignored, so a thin keyed wrapper view is safe.
- **Log:** `gold.dbo.pipeline_execution_log` (run_id `yyyymmdd`, step, table, status, rows, error).
  - **Status values are UPPER CASE** (`SUCCESS` / `FAILED`) and the collation is case-sensitive.
  - A crash often logs no FAILED row; the missing table is the clue.
- **Old log:** `arco_meta_dw.utilities.silver_to_gold_log` belongs to the old notebook `S2G_Meta_Config_Dim_Fact_Full_Daily_NB` and has nothing since Oct 2026.

## When a run fails: `python scripts/pipeline_health.py`

It reports:
- the latest vs previous run (tables, failures);
- **tables missing from the latest run** (usually the failed ForEach item);
- the last logged step;
- **every source view opened with `SELECT TOP 0 *`.**

A view error like "Invalid column name 'x'" is **silver schema drift**: a source column was dropped or renamed upstream (e.g. a CounselLink custom field). The gold table keeps yesterday's rows until fixed.

**Fix options:**
- **Renamed field:** point the view at the new name. Confirm with the source system owner.
- **Removed field:** replace it with `CAST(NULL AS varchar(8000)) AS [<same name>]`, so the gold table and models don't change shape.

Production view changes need the user's go-ahead. Run `--views` alone as a quick drift check before releases.

## Surrogate keys (rules for any new or changed gold table)

- **Every fact and dimension gets one stable, deterministic single-column key.** The ontology needs it, apps store it, and incremental loads and dedupe checks depend on it.
- **Never** use ROW_NUMBER(), NEWID() or IDENTITY: they renumber on every truncate-reload. Fact_Task_Time_Worked and Fact_Time_Entry still do this until ADO 5981 lands.
- **Build keys from the source system's own key** whenever the view drops it. Verified examples:

  | Table | Source key |
  |---|---|
  | Direct Cost | `bJCCD (JCCo, Mth, CostTrans)` |
  | AP Transaction Detail | `bAPTD (APCo, Mth, APTrans, APLine, APSeq)` |
  | Billing | `ARTrans` plus the receipt grouping |
  | Concur allocations | `allocation_key` |
  | ServiceNow task time | `sys_id` |
  | ProjectPhase | `bJCJP (JCCo, Job, PhaseGroup, Phase)` |

- **Format:** readable keys are `CONCAT(a,'|',b,...)`, with dates as `CONVERT(char(8), d, 112)` and NULLs as `ISNULL(x,'~')`. Don't use CONCAT_WS (it skips NULLs). For long grains, use `CONVERT(char(64), HASHBYTES('SHA2_256', CONCAT(...)), 2)`.
- **Before deduping, check the view isn't dropping a key column.** The 22,914 "duplicate" Concur allocations were distinct allocations with `allocation_key` left out. Prove it: `gold_checks.py grain <table> "<cols>"` reports key duplicates vs exact duplicate rows.
- **Validate after the first load:** 0 duplicate keys, 0 null keys, row counts unchanged.
- **Declaring keys (optional):** `PRIMARY KEY NONCLUSTERED (...) NOT ENFORCED`. It needs a NOT NULL column, so do it in a rebuild pass.
