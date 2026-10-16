import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { config } from '../config.js';
import { query, queryOne } from '../db/index.js';
import { createApproval, setOutcome, supersedeChatApprovals, type Approval } from '../approvals.js';
import { getConversation, postApprovalCard, postAppNote, sendMessage } from '../orchestrator.js';
import { createRun, getRun, parseMeta, type Run } from '../runs.js';
import { startWorkerRun } from '../workers.js';
import { createItem, getDefinition, listItems, listWorkspaces, updateDefinition, type Workspace } from '../fabric/client.js';
import { findItemFolder, parseModelRef, partText, pbirByConnection, pbirByPath, readParts, textPart, writeParts, writePbip } from '../fabric/pbip.js';
import { changedFiles, commitAll, ensureWorktree, headSha, openPullRequest, pushBranch, slugify } from './repo.js';

// The Power BI story workflow (ARCHITECTURE.md §5): start card → pull from Fabric into the PowerBI repo →
// builder ⇄ QC loop → Review report card → (Not ready → interview → revision card → loop again) or
// (Approve → Publish card → Fabric publish + PR). Every ServiceNow change happens in the story chat, in a turn
// started by one of Matt's clicks; the app itself never touches ServiceNow.

export type Stage = 'pulling' | 'building' | 'review' | 'revising' | 'publishing' | 'published' | 'failed';
const ACTIVE: Stage[] = ['pulling', 'building', 'publishing'];

export interface FlowData {
  conversationId: string;
  plan: string;
  /** The approved card that authorises the next lane move (start card, then the latest revision card). */
  permitApprovalId: string;
  sourceWorkspaceId: string;
  sourceWorkspaceName: string;
  reportId: string;
  reportName: string;
  modelId?: string;
  modelName?: string;
  thinReportNote?: string;
  branch: string;
  folder: string;
  worktree?: string;
  reportDir?: string; // relative to the worktree
  modelDir?: string;
  pbip?: string;
  pullSha?: string;
  round: number;
  revisions: string[];
  lastBuilder?: string;
  lastQc?: { verdict?: string; result: string };
  movedToReadyRound?: number;
  prUrl?: string;
  published?: { workspaceId: string; workspaceName: string; reportUrl: string; modelCreated?: boolean; reportCreated: boolean };
  error?: string;
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
  const rows = await query<FlowRow>(`SELECT * FROM dbo.story_flows WHERE stage IN ('pulling', 'building', 'publishing')`);
  for (const row of rows) {
    const data = JSON.parse(row.data) as FlowData;
    await saveFlow(row.story_number, 'failed', { ...data, error: `Interrupted while ${row.stage}: server restarted` });
  }
}

// ---- workspaces ---------------------------------------------------------------------------------

const isBlocked = (name: string) => config.powerbi.blockedWorkspacePatterns.some((p) => new RegExp(p).test(name));

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
  const list = (await workspaces()).map((w) => ({ id: w.id, name: w.displayName.trim(), blocked: isBlocked(w.displayName) }));
  list.sort((a, b) => a.name.localeCompare(b.name));
  return { workspaces: list, suggested: flow ? suggestTarget(flow.data, list) : undefined };
}

/** Prefer "<source> Acceptance Region" when it exists, else the workspace the report came from. */
function suggestTarget(flow: FlowData, list: { id: string; name: string; blocked: boolean }[]) {
  const source = flow.sourceWorkspaceName.trim();
  const acceptance = list.find((w) => !w.blocked && w.name.toLowerCase() === `${source} acceptance region`.toLowerCase());
  return acceptance?.id ?? list.find((w) => w.id === flow.sourceWorkspaceId && !w.blocked)?.id;
}

/** Repo folder for a workspace: configured override, else the name minus an "Acceptance (Region)" suffix. */
function workspaceFolder(name: string): string {
  const trimmed = name.trim();
  return config.powerbi.workspaceFolders[trimmed] ?? trimmed.replace(/\s+Acceptance(\s+Region)?$/i, '').trim();
}

