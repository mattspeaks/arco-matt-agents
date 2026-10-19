# CLAUDE.md

Project rules for every Claude session in this repo: the orchestrator, workers, and anyone developing the app.

## Guardrails (non-negotiable)
- Reports reach any Fabric workspace, production included, only through a Publish card Matt approves (the app
  publishes; production needs his extra confirmation on the card). Never publish or update a Power BI **app**: Matt
  does that.
- Never move a ServiceNow story to Testing, Deploy/Launch, Complete or Cancelled. Agents only *propose* changes
  through the app, and Matt approves them.
- ServiceNow is touched only in the orchestrator chat, in response to Matt's own messages, following the
  `servicenow` skill. Every write needs an approval card that Matt has approved. No background session or worker
  touches ServiceNow. `server/hooks/sn-write-guard.mjs` blocks forbidden writes. Never work around it.
- Builders commit only to `agent/<story>-<slug>` branches. Never push, merge, reset or rebase. Only the app pushes,
  and only after Matt confirms a Publish card. It opens the PR and never merges it.
- Fabric publishing is done by the app (`server/src/pbi/flow.ts`), only to the workspace Matt picks on the Publish
  card, and never to a workspace matching `powerbi.blockedWorkspacePatterns`.
- Models and reports never read from bronze.
- No secrets in the repo. Auth is Windows (SQL Server) and the user's Claude Code login.

## Developing the app
- TypeScript everywhere: `server/` (Fastify, msnodesqlv8 → SQL Server LocalDB) and `web/` (React + Vite).
- `npm run dev` starts both. `npm run typecheck` before committing.
- DB schema changes: append new idempotent statements to `server/src/db/schema.ts`. Never edit applied ones.
- Claude runs go through `server/src/claude/runner.ts` (headless `claude -p`, stream-json). Don't add the Agent
  SDK or an API key: Chrome integration requires the claude.ai login.
- On Windows, write files containing backslashes with an editor tool, not shell heredocs (they eat backslashes).
