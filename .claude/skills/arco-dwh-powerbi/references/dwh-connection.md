# ARCO DWH connections (Fabric SQL, Fabric REST, semantic models, ADO)

Never ask the user how to connect. These patterns are established; only ask if they actually fail.

## Fabric SQL (gold / silver / gold_uat / bronze)
- Server (SQL analytics endpoint, same for every database):
  `jpea7wyaqnne3hiyaakbzbit4i-sren67wzqvxuzidngaf3vjto3m.datawarehouse.fabric.microsoft.com`
- Databases: `gold`, `silver`, `gold_uat`, plus bronze/confidential catalogs (e.g. `bronze_confidential`, `Bronze_Viewpoint`).
  Three-part names in the data dictionary are `catalog.schema.table`: `gold.analytics.Dim_Associate` = DATABASE gold, query `analytics.Dim_Associate`.
- Auth: the user's own `az login` identity (db_owner on gold). Token resource `https://database.windows.net`, packed into
  `SQL_COPT_SS_ACCESS_TOKEN` (1256) for pyodbc + `ODBC Driver 18 for SQL Server`.
- **Use `scripts/fabric_query.py`** (gets the token in-process, runs GO batches, JSON or `--csv` output):
  ```
  python "%USERPROFILE%\.claude\skills\arco-dwh-powerbi\scripts\fabric_query.py" --db gold "SELECT TOP 10 * FROM analytics.Dim_Company"
  ```
- **SQL1 is validation only (user rule 2026-10-02)**: the Viewpoint SQL server `arco-sql-instance-1.public.791ac7a1f50a.database.windows.net,3342`
  ("SQL1", needs VPN) may be queried to validate numbers but is NEVER a data source for a report or semantic model. Reports read
  Fabric only (gold, then silver / bronze). Check partition sources on every report you touch and move SQL1 queries to Fabric.
- Gotchas:
  - If you must write a token file from PowerShell, `>` adds a BOM and breaks auth; use `Out-File -Encoding ascii -NoNewline`.
  - Collation is case-sensitive (`Latin1_General_100_BIN2_UTF8`): string keys (emails, codes) must match exactly; prefer ID keys.
  - Bronze Viewpoint pads `Contract`/`Job` with leading spaces: `TRIM` both sides when joining.
  - Gold tables are TRUNCATE + INSERT from views in `gold_uat.materialized_etl.*_vw`; `queryinsights.exec_requests_history` shows what really ran.
  - Silver strips pay rates; salary history is in `bronze_ukg.employee_job_history_details`.
  - "Failed to complete the command because the underlying location does not exist ... part-xxxx.snappy.parquet" = a bronze
    table is mid-reload (seen on bronze_servicenow time_card / fm_expense_line / dmn_decision). Not a permissions or SQL problem:
    retry in a background loop (refresh the token each try) or wait; Desktop refreshes fail the same way during the window.
  - Native SQL in Power Query (`Value.NativeQuery`, `EnableFolding=false`): avoid CTEs (`WITH`) when the SQL might be wrapped
    as a subquery; use derived tables / CROSS APPLY. STRING_SPLIT and STRING_AGG work on the endpoint.
  - ServiceNow (bronze_servicenow): time cards post to `fm_expense_line` (time_card key, $110/hr) only when every approver on
    `approver_list` is in `approved_by`; since 2026-06 project cards need PM + org manager. Exclude the "ABS ... Operations"
    pm_project ticket buckets from project reporting. Details: `PMO Projects\SNOW_timecard_expense_gap_findings.md`.
  - ServiceNow `risk` has TWO status fields: workflow `state` (pending / mitigate / achieved / avoid ...) and `risk_state`
    (-5 new, 1 Open, 2 Mitigated, 3 Closed, 4 Accepted; the UI "Status"). PMs close risks via `risk_state` while `state` stays
    "mitigate", so a risk is open only when risk_state NOT IN (2,3,4) AND state NOT IN (achieved, closed, accepted, cancelled, avoid).
    Using `state` alone shows closed risks as open (PMO Vista Server Migration went Red on 4 closed risks, 2026-10-02).
  - Viewpoint `PREmp` / Viewpoint Employee ID alone is NOT unique: join on company code + employee number. UKG <-> Vista person bridge: `silver.viewpoint.bPREH.udUltiproEmpID = Dim_Associate.[Employee ID]`.
- Legacy examples on disk: `C:\SNOW Logic\query.py`, `run_script.py` (GO batches), `exec_ddl.py`.
- Alternatives seen: `Authentication=ActiveDirectoryInteractive` (browser prompt), service principal (`ActiveDirectoryServicePrincipal`).

