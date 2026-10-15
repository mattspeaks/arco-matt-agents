import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './config.js';
import { createApproval } from './approvals.js';
import { query, queryOne } from './db/index.js';

interface LessonRow {
  id: string;
  lesson_code: string | null;
  worker: string;
  rule_text: string;
  why: string | null;
  applies_to: string | null;
  source_story: string | null;
  status: string;
}

/** The manager drafts a lesson from Matt's feedback; it only reaches memory/ after approval (§6). */
export async function proposeLesson(p: {
  worker: string;
  rule: string;
  why?: string;
  appliesTo?: string;
  sourceStory?: string;
  parentRunId?: string | null;
}) {
  const id = randomUUID();
  await query(
    `INSERT INTO dbo.lessons (id, worker, rule_text, why, applies_to, source_story, status) VALUES (?, ?, ?, ?, ?, ?, 'proposed')`,
    [id, p.worker, p.rule, p.why, p.appliesTo ?? p.worker, p.sourceStory],
  );
  return createApproval({
    kind: 'lesson',
    title: `Lesson for ${p.worker}: ${p.rule.slice(0, 140)}`,
    payload: { lessonId: id, worker: p.worker, rule: p.rule, why: p.why, appliesTo: p.appliesTo, sourceStory: p.sourceStory },
    requestedByRunId: p.parentRunId,
  });
}

export async function approveLesson(lessonId: string): Promise<string> {
  const lesson = await queryOne<LessonRow>('SELECT * FROM dbo.lessons WHERE id = ?', [lessonId]);
  if (!lesson) return 'Lesson not found';
  const file = resolve(REPO_ROOT, 'memory', `${lesson.worker}-lessons.md`);
  if (!existsSync(file)) writeFileSync(file, `# ${lesson.worker} lessons\n`, 'utf8');
  const prefix = lesson.worker.startsWith('dwh') ? 'DWH' : 'PBI';
  const count = (readFileSync(file, 'utf8').match(/^### L-/gm) ?? []).length;
  const code = `L-${prefix}-${String(count + 1).padStart(3, '0')}`;
  const today = new Date().toISOString().slice(0, 10);
  appendFileSync(
    file,
    `\n### ${code} · ${today}${lesson.source_story ? ` · source: ${lesson.source_story}` : ''}\n` +
      `**Rule:** ${lesson.rule_text}\n` +
      (lesson.why ? `**Why:** ${lesson.why}\n` : '') +
      `**Applies to:** ${lesson.applies_to ?? lesson.worker}\n`,
    'utf8',
  );
  await query(`UPDATE dbo.lessons SET status = 'approved', lesson_code = ? WHERE id = ?`, [code, lessonId]);
  return `Added ${code} to memory/${lesson.worker}-lessons.md (commit it when ready)`;
}

export async function rejectLesson(lessonId: string) {
  await query(`UPDATE dbo.lessons SET status = 'rejected' WHERE id = ?`, [lessonId]);
}
