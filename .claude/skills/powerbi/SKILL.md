---
name: powerbi
description: How this app's Power BI agents (pbi-builder, pbi-qc) apply ARCO's house playbook (the arco-dwh-powerbi skill) inside the app's story workflow. PBIP structure, which playbook rules apply, and which app rules override it. Load before building or reviewing any ARCO semantic model or report.
---
# ARCO Power BI in this app

The team standard is the **`arco-dwh-powerbi`** skill (ABS Data & Analytics house playbook, vendored unmodified in
`.claude/skills/arco-dwh-powerbi/`; see its `VENDORED.md`). Load it, and read the reference file for the area you're
touching before you act. This file says how it applies when you run as one of the app's agents.

## Read for report and model work
| Touching | Read in `arco-dwh-powerbi/references/` |
|---|---|
| Layout, header, KPI band, backgrounds, pill buttons, page navigator | `brandbook.md` |
| Colors: tables vs charts, CIO color-blind palette, RAG | `color-palettes.md` |
| Issue indicators, badges, text budget, help tooltips | `feedback-and-actions.md` |
| PBIR / TMDL authoring: borders, sizing, headers, display option, encoding, DAX gotchas, zeros not blanks | `pbir-rules.md` |
| How To Guide page | `how-to-guide.md` |
| WIP, backlog, revenue, GP, billing, financial statements (and the open Gold bugs) | `wip-accounting-rules.md` |
| Gold semantic models: identity, descriptions, PII, join keys | `gold-semantic-models.md` |

Assets (theme, backgrounds, icons, visual templates) are in `arco-dwh-powerbi/assets/`. The house theme is
`assets/theme/ABS_Custom_Theme.json`.

## Where the app's rules override the playbook
The playbook was written for a person working interactively. As an app agent, these rules win:

| The playbook says | As an app agent |
|---|---|
| Live PBIPs in `C:\SNOW Logic\`; build with generators in `<Project>\build\` | Work only in the PowerBI repo worktree and folders your brief names. Edit the PBIP in place (Edit/Write); don't create generator projects unless the brief asks |
| `publish_dev.py`, `deploy_model.py`, publishing, `push_ontology.py`, scheduled refresh setup | Never. The app publishes after Matt approves the Publish card |
| Open / reload Power BI Desktop, `collapse_panes.ps1`, screenshots, `reset_test.mjs`, `reconcile.py` | Not available to you. Matt reviews in Desktop from the Review card; say in your result what needs a visual check |
| Query the DWH (`fabric_query.py`, `gold_checks.py`) to verify numbers | Not available to you. Don't state numbers you haven't verified; list what needs verifying |
| Ask the user, or "MGR", before doing X | You can't ask mid-run: stop at that point and say what you need in your result |
| Work items, emails, ontology, stats/ML | Out of scope for these agents |
| `check_pbir.py --fix-bom` | Builder: allowed on your own report. QC: read-only, never |

Everything else in the playbook applies: brandbook, palettes, borders, centering, headers, display option, no em
dashes, vocabulary, How To Guide, zeros not blanks, viewer identity, PII, "replace, never layer", "refresh = light
touch" (patch the pages users have; ask before a redesign).

## Scope: the branch, not the backlog
Existing reports often break house rules already. Fix what the story asks for, and make sure what you **add or
change** follows the rules. Pre-existing problems are out of scope unless the plan says otherwise: list them, don't fix
them (see the lessons files). The app's house linter (`check_pbir.py`) runs on the branch and on its starting point,
and only **new** errors count.

## Repo specifics
- PBIP: `<Name>.SemanticModel/definition/` (TMDL) and `<Name>.Report/` (PBIR `definition/` or PBIR-Legacy
  `report.json`; keep whichever the report uses). Never edit `.pbix`.
- TMDL descriptions are `///` doc comments above the object, never a `description:` property.
- Associate job titles: `gold.ukg_analytics.Dim_Associate` (`[Job Description]`, keyed by `[Email Address]`).

See `qc-rules.md` for what pbi-qc checks.
