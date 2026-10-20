import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, relative, resolve } from 'node:path';
import { config } from '../config.js';
import { query, queryOne } from '../db/index.js';
import { createApproval, getApproval, setOutcome, supersedeChatApprovals, type Approval } from '../approvals.js';
import { cancelClaudeRun } from '../claude/runner.js';
import { publish } from '../bus.js';
import { getConversation, postApprovalCard, postAppNote, sendMessage } from '../orchestrator.js';
import { createRun, getRun, parseMeta, type Run } from '../runs.js';
import { startWorkerRun } from '../workers.js';
import { askTimeEntry } from '../timesheet.js';
import { startCloseout } from '../closeout.js';
import { lintBranch, lintSummary, type LintDiff } from './lint.js';
import { catalogPath, ensureCatalog } from '../dwh/catalog.js';
import { ensureOntology } from '../dwh/ontology.js';
import { createItem, getDefinition, listItems, listWorkspaces, renameItem, updateDefinition, type Workspace } from '../fabric/client.js';
import { findItemFolder, parseModelRef, partText, pbirByConnection, pbirByPath, readParts, textPart, writeParts, writePbip } from '../fabric/pbip.js';
import { changedFiles, commitAll, diffStat, ensureWorktree, filesAt, freshBase, git, headSha, mergeBase, openPullRequest, pushBranch, refExists, showAt, slugify } from './repo.js';

// The Power BI story workflow (ARCHITECTURE.md §5). One workflow per story, and it doesn't have to run in a straight
// line: it can start from Fabric or from the repo, take over a branch built outside it, rebuild, stop, or raise a
// Review card at any point. Builders only run here (start_worker refuses pbi-builder on the PowerBI repo), so a build
// always ends in a Review card, and Approve on that card always leads to the Publish card.
// ServiceNow changes happen only in story-chat turns started by Matt's clicks; the app never touches ServiceNow.

// final_qc: Matt approved the review; pbi-qc checks exactly what will be published before the Publish card.
// gaps: the builder stopped on blocking data gaps; waiting for Matt (story? then proceed or pause).
// modeling: the report model builder (pbi-report-model-builder) works on the report's own model before the report loop.
export type Stage = 'pulling' | 'modeling' | 'building' | 'gaps' | 'idle' | 'review' | 'revising' | 'final_qc' | 'publishing' | 'published' | 'failed';
const ACTIVE: Stage[] = ['pulling', 'modeling', 'building', 'final_qc', 'publishing'];

export interface FlowData {
  conversationId: string;
  plan: string;
  /** fabric: pulled from a workspace; repo: built from the PowerBI repo; attached: a branch built outside the workflow. */
  source?: 'fabric' | 'repo' | 'attached';
  /** The approved card that authorises the WIP move (start card, then the latest rebuild card). */
  permitApprovalId?: string;
  sourceWorkspaceId?: string;
  sourceWorkspaceName?: string;
  reportId?: string;
  reportName: string;
  modelId?: string;
  modelName?: string;
  thinReportNote?: string;
  branch: string;
  folder: string;
  /** Report folder in the repo (repo-relative), when known before the worktree exists. */
  repoReport?: string;
  worktree?: string;
  reportDir?: string; // relative to the worktree
  modelDir?: string;
  pbip?: string;
  /** What QC diffs against: the untouched pull commit, or where the branch left main. */
  baseSha?: string;
  pullSha?: string; // older flows
  round: number;
  revisions: string[];
  activeRunId?: string;
  lastBuilder?: string;
  lastQc?: { verdict?: string; result: string };
  /** Data the work needs that isn't in the semantic model or in gold, as reported by the builder this round. */
  gaps?: DataGap[];
  /** The report model builder's notes for the report builder: what's in the model for this report. */
  modelHandoff?: string;
  /** Name mappings Matt approved on a gap design ("X is really gold.schema.table.column"), for the model builder. */
  approvedMappings?: GapMapping[];
  /** Matt's decision on blocking gaps: build with the proposed (silver / bronze) sources, or without. */
  gapDecision?: { choice: 'sources' | 'without'; approvedSources?: (ProposedSource & { gap: string })[]; at: string; note?: string };
  /** Matt chose to build what's possible despite blocking gaps (Proceed on the Proceed-or-pause card). */
  proceedDespiteGaps?: boolean;
  /** Matt paused the work until the gaps are resolved; the next rebuild checks again. */
  pausedForGaps?: boolean;
  /** The house linter on the last build: new errors / warnings vs the starting point. */
  lastLint?: { ran: boolean; newErrors: number; newWarnings: number; preexisting: number };
  /** Head when the Review card went up: later commits are Matt's own edits in Desktop. */
  reviewSha?: string;
  /** The pre-publish QC and the commit it checked. */
  finalQc?: { verdict?: string; result: string; sha: string; runId?: string };
  movedToReadyRound?: number;
  prUrl?: string;
  published?: { workspaceId: string; workspaceName: string; reportUrl: string; modelCreated?: boolean; reportCreated: boolean };
  error?: string;
}

/**
 * Something the report or model needs that isn't available, from the builder's data-gaps block:
 * - missing_table: no such table in gold (it has to be built)
 * - missing_column: the gold table exists but lacks the column
 * - not_in_model: it's in gold, but not in the semantic model (the model needs the table / column added)
 * - unknown: the builder couldn't tell (e.g. no catalog)
 * - derivable: NOT a gap. It can be computed from data already there (DAX, calculated column, existing join); listed so
 *   Matt sees how, and never put in a story
 */
export interface DataGap {
  kind: 'missing_table' | 'missing_column' | 'not_in_model' | 'unknown' | 'derivable';
  /** gold.schema.table (the one that's missing, or the one lacking the column) */
  object: string;
  column?: string;
  /** What in the report / model needs it */
  neededFor: string;
  /** Where the data could come from (e.g. silver.viewpoint.bAPTH.Retainage) */
  sourceHint?: string;
  /** The work can't be finished without it */
  blocking?: boolean;
  /** What the builder searched to conclude it's missing (catalog terms, model tables) */
  checked?: string;
  /** For derivable: how it will be computed */
  derivation?: string;
  /** For real gaps: where the data could come from instead (silver first, then source bronze) */
  proposedSources?: ProposedSource[];
  notes?: string;
}

/** The report builder's request to the model builder: something the model should have, or a problem with it. */
export interface ModelRequest {
  need: 'measure' | 'table' | 'column' | 'relationship' | 'fix';
  what: string;
  why?: string;
}

/** The report builder's ```model-requests JSON block. */
export function parseModelRequests(result: string): ModelRequest[] {
  const m = /```model-requests\s*\n([\s\S]*?)```/.exec(result);
  if (!m) return [];
  try {
    const raw = JSON.parse(m[1]) as Record<string, unknown>[];
    return (Array.isArray(raw) ? raw : [])
      .filter((r) => r && typeof r.what === 'string' && r.what.trim())
      .slice(0, 20)
      .map((r) => ({
        need: (['measure', 'table', 'column', 'relationship', 'fix'].includes(String(r.need)) ? r.need : 'fix') as ModelRequest['need'],
        what: String(r.what).trim().slice(0, 300),
        why: typeof r.why === 'string' ? r.why.trim().slice(0, 300) || undefined : undefined,
      }));
  } catch {
    return [];
  }
}

/** A name-confusion resolution from the gap designer, approved by Matt. */
export interface GapMapping {
  /** What the report asked for, as the gap named it */
  gap: string;
  /** Where it really is: gold.schema.table.column (and the ontology entity / property, if any) */
  resolvedTo: string;
  evidence?: string;
}

export interface ProposedSource {
  /** db.schema.table, e.g. silver.viewpoint.bAPTD */
  object: string;
  column?: string;
  layer?: string;
  join?: string;
  why?: string;
}

const realGaps = (gaps: DataGap[] = []) => gaps.filter((g) => g.kind !== 'derivable');
const blockingGaps = (gaps: DataGap[] = []) => realGaps(gaps).filter((g) => g.blocking);

const GAP_KINDS = ['missing_table', 'missing_column', 'not_in_model', 'unknown', 'derivable'];

/** The builder's ```data-gaps JSON block, validated. Missing or malformed = none reported. */
export function parseGaps(result: string): DataGap[] {
  const m = /```data-gaps\s*\n([\s\S]*?)```/.exec(result);
  if (!m) return [];
  try {
    const raw = JSON.parse(m[1]) as Record<string, unknown>[];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((g) => g && GAP_KINDS.includes(String(g.kind)) && typeof g.object === 'string' && g.object.trim())
      .map((g) => ({
        kind: g.kind as DataGap['kind'],
        object: String(g.object).trim(),
        column: typeof g.column === 'string' && g.column.trim() ? g.column.trim() : undefined,
        neededFor: String(g.needed_for ?? g.neededFor ?? '').trim().slice(0, 300),
        sourceHint: typeof (g.source_hint ?? g.sourceHint) === 'string' ? String(g.source_hint ?? g.sourceHint).trim().slice(0, 200) || undefined : undefined,
        blocking: g.kind !== 'derivable' && Boolean(g.blocking),
        checked: typeof g.checked === 'string' ? g.checked.trim().slice(0, 300) || undefined : undefined,
        derivation: typeof g.derivation === 'string' ? g.derivation.trim().slice(0, 300) || undefined : undefined,
        proposedSources: Array.isArray(g.proposed_sources ?? g.proposedSources)
          ? ((g.proposed_sources ?? g.proposedSources) as Record<string, unknown>[])
              .filter((s) => s && typeof s.object === 'string' && s.object.trim() && !/bronze_confidential/i.test(String(s.object)))
              .slice(0, 5)
              .map((s) => ({
                object: String(s.object).trim(),
                column: typeof s.column === 'string' ? s.column.trim() || undefined : undefined,
                layer: typeof s.layer === 'string' ? s.layer.trim() || undefined : undefined,
                join: typeof s.join === 'string' ? s.join.trim().slice(0, 200) || undefined : undefined,
                why: typeof s.why === 'string' ? s.why.trim().slice(0, 200) || undefined : undefined,
              }))
          : undefined,
        notes: typeof g.notes === 'string' ? g.notes.trim().slice(0, 300) || undefined : undefined,
      }));
  } catch {
    return [];
  }
}

const gapKey = (g: DataGap) => `${g.kind}|${g.object.toLowerCase()}|${(g.column ?? '').toLowerCase()}`;
function mergeGaps(a: DataGap[] = [], b: DataGap[] = []): DataGap[] {
  const out = new Map(a.map((g) => [gapKey(g), g]));
  for (const g of b) out.set(gapKey(g), { ...out.get(gapKey(g)), ...g });
  return [...out.values()];
}

interface FlowRow {
  story_number: string;
  stage: Stage;
  data: string;
  updated_at: string;
}

export async function getFlow(storyNumber: string): Promise<{ stage: Stage; data: FlowData } | undefined> {
  const row = await queryOne<FlowRow>('SELECT * FROM dbo.story_flows WHERE story_number = ?', [storyNumber]);
  return row ? { stage: row.stage, data: JSON.parse(row.data) as FlowData } : undefined;
}

async function saveFlow(storyNumber: string, stage: Stage, data: FlowData) {
  await query(
    `MERGE dbo.story_flows AS t USING (SELECT ? AS story_number) AS s ON t.story_number = s.story_number
     WHEN MATCHED THEN UPDATE SET stage = ?, data = ?, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (story_number, stage, data) VALUES (?, ?, ?);`,
    [storyNumber, stage, data, storyNumber, stage, data],
  );
}

