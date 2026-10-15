import { publish } from '../bus.js';
import { finishRun } from '../claude/runner.js';
import { query, queryOne } from '../db/index.js';
import { createRun } from '../runs.js';
import { runChromeScript } from './chrome.js';
import { TIMESHEET_MARKER, WEEKDAYS, timeEntrySnippet, type Weekday } from './snippets.js';
import type { SyncOutcome } from './sync.js';

export interface TimeEntryRequest {
  task_number?: string;
  category?: string;
  /** Weekday name (current week) or YYYY-MM-DD. */
  day: string;
  /** The day's new total for this row. */
  hours: number;
}

/** A validated request, resolved to a concrete week and weekday. */
export interface ResolvedTimeEntry {
  task_number?: string;
  category?: string;
  week_starts_on: string;
  day: Weekday;
  date: string;
  hours: number;
  current_hours: number | null; // from the local copy, when that week is synced
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sundayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());

/** Resolves and checks a request: own timesheet only, current or previous week, sane hours. Returns an error string or the resolved entry. */
export async function resolveTimeEntry(req: TimeEntryRequest): Promise<string | ResolvedTimeEntry> {
  const task = req.task_number?.trim().toUpperCase() || undefined;
  const category = req.category?.trim() || undefined;
  if (!task && !category) return 'Provide task_number (story/task) or category (e.g. Admin, Meeting).';
  if (task && !/^[A-Z]+\d+$/.test(task)) return `"${req.task_number}" doesn't look like a ServiceNow task number.`;
  const hours = Number(req.hours);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) return 'hours must be between 0 and 24.';
  if (Math.round(hours * 4) !== hours * 4) return 'hours must be in quarter-hour steps (e.g. 1.25, 4, 7.5).';

  const today = new Date();
  let date: Date;
  const dayText = String(req.day ?? '').trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayText)) {
    const [y, m, d] = dayText.split('-').map(Number);
    date = new Date(y, m - 1, d);
  } else if ((WEEKDAYS as readonly string[]).includes(dayText)) {
    const sunday = sundayOf(today);
    date = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + WEEKDAYS.indexOf(dayText as Weekday));
  } else if (dayText === 'today') {
    date = today;
  } else {
    return 'day must be a weekday name (this week), "today", or YYYY-MM-DD.';
  }
  const week = sundayOf(date);
  const thisWeek = sundayOf(today);
  const weeksBack = Math.round((thisWeek.getTime() - week.getTime()) / (7 * 86400000));
  if (weeksBack < 0 || weeksBack > 1) return 'Only the current or previous week can be edited.';

  const weekStartsOn = ymd(week);
  const day = WEEKDAYS[date.getDay()];
  let current: number | null = null;
  const sheet = await queryOne<{ sys_id: string }>('SELECT sys_id FROM dbo.timesheets WHERE week_starts_on = ?', [weekStartsOn]);
  if (sheet) {
    const row = task
      ? await queryOne<Record<string, number>>(`SELECT TOP 1 ${day} AS h FROM dbo.time_cards WHERE time_sheet_id = ? AND task_number = ?${category ? ' AND category = ?' : ''}`, [sheet.sys_id, task, ...(category ? [category] : [])])
      : await queryOne<Record<string, number>>(`SELECT TOP 1 ${day} AS h FROM dbo.time_cards WHERE time_sheet_id = ? AND task_number IS NULL AND category = ?`, [sheet.sys_id, category]);
    current = row ? Number(row.h) || 0 : 0;
    const dayTotal = await queryOne<{ t: number }>(`SELECT COALESCE(SUM(${day}), 0) AS t FROM dbo.time_cards WHERE time_sheet_id = ?`, [sheet.sys_id]);
    if (Number(dayTotal?.t ?? 0) - current + hours > 24) return `That would put ${day} over 24 hours.`;
  }
  return { task_number: task, category, week_starts_on: weekStartsOn, day, date: ymd(date), hours, current_hours: current };
}

export function describeTimeEntry(e: ResolvedTimeEntry): string {
  const what = e.task_number ? `${e.task_number}${e.category ? ` (${e.category})` : ''}` : e.category;
  const dayLabel = e.day[0].toUpperCase() + e.day.slice(1, 3);
  return `Timesheet: ${what}, ${dayLabel} ${e.date}: ${e.current_hours ?? '?'}h → ${e.hours}h`;
}

interface TimeEntryResult {
  status: number;
  action: 'updated' | 'created' | null;
  error: string | null;
  previous?: number;
  sys_id?: string;
  category?: string;
  day_hours?: number;
  total?: number;
  state?: string;
}

/** Executes an approved time entry in the browser session, then mirrors it into the local copy. */
export async function applyTimeEntry(entry: ResolvedTimeEntry, approvalId: string): Promise<SyncOutcome> {
  const label = describeTimeEntry(entry);
  const run = await createRun({ kind: 'sn_write', title: label, storyNumber: entry.task_number, meta: { approvalId, ...entry } });
  const code = timeEntrySnippet({ weekStartsOn: entry.week_starts_on, day: entry.day, hours: entry.hours, taskNumber: entry.task_number, category: entry.category });
  const { run: res, payload } = await runChromeScript<TimeEntryResult>(run.id, TIMESHEET_MARKER, code, 'approved timesheet entry');
  if (!payload || payload.error || payload.status >= 300) {
    const error = payload?.error ?? res.error ?? 'Timesheet write result not found in the browser session output.';
    await finishRun(run.id, res, { ok: false, error });
    return { runId: run.id, ok: false, summary: error };
  }
  await mirrorLocally(entry, payload);
  const summary = `Timesheet ${payload.action}: ${entry.task_number ?? entry.category} ${entry.day} ${entry.date} = ${payload.day_hours}h (was ${payload.previous ?? 0}h; row total ${payload.total}h)`;
  await finishRun(run.id, { ...res, result: summary }, { ok: true });
  publish('board', { syncedAt: new Date().toISOString() });
  return { runId: run.id, ok: true, summary };
}

async function mirrorLocally(entry: ResolvedTimeEntry, r: TimeEntryResult) {
  const sheet = await queryOne<{ sys_id: string }>('SELECT sys_id FROM dbo.timesheets WHERE week_starts_on = ?', [entry.week_starts_on]);
  if (!sheet || !r.sys_id) return;
  const day = entry.day; // whitelisted weekday name, safe as a column name
  const exists = await queryOne('SELECT 1 AS x FROM dbo.time_cards WHERE sys_id = ?', [r.sys_id]);
  if (exists) {
    await query(`UPDATE dbo.time_cards SET ${day} = ?, total = ?, synced_at = SYSUTCDATETIME() WHERE sys_id = ?`, [r.day_hours ?? entry.hours, r.total ?? null, r.sys_id]);
  } else {
    await query(
      `INSERT INTO dbo.time_cards (sys_id, time_sheet_id, task_number, category, sunday, monday, tuesday, wednesday, thursday, friday, saturday, total, state)
       VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
      [r.sys_id, sheet.sys_id, entry.task_number ?? null, r.category ?? entry.category ?? null, r.total ?? entry.hours, r.state ?? 'Pending'],
    );
    await query(`UPDATE dbo.time_cards SET ${day} = ? WHERE sys_id = ?`, [r.day_hours ?? entry.hours, r.sys_id]);
  }
  await query(
    'UPDATE dbo.timesheets SET total_hours = (SELECT COALESCE(SUM(total), 0) FROM dbo.time_cards WHERE time_sheet_id = ?) WHERE sys_id = ?',
    [sheet.sys_id, sheet.sys_id],
  );
}
