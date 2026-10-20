---
name: arco-ontology
description: How to read ARCO_Gold_Ontology (the Fabric IQ business ontology over the ARCO gold warehouse) from the app's local read-only copy, and how to use it to resolve names, joins, grain and traps. Use when mapping report or story requirements to gold data, telling name confusion from real data gaps, choosing joins, or proposing gold changes.
---
# ARCO_Gold_Ontology

The authority on how ARCO's gold data fits together: 95 business **entities**, each backed by one gold table, with
**declared relationships** and descriptions written for an LLM: grain and keys, row counts and date ranges, join
match rates, numbered **TRAPS**, and **sensitivity** flags. Domains: Vista financials (AP, AR, GL, job cost, WIP,
budgets), Textura sub pay apps, Procore safety, UKG payroll and time off, Concur expenses, iCIMS / Greenhouse
recruiting, CounselLink legal, ServiceNow IT.

## Where it is
`data/ontology/` in the arco-matt-agents repo: a read-only copy the app fetches from Fabric (getDefinition) and
refreshes daily. Never edit it. The live item is in the ARCO DWH workspace and agents don't change it.

| Path | What's in it |
|---|---|
| `entities/<Entity>.tmdl` | One business entity. Its `///` description says what one row is, the key, counts and traps. `backingTable:` is the gold table. Each `property` has its own `///` description and `valueColumn: <Table>.'<Gold Column>'` |
| `tables/<Table>.tmdl` | The gold table behind an entity: its columns, and in the partition, `schemaName:` (the gold schema) and `entityName:` |
| `relationships.tmdl` | Declared joins: `fromColumn: <Table>.'<Col>'` / `toColumn: <Table>.'<Col>'` |
| `entityRelationships.tmdl` | The same joins with business names (e.g. "AP Line Paid To Vendor") |

**Gold has many schemas**, not just `analytics`: `servicenow_analytics`, `greenhouse_analytics`, `concur_analytics`,
`payroll_analytics`, `counsellink_analytics`, `ukg_analytics`, `mycoi_analytics` and more. Always resolve the full
name the ontology's way: entity → `backingTable` → `tables/<Table>.tmdl` partition `schemaName` →
`gold.<schema>.<Table>`. Never assume `analytics`.

## Recipes (Grep / Read)
- **Which entity holds a concept?** Grep `entities/` descriptions for the business word and its synonyms, e.g.
  `retain|retention`, `vendor|supplier|subcontractor`, `job|project`, `invoice|bill`, `associate|employee|worker`,
  `GL|general ledger|account balance`. Read the matching entity's description in full: it often names the column you
  want and the trap that goes with it.
- **Which gold column is property X?** Its `valueColumn` (e.g. `Fact_AP_Approved.'AP Company'`); the schema comes from
  `tables/Fact_AP_Approved.tmdl`.
- **How do two entities join?** Only on a declared relationship (`relationships.tmdl`). The ontology says: "These are
  the only declared joins; do not join to other entities on shared columns." Read the join-quality note in the
  property description (e.g. "71.7% of project numbers match Dim_Project").
- **What's the grain?** The entity description's first lines ("one row per AP Company + Accounting Month + AP
  Transaction + Line").
- **Traps:** numbered in the descriptions. Read every trap for each entity you use, and follow it. Examples: AP is
  owed by `[AP Company]`, not the job's company (they differ on 21% of rows); never add job-coded AP lines to direct
  cost (same dollars); GL month balances are point-in-time, never summed across months; `Current Due = Invoiced + Tax −
  Retainage`; GL account codes are space-padded, so compare raw values on both sides.
- **Sensitive:** properties flagged sensitive (e.g. AP Notes may hold personal details) are never surfaced in a model,
  report or proposal.

## Name confusion vs real gaps
Before calling anything missing:
1. Search the ontology: entity and property names, then descriptions, then synonyms. Business names differ from table
   names (`APInvoiceLine` = `Fact_AP_Approved`, `ARInvoice` = `Fact_Billing`, `GLMonthBalance` = `Fact_BalanceSheet`).
2. If it isn't there, search the gold catalog (`data/catalog/gold.tsv`). The ontology covers 95 of gold's 266 tables
   and views, so something can be in gold without being in the ontology. Say so when that's the case: there are no
   documented traps for it.
3. Only then is it a real gap. Look in `data/catalog/silver.tsv` and the source-bronze catalogs for where it could
   come from (never `bronze_confidential`).

When you resolve a name, record the evidence: the entity / property, the gold object, and the description line that
convinced you, so a human can approve the mapping.
