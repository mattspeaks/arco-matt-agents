# Power BI QC rules (v2)

Versioned with the repo: adding or changing a rule is a reviewed commit. The house standard is the
`arco-dwh-powerbi` skill (see `SKILL.md` here for how it applies). Judge only what the branch adds or changes:
anything that was already there is **PRE-EXISTING (out of scope)**. List it with its file, but it doesn't fail QC.

## Mechanical rules: the house linter
| ID | Rule | Method |
|---|---|---|
| QC-00 | No **new** house-linter errors | The app runs `arco-dwh-powerbi/scripts/check_pbir.py` on the branch and on its starting point and puts the new findings in your brief. Any new ERROR = FAIL (the app enforces this too). Report new WARNs as findings. Don't re-derive what the linter covers: borders, centering, header icons, display option, BOM, dashes, How To Guide page, Clear/Reset buttons, slicer setup, TMDL validity |

## Rules you judge (the linter can't)
| ID | Rule | Method |
|---|---|---|
| QC-01 | Models read gold; silver / bronze only as an approved temporary source | TMDL partitions and M/SQL expressions: silver or bronze references (`silver`, `bronze`, `brz_`). A new one FAILS, unless your brief lists it as a source Matt approved AND its table carries an `ARCO_TemporarySource` annotation: then PASS with a note. `bronze_confidential` always FAILS. Existing ones are PRE-EXISTING |
| QC-02 | Reports connect only to approved gold / semantic sources | `definition.pbir` connection and model sources |
| QC-03 | Model passes Best Practice Analyzer | **SKIPPED**: Tabular Editor CLI isn't installed |
| QC-04 | Theme and colors follow the house palettes | Report theme vs `arco-dwh-powerbi/assets/theme/ABS_Custom_Theme.json`; table / KPI fills use house RAG; charts use the theme order, or the CIO color-blind palette for CIO / IT reports (`references/color-palettes.md`) |
| QC-05 | Layout follows the brandbook | New or changed visuals: navy header, Arial, title 24pt white, "Created By: ABS Data & Analytics Team", page nav, matching background; scrolling pages put slicers in the top grey bar; content 10 px below the header (`references/brandbook.md`) |
| QC-06 | Text and vocabulary | No em / en dashes; visual text black (white only on navy / charcoal); labels 2-4 words, reasons one line, detail in "?" tooltips; "Family > Division" (never "cohort" / "business unit"); no table / schema names in visible text; no "SO WHAT / NOW WHAT" (`pbir-rules.md`, `feedback-and-actions.md`) |
| QC-07 | Measures have descriptions and display folders | Every new or changed `measure`: a `///` doc comment and a `displayFolder`. Never a `description:` property (Desktop won't open the model) |
| QC-08 | No hard-coded credentials or personal connection strings | `password=`, `pwd=`, personal OneDrive paths, user emails in connection strings; sources run as the viewer (`gold-semantic-models.md` identity) |
| QC-09 | Issues bubble up and name an owner | New flagged items use house badges / RAG, worst first, and say who owns the action (person + role, or team); calculated checks don't override a reported status (`feedback-and-actions.md`) |
| QC-10 | Readable, or it scrolls | New charts and tables are readable at size (labels, legends, no internal scroll for a few rows, charts not under ~200 px); otherwise the page should scroll (`pbir-rules.md` 8a) |
| QC-11 | Zeros, not blanks | New additive measures (counts, sums, dollars) return 0 on rows that belong in the visual, guarded so they add no rows; never on averages, ratios, as-of values, badge / color measures (`pbir-rules.md` "Zeros, not blanks") |
| QC-12 | Help tooltips | New visuals with baked-in logic (hidden filters, thresholds behind colors, derived formulas, as-of rules) have a short "?" tooltip |
| QC-13 | Finance rules | Stories touching WIP, backlog, revenue, GP, billing or financial statements follow `wip-accounting-rules.md`, including the open Gold-bug workarounds in its section 7 |
| QC-14 | No PII added | New model columns don't expose sensitive personal data (remove, don't hide); business free text flagged Sensitive in descriptions (`gold-semantic-models.md` PII) |
| QC-15 | Replace, never layer | When new logic replaces old, no leftover old filters, measures, titles, tooltips or bookmarks remain (`SKILL.md` non-negotiable 20) |
| QC-17 | The model fits the ontology | For model changes: joins only on ARCO_Gold_Ontology's declared relationships (`relationships.tmdl`), grain and keys as its entity descriptions say, every numbered TRAP respected (e.g. AP is owed by AP Company, not the job's company; never sum GL month balances across months; compare padded account codes raw on both sides), nothing it flags sensitive exposed. The ontology path is in your brief |
| QC-16 | Needs a visual check | You can't see the report. List what Matt should check in Desktop: KPI clipping, truncated titles, overlaps, horizontal scroll, empty visuals. This is never a FAIL on its own |