/** Flows a previous server process left mid-step can't resume; mark them failed so the chat can rerun them. */
export async function recoverInterruptedFlows() {
  const rows = await query<FlowRow>(`SELECT * FROM dbo.story_flows WHERE stage IN ('pulling', 'building', 'final_qc', 'publishing')`);
  for (const row of rows) {
    const data = JSON.parse(row.data) as FlowData;
    await saveFlow(row.story_number, 'failed', { ...data, activeRunId: undefined, error: `Interrupted while ${row.stage}: server restarted` });
  }
}

const diffBase = (d: FlowData) => d.baseSha ?? d.pullSha;

// ---- workspaces ---------------------------------------------------------------------------------

const isBlocked = (name: string) => config.powerbi.blockedWorkspacePatterns.some((p) => new RegExp(p).test(name));
/** Production = not blocked and not recognisably Acceptance/Dev/Test/POC/Sandbox. Publishing there needs Matt's extra confirmation. */
const isProduction = (name: string) => !isBlocked(name) && !config.powerbi.nonProductionWorkspacePatterns.some((p) => new RegExp(p).test(name));

let wsCache: { at: number; list: Workspace[] } | null = null;
async function workspaces(): Promise<Workspace[]> {
  if (!wsCache || Date.now() - wsCache.at > 5 * 60_000) wsCache = { at: Date.now(), list: (await listWorkspaces()).filter((w) => w.type === 'Workspace') };
  return wsCache.list;
}

async function findWorkspace(idOrName: string): Promise<Workspace> {
  const key = idOrName.trim().toLowerCase();
  const ws = (await workspaces()).find((w) => w.id === key || w.displayName.trim().toLowerCase() === key);
  if (!ws) throw new Error(`No workspace "${idOrName}" among the ones Matt can access`);
  return ws;
}

/** For the Publish card's dropdown: every workspace Matt can access, TEST/PROD ones flagged and not selectable. */
export async function publishTargets(storyNumber?: string) {
  const flow = storyNumber ? await getFlow(storyNumber) : undefined;
  const list = (await workspaces()).map((w) => ({ id: w.id, name: w.displayName.trim(), blocked: isBlocked(w.displayName), production: isProduction(w.displayName) }));
  list.sort((a, b) => a.name.localeCompare(b.name));
  return { workspaces: list, suggested: flow ? suggestTarget(flow.data, list) : undefined, repoName: flow?.data.reportName };
}

/**
 * For the Publish card, once a workspace is picked: its reports, and which one this story's report should update.
 * The story's own report (by id) wins; otherwise a report with the same name; otherwise none (create new).
 */
export async function publishOptions(storyNumber: string, workspaceId: string) {
  const flow = await getFlow(storyNumber);
  if (!flow) throw new Error(`No report workflow for ${storyNumber}`);
  const items = await listItems(workspaceId, 'Report');
  const reports = items.map((i) => ({ id: i.id, name: i.displayName })).sort((a, b) => a.name.localeCompare(b.name));
  const byId = flow.data.reportId && reports.find((r) => r.id === flow.data.reportId);
  const byName = reports.find((r) => r.name.toLowerCase() === flow.data.reportName.toLowerCase());
  return { reports, match: (byId || byName || undefined)?.id ?? '', repoName: flow.data.reportName };
}

/** "<workspace> Acceptance Region" when it exists, else the workspace itself (the source, or the repo folder's). */
function suggestTarget(flow: FlowData, list: { id: string; name: string; blocked: boolean }[]) {
  const home = (flow.sourceWorkspaceName ?? flow.folder).trim().toLowerCase();
  const pick = (name: string) => list.find((w) => !w.blocked && w.name.toLowerCase() === name)?.id;
  return pick(`${home} acceptance region`) ?? (flow.sourceWorkspaceId && list.find((w) => w.id === flow.sourceWorkspaceId && !w.blocked)?.id) ?? pick(home);
}

/** Repo folder for a workspace: configured override, else the name minus an "Acceptance (Region)" suffix. */
function workspaceFolder(name: string): string {
  const trimmed = name.trim();
  return config.powerbi.workspaceFolders[trimmed] ?? trimmed.replace(/\s+Acceptance(\s+Region)?$/i, '').trim();
}

const safeName = (s: string) => s.replace(/[<>:"/\\|?*]/g, '_').trim();
const displayNameOf = (platformJson: string | undefined, folder: string, type: string) => {
  try {
    const name = JSON.parse(platformJson ?? '')?.metadata?.displayName;
    if (name) return String(name);
  } catch {
    /* no .platform */
  }
  return basename(folder).replace(new RegExp(`\\.${type}$`), '');
};

// ---- the repo, read at a ref (no checkout needed) ------------------------------------------------

const cleanRepoPath = (p: string) => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/^PowerBI\//i, '');

/** Accepts a .pbip, an X.Report folder, or a folder holding exactly one report. Returns the X.Report folder. */
export async function resolveRepoReport(ref: string, input: string): Promise<{ reportDir: string; name: string }> {
  const path = cleanRepoPath(input);
  let reportDir: string | undefined;
  if (/\.pbip$/i.test(path)) {
    const pbip = JSON.parse(await showAt(ref, path).catch(() => '{}'));
    const rel = pbip?.artifacts?.find((a: { report?: { path?: string } }) => a.report?.path)?.report.path;
    if (!rel) throw new Error(`${path} isn't a .pbip on ${ref}`);
    reportDir = posix.normalize(posix.join(posix.dirname(path), rel));
  } else if (/\.Report$/i.test(path)) {
    reportDir = path;
  } else {
    const dirs = [...new Set((await filesAt(ref, path)).filter((f) => f.endsWith('.Report/definition.pbir')).map((f) => posix.dirname(f)))];
    if (dirs.length !== 1) throw new Error(dirs.length ? `${path} holds several reports; pass one of: ${dirs.join(', ')}` : `No report under ${path} on ${ref}`);
    reportDir = dirs[0];
  }
  const files = await filesAt(ref, reportDir);
  if (!files.includes(`${reportDir}/definition.pbir`)) throw new Error(`No report at ${reportDir} on ${ref}`);
  const platform = files.includes(`${reportDir}/.platform`) ? await showAt(ref, `${reportDir}/.platform`) : undefined;
  return { reportDir, name: displayNameOf(platform, reportDir, 'Report') };
}

/** An existing report in a repo folder with this display name (or the same name ignoring spaces/punctuation). */
export async function findRepoReport(ref: string, folder: string, name: string): Promise<string | undefined> {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const reports = [...new Set((await filesAt(ref, folder)).filter((f) => f.endsWith('.Report/definition.pbir')).map((f) => posix.dirname(f)))];
  for (const dir of reports) {
    const platform = await showAt(ref, `${dir}/.platform`).catch(() => undefined);
    if (key(displayNameOf(platform, dir, 'Report')) === key(name)) return dir;
  }
  return undefined;
}

export async function listRepoReports(folder?: string) {
  const ref = await freshBase();
  const files = await filesAt(ref, folder ? cleanRepoPath(folder) : '.');
  const dirs = [...new Set(files.filter((f) => f.endsWith('.Report/definition.pbir')).map((f) => posix.dirname(f)))];
  const reports = [];
  for (const dir of dirs) {
    const platform = await showAt(ref, `${dir}/.platform`).catch(() => undefined);
    reports.push({ report_folder: dir, name: displayNameOf(platform, dir, 'Report') });
  }
  return { ref, reports };
}

/** Fills in names and paths from the report folder in the worktree (its .platform, its pbir's model path, the .pbip). */
function describeLocal(wt: string, reportDirAbs: string, createPbip: boolean) {
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined);
  const reportName = displayNameOf(read(join(reportDirAbs, '.platform')), reportDirAbs, 'Report');
  let modelDirAbs: string | undefined;
  try {
    const byPath = JSON.parse(read(join(reportDirAbs, 'definition.pbir')) ?? '{}')?.datasetReference?.byPath?.path;
    if (byPath && existsSync(resolve(reportDirAbs, byPath))) modelDirAbs = resolve(reportDirAbs, byPath);
  } catch {
    /* unreadable pbir */
  }
  const modelName = modelDirAbs ? displayNameOf(read(join(modelDirAbs, '.platform')), modelDirAbs, 'SemanticModel') : undefined;
  const parent = dirname(reportDirAbs);
  const folderName = basename(reportDirAbs);
  const existingPbip = readdirSync(parent)
    .filter((f) => f.toLowerCase().endsWith('.pbip'))
    .find((f) => (read(join(parent, f)) ?? '').includes(`"${folderName}"`));
  const pbipAbs = join(parent, existingPbip ?? `${folderName.replace(/\.Report$/, '')}.pbip`);
  if (!existingPbip && createPbip) writePbip(pbipAbs, folderName);
  const r = (p: string) => relative(wt, p).replace(/\\/g, '/');
  return { reportName, modelName, reportDir: r(reportDirAbs), modelDir: modelDirAbs && r(modelDirAbs), pbip: r(pbipAbs) };
}

// ---- orchestrator tools -------------------------------------------------------------------------

async function storyChat(parentRunId?: string | null) {
  const run = parentRunId ? await getRun(parentRunId) : undefined;
  const conv = run?.conversation_id ? await getConversation(run.conversation_id) : undefined;
  if (!run || !conv?.story_number) throw new Error('This only works in a story chat ("Discuss with orchestrator" on the story).');
  return { run, conv, storyNumber: conv.story_number };
}

export async function listFabric(workspace?: string) {
  if (!workspace) return { workspaces: (await workspaces()).map((w) => ({ id: w.id, name: w.displayName.trim(), blocked_for_publish: isBlocked(w.displayName) })) };
  const ws = await findWorkspace(workspace);
  const items = await listItems(ws.id);
  return {
    workspace: { id: ws.id, name: ws.displayName.trim(), repo_folder: workspaceFolder(ws.displayName) },
    reports: items.filter((i) => i.type === 'Report').map((i) => ({ id: i.id, name: i.displayName })),
    semantic_models: items.filter((i) => i.type === 'SemanticModel').map((i) => ({ id: i.id, name: i.displayName })),
  };
}

function assertNotActive(story: string, flow?: { stage: Stage }) {
  if (flow && ACTIVE.includes(flow.stage)) throw new Error(`${story}'s workflow is ${flow.stage} right now. Wait for it, or stop it with stop_report_work.`);
}

/**
 * The start card. From Fabric (workspace + report: pull into the repo first) or from the repo (repo_report: build on
 * main as it is). Either way: move to WIP, builder ⇄ QC, Review card. Replaces any earlier workflow for the story.
 */
export async function proposeReportWork(p: {
  parentRunId?: string | null;
  workspace?: string;
  report?: string;
  repoReport?: string;
  plan: string;
  workNote: string;
}) {
  const { run, conv, storyNumber } = await storyChat(p.parentRunId);
  const existing = await getFlow(storyNumber);
  assertNotActive(storyNumber, existing);
  const ref = await freshBase();
  let payload: Record<string, string>;
  let sourceLine: string;
  let firstStep: string;

  if (p.workspace && p.report) {
    const ws = await findWorkspace(p.workspace);
    const report = (await listItems(ws.id, 'Report')).find((i) => i.id === p.report || i.displayName.toLowerCase() === p.report!.trim().toLowerCase());
    if (!report) throw new Error(`No report "${p.report}" in workspace ${ws.displayName}`);
    const folder = workspaceFolder(ws.displayName);
    const repoReport = p.repoReport ? (await resolveRepoReport(ref, p.repoReport)).reportDir : await findRepoReport(ref, folder, report.displayName);
    payload = { source: 'fabric', workspaceId: ws.id, workspaceName: ws.displayName.trim(), reportId: report.id, reportName: report.displayName, folder, repoReport: repoReport ?? '' };
    sourceLine = `**Source:** report *${report.displayName}* in workspace *${ws.displayName.trim()}* (plus its semantic model if it's in the same workspace), pulled into ${
      repoReport ? `the existing \`PowerBI/${repoReport}\`` : `a new folder \`PowerBI/${folder}/${safeName(report.displayName)}/\` (no report with that name is in \`${folder}/\` on ${ref}; pass repo_report if it lives under another name)`
    }.`;
    firstStep = 'The app pulls the report from Fabric into the repo and commits it untouched, so the diff shows only the changes.';
  } else if (p.repoReport) {
    const found = await resolveRepoReport(ref, p.repoReport);
    const folder = found.reportDir.split('/')[0];
    const home = (await workspaces()).find((w) => w.displayName.trim().toLowerCase() === folder.toLowerCase());
    payload = { source: 'repo', reportName: found.name, folder, repoReport: found.reportDir, workspaceId: home?.id ?? '', workspaceName: home?.displayName.trim() ?? '' };
    sourceLine = `**Source:** \`PowerBI/${found.reportDir}\` (*${found.name}*) as it is on ${ref}. Nothing is pulled from Fabric.`;
    firstStep = `The app branches from ${ref}.`;
  } else {
    throw new Error('Give either workspace + report (start from Fabric) or repo_report (start from the repo)');
  }

  const branch = `agent/${storyNumber}-${slugify(payload.reportName)}`;
  const preview = [
    `**Plan**\n\n${p.plan}`,
    sourceLine,
    `**Branch:** \`${branch}\`, in the app's own worktree. Your checkout isn't touched.`,
    existing && `**Replaces** the earlier workflow for ${storyNumber} (\`${existing.data.branch}\`, ${existing.stage}). That branch is left as it is.`,
    `**What happens when you approve**`,
    `1. ${firstStep}`,
    `2. ServiceNow: ${storyNumber} → **Work in progress**, with this work note:\n\n\`\`\`\n${p.workNote}\n\`\`\``,
    `3. Power BI builder ⇄ QC: build → QC → build → QC → build → final QC. It stops as soon as QC passes.`,
    `4. A **Review report** card appears in this chat. Opening the report from it moves ${storyNumber} → **Ready for testing**.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  await supersedeChatApprovals(conv.id);
  const approval = await createApproval({
    kind: 'pbi_start',
    title: `${storyNumber}: start work on "${payload.reportName}"`,
    payload: { conversationId: conv.id, storyNumber, preview, plan: p.plan, branch, ...payload },
    requestedByRunId: run.id,
  });
  await postApprovalCard(conv.id, approval.id);
  return { approval_id: approval.id, status: 'pending', note: "The start card is in Matt's Approvals panel and in this chat. End your turn now." };
}

/**
 * Takes over a branch built outside the workflow (by hand, in Desktop, or an earlier detour), so the Review and
 * Publish cards work for it. No card: it only sets up the app's worktree on that branch. The chat then raises a
 * Review card (request_review) or a rebuild card (submit_revision).
 */
export async function attachReportWork(p: { parentRunId?: string | null; branch: string; repoReport?: string; plan?: string }) {
  const { conv, storyNumber } = await storyChat(p.parentRunId);
  const existing = await getFlow(storyNumber);
  assertNotActive(storyNumber, existing);
  const ref = await freshBase();
  const branch = p.branch.replace(/^refs\/heads\//, '').replace(/^origin\//, '');
  if (!(await refExists(branch)) && !(await refExists(`origin/${branch}`))) throw new Error(`No branch ${branch} in the PowerBI repo`);
  const wt = await ensureWorktree(branch, (await refExists(branch)) ? undefined : `origin/${branch}`);
  const base = await mergeBase(wt, ref);

  let reportRel = p.repoReport ? cleanRepoPath(p.repoReport) : undefined;
  if (reportRel && /\.pbip$/i.test(reportRel)) {
    const pbip = JSON.parse(readFileSync(join(wt, reportRel), 'utf8'));
    reportRel = posix.normalize(posix.join(posix.dirname(reportRel), pbip.artifacts.find((a: { report?: { path?: string } }) => a.report?.path).report.path));
  }
  if (!reportRel) {
    const dirs = [...new Set((await changedFiles(wt, base)).map((f) => /^(.*?\.Report)\//.exec(f)?.[1]).filter((d): d is string => !!d))];
    if (dirs.length !== 1) throw new Error(dirs.length ? `The branch changes several reports; pass repo_report: ${dirs.join(', ')}` : `The branch changes no report; pass repo_report`);
    reportRel = dirs[0];
  }
  const reportAbs = resolve(wt, reportRel);
  if (!existsSync(join(reportAbs, 'definition.pbir'))) throw new Error(`No report at ${reportRel} on ${branch}`);
  const local = describeLocal(wt, reportAbs, true);
  await commitAll(wt, `${storyNumber}: add .pbip for ${local.reportName}`);
  const folder = local.reportDir.split('/')[0];
  const home = (await workspaces()).find((w) => w.displayName.trim().toLowerCase() === folder.toLowerCase());

  const data: FlowData = {
    conversationId: conv.id,
    plan: p.plan ?? existing?.data.plan ?? '(Work built outside the workflow, then attached.)',
    source: 'attached',
    // The story's original Fabric report stays the publish target; the repo folder's workspace is only a fallback.
    sourceWorkspaceId: existing?.data.sourceWorkspaceId ?? home?.id,
    sourceWorkspaceName: existing?.data.sourceWorkspaceName ?? home?.displayName.trim(),
    reportId: existing?.data.reportId,
    modelId: existing?.data.modelId,
    reportName: local.reportName,
    modelName: local.modelName,
    branch,
    folder,
    worktree: wt,
    reportDir: local.reportDir,
    modelDir: local.modelDir,
    pbip: local.pbip,
    baseSha: base,
    round: (existing?.data.round ?? 0) + 1,
    revisions: existing?.data.revisions ?? [],
    // Results from earlier runs describe other commits; the attached branch hasn't been built or QC'd here yet.
  };
  await saveFlow(storyNumber, 'idle', data);
  await supersedeFlowCards(storyNumber);
  const files = await changedFiles(wt, base);
  await postAppNote(conv.id, `Attached \`${branch}\` to ${storyNumber}'s workflow: *${local.reportName}* at \`PowerBI/${local.reportDir}\`, ${files.length} files changed since ${ref}. It now runs in the app's worktree.`);
  return {
    stage: 'idle',
    branch,
    report: local.reportDir,
    files_changed: files.length,
    next: 'Call request_review to put the Review card up for this branch as it is, or submit_revision to rebuild (builder ⇄ QC) first.',
  };
}

