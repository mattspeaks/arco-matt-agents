---
name: medallion
description: ARCO medallion architecture — bronze/silver/gold definitions and which consumers may read each layer. Load before any model, report or DWH change.
---
# ARCO medallion layers

| Layer | Contents | Who may read it |
|---|---|---|
| Bronze | Raw ingested source data, as landed | Pipelines into silver. Reports and semantic models: **only** a Matt-approved temporary source (below) |
| Silver | Cleaned, conformed, deduplicated | Pipelines into gold; DWH QC. Reports and semantic models: **only** a Matt-approved temporary source (below) |
| Gold | Business-ready star schemas (`Fact_*`, `Dim_*`), e.g. `gold.analytics` | Semantic models and reports |

## Temporary sources for data gaps
When a report needs data that isn't in gold, the report model builder may propose silver (first) or source-bronze
tables. They're used only if Matt approves those exact sources on the report's Proceed-or-pause card. Each table that
reads one carries `annotation ARCO_TemporarySource = "<source> approved by Matt <date> for <story>; repoint to gold
when the data-gaps story is done"`, and the data-gaps story gets the data into gold. `bronze_confidential` is never a
source.

TODO (ARCHITECTURE.md §11.7): Fabric Warehouse vs Lakehouse SQL endpoint per layer, and naming standards per layer.
