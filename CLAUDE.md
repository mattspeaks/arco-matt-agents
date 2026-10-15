# CLAUDE.md

Project rules for every Claude session in this repo: the orchestrator, workers, and anyone developing the app.

## Guardrails (non-negotiable)
- Never deploy to TEST or PROD Fabric workspaces, and never publish or update a Power BI **app**. Matt does that.
- Never move a ServiceNow story to Testing, Deploy/Launch, Complete or Cancelled. Agents only *propose* changes
  through the app, and Matt approves them.
- ServiceNow is touched only through the vetted snippets in `server/src/servicenow/snippets.ts`, run by the app.
  Never hand-write ServiceNow requests in an agent session.
- Builders commit only to `agent/<story>-<slug>` branches. Never push, merge, reset or rebase.
- Models and reports never read from bronze.
- No secrets in the repo. Auth is Windows (SQL Server) and the user's Claude Code login.

## Developing the app
- TypeScript everywhere: `server/` (Fastify, msnodesqlv8 → SQL Server LocalDB) and `web/` (React + Vite).
- `npm run dev` starts both. `npm run typecheck` before committing.
- DB schema changes: append new idempotent statements to `server/src/db/schema.ts`. Never edit applied ones.
- Claude runs go through `server/src/claude/runner.ts` (headless `claude -p`, stream-json). Don't add the Agent
  SDK or an API key: Chrome integration requires the claude.ai login.
- On Windows, write files containing backslashes with an editor tool, not shell heredocs (they eat backslashes).