/** Puts a Review card up for the branch as it is now, from any stage that isn't mid-step. */
export async function requestReview(p: { parentRunId?: string | null; summary?: string }) {
  const { storyNumber } = await storyChat(p.parentRunId);
  const flow = await getFlow(storyNumber);
  if (!flow?.data.worktree) throw new Error(`${storyNumber} has no report branch in the workflow yet (propose_report_work or attach_report_work first)`);
  assertNotActive(storyNumber, flow);
  await commitAll(flow.data.worktree, `${storyNumber}: changes left uncommitted before review`);
  const data = { ...flow.data, lastBuilder: p.summary ?? flow.data.lastBuilder };
  await saveFlow(storyNumber, 'review', data);
  await raiseReviewCard(storyNumber, data, flow.data.lastQc);
  return { status: 'review card posted', note: "The Review card is in this chat and Matt's Approvals. End your turn." };
}

/**
 * A rebuild card: more builder ⇄ QC on the same branch, with Matt's changes. Works from any stage that isn't
 * mid-step (after Not ready, after a stop or failure, after publishing). The acceptance-criteria text is optional.
 */
export async function submitRevision(p: { parentRunId?: string | null; changes: string; acceptanceCriteria?: string }) {
  const { run, conv, storyNumber } = await storyChat(p.parentRunId);
  const flow = await getFlow(storyNumber);
  if (!flow) throw new Error(`${storyNumber} has no report workflow yet (propose_report_work or attach_report_work first)`);
  assertNotActive(storyNumber, flow);
  const preview = [
    `**Changes to make**\n\n${p.changes}`,
    p.acceptanceCriteria
      ? `**ServiceNow:** ${storyNumber} → Work in progress (if it isn't already), and add to its acceptance criteria:\n\n\`\`\`\n${p.acceptanceCriteria}\n\`\`\``
      : `**ServiceNow:** ${storyNumber} → Work in progress, if it isn't already.`,
    `**What happens when you approve:** builder ⇄ QC on \`${flow.data.branch}\` (round ${flow.data.round + 1})${flow.data.worktree ? '' : ', after pulling the report'}, then a new **Review report** card. Opening the report from it moves ${storyNumber} → **Ready for testing**.`,
  ].join('\n\n');
  await supersedeChatApprovals(conv.id);
  const approval = await createApproval({
    kind: 'pbi_revise',
    title: `${storyNumber}: rebuild "${flow.data.reportName}" (round ${flow.data.round + 1})`,
    payload: { conversationId: conv.id, storyNumber, preview, changes: p.changes, acceptanceCriteria: p.acceptanceCriteria ?? '' },
    requestedByRunId: run.id,
  });
  await postApprovalCard(conv.id, approval.id);
  return { approval_id: approval.id, status: 'pending', note: "The rebuild card is in Matt's Approvals panel and in this chat. End your turn now." };
}

/** Stops a running builder ⇄ QC loop; the branch keeps whatever was committed. No card: stopping is always safe. */
export async function stopReportWork(p: { parentRunId?: string | null; storyNumber?: string; reason?: string }) {
  const storyNumber = p.storyNumber ?? (await storyChat(p.parentRunId)).storyNumber;
  const flow = await getFlow(storyNumber);
  if (!flow) throw new Error(`${storyNumber} has no report workflow`);
  if (flow.stage === 'publishing') throw new Error('Publishing is under way and stopping it halfway would leave Fabric half-updated; let it finish');
  if (flow.stage !== 'building' && flow.stage !== 'pulling' && flow.stage !== 'final_qc') return { stage: flow.stage, note: 'Nothing is running.' };
  await saveFlow(storyNumber, 'idle', { ...flow.data, activeRunId: undefined });
  if (flow.data.activeRunId) cancelClaudeRun(flow.data.activeRunId);
  await postAppNote(flow.data.conversationId, `Stopped the builder ⇄ QC loop${p.reason ? `: ${p.reason}` : ''}. \`${flow.data.branch}\` keeps what was committed. Rebuild, review or start over from here.`);
  return { stage: 'idle', note: 'Stopped. Next: submit_revision to rebuild, request_review to review as it is, or propose_report_work to start over.' };
}

export async function flowSummary(parentRunId?: string | null) {
  const { storyNumber } = await storyChat(parentRunId);
  const flow = await getFlow(storyNumber);
  if (!flow) return { story: storyNumber, stage: 'none' };
  const { plan: _plan, lastBuilder, lastQc, ...rest } = flow.data;
  return { story: storyNumber, stage: flow.stage, ...rest, lastBuilder: lastBuilder?.slice(0, 2000), lastQc: lastQc && { ...lastQc, result: lastQc.result.slice(0, 3000) } };
}

// ---- cards --------------------------------------------------------------------------------------

/** Older Review/Publish cards for the story stop being actionable once the branch moves on. */
async function supersedeFlowCards(storyNumber: string) {
  const rows = await query<{ id: string }>(
    `SELECT id FROM dbo.approvals WHERE kind IN ('pbi_review', 'pbi_publish') AND status = 'pending' AND JSON_VALUE(payload, '$.storyNumber') = ?`,
    [storyNumber],
  );
  for (const { id } of rows) {
    await query(`UPDATE dbo.approvals SET status = 'superseded', outcome = 'Replaced: the branch moved on', decided_at = SYSUTCDATETIME() WHERE id = ?`, [id]);
    publish('approval', await getApproval(id));
  }
}

