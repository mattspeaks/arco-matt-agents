import { execFile } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { basename, join, posix, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, DATA_DIR, REPO_ROOT } from '../config.js';
import { git } from './repo.js';

// The house linter from the arco-dwh-powerbi skill (scripts/check_pbir.py), run by the app on the story branch and on
// its starting point, so QC and the builder see only the findings the branch introduced. Read-only: never --fix-bom.

export interface LintResult {
  ran: boolean;
  /** Why it didn't run, or extra info. */
  note?: string;
  errors: string[];
  warnings: string[];
}

export interface LintDiff {
  ran: boolean;
  note?: string;
  newErrors: string[];
  newWarnings: string[];
  /** Findings that were already there before the branch (out of scope). */
  preexisting: { errors: number; warnings: number };
  fixed: number;
}

// Windows' own bsdtar: Git's GNU tar reads 'C:' in a path as a remote host.
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

const SCRIPT = () => resolve(REPO_ROOT, config.powerbi.lint.script);

/** Runs check_pbir.py on a .Report folder. */
export function runLint(reportDir: string): Promise<LintResult> {
  if (!config.powerbi.lint.enabled) return Promise.resolve({ ran: false, note: 'linter turned off in config', errors: [], warnings: [] });
  return new Promise((done) => {
    execFile(config.powerbi.lint.python, [SCRIPT(), reportDir], { windowsHide: true, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const lines = String(stdout).split(/\r?\n/);
      const errors = lines.filter((l) => l.startsWith('ERROR')).map((l) => l.replace(/^ERROR\s*/, ''));
      const warnings = lines.filter((l) => l.startsWith('WARN')).map((l) => l.replace(/^WARN\s*/, ''));
      const summary = lines.find((l) => /\d+ error\(s\), \d+ warning\(s\)/.test(l));
      // Exit 1 just means "errors found"; anything without a summary line means it didn't run.
      if (!summary) return done({ ran: false, note: `linter didn't run: ${(stderr || err?.message || 'no output').toString().trim().slice(0, 300)}`, errors: [], warnings: [] });
      done({ ran: true, errors, warnings });
    });
  });
}

/**
 * Comparable form of a finding: the report and model folder paths replaced by placeholders (so a renamed report
 * still matches), separators unified, and numbers (counts, px) blanked.
 */
function keyOf(finding: string, reportDir: string): string {
  const variants = (p: string) => [p, p.replace(/\//g, '\\'), p.replace(/\\/g, '/')];
  let s = finding;
  const report = resolve(reportDir);
  const stem = report.replace(/\.Report$/i, '');
  for (const v of variants(report)) s = s.split(v).join('<report>');
  for (const v of variants(`${stem}.SemanticModel`)) s = s.split(v).join('<model>');
  s = s.split(basename(stem)).join('<name>');
  return s.replace(/\\/g, '/').replace(/\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();
}

/**
 * Lints the branch and its starting point (a commit; the report may have had another path there) and returns the
 * findings the branch introduced. `reportRel` / `baseReportRel` are repo-relative .Report paths.
 */
export async function lintBranch(p: { worktree: string; reportRel: string; baseSha: string; baseReportRel?: string }): Promise<LintDiff> {
  const head = await runLint(join(p.worktree, p.reportRel));
  if (!head.ran) return { ran: false, note: head.note, newErrors: [], newWarnings: [], preexisting: { errors: 0, warnings: 0 }, fixed: 0 };

  // The starting point, exported (not checked out) into a scratch folder.
  // The report may have been renamed on the branch: follow git's rename of its definition.pbir back to the start.
  let baseRel = p.baseReportRel ?? p.reportRel;
  if (!p.baseReportRel) {
    const renames = await git(p.worktree, ['diff', '-M', '--name-status', p.baseSha, 'HEAD']).catch(() => '');
    const hit = renames.split('\n').map((l) => l.split('\t')).find((c) => /^R/.test(c[0] ?? '') && c[2] === `${p.reportRel}/definition.pbir`);
    if (hit) baseRel = posix.dirname(hit[1]);
  }
  const parent = posix.dirname(baseRel);
  const tmp = join(DATA_DIR, 'tmp', `lint-${randomUUID().slice(0, 8)}`);
  mkdirSync(tmp, { recursive: true });
  let base: LintResult = { ran: false, errors: [], warnings: [] };
  try {
    const exists = await git(p.worktree, ['cat-file', '-e', `${p.baseSha}:${baseRel}/definition.pbir`]).then(
      () => true,
      () => false,
    );
    if (exists) {
      await new Promise<void>((done, fail) => {
        const tar = join(tmp, 'base.tar');
        git(p.worktree, ['archive', '--format=tar', '-o', tar, p.baseSha, '--', parent])
          .then(() => execFile(TAR, ['-xf', tar, '-C', tmp], { windowsHide: true }, (e) => (e ? fail(e) : done())))
          .catch(fail);
      });
      base = await runLint(join(tmp, baseRel));
    }
  } catch {
    /* no comparable starting point: everything counts as new */
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const baseDir = join(tmp, baseRel);
  const baseKeys = new Set([...base.errors, ...base.warnings].map((f) => keyOf(f, baseDir)));
  const headDir = join(p.worktree, p.reportRel);
  const isNew = (f: string) => !baseKeys.has(keyOf(f, headDir));
  const headKeys = new Set([...head.errors, ...head.warnings].map((f) => keyOf(f, headDir)));
  const tidy = (f: string) => f.split(resolve(headDir)).join(basename(headDir)).split(resolve(headDir).replace(/\\/g, '/')).join(basename(headDir));
  return {
    ran: true,
    note: base.ran ? undefined : 'no linted starting point to compare with, so every finding counts as new',
    newErrors: head.errors.filter(isNew).map(tidy),
    newWarnings: head.warnings.filter(isNew).map(tidy),
    preexisting: { errors: head.errors.filter((f) => !isNew(f)).length, warnings: head.warnings.filter((f) => !isNew(f)).length },
    fixed: [...baseKeys].filter((k) => !headKeys.has(k)).length,
  };
}

/** Markdown for briefs and cards. */
export function lintSummary(d: LintDiff): string {
  if (!d.ran) return `House linter (check_pbir.py): not run (${d.note ?? 'unknown reason'}).`;
  const lines = [
    `House linter (check_pbir.py): **${d.newErrors.length} new error(s), ${d.newWarnings.length} new warning(s)** on this branch` +
      ` (${d.preexisting.errors} error(s) and ${d.preexisting.warnings} warning(s) were already there: out of scope${d.fixed ? `; ${d.fixed} fixed` : ''}).`,
  ];
  if (d.note) lines.push(`_${d.note}_`);
  if (d.newErrors.length) lines.push('New errors:', ...d.newErrors.slice(0, 25).map((e) => `- ${e}`));
  if (d.newWarnings.length) lines.push('New warnings:', ...d.newWarnings.slice(0, 25).map((w) => `- ${w}`));
  return lines.join('\n');
}

