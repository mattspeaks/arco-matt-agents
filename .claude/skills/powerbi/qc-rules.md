# Power BI QC rules (v1)

Versioned with the repo: adding or changing a rule is a reviewed commit.

| ID | Rule | Method |
|---|---|---|
| QC-01 | No partition or query reads from **bronze** | Scan TMDL partitions and M/SQL expressions (`expressions.tmdl`, `tables/*.tmdl` `partition` blocks) for bronze lakehouse, schema or table references (e.g. `bronze`, `brz_`) |
| QC-02 | Reports connect only to approved gold/semantic sources | Check `definition.pbir` / connection target in the report definition |
| QC-03 | Model passes Best Practice Analyzer | Tabular Editor CLI with ARCO's BPA rules file. **SKIPPED until Tabular Editor CLI is installed** |
| QC-04 | Theme matches the ARCO style guide | Diff report theme JSON (`StaticResources/`) against `../style-guide/arco-theme.json` |
| QC-05 | Visual titles, fonts and page size follow the style guide | Inspect PBIR `page.json` and `visual.json` |
| QC-06 | Naming conventions (tables, measures, columns) | Regex rules from `SKILL.md` |
| QC-07 | Measures have descriptions and display folders | TMDL scan: every `measure` has `description` (`///` doc comment) and `displayFolder` |
| QC-08 | No hard-coded credentials or personal connection strings | Pattern scan for `password=`, `pwd=`, personal OneDrive paths, user emails in connection strings |
