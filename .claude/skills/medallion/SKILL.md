---
name: medallion
description: ARCO medallion architecture — bronze/silver/gold definitions and which consumers may read each layer. Load before any model, report or DWH change.
---
# ARCO medallion layers

| Layer | Contents | Who may read it |
|---|---|---|
| Bronze | Raw ingested source data, as landed | Pipelines into silver only. **Never** reports or semantic models |
| Silver | Cleaned, conformed, deduplicated | Pipelines into gold; DWH QC |
| Gold | Business-ready star schemas (`Fact_*`, `Dim_*`), e.g. `gold.ukg_analytics` | Semantic models and reports |

TODO (ARCHITECTURE.md §11.7): Fabric Warehouse vs Lakehouse SQL endpoint per layer, and naming standards per layer.
