> **RETIRED 2026-10-09: the D&A team now plans in ServiceNow Agile.** Create stories, defects and tasks with the `da-sprint-planning` skill.
> ADO stays read-only history; migrated items carry `Custom.SNOWWorkItem` / `Custom.SNOWWorkItemURL` links to their SNOW records.
> Still valid below: the *content* rules (verified numbers, attach files instead of paths, findings vs fix split for bugs = SNOW Description vs Implementation Plan). Not valid: ADO sprint/title rules (SNOW titles are verb + business object, no "DWH:").

# Azure DevOps work items (stories, tasks, tickets)

- **Org:** `https://dev.azure.com/ArcoBusinessServices`. **Project and area:** `Data and Analytics`. **Iterations:** `Data and Analytics\Sprint N`.
- **Auth:** the signed-in Azure CLI identity. Use the CLI's bundled Python (`"C:\Program Files\Microsoft SDKs\Azure\CLI2\python.exe" -IBm azure.cli boards ...`). REST calls use a token for resource `499b84ac-1321-427f-aa17-267ca6975798`.

## Create: `python scripts/ado_item.py spec.json` (`--dry-run` first)

The spec has: title, description_html, sprint (`"Sprint 36"` or `"current"`), assigned_to, priority, value_area, attachments and tasks. The script:
- creates the story and tasks, links each task to the story, and puts them in the sprint;
- uploads each attachment and attaches it to the story **and** every task;
- refuses descriptions that contain OneDrive or local paths, or em/en dashes.

## House rules

- **Title prefix** `DWH: ` for warehouse and model work, e.g. "DWH: Gold Ontology Surrogate Keys".
- **Attach supporting files** (T-SQL, spec MD, handoff) and refer to "the attached <file>". **Never link OneDrive or local paths**: teammates can't open them.
- **Story body:** a short description, **findings with verified numbers** (from `gold_checks.py`, not estimates), implementation (pointing at the attachment), and acceptance criteria (e.g. 0 duplicate keys, row counts unchanged, models still refresh).
- **Sprint (user rule 2026-10-08):** new items go in the CURRENT sprint (`"sprint": "current"`), even when it ends in a day or two. Never push to the next sprint on your own.
- **Assignment:** leave items unassigned unless the user names someone. Look up assignee emails with `boards query --wiql` (`System.AssignedTo.uniqueName`).
- **Bulk backlog:** collect follow-ups in a single markdown list (sensitive data / wrong numbers / keys and joins / cleanup, each with owner team and priority). Create one bulk bug ticket from it when the user asks.
- **Data bugs go into tickets, never into report text** (house rule).
- **Bugs (user rule 2026-10-06):** findings with verified numbers go in Repro Steps (`Microsoft.VSTS.TCM.ReproSteps`); the fix (step-by-step changes + how to validate) goes in **System Info** (`Microsoft.VSTS.TCM.SystemInfo`). `ado_item.py` only creates stories; for a Bug, POST `_apis/wit/workitems/$Bug` with both fields (example: Textura Pay Times\build\create_textura_bug.py).