async function raiseReviewCard(story: string, d: FlowData, qc?: { verdict?: string; result: string }) {
  await supersedeFlowCards(story);
  if (d.worktree) {
    const current = await getFlow(story);
    if (current) await saveFlow(story, current.stage, { ...current.data, reviewSha: await headSha(d.worktree), finalQc: undefined });
  }
  const base = diffBase(d);
  const changed = base && d.worktree ? await changedFiles(d.worktree, base) : [];
  const builder = d.lastBuilder ?? '';
  const card = await createApproval({
    kind: 'pbi_review',
    title: `${story}: review "${d.reportName}"${d.round > 1 ? ` (round ${d.round})` : ''}`,
    payload: {
      conversationId: d.conversationId,
      storyNumber: story,
      round: String(d.round),
      qcVerdict: qc?.verdict ?? 'not run',
      gaps: d.gaps?.length ? `${d.gaps.length} (see the Data gaps card)` : '',
      lint: d.lastLint?.ran ? `${d.lastLint.newErrors} new error(s), ${d.lastLint.newWarnings} new warning(s)` : '',
      summary: (/Summary:\s*([\s\S]*?)(?:\n[A-Z][\w /]+:|$)/.exec(builder)?.[1] ?? builder).trim().slice(0, 1500),
      files: String(changed.length),
      branch: d.branch,
      pbip: d.pbip ?? '',
    },
    requestedByRunId: null,
  });
  await postApprovalCard(d.conversationId, card.id);
}

type CardPayload = Record<string, string> & { conversationId: string; storyNumber: string };

/** Called by approvals.decide before the card is marked. Throwing leaves the card pending. Returns the outcome text. */
export interface PublishChoice {
  /** Proceed-or-pause card: build with the proposed sources, or without the missing data. */
  choice?: 'sources' | 'without';
  /** Data gaps card: put the story in the current sprint or the backlog. */
  sprint?: 'current' | 'backlog';
  workspaceId?: string;
  /** Existing report to update; empty = create a new one. */
  reportId?: string;
  /** Name for the report in Fabric and in the repo. */
  name?: string;
  /** Matt ticked "publish to production" on the card. */
  confirmProduction?: boolean;
}

