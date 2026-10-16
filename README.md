# arco-matt-agents

A local orchestration app for Matt's BI work. It runs Claude agents that read the ServiceNow VTB and timesheet
through Claude in Chrome, triage stories, and run Power BI builder and QC workers, with a web UI for chat,
approvals and live run traces. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Prerequisites (one-time)

- Node 22+, git
- Claude Code CLI logged in with your ARCO account (`claude auth status` → `authMethod: claude.ai`). **No API key.**
  Don't set `ANTHROPIC_API_KEY`: it overrides the login and turns off Chrome.
- The Claude in Chrome extension, signed in to the same ARCO org, connected once with `/chrome` in Claude Code, and
  with site permission for `arcoconstruction.service-now.com`
- SQL Server LocalDB (`(localdb)\MSSQLLocalDB`) and ODBC Driver 18 for SQL Server (both installed already)
- Stay logged in to ServiceNow in Chrome

## Run

```powershell
npm install
copy .env.example .env      # defaults point at LocalDB; edit to use another SQL Server
npm run db:init             # optional: the server also creates the DB/tables on start
npm run dev                 # API on 127.0.0.1:4317, UI on http://127.0.0.1:5173
```

Open http://127.0.0.1:5173, click **Sync ServiceNow**, then talk to the orchestrator.

## While it's running

- When the orchestrator works in ServiceNow, it opens a tab in a Chrome tab group and closes it when done. Don't run
  another Claude Code session that uses Chrome at the same time: Windows allows one Chrome connection.
- Agent runs count against your Claude plan's usage limits. The "est. $" figures are Claude Code's estimates, not
  bills.
- ServiceNow work happens in the chat. **Sync ServiceNow** posts a request from you into the "ServiceNow refresh"
  chat. Changes (lane moves, work notes, hours) show up as cards in **Approvals** (top right), and nothing is saved until you click Approve.

## Where things live

| What | Where |
|---|---|
| Lanes, routing tags, worker tool policies, models | `config/app.config.json` |
| Orchestrator behaviour | `prompts/orchestrator.md` |
| Worker prompts | `.claude/agents/*.md` |
| Standards the workers follow | `.claude/skills/*` |
| Approved lessons | `memory/*-lessons.md` |
| How the orchestrator reads and updates ServiceNow | `.claude/skills/servicenow/` |
| Hard limits on ServiceNow writes | `server/hooks/sn-write-guard.mjs` |