const safeName = (s: string) => s.replace(/[<>:"/\\|?*]/g, '_').trim();

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

/** Puts the combined start card in Approvals: plan + pull + move to WIP + loop + Ready for testing on review. */
export async function proposeReportWork(p: { parentRunId?: string | null; workspace: string; report: string; plan: string; workNote: string }) {
  const { run, conv, storyNumber } = await storyChat(p.parentRunId);
  const existing = await getFlow(storyNumber);
  if (existing && ACTIVE.includes(existing.stage)) throw new Error(`${storyNumber} already has work in progress (${existing.stage}). Use get_report_flow.`);
  const ws = await findWorkspace(p.workspace);
  const report = (await listItems(ws.id, 'Report')).find((i) => i.id === p.report || i.displayName.toLowerCase() === p.report.trim().toLowerCase());
  if (!report) throw new Error(`No report "${p.report}" in workspace ${ws.displayName}`);
  const branch = `agent/${storyNumber}-${slugify(report.displayName)}`;
  const folder = workspaceFolder(ws.displayName);
  const preview = [
    `**Plan**\n\n${p.plan}`,
    `**Source:** report *${report.displayName}* in workspace *${ws.displayName.trim()}*, plus its semantic model if it lives in the same workspace.`,
    `**Repo:** \`PowerBI/${folder}/…\` on branch \`${branch}\`, in a separate worktree, so your own checkout isn't touched.`,
    `**What happens when you approve**`,
    `1. The app pulls the report from Fabric into the repo and commits it untouched.`,
    `2. ServiceNow: ${storyNumber} → **Work in progress**, with this work note:\n\n\`\`\`\n${p.workNote}\n\`\`\``,
    `3. Power BI builder ⇄ QC: build → QC → build → QC → build → final QC. It stops early as soon as QC passes.`,
    `4. A **Review report** card appears in this chat. Opening the report from it moves ${storyNumber} → **Ready for testing**, with a work note giving the build and QC results.`,
  ].join('\n\n');
  await supersedeChatApprovals(conv.id);
  const approval = await createApproval({
    kind: 'pbi_start',
    title: `${storyNumber}: start work on "${report.displayName}"`,
    payload: { conversationId: conv.id, storyNumber, preview, workspaceId: ws.id, workspaceName: ws.displayName.trim(), reportId: report.id, reportName: report.displayName, plan: p.plan, branch, folder },
    requestedByRunId: run.id,
  });
  await postApprovalCard(conv.id, approval.id);
  return { approval_id: approval.id, status: 'pending', note: 'The start card is in Matt\'s Approvals panel and in this chat. End your turn now.' };
}

/** After "Not ready" and the interview: the revision card (acceptance criteria update + another loop). */
export async function submitRevision(p: { parentRunId?: string | null; changes: string; acceptanceCriteria: string }) {
  const { run, conv, storyNumber } = await storyChat(p.parentRunId);
  const flow = await getFlow(storyNumber);
  if (!flow || !['review', 'revising', 'failed'].includes(flow.stage)) throw new Error(`No report waiting on changes for ${storyNumber} (stage: ${flow?.stage ?? 'none'})`);
  const preview = [
    `**Changes to make**\n\n${p.changes}`,
    `**ServiceNow:** add to ${storyNumber}'s acceptance criteria:\n\n\`\`\`\n${p.acceptanceCriteria}\n\`\`\``,
    `**What happens when you approve:** the builder ⇄ QC loop runs again (round ${flow.data.round + 1}), then a new **Review report** card appears. Opening the report from it moves ${storyNumber} → **Ready for testing**.`,
  ].join('\n\n');
  await supersedeChatApprovals(conv.id);
  const approval = await createApproval({
    kind: 'pbi_revise',
    title: `${storyNumber}: revise "${flow.data.reportName}" (round ${flow.data.round + 1})`,
    payload: { conversationId: conv.id, storyNumber, preview, changes: p.changes, acceptanceCriteria: p.acceptanceCriteria },
    requestedByRunId: run.id,
  });
  await postApprovalCard(conv.id, approval.id);
  return { approval_id: approval.id, status: 'pending', note: 'The revision card is in Matt\'s Approvals panel and in this chat. End your turn now.' };
}

export async function flowSummary(parentRunId?: string | null) {
  const { storyNumber } = await storyChat(parentRunId);
  const flow = await getFlow(storyNumber);
  if (!flow) return { story: storyNumber, stage: 'none' };
  const { plan: _plan, lastBuilder, lastQc, ...rest } = flow.data;
  return { story: storyNumber, stage: flow.stage, ...rest, lastBuilder: lastBuilder?.slice(0, 2000), lastQc: lastQc && { ...lastQc, result: lastQc.result.slice(0, 3000) } };
}

// ---- Matt's decisions on flow cards ---------------------------------------------------------------

type CardPayload = Record<string, string> & { conversationId: string; storyNumber: string };

/** Called by approvals.decide before the card is marked. Throwing leaves the card pending. Returns the outcome text. */
export async function decideFlowCard(approval: Approval, approve: boolean, note?: string, extra: { workspaceId?: string } = {}): Promise<string> {
  const p = JSON.parse(approval.payload) as CardPayload;
  const story = p.storyNumber;
  const withNote = note ? ` (${note})` : '';

  if (approval.kind === 'pbi_start') {
    if (!approve) {
      await sendMessage(p.conversationId, `No, don't start: ${approval.title}.${note ? ` ${note}` : ''}`);
      return 'Rejected in chat';
    }
    await sendMessage(
      p.conversationId,
      `Yes, go ahead: ${approval.title}${withNote}. Move ${story} to Work in progress now with the work note from the card, then resync. The app is pulling the report and running the builder/QC loop, and posts progress here.`,
      { answersApprovalId: approval.id },
    );
    const data: FlowData = {
      conversationId: p.conversationId,
      plan: p.plan,
      permitApprovalId: approval.id,
      sourceWorkspaceId: p.workspaceId,
      sourceWorkspaceName: p.workspaceName,
      reportId: p.reportId,
      reportName: p.reportName,
      branch: p.branch,
      folder: p.folder,
      round: 1,
      revisions: [],
    };
    await saveFlow(story, 'pulling', data);
    void pipeline(story, approval.id, async () => {
      await pull(story);
      await buildLoop(story);
    });
    return 'Approved: pulling the report, then building';
  }

  const flow = await getFlow(story);
  if (!flow) throw new Error(`No report workflow for ${story}`);

  if (approval.kind === 'pbi_review') {
    if (approve) {
      const card = await createApproval({
        kind: 'pbi_publish',
        title: `${story}: publish "${flow.data.reportName}" and open the PR`,
        payload: { conversationId: p.conversationId, storyNumber: story, reportName: flow.data.reportName, modelName: flow.data.modelName ?? '', branch: flow.data.branch },
        requestedByRunId: null,
      });
      await postApprovalCard(p.conversationId, card.id);
      return 'Approved: choose the workspace on the Publish card';
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
      await sendMessage(p.conversationId, `No, don't rerun yet: ${approval.title}.${note ? ` ${note}` : ''}`);
      return 'Rejected in chat';
    }
    await sendMessage(
      p.conversationId,
      `Yes, go ahead: ${approval.title}${withNote}. Add the new acceptance criteria from the card to ${story} in ServiceNow, then resync. The app is re-running the builder/QC loop with these changes.`,
      { answersApprovalId: approval.id },
    );
    const data: FlowData = { ...flow.data, round: flow.data.round + 1, revisions: [...flow.data.revisions, p.changes], permitApprovalId: approval.id, error: undefined };
    await saveFlow(story, 'building', data);
    void pipeline(story, approval.id, () => buildLoop(story));
    return 'Approved: rebuilding';
  }

  if (approval.kind === 'pbi_publish') {
    if (!approve) {
      await postAppNote(p.conversationId, `Publishing skipped${note ? `: ${note}` : ''}. The branch stays local; ask here when you want to publish.`);
      return 'Not published';
    }
    if (!extra.workspaceId) throw new Error('Pick a workspace to publish to');
    const ws = (await workspaces()).find((w) => w.id === extra.workspaceId);
    if (!ws) throw new Error("That workspace isn't one you can access");
    if (isBlocked(ws.displayName)) throw new Error(`${ws.displayName.trim()} is a TEST/PROD workspace; agents never publish there`);
    await saveFlow(story, 'publishing', flow.data);
    void pipeline(story, approval.id, () => publishFlow(story, ws, approval.id));
    return `Publishing to ${ws.displayName.trim()}…`;
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
    if (flow) {
      await saveFlow(story, 'failed', { ...flow.data, error: message });
      await postAppNote(flow.data.conversationId, `**Stopped:** ${message}\n\nAsk the orchestrator here to retry once it's sorted.`);
    }
    await setOutcome(approvalId, `Failed: ${message.slice(0, 300)}`).catch(() => undefined);
  }
}

// ---- steps --------------------------------------------------------------------------------------

async function pull(story: string) {
  const { data } = (await getFlow(story))!;
  const wt = await ensureWorktree(data.branch, story);
  const parts = await getDefinition(data.sourceWorkspaceId, data.reportId);
  const pbir = partText(parts, 'definition.pbir');
  if (!pbir) throw new Error('The report definition has no definition.pbir');
  const ref = parseModelRef(pbir);
  const sourceModels = await listItems(data.sourceWorkspaceId, 'SemanticModel');
  const model = ref.modelId ? sourceModels.find((m) => m.id === ref.modelId) : undefined;

  const folderRoot = join(wt, data.folder);
  const reportDir = findItemFolder(folderRoot, 'Report', data.reportName) ?? join(folderRoot, safeName(data.reportName), `${safeName(data.reportName)}.Report`);
  let modelDir: string | undefined;
  if (model) {
    modelDir = findItemFolder(folderRoot, 'SemanticModel', model.displayName) ?? join(dirname(reportDir), `${safeName(model.displayName)}.SemanticModel`);
    writeParts(modelDir, await getDefinition(data.sourceWorkspaceId, model.id, 'TMDL'));
  }
  // Locally the report points at the model folder next to it, so Desktop opens both; publish re-points it.
  const localPbir = modelDir ? pbirByPath(pbir, relative(reportDir, modelDir).replace(/\\/g, '/')) : pbir;
  writeParts(reportDir, [...parts.filter((x) => x.path !== 'definition.pbir'), textPart('definition.pbir', localPbir)]);
  const pbip = join(dirname(reportDir), `${basename(reportDir).replace(/\.Report$/, '')}.pbip`);
  writePbip(pbip, basename(reportDir));

  const sha = (await commitAll(wt, `${story}: pull "${data.reportName}" from ${data.sourceWorkspaceName} (unchanged)`)) ?? (await headSha(wt));
  const r = (p: string) => relative(wt, p).replace(/\\/g, '/');
  const next: FlowData = {
    ...data,
    worktree: wt,
    reportDir: r(reportDir),
    modelDir: modelDir && r(modelDir),
    modelId: model?.id,
    modelName: model?.displayName,
    thinReportNote: model ? undefined : `The report uses a semantic model outside ${data.sourceWorkspaceName}${ref.modelName ? ` ("${ref.modelName}"${ref.workspaceName ? ` in ${ref.workspaceName}` : ''})` : ''}; only the report was pulled.`,
    pbip: r(pbip),
    pullSha: sha,
  };
  await saveFlow(story, 'building', next);
  await postAppNote(
    data.conversationId,
    `Pulled *${data.reportName}*${model ? ` and its model *${model.displayName}*` : ''} from ${data.sourceWorkspaceName} into \`PowerBI/${r(dirname(reportDir))}\` on \`${data.branch}\` (commit ${sha.slice(0, 7)}).${next.thinReportNote ? `\n\n${next.thinReportNote}` : ''}\n\nStarting the builder ⇄ QC loop.`,
  );
}

async function runWorker(worker: string, brief: string, story: string, projectPath: string): Promise<Run> {
  const run = await createRun({
    kind: 'worker',
    worker,
    storyNumber: story,
    title: `${worker} · ${story}: ${brief.split('\n')[0].slice(0, 100)}`,
    meta: { brief, projectPath },
  });
  await startWorkerRun(run.id);
  return (await getRun(run.id))!;
}

async function buildLoop(story: string) {
  const { data } = (await getFlow(story))!;
  if (!data.worktree || !data.reportDir || !data.pullSha) throw new Error('The report was never pulled; start over with a new start card');
  const wt = data.worktree;
  const roundStart = await headSha(wt);
  const label = data.round > 1 ? ` (round ${data.round})` : '';
  let findings: string | undefined;
  let builder = '';
  let qc: { verdict?: string; result: string } = { result: '' };

  for (let pass = 1; pass <= 3; pass++) {
    await postAppNote(data.conversationId, `Builder pass ${pass}${label} started.`);
    const b = await runWorker('pbi-builder', builderBrief(story, data, pass, findings), story, wt);
    if (b.status !== 'succeeded') throw new Error(`Builder pass ${pass} ${b.status}${b.error ? `: ${b.error}` : ''}`);
    builder = b.result ?? '';
    await commitAll(wt, `${story}: builder pass ${pass} (changes the builder left uncommitted)`);

    const files = await changedFiles(wt, data.pullSha);
    const q = await runWorker('pbi-qc', qcBrief(story, data, pass, files, findings), story, wt);
    if (q.status !== 'succeeded') throw new Error(`QC review ${pass} ${q.status}${q.error ? `: ${q.error}` : ''}`);
    qc = { verdict: parseMeta<{ verdict?: string }>(q).verdict, result: q.result ?? '' };
    const final = qc.verdict === 'PASS' || pass === 3;
    await postAppNote(data.conversationId, `QC review ${pass}${label}: **${qc.verdict ?? 'no verdict'}**${final ? '' : '. Sending the findings back to the builder.'}`);
    if (qc.verdict === 'PASS') break;
    findings = qc.result;
  }

  const changed = await changedFiles(wt, roundStart);
  const next: FlowData = { ...(await getFlow(story))!.data, lastBuilder: builder, lastQc: qc };
  await saveFlow(story, 'review', next);
  const card = await createApproval({
    kind: 'pbi_review',
    title: `${story}: review "${data.reportName}"${label}`,
    payload: {
      conversationId: data.conversationId,
      storyNumber: story,
      round: String(data.round),
      qcVerdict: qc.verdict ?? 'none',
      summary: (/Summary:\s*([\s\S]*?)(?:\n[A-Z][\w /]+:|$)/.exec(builder)?.[1] ?? builder).trim().slice(0, 1500),
      files: String(changed.length),
      branch: data.branch,
      pbip: next.pbip ?? '',
    },
    requestedByRunId: null,
  });
  await postApprovalCard(data.conversationId, card.id);
}

function builderBrief(story: string, d: FlowData, pass: number, findings?: string): string {
  const wt = d.worktree!;
  return [
    pass === 1 && d.round === 1
      ? `Story ${story}: implement the plan below on the pulled report.`
      : pass === 1
        ? `Story ${story}, round ${d.round}: Matt reviewed the report and asked for the changes under "Revisions". Make them.`
        : `Story ${story}, pass ${pass}: fix QC's findings below. Change only what they require.`,
    `## Plan (approved by Matt)\n${d.plan}`,
    d.revisions.length && `## Revisions Matt asked for after review (also added to the acceptance criteria)\n${d.revisions.map((r, i) => `### Round ${i + 2}\n${r}`).join('\n\n')}`,
    findings && `## QC findings to fix\n${findings}`,
    [
      '## Where',
      `- Git worktree: ${wt}. It's already on branch \`${d.branch}\`; stay on it (don't create or switch branches).`,
      `- Report: ${join(wt, d.reportDir!)}. Keep its current format (PBIR-Legacy report.json or PBIR definition/).`,
      d.modelDir ? `- Semantic model (TMDL): ${join(wt, d.modelDir)}` : `- No semantic model in the repo: ${d.thinReportNote ?? 'thin report'} Report changes only; say so if the plan needs model changes.`,
      `- Work only in those folders. Commit with \`git -C "${wt}" commit\` and a message starting with ${story}. Don't push.`,
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function qcBrief(story: string, d: FlowData, pass: number, files: string[], previous?: string): string {
  const wt = d.worktree!;
  return [
    `Story ${story}: QC review ${pass}${pass === 3 ? ' (final confirmation)' : ''} of "${d.reportName}".`,
    `Target project: ${join(wt, dirname(d.reportDir!))} (report ${basename(d.reportDir!)}${d.modelDir ? `, model ${basename(d.modelDir)}` : ''}).`,
    `## Files changed on this branch since the untouched pull (commit ${d.pullSha!.slice(0, 7)})\n${files.length ? files.map((f) => `- ${join(wt, f)}`).join('\n') : '- none'}`,
    `Review the changed files against your rules, and check that the plan${d.revisions.length ? ', the revisions' : ''} and the story's acceptance criteria are met.`,
    `## Plan\n${d.plan}`,
    d.revisions.length && `## Revisions\n${d.revisions.join('\n\n')}`,
    previous && `## Previous QC findings: confirm each one is fixed\n${previous}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** "Open" on the Review card: launches the .pbip in Power BI Desktop; the first open per round also moves the story. */
export async function openForReview(story: string): Promise<{ opened: string; laneMove: 'requested' | 'already' | 'chat_busy' }> {
  const flow = await getFlow(story);
  if (!flow?.data.worktree || !flow.data.pbip) throw new Error(`No pulled report for ${story}`);
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
        `I'm opening ${story} in Power BI Desktop to review it. Move ${story} to Ready for testing now (authorised by the card I approved earlier) with a work note in the standard format, then resync. Use these details:`,
        `- Summary: ${(d.lastBuilder ?? '').slice(0, 1200)}`,
        `- QC result: ${d.lastQc?.verdict ?? 'no verdict'}: ${(d.lastQc?.result ?? '').split('\n').slice(0, 3).join(' ').slice(0, 400)}`,
        `- Branch/PR: ${d.branch} (PR opens when I approve publishing)`,
        `- Needs: Matt's review in Power BI Desktop`,
      ].join('\n'),
      { answersApprovalId: d.permitApprovalId },
    );
  } catch {
    return { opened: pbip, laneMove: 'chat_busy' };
  }
  await saveFlow(story, flow.stage, { ...d, movedToReadyRound: d.round });
  return { opened: pbip, laneMove: 'requested' };
}

async function publishFlow(story: string, ws: Workspace, approvalId: string) {
  const { data } = (await getFlow(story))!;
  const wt = data.worktree!;
  const wsName = ws.displayName.trim();
  // Anything Matt saved in Desktop during review goes in too.
  await commitAll(wt, `${story}: changes saved in Power BI Desktop during review`);

  const targetItems = await listItems(ws.id);
  let modelId = data.modelId;
  let modelCreated: boolean | undefined;
  if (data.modelDir && data.modelName) {
    const parts = readParts(join(wt, data.modelDir));
    const existing = targetItems.find((i) => i.type === 'SemanticModel' && i.displayName === data.modelName);
    if (existing) {
      await updateDefinition(ws.id, existing.id, parts, 'TMDL');
      modelId = existing.id;
    } else {
      modelId = (await createItem(ws.id, { displayName: data.modelName, type: 'SemanticModel', parts, format: 'TMDL' })).id;
      modelCreated = true;
    }
  }

  const reportDir = join(wt, data.reportDir!);
  const localPbir = readFileSync(join(reportDir, 'definition.pbir'), 'utf8');
  const pbir = data.modelDir && data.modelName && modelId ? pbirByConnection(localPbir, wsName, data.modelName, modelId) : localPbir;
  const parts = [...readParts(reportDir).filter((x) => x.path !== 'definition.pbir'), textPart('definition.pbir', pbir)];
  const format = parts.some((x) => x.path === 'report.json') ? 'PBIR-Legacy' : 'PBIR';
  const existingReport = targetItems.find((i) => i.type === 'Report' && i.displayName === data.reportName);
  let reportId: string;
  if (existingReport) {
    await updateDefinition(ws.id, existingReport.id, parts, format);
    reportId = existingReport.id;
  } else {
    reportId = (await createItem(ws.id, { displayName: data.reportName, type: 'Report', parts, format })).id;
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
        `QC: ${data.lastQc?.verdict ?? 'no verdict'}`,
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
      `**Published** *${data.reportName}* to **${wsName}** (${existingReport ? 'updated the existing report' : 'new report'}${data.modelName ? `; model ${modelCreated ? 'created' : 'updated'}` : ''}): [open in Power BI](${reportUrl})`,
      prUrl ? `**Pull request:** [${prUrl.split('/').pop()}](${prUrl}). Merging it is yours.` : `**PR not opened:** ${prError}`,
      `Still yours: ${[data.modelName && (modelCreated ? 'set the new model\'s data source credentials and refresh it' : 'refresh the model if its schema changed'), 'merge the PR', 'update the app'].filter(Boolean).join(', ')}.`,
    ].join('\n\n'),
  );
}