## Fabric REST (items, TMDL definitions)
- Token resource `https://api.fabric.microsoft.com`. Python here has no `requests`; use `urllib`.
- ARCO DWH workspace id `7edf4894-85d9-4c6f-a06d-300bbaa66edb`. Endorsed models = the 10 "Gold *" models:
  Gold Shared Dimensions, Gold Financials, Gold Job Cost, Gold Safety, Gold Legal, Gold HR, Gold Textura, Gold Expenses,
  Gold Master Client Prospect List, Gold Payroll. (Endorsement is not visible to the API; don't try.)
- TMDL: `POST /v1/workspaces/{ws}/semanticModels/{id}/getDefinition?format=TMDL` body `{}` -> 202 + Location; poll until
  `Succeeded`, `GET {Location}/result`, base64-decode each part to its `path`.
- Local copies: `Claude DWH Directory\Semantic Models\<Model>\`. Glean copy (only `.tmdl`): `X:\ABS\Technology\Data and Analytics\Data Warehouse\Operations\Gold TMDL\<Model>\` (X: = Egnyte drive; plain file copy uploads).

## Semantic models / Power BI Desktop
- Use the `powerbi-modeling-mcp` tools (connect to Desktop, Fabric workspace, or local PBIP/TMDL). XMLA DAX against an
  endorsed model is a valid import source (Owner Billing pattern: pre-aggregate, 10-35 ms queries vs 5-20 s DirectQuery).
- `analytics.Dim_Associate_Public` (gold_analytics_reader) is the HR-safe associate dim; `ukg_analytics.Dim_Associate`
  needs `gold_ukg_analytics_reader` (2 members) so don't use it in broadly shared models. Relationships into Shared
  Dimensions are limited relationships: a BLANK FK matches every BLANK key; check new associate links for NULL FKs.
- MCP single-table refresh often silently no-ops: use a model-level Full refresh.
- Vista nightly load rewrites bPREA ~12:04-12:07 AM CT, so never refresh in that window.
- **Scheduled refresh standard (user rule 2026-10-04): every published semantic model refreshes daily at 6:00 AM Central, with refresh-failure emails to ABSDataAnalytics@arco1.com.** Set the schedule by API right after publishing:
  `PATCH https://api.powerbi.com/v1.0/myorg/groups/{ws}/datasets/{id}/refreshSchedule` body
  `{"value":{"enabled":true,"days":["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],"times":["06:00"],"localTimeZoneId":"Central Standard Time","notifyOption":"MailOnFailure"}}` (resource `https://analysis.windows.net/powerbi/api`). The API can only mail the model owner; add **ABSDataAnalytics@arco1.com** under model Settings > Refresh > "Send refresh failure notifications to: these contacts" in the service (no public API for it), and tell the user if that step is still open. A model created through the API also needs its data sources bound to the shareable cloud connections (silver = DWH-Silver, gold = fabric-gold, bronze_ukg = bronze-ukg, bronze_confidential = arco-dwh-confidential) via `bindConnection` before the first refresh (see the semantic-model-authoring connection-binding reference).
- **After every publish, check the model's data source bindings** (user 2026-10-04: HR Analytics and ANH CEO Dashboard failed with
  `Premium_ASWL_Error` "uses a default data connection without explicit connection credentials"). Any NEW Fabric database in a model
  (e.g. adding `bronze_confidential`) or a first publish to a new workspace leaves that source unbound (`gatewayId` null in
  `GET /groups/{ws}/datasets/{id}/datasources`), and the scheduled refresh fails. Fix with Power BI REST (az token, resource
  `https://analysis.windows.net/powerbi/api`): `POST /groups/{ws}/datasets/{id}/Default.BindToGateway`
  `{"gatewayObjectId": "e467fe0f-d882-4879-9296-e94ca66629ea", "datasourceObjectIds": [<one per source, ALL of them>]}`, then
  `POST .../refreshes`. Shareable cloud connections on that gateway id (endpoint jpea7wy...sren67...):
  gold `e7fa4726-7034-4496-846b-e5b92637867b` (fabric-gold), silver `9d5f45a6-7e52-441e-9392-986cefec65b5` (DWH-Silver),
  bronze_ukg `c8256d81-66a0-4490-b641-442ad703855a`, bronze_confidential `b311ad6b-7030-4622-8564-249ade26235e`,
  bronze_servicenow `9cbf5eae-a04a-4035-958f-72f1d255e004`, bronze_viewpoint `f03c7f3e-d1d4-47a5-aaf7-1c856c674d40`,
  bronze_procore `1f84f1e5-279b-4320-9bdc-c457aec7325e`, bronze_concur `e4d3c313-42d3-4880-b668-da253a3fb7ca`.
  Full list: `GET https://api.fabric.microsoft.com/v1/connections`. A database with no connection yet needs one created first (ask).

