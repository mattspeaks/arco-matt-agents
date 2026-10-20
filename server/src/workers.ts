import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { config, REPO_ROOT } from './config.js';
import { finishRun, runClaude } from './claude/runner.js';
import { createApproval } from './approvals.js';
import { createRun, getRun, parseMeta, updateRun } from './runs.js';
import { getStory } from './servicenow/store.js';

export interface WorkerInfo {
  name: string;
  description: string;
  model: string;
  domain: string;
  requiresApproval: boolean;
  readOnly: boolean;
}

interface WorkerMeta {
  brief: string;
  projectPath?: string;
  verdict?: 'PASS' | 'FAIL';
}

const AGENTS_DIR = resolve(REPO_ROOT, '.claude/agents');

/** Workers = .claude/agents/*.md definitions that also have an entry (tool policy) in app.config.json. */
export function listWorkers(): WorkerInfo[] {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const fm = frontmatter(readFileSync(resolve(AGENTS_DIR, f), 'utf8'));
      const name = fm.name ?? f.replace(/\.md$/, '');
      const policy = config.workers[name];
      if (!policy) return null;
      return {
        name,
        description: fm.description ?? '',
        model: policy.model ?? fm.model ?? config.claude.defaultWorkerModel,
        domain: policy.domain,
        requiresApproval: policy.requiresApproval,
        readOnly: policy.readOnly,
      };
    })
    .filter((w): w is WorkerInfo => w !== null);
}

function frontmatter(md: string): Record<string, string> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md)?.[1] ?? '';
  const out: Record<string, string> = {};
  let key = '';
  for (const line of block.split(/\r?\n/)) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (m) {
      key = m[1];
      out[key] = m[2].trim();
    } else if (key && line.trim()) {
      out[key] += ' ' + line.trim();
    }
  }
  return out;
}

function validateProjectPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const abs = resolve(path);
  if (!isAbsolute(path)) throw new Error('project_path must be an absolute path');
  const allowed = config.projectRoots.some((root) => {
    const rel = relative(resolve(root), abs);
    return rel && !rel.startsWith('..') && !isAbsolute(rel);
  });
  if (!allowed) throw new Error(`project_path must be inside one of: ${config.projectRoots.join(', ')}`);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`project_path does not exist: ${abs}`);
  return abs;
}

/** Called by the orchestrator. Read-only workers start immediately; write-capable ones wait for Matt's approval. */
export async function requestWorker(p: {
  worker: string;
  brief: string;
  storyNumber?: string;
  projectPath?: string;
  parentRunId?: string | null;
}): Promise<{ runId: string; status: string; approvalId?: string }> {
  const info = listWorkers().find((w) => w.name === p.worker);
  if (!info) throw new Error(`Unknown worker "${p.worker}". Available: ${listWorkers().map((w) => w.name).join(', ')}`);
  const projectPath = validateProjectPath(p.projectPath);
  // Power BI builds on the PowerBI repo run only inside the report workflow, so every build ends in a Review card and
  // never touches Matt's own checkout.
  const inside = (root: string) => !!projectPath && !relative(resolve(root), projectPath).startsWith('..');
  if ((p.worker === 'pbi-builder' || p.worker === 'pbi-report-model-builder') && (inside(config.powerbi.repoPath) || inside(config.powerbi.worktreeRoot))) {
    throw new Error(
      'pbi-builder on the PowerBI repo runs only through the report workflow, so the Review and Publish cards follow. Use propose_report_work (from Fabric, or repo_report to build on main), attach_report_work (take over an existing branch), submit_revision (rebuild) or request_review.',
    );
  }
  const meta: WorkerMeta = { brief: p.brief, projectPath };
  const title = `${p.worker}${p.storyNumber ? ` · ${p.storyNumber}` : ''}: ${p.brief.split('\n')[0].slice(0, 120)}`;

  const run = await createRun({
    kind: 'worker',
    worker: p.worker,
    storyNumber: p.storyNumber,
    parentRunId: p.parentRunId,
    title,
    status: info.requiresApproval ? 'awaiting_approval' : 'queued',
    meta,
  });

  if (info.requiresApproval) {
    const approval = await createApproval({
      kind: 'start_worker',
      title: `Start ${title}`,
      payload: { runId: run.id, worker: p.worker, storyNumber: p.storyNumber, projectPath, brief: p.brief },
      requestedByRunId: p.parentRunId,
    });
    return { runId: run.id, status: 'awaiting_approval', approvalId: approval.id };
  }
  void startWorkerRun(run.id);
  return { runId: run.id, status: 'running' };
}

export async function startWorkerRun(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run?.worker) return;
  const policy = config.workers[run.worker];
  const meta = parseMeta<WorkerMeta>(run);
  const story = run.story_number ? await getStory(run.story_number) : undefined;

  const prompt = [
    `# Task brief from the ${policy.domain.toUpperCase()} manager`,
    meta.brief,
    story &&
      [
        `## ServiceNow story ${story.number}: ${story.short_description}`,
        `Lane: ${story.state_label} · Priority: ${story.priority ?? '-'} · Assigned: ${story.assigned_to ?? '-'}`,
        story.description && `### Description\n${story.description}`,
        story.acceptance_criteria && `### Acceptance criteria\n${story.acceptance_criteria}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    meta.projectPath ? `## Target project\n${meta.projectPath}` : '## Target project\nNone given. If you need one, say so and stop.',
    `## Lessons\nRead memory/${run.worker}-lessons.md (in ${REPO_ROOT}) before starting.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  await updateRun(runId, { prompt });
  const res = await runClaude({
    runId,
    prompt,
    // Run from this repo so .claude/agents, skills, CLAUDE.md and memory/ load; the project is added as a working dir.
    cwd: REPO_ROOT,
    agent: run.worker,
    model: policy.model ?? config.claude.defaultWorkerModel,
    addDirs: meta.projectPath ? [meta.projectPath] : [],
    allowedTools: policy.allowedTools,
    disallowedTools: policy.disallowedTools,
    permissionMode: policy.readOnly ? 'default' : 'acceptEdits',
    strictMcp: true,
    mcpConfig: { mcpServers: {} },
    env: { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' },
  });

  const verdict = /\bFAIL\b/.test(res.result.slice(0, 400)) ? 'FAIL' : /\bPASS\b/.test(res.result.slice(0, 400)) ? 'PASS' : undefined;
  await finishRun(runId, res, { meta: { ...meta, verdict } });
}
