import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { azToken, RESOURCE } from '../fabric/client.js';

// The PowerBI repo. Agent work happens in a git worktree per story, on agent/<story>-<slug>, so Matt's own
// checkout (and whatever branch he has open) is never touched.

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolveOut, reject) => {
    execFile('git', ['-c', 'core.longpaths=true', ...args], { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.join(' ')}: ${(stderr || err.message).trim().slice(0, 500)}`));
      else resolveOut(stdout.trim());
    });
  });
}

export const repoPath = () => resolve(config.powerbi.repoPath);

export async function baseBranch(): Promise<string> {
  if (config.powerbi.baseBranch) return config.powerbi.baseBranch;
  const head = await git(repoPath(), ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => 'origin/main');
  return head.replace(/^origin\//, '');
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'report';

/** The story's worktree, created from origin/<base> on first use. Returns its path. */
export async function ensureWorktree(branch: string, storyNumber: string): Promise<string> {
  const dir = resolve(config.powerbi.worktreeRoot, storyNumber);
  if (existsSync(resolve(dir, '.git'))) return dir;
  mkdirSync(resolve(config.powerbi.worktreeRoot), { recursive: true });
  const repo = repoPath();
  const base = await baseBranch();
  await git(repo, ['fetch', 'origin', base]);
  const exists = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  );
  await git(repo, exists ? ['worktree', 'add', dir, branch] : ['worktree', 'add', '-b', branch, dir, `origin/${base}`]);
  return dir;
}

/** Commits everything in the worktree. Returns the new commit sha, or undefined if there was nothing to commit. */
export async function commitAll(dir: string, message: string): Promise<string | undefined> {
  await git(dir, ['add', '-A']);
  if (!(await git(dir, ['status', '--porcelain']))) return undefined;
  await git(dir, ['commit', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}

export const headSha = (dir: string) => git(dir, ['rev-parse', 'HEAD']);

export async function changedFiles(dir: string, since: string): Promise<string[]> {
  const out = await git(dir, ['diff', '--name-only', since, 'HEAD']);
  return out ? out.split('\n') : [];
}

export async function pushBranch(dir: string, branch: string): Promise<void> {
  await git(dir, ['push', '-u', 'origin', branch]);
}

/** Azure DevOps remote: https://<org>.visualstudio.com/<project>/_git/<repo> or https://dev.azure.com/<org>/<project>/_git/<repo>. */
async function adoRepo(): Promise<{ apiBase: string; webUrl: string }> {
  const url = (await git(repoPath(), ['remote', 'get-url', 'origin'])).replace(/\/\/[^@/]+@/, '//');
  const m = /^(https:\/\/[^/]+(?:\/[^/]+)?)\/([^/]+)\/_git\/([^/]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`Not an Azure DevOps remote: ${url}`);
  const [, org, project, repo] = m;
  return { apiBase: `${org}/${project}/_apis/git/repositories/${repo}`, webUrl: `${org}/${project}/_git/${repo}` };
}

/** Opens a PR (or returns the open one) for branch → base. Never completes or merges it. */
export async function openPullRequest(p: { branch: string; title: string; description: string }): Promise<string> {
  const { apiBase, webUrl } = await adoRepo();
  const headers = { Authorization: `Bearer ${await azToken(RESOURCE.devops)}`, 'Content-Type': 'application/json' };
  const source = `refs/heads/${p.branch}`;
  const target = `refs/heads/${await baseBranch()}`;
  const existing = await fetch(`${apiBase}/pullrequests?searchCriteria.sourceRefName=${encodeURIComponent(source)}&searchCriteria.status=active&api-version=7.1`, { headers });
  if (existing.ok) {
    const pr = ((await existing.json()) as { value: { pullRequestId: number }[] }).value[0];
    if (pr) return `${webUrl}/pullrequest/${pr.pullRequestId}`;
  }
  const res = await fetch(`${apiBase}/pullrequests?api-version=7.1`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sourceRefName: source, targetRefName: target, title: p.title, description: p.description.slice(0, 3900) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Azure DevOps PR create → ${res.status}: ${text.slice(0, 400)}`);
  return `${webUrl}/pullrequest/${(JSON.parse(text) as { pullRequestId: number }).pullRequestId}`;
}