## How to query Fabric (MCP tools; tested 2026-10-11)
All of these run as the signed-in user (az token via `headersHelper`), so viewer SSO and Gold reader roles apply.

| Question | Use | Notes |
|---|---|---|
| Single-domain data question ("how many / top N / total") | FabricIQ `GetSemanticModelSchema` then `ExecuteQuery` (DAX) | 1-3 s; matched SQL to the cent. Schema overview carries our table descriptions + TRAPS; drill in with JMESPath on `schema.Tables` (top keys `schema`, `semanticModel`). Max 4 DAX queries per call, 250 rows default. |
| Cross-domain or plain-words business question (jobs + subs + safety + people) | `arco-gold-ontology` `ask_ontology` (project `.mcp.json` in the DWH folder; ontology item `063432d2-ccff-48d4-b6f6-6243f60f9dd2` in ARCO DWH) | Accurate (matched SQL) but ~55 s per question. Can also return validated DAX / SQL / KQL. |
| Ontology structure | `list_ontology_entities` with `entityName` | Unfiltered = ~1 MB (85 entities); one entity ~20 KB. `list_ontology_rules` is empty (no rules defined). |
| Find a model / report | FabricIQ `DiscoverArtifacts` (`ResolveFabricItem` for a GUID) | Discover descriptions are short Copilot summaries, not our model descriptions. |
| Look up a name or value | Import models: FabricIQ `ValueSearch`. **Gold (DirectQuery) models: DAX `CONTAINSSTRING` filter or SQL** | ValueSearch returns `Results: null` on DirectQuery Gold models (no index). |
| What a published report shows | FabricIQ `GetReportMetadata` | Pages, visuals, fields, filters. |
| Exact model definitions | `scripts/fab.py` getDefinition (TMDL) | Schema tool is a summary. |
| Authoring / deploy | local `powerbi-modeling-mcp` (powerbi-authoring) for Desktop; `scripts/deploy_model.py` for shared Gold models | Remote authoring MCP = 403 in the ARCO tenant. |
| Validation / reconciliation, T-SQL | `scripts/fabric_query.py` (or fabric-sqlendpoint `execute_query`) | Source of truth for "verify, then claim". |

- FabricIQ cannot query the ontology: `ResolveFabricItem` identifies it as an Ontology but FabricIQ exposes no AskOntology tool.
- Last closed WIP month: never use a plain MAX of `Fact_Project_Financial[Financial Month]`; 12 rows are dated after Oct 2026 (to Aug 2027).
- Connection setup (applied 2026-10-11): `MCP_TIMEOUT=30000` in `~/.claude/settings.json` env; fabric-skills `.mcp.json` carries
  the az `headersHelper`; the remote `powerbi-modeling-mcp` is removed from the plugin's `plugin.json`. Re-apply the two plugin
  patches after every fabric-skills update. Details and verify steps: SKILL.md MCP note.

## Azure DevOps (stories, tasks, bugs)
- Org `https://dev.azure.com/ArcoBusinessServices`, project and area path `Data and Analytics`, iterations `Data and Analytics\Sprint N` (Sprint 36 = 2026-09-28 to 2026-10-09).
- Invoke the CLI through its bundled Python:
  `subprocess.run([r"C:\Program Files\Microsoft SDKs\Azure\CLI2\python.exe", "-IBm", "azure.cli", "boards", "work-item", "create", ...])`
- Query with `boards query --wiql "..."` (returns `System.AssignedTo.uniqueName`). Example: `C:\SNOW Logic\create_ado_items.py`.
- Emails are first-initial + last-name @arco1.com (e.g. Jesus DeLintt -> jdelintt@arco1.com).
- Gold data bugs go in ADO tickets (drafted as `*_Ticket.md` in the Claude DWH Directory), never in report text.

- **Workspace apps do NOT update on republish** (user 2026-10-05): users who open a report through the workspace app keep seeing the
  last app snapshot, now running on the NEW model (old visuals + new measures = wrong numbers, e.g. a per-code column showing the
  same total on every row). There is no public API to publish / update an app, so after every republish tell the user to click
  **Update app** in each workspace that has one (GET /v1.0/myorg/apps lists them), and add any new report to the app audience.
