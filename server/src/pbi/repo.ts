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

const norm = (p: string) => resolve(p).replace(/\\/g, '/').toLowerCase();
const branchExists = (branch: string) =>
  git(repoPath(), ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(
    () => true,
    () => false,
  );

/** Where a branch is checked out (any worktree, including Matt's own checkout), if anywhere. */
async function checkedOutAt(branch: string): Promise<string | undefined> {
  const out = await git(repoPath(), ['worktree', 'list', '--porcelain']);
  for (const block of out.split(/\n\n+/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (path && new RegExp(`^branch refs/heads/${branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(block)) return path;
  }
  return undefined;
}

/**
 * The branch's own worktree under worktreeRoot (one per branch), created on first use: from `from` (default
 * origin/<base>) for a new branch, or on the existing branch. A branch that's checked out in Matt's own checkout
 * can't get a second worktree; he switches his checkout away first, so agents never work in it.
 */
export async function ensureWorktree(branch: string, from?: string): Promise<string> {
  const root = resolve(config.powerbi.worktreeRoot);
  const at = await checkedOutAt(branch);
  if (at) {
    if (norm(at).startsWith(norm(root) + '/')) return resolve(at);
    throw new Error(
      `${branch} is checked out in ${at}. Agents don't work in your own checkout: switch it to another branch (e.g. \`git switch main\`) and try again; the app then works on ${branch} in its own worktree.`,
    );
  }
  const dir = resolve(root, branch.replace(/^agent\//, '').replace(/[^\w.-]+/g, '-'));
  if (existsSync(dir)) throw new Error(`${dir} already exists but isn't a worktree of ${branch}; remove it and try again`);
  mkdirSync(root, { recursive: true });
  const repo = repoPath();
  const base = await baseBranch();
  await git(repo, ['fetch', 'origin', base]);
  if (await branchExists(branch)) await git(repo, ['worktree', 'add', dir, branch]);
  else await git(repo, ['worktree', 'add', '-b', branch, dir, from ?? `origin/${base}`]);
  return dir;
}

/** Fetches and returns the ref new work branches from (origin/<base>). */
export async function freshBase(): Promise<string> {
  const base = await baseBranch();
  await git(repoPath(), ['fetch', 'origin', base]);
  return `origin/${base}`;
}

export async function refExists(ref: string): Promise<boolean> {
  return git(repoPath(), ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).then(
    () => true,
    () => false,
  );
}

/** Files under a folder at a ref (repo-relative, forward slashes), without checking anything out. */
export async function filesAt(ref: string, folder: string): Promise<string[]> {
  const out = await git(repoPath(), ['ls-tree', '-r', '--name-only', ref, '--', folder.replace(/\/$/, '') + '/']);
  return out ? out.split('\n') : [];
}

export const showAt = (ref: string, path: string) => git(repoPath(), ['show', `${ref}:${path}`]);

export const mergeBase = (dir: string, ref: string) => git(dir, ['merge-base', 'HEAD', ref]);

export const diffStat = (dir: string, since: string) => git(dir, ['diff', '--stat', since, 'HEAD']);

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

/** A PR's status from its web URL: active, completed or abandoned. Read-only. */
export async function pullRequestStatus(prUrl: string): Promise<string | undefined> {
  const id = /\/pullrequest\/(\d+)/.exec(prUrl)?.[1];
  if (!id) return undefined;
  const { apiBase } = await adoRepo();
  const res = await fetch(`${apiBase}/pullrequests/${id}?api-version=7.1`, { headers: { Authorization: `Bearer ${await azToken(RESOURCE.devops)}` } });
  if (!res.ok) throw new Error(`Azure DevOps PR ${id} → ${res.status}`);
  return ((await res.json()) as { status?: string }).status;
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