export async function decideFlowCard(approval: Approval, approve: boolean, note?: string, extra: PublishChoice = {}): Promise<string> {
  const p = JSON.parse(approval.payload) as CardPayload;
  const story = p.storyNumber;
  const withNote = note ? ` (${note})` : '';

  if (approval.kind === 'pbi_start') {
    if (!approve) {
      await sendMessage(p.conversationId, `No, don't start: ${approval.title}.${note ? ` ${note}` : ''}`);
      return 'Rejected in chat';
    }
    assertNotActive(story, await getFlow(story));
    await sendMessage(
      p.conversationId,
      `Yes, go ahead: ${approval.title}${withNote}. Move ${story} to Work in progress now with the work note from the card, then resync. The app is setting up the branch and running the builder/QC loop, and posts progress here.`,
      { answersApprovalId: approval.id },
    );
    const data: FlowData = {
      conversationId: p.conversationId,
      plan: p.plan,
      source: p.source === 'repo' ? 'repo' : 'fabric',
      permitApprovalId: approval.id,
      sourceWorkspaceId: p.workspaceId || undefined,
      sourceWorkspaceName: p.workspaceName || undefined,
      reportId: p.reportId || undefined,
      reportName: p.reportName,
      branch: p.branch,
      folder: p.folder,
      repoReport: p.repoReport || undefined,
      round: 1,
      revisions: [],
    };
    await supersedeFlowCards(story);
    await saveFlow(story, 'pulling', data);
    void pipeline(story, approval.id, async () => {
      await prepare(story);
      await runRound(story);
    });
    return 'Approved: setting up the branch, then building';
  }

  const flow = await getFlow(story);
  if (!flow) throw new Error(`No report workflow for ${story}`);

  if (approval.kind === 'pbi_review') {
    if (approve) {
      assertNotActive(story, flow);
      await saveFlow(story, 'final_qc', flow.data);
      void pipeline(story, approval.id, () => finalQc(story));
      return 'Approved: final QC, then the Publish card';
    }
    await sendMessage(
      p.conversationId,
      `Not ready${note ? `: ${note}` : ''}. Move ${story} back to Work in progress (authorised by the Review card), then resync. Then interview me, one focused round of questions at a time, until you have the complete list of changes. When you have it, call submit_revision with the changes and the acceptance-criteria text.`,
      { answersApprovalId: approval.id },
    );
    await saveFlow(story, 'revising', flow.data);
    return 'Not ready: the orchestrator will ask what to change';
  }

  if (approval.kind === 'pbi_revise') {
    if (!approve) {
      await sendMessage(p.conversationId, `No, don't rebuild yet: ${approval.title}.${note ? ` ${note}` : ''}`);
      return 'Rejected in chat';
    }
    assertNotActive(story, flow);
    await sendMessage(
      p.conversationId,
      `Yes, go ahead: ${approval.title}${withNote}. Move ${story} to Work in progress if it isn't already${p.acceptanceCriteria ? ', add the new acceptance criteria from the card' : ''}, then resync. The app is running the builder/QC loop with these changes.`,
      { answersApprovalId: approval.id },
    );
    const data: FlowData = {
      ...flow.data,
      round: flow.data.round + 1,
      revisions: [...flow.data.revisions, p.changes],
      permitApprovalId: approval.id,
      error: undefined,
      // After a pause for data gaps, the rebuild checks the data again (and stops again if they're still missing).
      ...(flow.data.pausedForGaps ? { pausedForGaps: false, proceedDespiteGaps: false, gapDecision: undefined } : {}),
    };
    await supersedeFlowCards(story);
    await saveFlow(story, data.worktree ? 'building' : 'pulling', data);
    void pipeline(story, approval.id, async () => {
      if (!data.worktree) await prepare(story);
      await runRound(story);
    });
    return 'Approved: rebuilding';
  }

  if (approval.kind === 'pbi_gaps') {
    // Either way, a stop on blocking gaps then asks: proceed with what's possible, or pause?
    const next = async () => {
      if (p.blocked) await raiseProceedCard(story, flow.data);
    };
    if (!approve) {
      await next();
      return 'No story';
    }
    const gaps = realGaps(JSON.parse(p.gaps || '[]') as DataGap[]);
    const desc = (await queryOne<{ d: string | null }>('SELECT short_description AS d FROM dbo.stories WHERE number = ?', [story]))?.d ?? flow.data.reportName;
    const title = `Data Gaps for - ${story} - ${desc}`.slice(0, 160);
    const sprint = extra.sprint === 'current' ? 'in the current sprint' : 'in the backlog (no sprint)';
    await sendMessage(
      p.conversationId,
      [
        `Create one VTB story for the data the ${story} work found missing, ${sprint}${note ? ` (${note})` : ''}.`,
        `Title: "${title}"`,
        '',
        gapsMarkdown(gaps),
        '',
        `Follow the servicenow skill's creating recipe. One story, not one per gap. The description lists every gap above grouped as shown, with what needs it (${story}) and where the data likely comes from; acceptance criteria list each table, column and model addition. Tag it #DWH (and #SemanticModel if it includes model additions). Put it on an approval card and end your turn.`,
      ].join('\n'),
    );
    await next();
    return `Approved: drafting "${title}" ${sprint}`;
  }

  if (approval.kind === 'pbi_proceed') {
    const choice = approve ? (extra.choice === 'sources' ? 'sources' : 'without') : 'pause';
    if (choice !== 'pause') {
      assertNotActive(story, flow);
      const approvedSources =
        choice === 'sources'
          ? blockingGaps(flow.data.gaps).flatMap((g) => (g.proposedSources ?? []).map((s) => ({ ...s, gap: `${g.object}${g.column ? `.${g.column}` : ''}` })))
          : undefined;
      if (choice === 'sources' && !approvedSources?.length) throw new Error('No sources were proposed for these gaps; choose Proceed without, or Pause');
      const data: FlowData = {
        ...flow.data,
        proceedDespiteGaps: true,
        pausedForGaps: false,
        error: undefined,
        gapDecision: { choice, approvedSources, at: new Date().toISOString().slice(0, 10), note },
      };
      await saveFlow(story, 'modeling', data);
      await postAppNote(
        p.conversationId,
        choice === 'sources'
          ? `Proceeding with the proposed sources: the report model builder wires in ${approvedSources!.length} source${approvedSources!.length === 1 ? '' : 's'}, each marked temporary in the model until the data-gaps story is done. Then the report loop runs as usual.`
          : `Proceeding without the missing data: the model and report are built without the parts that need it (they're listed, not faked), then QC and a Review card as usual.`,
      );
      void pipeline(story, approval.id, () => runRound(story));
      return choice === 'sources' ? 'Proceeding with the proposed sources' : 'Proceeding without the gaps';
    }
    await saveFlow(story, 'idle', { ...flow.data, pausedForGaps: true, proceedDespiteGaps: false, gapDecision: undefined });
    await postAppNote(p.conversationId, `Paused until the data gaps are resolved. When they are, ask the orchestrator here to rebuild; it'll check the data again first.`);
    return 'Paused for data gaps';
  }

  if (approval.kind === 'pbi_publish') {
    if (!approve) {
      await postAppNote(p.conversationId, `Publishing skipped${note ? `: ${note}` : ''}. The branch stays local; ask here when you want to publish.`);
      return 'Not published';
    }
    if (!extra.workspaceId) throw new Error('Pick a workspace to publish to');
    assertNotActive(story, flow);
    const ws = (await workspaces()).find((w) => w.id === extra.workspaceId);
    if (!ws) throw new Error("That workspace isn't one you can access");
    if (isBlocked(ws.displayName)) throw new Error(`${ws.displayName.trim()} is on the blocked list (powerbi.blockedWorkspacePatterns); agents never publish there`);
    if (isProduction(ws.displayName) && !extra.confirmProduction) throw new Error(`${ws.displayName.trim()} is a production workspace: tick the production box on the card to publish there`);
    const name = (extra.name ?? flow.data.reportName).trim();
    if (!name || name.length > 200 || /[<>:"/\\|?*]/.test(name)) throw new Error('The report name must be 1–200 characters, without < > : " / \\ | ? *');
    let target: { id: string; name: string } | undefined;
    if (extra.reportId) {
      const found = (await listItems(ws.id, 'Report')).find((i) => i.id === extra.reportId);
      if (!found) throw new Error(`That report isn't in ${ws.displayName.trim()} any more`);
      target = { id: found.id, name: found.displayName };
    }
    await saveFlow(story, 'publishing', flow.data);
    void pipeline(story, approval.id, () => publishFlow(story, ws, approval.id, { target, name, production: isProduction(ws.displayName) }));
    return `Publishing to ${ws.displayName.trim()} as "${name}"…`;
  }

  throw new Error(`Not a workflow card: ${approval.kind}`);
}

/** Runs a background step; a failure is recorded on the flow and posted in the story chat. */
async function pipeline(story: string, approvalId: string, step: () => Promise<void>) {
  try {
    await step();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const flow = await getFlow(story);
    if (flow && flow.stage !== 'idle') {
      await saveFlow(story, 'failed', { ...flow.data, activeRunId: undefined, error: message });
      await postAppNote(flow.data.conversationId, `**Stopped:** ${message}\n\nAsk the orchestrator here to retry (a rebuild card) once it's sorted.`);
    }
    if (approvalId) await setOutcome(approvalId, `Failed: ${message.slice(0, 300)}`).catch(() => undefined);
  }
}

// ---- steps --------------------------------------------------------------------------------------

/** Sets up the story branch: from the repo as it is, or by pulling the report from Fabric into it. */
async function prepare(story: string) {
  const { data } = (await getFlow(story))!;
  const wt = await ensureWorktree(data.branch);
  if (data.source === 'repo') {
    const reportAbs = resolve(wt, data.repoReport!);
    if (!existsSync(join(reportAbs, 'definition.pbir'))) throw new Error(`No report at ${data.repoReport} on ${data.branch}`);
    const local = describeLocal(wt, reportAbs, true);
    await commitAll(wt, `${story}: add .pbip for ${local.reportName}`);
    const next: FlowData = { ...data, worktree: wt, ...local, baseSha: await mergeBase(wt, await freshBase()) };
    await saveFlow(story, 'building', next);
    await postAppNote(data.conversationId, `Working on \`PowerBI/${local.reportDir}\` (*${local.reportName}*) on \`${data.branch}\`, branched from main. Starting the builder ⇄ QC loop.`);
    return;
  }
  await pullFromFabric(story, wt);
}

async function pullFromFabric(story: string, wt: string) {
  const { data } = (await getFlow(story))!;
  const parts = await getDefinition(data.sourceWorkspaceId!, data.reportId!);
  const pbir = partText(parts, 'definition.pbir');
  if (!pbir) throw new Error('The report definition has no definition.pbir');
  const ref = parseModelRef(pbir);
  const model = ref.modelId ? (await listItems(data.sourceWorkspaceId!, 'SemanticModel')).find((m) => m.id === ref.modelId) : undefined;

  const folderRoot = join(wt, data.folder);
  const reportDir = data.repoReport
    ? resolve(wt, data.repoReport)
    : (findItemFolder(folderRoot, 'Report', data.reportName) ?? join(folderRoot, safeName(data.reportName), `${safeName(data.reportName)}.Report`));
  let modelDir: string | undefined;
  if (model) {
    // Keep the model where the repo's report already points, if it does.
    const existing = existsSync(reportDir) ? describeLocal(wt, reportDir, false).modelDir : undefined;
    modelDir = existing
      ? resolve(wt, existing)
      : (findItemFolder(folderRoot, 'SemanticModel', model.displayName) ?? join(dirname(reportDir), `${safeName(model.displayName)}.SemanticModel`));
    writeParts(modelDir, await getDefinition(data.sourceWorkspaceId!, model.id, 'TMDL'));
  }
  // Locally the report points at the model folder next to it, so Desktop opens both; publish re-points it.
  const localPbir = modelDir ? pbirByPath(pbir, relative(reportDir, modelDir).replace(/\\/g, '/')) : pbir;
  writeParts(reportDir, [...parts.filter((x) => x.path !== 'definition.pbir'), textPart('definition.pbir', localPbir)]);
  const local = describeLocal(wt, reportDir, true);

  const sha = (await commitAll(wt, `${story}: pull "${data.reportName}" from ${data.sourceWorkspaceName} (unchanged)`)) ?? (await headSha(wt));
  const next: FlowData = {
    ...data,
    worktree: wt,
    reportDir: local.reportDir,
    modelDir: local.modelDir,
    pbip: local.pbip,
    modelId: model?.id,
    modelName: model?.displayName,
    thinReportNote: model ? undefined : `The report uses a semantic model outside ${data.sourceWorkspaceName}${ref.modelName ? ` ("${ref.modelName}"${ref.workspaceName ? ` in ${ref.workspaceName}` : ''})` : ''}; only the report was pulled.`,
    baseSha: sha,
  };
  await saveFlow(story, 'building', next);
  await postAppNote(
    data.conversationId,
    `Pulled *${data.reportName}*${model ? ` and its model *${model.displayName}*` : ''} from ${data.sourceWorkspaceName} into \`PowerBI/${local.reportDir}\` on \`${data.branch}\` (commit ${sha.slice(0, 7)}).${next.thinReportNote ? `\n\n${next.thinReportNote}` : ''}\n\nStarting the builder ⇄ QC loop.`,
  );
}

/** Runs a worker for the loop. Returns undefined if the loop was stopped meanwhile. */
async function runWorker(worker: string, brief: string, story: string, projectPath: string, stage: Stage = 'building'): Promise<Run | undefined> {
  const run = await createRun({
    kind: 'worker',
    worker,
    storyNumber: story,
    title: `${worker} · ${story}: ${brief.split('\n')[0].slice(0, 100)}`,
    meta: { brief, projectPath, flow: true },
  });
  const before = await getFlow(story);
  if (before?.stage !== stage) return undefined;
  await saveFlow(story, stage, { ...before.data, activeRunId: run.id });
  await startWorkerRun(run.id);
  const after = await getFlow(story);
  if (after?.stage !== stage) return undefined; // stopped while it ran
  await saveFlow(story, stage, { ...after.data, activeRunId: undefined });
  return getRun(run.id);
}

async function buildLoop(story: string) {
  let { data } = (await getFlow(story))!;
  const base = diffBase(data);
  if (!data.worktree || !data.reportDir || !base) throw new Error('The branch was never set up; start over with a new start card');
  const wt = data.worktree;
  const label = data.round > 1 ? ` (round ${data.round})` : '';
  let findings: string | undefined;
  let builder = '';
  let qc: { verdict?: string; result: string } = { result: '' };
  let lint: LintDiff | undefined;
  let gaps: DataGap[] = [];
  // The builder checks what the work needs against gold; the catalog is rebuilt when it's more than a day old.
  const catalog = await ensureCatalog();
  let handbacks = 0;

  for (let pass = 1; pass <= 3; pass++) {
    await postAppNote(data.conversationId, `Builder pass ${pass}${label} started.`);
    const b = await runWorker('pbi-builder', builderBrief(story, data, pass, findings, catalog), story, wt);
    if (!b) return;
    if (b.status !== 'succeeded') throw new Error(`Builder pass ${pass} ${b.status}${b.error ? `: ${b.error}` : ''}`);
    builder = b.result ?? '';
    gaps = mergeGaps(gaps, parseGaps(builder));
    await commitAll(wt, `${story}: builder pass ${pass} (changes the builder left uncommitted)`);

    // The report builder found something the model should provide (or a problem with it): back to the model builder,
    // then the same builder pass again on the updated model.
    const requests = parseModelRequests(builder);
    if (requests.length && handbacks < 2) {
      handbacks++;
      await postAppNote(data.conversationId, `The report builder sent ${requests.length} request${requests.length === 1 ? '' : 's'} back to the report model builder:\n${requests.map((r) => `- ${r.need}: ${r.what}`).join('\n')}`);
      if (!(await modelStep(story, requests))) return;
      data = (await getFlow(story))!.data;
      pass--;
      continue;
    }

    // Blocking gaps stop the loop before QC and further passes: no half-built report, no Review card. Matt decides
    // on the Data gaps card (a story?) and then on Proceed or pause.
    const blocking = blockingGaps(gaps);
    if (blocking.length && !data.proceedDespiteGaps) {
      const cur = await getFlow(story);
      if (cur?.stage !== 'building') return;
      const next: FlowData = { ...cur.data, gaps, lastBuilder: builder };
      await saveFlow(story, 'gaps', next);
      await postAppNote(
        data.conversationId,
        `**Stopped:** the builder found ${blocking.length} blocking data gap${blocking.length === 1 ? '' : 's'}, so it didn't build the parts that need ${blocking.length === 1 ? 'it' : 'them'} and QC didn't run. Decide on the Data gaps card below, then choose whether to proceed with what's possible or pause.`,
      );
      await raiseGapsCard(story, next, gaps, true);
      return;
    }

    const files = await changedFiles(wt, base);
    const stat = await diffStat(wt, base);
    lint = await lintBranch({ worktree: wt, reportRel: data.reportDir!, baseSha: base });
    const q = await runWorker('pbi-qc', qcBrief(story, data, pass, files, stat, lintSummary(lint), findings), story, wt);
    if (!q) return;
    if (q.status !== 'succeeded') throw new Error(`QC review ${pass} ${q.status}${q.error ? `: ${q.error}` : ''}`);
    qc = withLint({ verdict: parseMeta<{ verdict?: string }>(q).verdict, result: q.result ?? '' }, lint);
    const final = qc.verdict === 'PASS' || pass === 3;
    await postAppNote(
      data.conversationId,
      `QC review ${pass}${label}: **${qc.verdict ?? 'no verdict'}**${lint.ran ? ` (house linter: ${lint.newErrors.length} new error(s), ${lint.newWarnings.length} new warning(s))` : ''}${final ? '' : '. Sending the findings back to the builder.'}`,
    );
    if (qc.verdict === 'PASS') break;
    findings = qc.result;
  }

  const current = await getFlow(story);
  if (current?.stage !== 'building') return;
  // The model builder's gaps stay; the report builder's are added. Only gaps nobody has offered yet get a new card.
  const known = new Set((current.data.gaps ?? []).map(gapKey));
  const fresh = gaps.filter((g) => !known.has(gapKey(g)));
  const next: FlowData = { ...current.data, lastBuilder: builder, lastQc: qc, lastLint: lint && lintCounts(lint), gaps: mergeGaps(current.data.gaps, gaps) };
  await saveFlow(story, 'review', next);
  if (realGaps(fresh).length && !current.data.proceedDespiteGaps) await raiseGapsCard(story, next, fresh, false);
  await raiseReviewCard(story, next, qc);
}

/** New linter errors fail QC whatever the QC run said (Matt's rule, 2026-10-19); the linter's findings lead the result. */
function withLint<T extends { verdict?: string; result: string }>(qc: T, lint: LintDiff): T {
  if (!lint.ran) return qc;
  const failed = lint.newErrors.length > 0;
  return {
    ...qc,
    verdict: failed ? 'FAIL' : qc.verdict,
    result: `${failed && qc.verdict === 'PASS' ? 'FAIL (house linter: new errors on this branch)\n\n' : ''}${lintSummary(lint)}\n\n${qc.result}`,
  };
}

const lintCounts = (l: LintDiff) => ({ ran: l.ran, newErrors: l.newErrors.length, newWarnings: l.newWarnings.length, preexisting: l.preexisting.errors + l.preexisting.warnings });

function builderBrief(story: string, d: FlowData, pass: number, findings?: string, catalog: { db: string; path: string; asOf: string | null; error?: string }[] = []): string {
  const wt = d.worktree!;
  return [
    pass === 1 && d.round === 1
      ? `Story ${story}: implement the plan below.`
      : pass === 1
        ? `Story ${story}, round ${d.round}: make the changes under "Revisions" (the latest round is the one to do now).`
        : `Story ${story}, pass ${pass}: fix QC's findings below. Change only what they require.`,
    `## Plan (approved by Matt)\n${d.plan}`,
    d.revisions.length && `## Revisions Matt asked for\n${d.revisions.map((r, i) => `### Round ${i + 2}\n${r}`).join('\n\n')}`,
    findings && `## QC findings to fix\n${findings}`,
    d.modelHandoff && `## The model is ready (from the report model builder)\n${d.modelHandoff}\n\nBuild the report on this model. Don't change its tables, sources or relationships; add report-level measures if you need them. If the model is missing something the report needs, or something in it is wrong, don't work around it: say so in a model-requests block and stop, and the app sends it back to the report model builder.`,
    d.proceedDespiteGaps && d.gaps?.length && `## Matt chose to proceed despite these data gaps\n${gapsMarkdown(d.gaps)}\n\nBuild everything that doesn't depend on them. Leave out the parts that do (no placeholder or invented data) and list them under Open questions. Still end with a data-gaps block.`,
    [
      '## Where',
      `- Git worktree: ${wt}. It's already on branch \`${d.branch}\`; stay on it (don't create or switch branches).`,
      `- Report: ${join(wt, d.reportDir!)}. Keep its current format (PBIR-Legacy report.json or PBIR definition/).`,
      d.modelDir ? `- Semantic model (TMDL): ${join(wt, d.modelDir)}` : `- No semantic model in the repo: ${d.thinReportNote ?? 'thin report'} Report changes only; say so if the plan needs model changes.`,
      `- Work only in those folders. Commit with \`git -C "${wt}" commit\` and a message starting with ${story}. Don't push.`,
      `- What gold has: ${catalog.filter((c) => c.asOf).map((c) => `\`${c.path}\` (${c.db}, as of ${c.asOf!.slice(0, 16).replace('T', ' ')} UTC)`).join(' and ') || 'no catalog available: report gaps you can\'t confirm as kind "unknown"'}. Tab-separated: object (db.schema.table), kind, column, type. Grep it to check every table and column the work needs.`,
      `- House linter: before you commit, run \`py .claude/skills/arco-dwh-powerbi/scripts/check_pbir.py "${join(wt, d.reportDir!)}"\` and fix every ERROR your change introduced. Errors that were there before the branch are out of scope unless the plan says otherwise. The app runs it too, and new errors fail QC.`,
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function qcBrief(story: string, d: FlowData, pass: number, files: string[], stat: string, lint: string, previous?: string): string {
  const wt = d.worktree!;
  return [
    `Story ${story}: QC review ${pass}${pass === 3 ? ' (final confirmation)' : ''} of "${d.reportName}".`,
    `Target project: ${join(wt, dirname(d.reportDir!))} (report ${basename(d.reportDir!)}${d.modelDir ? `, model ${basename(d.modelDir)}` : ''}).`,
    `## The branch's changes (the app ran git for you: \`git diff --stat ${diffBase(d)!.slice(0, 7)} HEAD\`)\n\`\`\`\n${stat || '(no changes)'}\n\`\`\`\n${files.map((f) => `- ${join(wt, f)}`).join('\n')}`,
    `This list is authoritative for the diff scope. Don't fail a rule only because you can't run git yourself. Review the changed files against your rules, and check that the plan${d.revisions.length ? ', the revisions' : ''} and the story's acceptance criteria are met.`,
    `## House linter (the app ran it on the branch and on its starting point)\n${lint}\n\nThe linter covers the mechanical house rules. Report its new findings in your table, don't re-derive them, and spend your review on the rules it can't check (see qc-rules.md).`,
    `## Plan\n${d.plan}`,
    d.revisions.length && `## Revisions\n${d.revisions.join('\n\n')}`,
    approvedSourcesText(d),
    previous && `## Previous QC findings: confirm each one is fixed\n${previous}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** "Open" on the Review card: launches the .pbip in Power BI Desktop; the first open per round also moves the story. */
export async function openForReview(story: string, approvalId?: string): Promise<{ opened: string; laneMove: 'requested' | 'already' | 'chat_busy' }> {
  const flow = await getFlow(story);
  if (!flow?.data.worktree || !flow.data.pbip) throw new Error(`No report branch for ${story}`);
  const wt = resolve(flow.data.worktree);
  const pbip = resolve(wt, flow.data.pbip);
  if (relative(resolve(config.powerbi.worktreeRoot), pbip).startsWith('..') || !existsSync(pbip)) throw new Error(`Report project not found: ${pbip}`);
  spawn('explorer.exe', [pbip], { detached: true, stdio: 'ignore', windowsHide: false }).unref();

  const d = flow.data;
  if (d.movedToReadyRound === d.round) return { opened: pbip, laneMove: 'already' };
  try {
    await sendMessage(
      d.conversationId,
      [
        `I'm opening ${story} in Power BI Desktop to review it. Move ${story} to Ready for testing now (authorised by the Review card) with a work note in the standard format, then resync. Use these details:`,
        `- Summary: ${(d.lastBuilder ?? '').slice(0, 1200)}`,
        `- QC result: ${d.lastQc?.verdict ?? 'not run'}: ${(d.lastQc?.result ?? '').split('\n').slice(0, 3).join(' ').slice(0, 400)}`,
        `- Branch/PR: ${d.branch} (PR opens when I approve publishing)`,
        `- Needs: Matt's review in Power BI Desktop`,
      ].join('\n'),
      // The Review card itself authorises this move; older flows fall back to their start/rebuild card.
      { answersApprovalId: approvalId ?? d.permitApprovalId },
    );
  } catch {
    return { opened: pbip, laneMove: 'chat_busy' };
  }
  await saveFlow(story, flow.stage, { ...d, movedToReadyRound: d.round });
  return { opened: pbip, laneMove: 'requested' };
}

/** Which items a publish touched, for the chat note. */
interface Touched {
  report: string;
  model?: string;
}

async function publishFlow(story: string, ws: Workspace, approvalId: string, choice: { target?: { id: string; name: string }; name: string; production?: boolean }) {
  const before = (await getFlow(story))!.data;
  const wt = before.worktree!;
  const wsName = ws.displayName.trim();
  // Anything Matt saved in Desktop during review goes in too.
  await commitAll(wt, `${story}: changes saved in Power BI Desktop during review`);
  const qcd = before.finalQc;
  const afterQc = qcd ? await changedFiles(wt, qcd.sha) : [];
  // The name on the card becomes the name in the repo too, so git and Fabric match.
  const modelFollows = !!before.modelName && before.modelName === before.reportName;
  let data = await renameInRepo(story, before, choice.name);
  // The app's own rename commit isn't a change QC needs to see: if QC covered everything before it, it still covers the branch.
  if (data !== before && qcd && afterQc.length === 0) data = { ...data, finalQc: { ...qcd, sha: await headSha(wt) } };
  if (data !== before) await saveFlow(story, 'publishing', data);

  const targetItems = await listItems(ws.id);
  let modelId = data.modelId;
  let modelCreated: boolean | undefined;
  const touched: Touched = { report: '' };
  if (data.modelDir && data.modelName) {
    const parts = readParts(join(wt, data.modelDir));
    // Updating an existing report: update the model it's bound to (if that model is in this workspace).
    let bound: string | undefined;
    if (choice.target) {
      const pbirText = partText(await getDefinition(ws.id, choice.target.id), 'definition.pbir');
      const ref = pbirText ? parseModelRef(pbirText) : {};
      bound = targetItems.find((i) => i.type === 'SemanticModel' && i.id === ref.modelId)?.id;
    }
    const existing = bound ? targetItems.find((i) => i.id === bound) : targetItems.find((i) => i.type === 'SemanticModel' && i.displayName === data.modelName);
    if (existing) {
      await updateDefinition(ws.id, existing.id, parts, 'TMDL');
      modelId = existing.id;
      if (modelFollows && existing.displayName !== data.modelName) await renameItem(ws.id, existing.id, data.modelName);
      touched.model = `updated model "${existing.displayName}"${modelFollows && existing.displayName !== data.modelName ? ` (renamed to "${data.modelName}")` : ''}`;
    } else {
      modelId = (await createItem(ws.id, { displayName: data.modelName, type: 'SemanticModel', parts, format: 'TMDL' })).id;
      modelCreated = true;
      touched.model = `created model "${data.modelName}"`;
    }
  }

  const reportDir = join(wt, data.reportDir!);
  const localPbir = readFileSync(join(reportDir, 'definition.pbir'), 'utf8');
  const pbir = data.modelDir && data.modelName && modelId ? pbirByConnection(localPbir, wsName, data.modelName, modelId) : localPbir;
  if (JSON.parse(pbir)?.datasetReference?.byPath) throw new Error("The report points at a model folder the app couldn't find, so it can't be published");
  const parts = [...readParts(reportDir).filter((x) => x.path !== 'definition.pbir'), textPart('definition.pbir', pbir)];
  const format = parts.some((x) => x.path === 'report.json') ? 'PBIR-Legacy' : 'PBIR';
  const existingReport = choice.target;
  let reportId: string;
  if (existingReport) {
    await updateDefinition(ws.id, existingReport.id, parts, format);
    if (existingReport.name !== data.reportName) await renameItem(ws.id, existingReport.id, data.reportName);
    reportId = existingReport.id;
    touched.report = `updated report "${existingReport.name}"${existingReport.name !== data.reportName ? ` (renamed to "${data.reportName}")` : ''}`;
  } else {
    reportId = (await createItem(ws.id, { displayName: data.reportName, type: 'Report', parts, format })).id;
    touched.report = `created report "${data.reportName}"`;
  }
  const reportUrl = `https://app.powerbi.com/groups/${ws.id}/reports/${reportId}`;
  const published = { workspaceId: ws.id, workspaceName: wsName, reportUrl, modelCreated, reportCreated: !existingReport };
  await saveFlow(story, 'publishing', { ...data, published });

  let prUrl: string | undefined;
  let prError: string | undefined;
  try {
    await pushBranch(wt, data.branch);
    prUrl = await openPullRequest({
      branch: data.branch,
      title: `${story}: ${data.reportName}`,
      description: [
        `ServiceNow story ${story}.`,
        `Summary: ${(data.lastBuilder ?? '').slice(0, 1500)}`,
        `Final QC before publishing: ${qcd?.verdict ?? 'not run'}${afterQc.length ? ` (${afterQc.length} files changed after it and weren't QC'd)` : ''}`,
        `Published to the ${wsName} workspace: ${reportUrl}`,
        '',
        '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
      ].join('\n\n'),
    });
  } catch (err) {
    prError = err instanceof Error ? err.message : String(err);
  }
  await saveFlow(story, 'published', { ...data, published, prUrl, error: prError });
  await setOutcome(approvalId, `Published to ${wsName}${prUrl ? '; PR opened' : `; PR failed: ${prError?.slice(0, 200)}`}`);
  await postAppNote(
    data.conversationId,
    [
      `**Published** to **${wsName}**${choice.production ? ' (production)' : ''}: ${[touched.report, touched.model].filter(Boolean).join('; ')}. [Open in Power BI](${reportUrl})`,
      data.reportName !== before.reportName && `Renamed in the repo too: \`${before.reportDir}\` → \`${data.reportDir}\`.`,
      afterQc.length > 0 && `**Heads up:** ${afterQc.length} file(s) changed after the final QC (saved in Desktop after it ran), so QC didn't see them: ${afterQc.slice(0, 5).map((f) => `\`${f}\``).join(', ')}${afterQc.length > 5 ? ', …' : ''}.`,
      prUrl ? `**Pull request:** [${prUrl.split('/').pop()}](${prUrl}). Merging it is yours.` : `**PR not opened:** ${prError}`,
      `Still yours: ${[data.modelName && (modelCreated ? "set the new model's data source credentials and refresh it" : 'refresh the model if its schema changed'), 'merge the PR', 'update the app'].filter(Boolean).join(', ')}.`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  );
  // Last step: how much time to log for the story (a failure here mustn't look like a failed publish). A story already
  // in close-out (published before) gets its last time card from the Close story card instead.
  const inCloseout = await queryOne('SELECT 1 AS x FROM dbo.story_checklists WHERE story_number = ?', [story]);
  if (!inCloseout) await askTimeEntry(data.conversationId, story).catch((err) => postAppNote(data.conversationId, `Couldn't put up the Timesheet card: ${err instanceof Error ? err.message : err}`));
  // From here the rollout is Matt's: his close-out list keeps the story open until it's done.
  await startCloseout(story).catch(() => undefined);
}

/** Sets an item folder's .platform display name (creating .platform if the folder has none). */
function setDisplayName(dirAbs: string, type: 'Report' | 'SemanticModel', name: string) {
  const path = join(dirAbs, '.platform');
  const json = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : {
        $schema: 'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json',
        metadata: { type },
        config: { version: '2.0', logicalId: randomUUID() },
      };
  json.metadata = { ...json.metadata, displayName: name };
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
}

/** git mv that also works for a case-only rename on Windows (via a temporary name). */
async function gitMove(wt: string, from: string, to: string) {
  if (from === to) return;
  if (from.toLowerCase() === to.toLowerCase()) {
    const tmp = `${from}.renaming`;
    await git(wt, ['mv', from, tmp]);
    await git(wt, ['mv', tmp, to]);
  } else {
    if (existsSync(join(wt, to))) throw new Error(`Can't rename to ${to}: it already exists in the repo`);
    await git(wt, ['mv', from, to]);
  }
}

/**
 * Renames the report in the repo: .platform display name, X.Report folder and X.pbip (and the model, when it had the
 * report's name). The parent folder stays. Commits the rename and returns the updated flow data.
 */
export async function renameInRepo(story: string, d: FlowData, name: string): Promise<FlowData> {
  const oldName = d.reportName;
  if (name === oldName) return d;
  const wt = d.worktree!;
  const posixRel = (p: string) => p.replace(/\\/g, '/');
  const safe = safeName(name);
  const reportRel = d.reportDir!;
  const parentRel = posix.dirname(reportRel);
  const newReportRel = posix.join(parentRel, `${safe}.Report`);
  let newModelRel = d.modelDir;
  let modelName = d.modelName;

  setDisplayName(join(wt, reportRel), 'Report', name);
  if (d.modelDir && d.modelName === oldName) {
    setDisplayName(join(wt, d.modelDir), 'SemanticModel', name);
    newModelRel = posix.join(posix.dirname(d.modelDir), `${safe}.SemanticModel`);
    await gitMove(wt, d.modelDir, newModelRel);
    modelName = name;
  }
  await gitMove(wt, reportRel, newReportRel);
  // The report's local model path and the .pbip's report path follow the new folder names.
  const pbirPath = join(wt, newReportRel, 'definition.pbir');
  const pbir = JSON.parse(readFileSync(pbirPath, 'utf8'));
  if (pbir?.datasetReference?.byPath && newModelRel) {
    pbir.datasetReference.byPath.path = posixRel(relative(join(wt, newReportRel), join(wt, newModelRel)));
    writeFileSync(pbirPath, JSON.stringify(pbir, null, 2) + '\n');
  }
  let newPbipRel = d.pbip;
  if (d.pbip && existsSync(join(wt, d.pbip))) {
    const pbip = JSON.parse(readFileSync(join(wt, d.pbip), 'utf8'));
    for (const a of pbip.artifacts ?? []) if (a.report?.path === posix.basename(reportRel)) a.report.path = posix.basename(newReportRel);
    writeFileSync(join(wt, d.pbip), JSON.stringify(pbip, null, 2) + '\n');
    newPbipRel = posix.join(posix.dirname(d.pbip), `${safe}.pbip`);
    await gitMove(wt, d.pbip, newPbipRel);
  }
  // Desktop's local files (.pbi/) aren't tracked, so git mv leaves them behind; move what's left.
  for (const [from, to] of [[reportRel, newReportRel], [d.modelDir, newModelRel]] as const) {
    if (from && to && from !== to && existsSync(join(wt, from, '.pbi')) && !existsSync(join(wt, to, '.pbi'))) renameSync(join(wt, from, '.pbi'), join(wt, to, '.pbi'));
  }
  await commitAll(wt, `${story}: rename report "${oldName}" to "${name}"`);
  return { ...d, reportName: name, modelName, reportDir: newReportRel, modelDir: newModelRel, pbip: newPbipRel };
}

/**
 * Between Matt's review and the Publish card: commit what he saved in Desktop, run pbi-qc once more on exactly what
 * will be published, post the report, then put the Publish card up with the verdict. A FAIL doesn't block
 * publishing; Matt decides with the report in front of him.
 */
async function finalQc(story: string) {
  const { data } = (await getFlow(story))!;
  const wt = data.worktree!;
  const base = diffBase(data)!;
  await commitAll(wt, `${story}: changes saved in Power BI Desktop during review`);
  const sha = await headSha(wt);
  const files = await changedFiles(wt, base);
  const stat = await diffStat(wt, base);
  const manual = data.reviewSha ? await changedFiles(wt, data.reviewSha) : [];
  await postAppNote(
    data.conversationId,
    `Final QC started on exactly what will be published (${files.length} files changed on the branch${manual.length ? `, including ${manual.length} you changed in Desktop during review` : ''}).`,
  );

  const lint = await lintBranch({ worktree: wt, reportRel: data.reportDir!, baseSha: base });
  let qc: { verdict?: string; result: string; runId?: string } = { verdict: 'not run', result: '' };
  const q = await runWorker('pbi-qc', finalQcBrief(story, data, files, stat, manual, lintSummary(lint)), story, wt, 'final_qc');
  if (!q) return; // stopped
  if (q.status === 'succeeded') qc = { verdict: parseMeta<{ verdict?: string }>(q).verdict ?? 'no verdict', result: q.result ?? '', runId: q.id };
  else qc = { verdict: 'not run', result: `QC didn't finish (${q.status}${q.error ? `: ${q.error}` : ''}).`, runId: q.id };
  qc = withLint(qc, lint);

  const current = await getFlow(story);
  if (current?.stage !== 'final_qc') return;
  const next: FlowData = { ...current.data, finalQc: { ...qc, sha } };
  await saveFlow(story, 'review', next);
  await postAppNote(data.conversationId, `**Final QC: ${qc.verdict}**\n\n${qc.result.slice(0, 6000)}`);
  await raisePublishCard(story, next, qc, manual.length);
}

async function raisePublishCard(story: string, d: FlowData, qc: { verdict?: string; result: string; runId?: string }, manualFiles: number) {
  const card = await createApproval({
    kind: 'pbi_publish',
    title: `${story}: publish "${d.reportName}"${d.prUrl ? '' : ' and open the PR'}`,
    payload: {
      conversationId: d.conversationId,
      storyNumber: story,
      reportName: d.reportName,
      modelName: d.modelName ?? '',
      branch: d.branch,
      qcVerdict: qc.verdict ?? 'not run',
      qcReport: qc.result.slice(0, 8000),
      manualFiles: String(manualFiles),
      qcRunId: qc.runId ?? '',
      published: d.published ? `${d.published.workspaceName}` : '',
    },
    requestedByRunId: null,
  });
  await postApprovalCard(d.conversationId, card.id);
}

function finalQcBrief(story: string, d: FlowData, files: string[], stat: string, manual: string[], lint: string): string {
  const wt = d.worktree!;
  return [
    `Story ${story}: FINAL pre-publish QC of "${d.reportName}". Matt has reviewed the report in Power BI Desktop and approved it. This is exactly what will be published to Fabric and go into the PR, so report every issue you see.`,
    `Target project: ${join(wt, dirname(d.reportDir!))} (report ${basename(d.reportDir!)}${d.modelDir ? `, model ${basename(d.modelDir)}` : ''}).`,
    `## Everything this branch changes (the app ran git for you: \`git diff --stat ${diffBase(d)!.slice(0, 7)} HEAD\`)\n\`\`\`\n${stat || '(no changes)'}\n\`\`\`\n${files.map((f) => `- ${join(wt, f)}`).join('\n')}`,
    manual.length
      ? `## Changed by Matt in Desktop during his review (not seen by any earlier QC run: look at these closely)\n${manual.map((f) => `- ${join(wt, f)}`).join('\n')}`
      : '## Changed by Matt in Desktop during his review\nNothing.',
    "This list is authoritative for the diff scope. Don't fail a rule only because you can't run git. Check the changed files against your rules, and check that the plan, the revisions and the story's acceptance criteria are met. Issues that were already there before this branch are PRE-EXISTING (out of scope), as your lessons say.",
    `## House linter (the app ran it on what will be published, and on the starting point)\n${lint}\n\nReport its new findings in your table. New linter errors fail this QC whatever else you find.`,
    `## Plan\n${d.plan}`,
    d.revisions.length && `## Revisions\n${d.revisions.join('\n\n')}`,
    'After your usual PASS/FAIL line and table, add:\n\n### What is being published\n3–6 plain bullets: what changes for report users, anything risky, and anything Matt should check after publishing.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * "Publish it again" (e.g. Acceptance first, then production): a Publish card for the branch as it is. If anything
 * changed since the last final QC (or there wasn't one), the final QC runs first, as after a review.
 */
export async function requestPublish(p: { parentRunId?: string | null }) {
  const { storyNumber } = await storyChat(p.parentRunId);
  const flow = await getFlow(storyNumber);
  if (!flow?.data.worktree) throw new Error(`${storyNumber} has no report branch in the workflow (propose_report_work or attach_report_work first)`);
  assertNotActive(storyNumber, flow);
  const wt = flow.data.worktree;
  await commitAll(wt, `${storyNumber}: changes saved in Power BI Desktop`);
  const head = await headSha(wt);
  const qc = flow.data.finalQc;
  await supersedeFlowCards(storyNumber);
  if (qc && qc.sha === head) {
    await raisePublishCard(storyNumber, flow.data, qc, 0);
    return { status: 'publish card posted', note: "Nothing changed since the final QC, so the Publish card is up. End your turn." };
  }
  await saveFlow(storyNumber, 'final_qc', { ...flow.data, reviewSha: flow.data.reviewSha ?? head });
  void pipeline(storyNumber, '', () => finalQc(storyNumber));
  return { status: 'final QC running', note: 'The branch changed since the last final QC (or there was none), so QC runs first; the Publish card follows. End your turn.' };
}

const GAP_LABEL: Record<DataGap['kind'], string> = {
  missing_table: 'Table not in gold',
  missing_column: 'Column missing from a gold table',
  not_in_model: 'In gold, not in the semantic model',
  unknown: "Couldn't confirm",
  derivable: 'Derivable from existing data (not a gap, no story)',
};

export function gapsMarkdown(gaps: DataGap[]): string {
  const order: DataGap['kind'][] = ['missing_table', 'missing_column', 'not_in_model', 'unknown', 'derivable'];
  return order
    .filter((k) => gaps.some((g) => g.kind === k))
    .map((k) =>
      [
        `**${GAP_LABEL[k]}**`,
        ...gaps
          .filter((g) => g.kind === k)
          .map((g) => `- \`${g.object}${g.column ? `.${g.column}` : ''}\`${g.blocking ? ' (blocking)' : ''}: ${g.neededFor || 'needed by the work'}${g.derivation ? `. Derive: ${g.derivation}` : ''}${g.sourceHint ? `. Source: ${g.sourceHint}` : ''}${g.checked ? `. Checked: ${g.checked}` : ''}${g.notes ? `. ${g.notes}` : ''}`),
      ].join('\n'),
    )
    .join('\n\n');
}

/** The Data gaps card: everything the builder found missing, and a button that asks the orchestrator to draft stories. */
async function raiseGapsCard(story: string, d: FlowData, gaps: DataGap[], blocked: boolean) {
  const real = realGaps(gaps);
  const derivable = gaps.length - real.length;
  const nBlocking = blockingGaps(gaps).length;
  const card = await createApproval({
    kind: 'pbi_gaps',
    title: `${story}: ${real.length} data gap${real.length === 1 ? '' : 's'}${nBlocking ? ` (${nBlocking} blocking)` : ''}${derivable ? `, ${derivable} derivable` : ''}`,
    payload: { conversationId: d.conversationId, storyNumber: story, gaps: JSON.stringify(gaps), preview: gapsMarkdown(gaps), blocked: blocked ? '1' : '' },
    requestedByRunId: null,
  });
  await postApprovalCard(d.conversationId, card.id);
}

/** After a stop on blocking gaps (and the gaps story decision): build what's possible now, or wait for the data? */
async function raiseProceedCard(story: string, d: FlowData) {
  const blocking = blockingGaps(d.gaps);
  const card = await createApproval({
    kind: 'pbi_proceed',
    title: `${story}: ${blocking.length} blocking data gap${blocking.length === 1 ? '' : 's'}: proceed or pause?`,
    payload: {
      conversationId: d.conversationId,
      storyNumber: story,
      preview: [
        `The work stopped because ${blocking.length === 1 ? 'this is' : 'these are'} missing from gold:`,
        gapsMarkdown(blocking),
        sourcesMarkdown(blocking),
        "**Proceed with these sources:** the report model builder wires in exactly the sources above, each marked temporary in the model (approved by you, to repoint to gold when the data-gaps story is done). Then the report loop as usual.",
        "**Proceed without:** build everything that doesn't depend on the gaps (no placeholder data; the parts that need them are left out and listed), then QC and a Review card as usual.",
        "**Pause:** nothing more is built. When the gaps are resolved, ask the orchestrator here to rebuild; it checks the data again first.",
      ].join('\n\n'),
      hasSources: blocking.some((g) => g.proposedSources?.length) ? '1' : '',
    },
    requestedByRunId: null,
  });
  await postApprovalCard(d.conversationId, card.id);
}

// ---- the report model step (pbi-report-model-builder) ------------------------------------------------

/** One round: the report model builder on the report's own model, then (unless it stopped on gaps) the report loop. */
async function runRound(story: string) {
  if (await modelStep(story)) await buildLoop(story);
}

/** The `## Model handoff` section of the model builder's result (up to the data-gaps block). */
export function handoffOf(result: string): string | undefined {
  const m = /##\s*Model handoff\s*\n([\s\S]*?)(?:```data-gaps|$)/i.exec(result);
  return m?.[1]?.trim().slice(0, 6000) || undefined;
}

export function sourcesMarkdown(gaps: DataGap[]): string {
  const rows = gaps.flatMap((g) => (g.proposedSources ?? []).map((s) => ({ g, s })));
  if (!rows.length) return '_No alternative sources were proposed._';
  return [
    '**Proposed sources (silver first, then source bronze)**',
    ...rows.map(
      ({ g, s }) =>
        `- For \`${g.object}${g.column ? `.${g.column}` : ''}\`: \`${s.object}${s.column ? `.${s.column}` : ''}\`${s.layer ? ` (${s.layer})` : ''}${s.join ? `, joined on ${s.join}` : ''}${s.why ? `. ${s.why}` : ''}`,
    ),
  ].join('\n');
}

/** For QC: tables reading these sources are Matt-approved temporary exceptions (QC-01 passes them with a note). */
function approvedSourcesText(d: FlowData): string | false {
  const srcs = d.gapDecision?.choice === 'sources' ? d.gapDecision.approvedSources : undefined;
  if (!srcs?.length) return false;
  return `## Temporary sources Matt approved on ${d.gapDecision!.at}\nThese silver / bronze sources are approved exceptions to the gold-only rule, each to be marked in the model with an \`ARCO_TemporarySource\` annotation. Pass them with a note (QC-01); any OTHER silver / bronze source still fails.\n${srcs.map((s) => `- ${s.object}${s.column ? `.${s.column}` : ''} (for ${s.gap})`).join('\n')}`;
}

function modelBrief(
  story: string,
  d: FlowData,
  pass: number,
  catalog: { db: string; path: string; asOf: string | null }[],
  ontology: { path: string; asOf: string | null; entities: number; error?: string },
  findings?: string,
  requests: ModelRequest[] = [],
): string {
  const wt = d.worktree!;
  const decision = d.gapDecision;
  return [
    pass === 1
      ? `Story ${story}${d.round > 1 ? `, round ${d.round}` : ''}: build the semantic model for the report below so the report builder can build the report on it.`
      : `Story ${story}: fix the model QC findings below. Change only what they require.`,
    `## Plan (approved by Matt)\n${d.plan}`,
    d.revisions.length && `## Revisions Matt asked for\n${d.revisions.map((r, i) => `### Round ${i + 2}\n${r}`).join('\n\n')}`,
    findings && `## Model QC findings to fix\n${findings}`,
    requests.length && `## The report builder needs these from the model\nIt stopped on these while building the report. Resolve each one (add, derive, fix), or explain in your handoff why not:\n${requests.map((r) => `- ${r.need}: ${r.what}${r.why ? ` (${r.why})` : ''}`).join('\n')}`,
    d.approvedMappings?.length && `## Name mappings Matt approved (from the gap design)\nThese "gaps" exist under other names. Use them:\n${d.approvedMappings.map((m) => `- ${m.gap} = ${m.resolvedTo}${m.evidence ? ` (${m.evidence})` : ''}`).join('\n')}`,
    decision?.choice === 'sources' &&
      `## Matt approved these temporary sources (${decision.at})${decision.note ? `: "${decision.note}"` : ''}\nWire in exactly these, nothing else, each table marked with \`annotation ARCO_TemporarySource\` (see your instructions):\n${(decision.approvedSources ?? []).map((s) => `- ${s.object}${s.column ? `.${s.column}` : ''} for ${s.gap}${s.join ? ` (join: ${s.join})` : ''}`).join('\n')}`,
    decision?.choice === 'without' &&
      `## Matt chose to proceed without the missing data${decision.note ? `: "${decision.note}"` : ''}\nBuild everything that doesn't depend on these gaps and list what's left out:\n${gapsMarkdown(blockingGaps(d.gaps))}`,
    [
      '## Where',
      `- Git worktree: ${wt}, on branch \`${d.branch}\` (stay on it).`,
      `- Report: ${join(wt, d.reportDir!)} (read it for what the report uses today).`,
      d.modelDir
        ? `- The report's model (yours to change): ${join(wt, d.modelDir)}`
        : `- This report has no model of its own in the repo (${d.thinReportNote ?? 'thin report'}). Don't create one unless the plan asks; report what's needed instead.`,
      `- Ontology (ARCO_Gold_Ontology, ${ontology.entities} entities${ontology.asOf ? `, as of ${ontology.asOf.slice(0, 10)}` : ''}): ${ontology.asOf ? ontology.path : `not available (${ontology.error ?? 'unknown'}): rely on the catalogs and say so`}`,
      `- Catalogs: ${catalog.filter((c) => c.asOf).map((c) => `\`${c.path}\``).join(', ') || 'none available'}`,
      `- House linter (also parses the TMDL with Desktop's parser): \`py .claude/skills/arco-dwh-powerbi/scripts/check_pbir.py "${join(wt, d.reportDir!)}"\``,
      `- Commit with \`git -C "${wt}" commit\` and a message starting with ${story}. Don't push.`,
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function modelQcBrief(story: string, d: FlowData, files: string[], lint: string, ontologyPath: string): string {
  const wt = d.worktree!;
  return [
    `Story ${story}: QC of the report's SEMANTIC MODEL only (${basename(d.modelDir!)}), built by the report model builder. The report itself is built afterwards; don't review report visuals.`,
    `Model: ${join(wt, d.modelDir!)}`,
    `## Model files changed this step\n${files.map((f) => `- ${join(wt, f)}`).join('\n') || '- none'}`,
    `## House linter (branch vs starting point)\n${lint}`,
    `Check the changes against qc-rules.md (QC-01, QC-07, QC-08, QC-11, QC-13, QC-14, QC-17) and against the ontology at ${ontologyPath}: joins only on its declared relationships, grain and keys as its descriptions say, every TRAP it lists respected, nothing it flags sensitive exposed.`,
    `## Plan\n${d.plan}`,
    approvedSourcesText(d),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The model step. Returns true when the report loop should follow, false when it stopped (blocking gaps, or the flow
 * was stopped). Model QC runs only when the model changed; one fix pass if it fails.
 */
async function modelStep(story: string, requests: ModelRequest[] = []): Promise<boolean> {
  const start = await getFlow(story);
  if (!start?.data.worktree || !start.data.reportDir) throw new Error('The branch was never set up; start over with a new start card');
  const d0 = start.data;
  const wt = d0.worktree!;
  await saveFlow(story, 'modeling', d0);
  const [catalog, ontology] = await Promise.all([ensureCatalog(), ensureOntology()]);
  const before = await headSha(wt);
  const label = d0.round > 1 ? ` (round ${d0.round})` : '';

  let result = '';
  let findings: string | undefined;
  for (let pass = 1; pass <= 2; pass++) {
    await postAppNote(d0.conversationId, `Report model builder${pass > 1 ? ' (fixing model QC findings)' : ''}${label} started.`);
    const m = await runWorker('pbi-report-model-builder', modelBrief(story, d0, pass, catalog, ontology, findings, requests), story, wt, 'modeling');
    if (!m) return false;
    if (m.status !== 'succeeded') throw new Error(`Report model builder ${m.status}${m.error ? `: ${m.error}` : ''}`);
    result = m.result ?? '';
    await commitAll(wt, `${story}: report model builder (changes it left uncommitted)`);

    const gaps = parseGaps(result);
    const blocking = blockingGaps(gaps);
    if (blocking.length && !d0.gapDecision) {
      const cur = await getFlow(story);
      if (cur?.stage !== 'modeling') return false;
      const next: FlowData = { ...cur.data, gaps, modelHandoff: handoffOf(result) };
      await saveFlow(story, 'gaps', next);
      await postAppNote(
        d0.conversationId,
        `**Stopped:** the report model builder found ${blocking.length} blocking data gap${blocking.length === 1 ? '' : 's'} (data that isn't in gold under any name). It built what doesn't depend on ${blocking.length === 1 ? 'it' : 'them'}. Decide on the Data gaps card below, then choose: pause, proceed with its proposed sources, or proceed without.`,
      );
      await raiseGapsCard(story, next, gaps, true);
      return false;
    }

    const modelFiles = d0.modelDir ? (await changedFiles(wt, before)).filter((f) => f.startsWith(d0.modelDir!)) : [];
    if (!modelFiles.length) {
      await postAppNote(d0.conversationId, `Report model builder: no model changes needed${gaps.length ? ` (${realGaps(gaps).length} gap(s) noted)` : ''}.`);
      break;
    }
    const lint = await lintBranch({ worktree: wt, reportRel: d0.reportDir!, baseSha: diffBase(d0)! });
    const q = await runWorker('pbi-qc', modelQcBrief(story, d0, modelFiles, lintSummary(lint), ontology.path), story, wt, 'modeling');
    if (!q) return false;
    const qc = withLint({ verdict: q.status === 'succeeded' ? parseMeta<{ verdict?: string }>(q).verdict : 'not run', result: q.result ?? '' }, lint);
    await postAppNote(d0.conversationId, `Model QC${label}: **${qc.verdict ?? 'no verdict'}** (${modelFiles.length} model file(s) changed)${qc.verdict === 'PASS' || pass === 2 ? '' : '. Sending the findings back to the report model builder.'}`);
    if (qc.verdict === 'PASS' || pass === 2) break;
    findings = qc.result;
  }

  const cur = await getFlow(story);
  if (cur?.stage !== 'modeling') return false;
  const gaps = parseGaps(result);
  const next: FlowData = { ...cur.data, gaps, modelHandoff: handoffOf(result) };
  await saveFlow(story, 'building', next);
  // Real but non-blocking gaps: offer the data-gaps story now; the report loop carries on.
  if (realGaps(gaps).length && !cur.data.gapDecision) await raiseGapsCard(story, next, gaps, false);
  return true;
}
