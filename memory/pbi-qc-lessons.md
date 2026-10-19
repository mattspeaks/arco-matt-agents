# pbi-qc lessons

Approved lessons only (added through the app's approval flow). Keep under ~150 lines; promote stable lessons into a skill.

### L-PBI-001 · 2026-10-19 · source: STRY0024370
**Rule:** QC-01 (bronze) is judged against the diff from the Fabric pull commit. If the branch adds or changes a bronze reference, that's a FAIL. A bronze source that was already in model files the branch doesn't touch is reported as "PRE-EXISTING (out of scope)" with file and table, and doesn't fail QC. On report-only stories, the builder must not edit the semantic model to remove pre-existing bronze sources. Leave them alone and mention them in the result.
**Why:** AP and AR Reconciliation to GL already reads bronze (Fact_APARtoGL, Projects). A report-only story (adding a disclaimer textbox) shouldn't fail QC or trigger an unasked-for model rewire because of tech debt it didn't create. Repointing to gold belongs in its own story.
**Applies to:** pbi-qc, pbi-builder
