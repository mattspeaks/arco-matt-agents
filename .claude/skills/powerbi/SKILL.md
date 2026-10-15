---
name: powerbi
description: ARCO Power BI standards for PBIP projects — folder structure, TMDL/PBIR conventions, naming, DAX style. Load before building or reviewing any ARCO semantic model or report.
---
# ARCO Power BI standards (skeleton — fill in with Matt)

## PBIP structure
- `<Name>.SemanticModel/definition/` holds the TMDL: `model.tmdl`, `tables/*.tmdl`, `relationships.tmdl`, `expressions.tmdl`
- `<Name>.Report/definition/` holds the PBIR: `report.json`, `pages/<page>/page.json`, `pages/<page>/visuals/<visual>/visual.json`
- Never edit `.pbix` files. Agents work only in PBIP.

## Modeling standards
- Star schema: facts `Fact_*`, dimensions `Dim_*` (matches gold naming)
- Explicit measures only. Hide the numeric columns the measures aggregate.
- Every measure has a `description` and a `displayFolder`
- Associate job titles come from `gold.ukg_analytics.Dim_Associate` (`[Job Description]`, keyed by `[Email Address]`)

## DAX conventions
- TODO: Matt to confirm (variables with `VAR`, `DIVIDE` over `/`, format strings on every measure, …)

## Naming rules (used by QC-06)
- TODO: Matt to confirm the regexes for tables, columns and measures

See `qc-rules.md` for the rule set that pbi-qc enforces.
