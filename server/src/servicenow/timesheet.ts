import { config } from '../config.js';
import { finishRun } from '../claude/runner.js';
import { queryOne } from '../db/index.js';
import { addEvent, createRun } from '../runs.js';
import { runChromeUiTask } from './chrome.js';
import { WEEKDAYS, type Weekday } from './snippets.js';
import { startSync, type SyncOutcome } from './sync.js';

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


const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** The portal's own labels: week "October 11 - October 17, 2026", day column "Wed 14". */
function portalLabels(e: ResolvedTimeEntry) {
  const start = parseYmd(e.week_starts_on);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const week = `${MONTHS[start.getMonth()]} ${start.getDate()} - ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  const day = `${e.day[0].toUpperCase()}${e.day.slice(1, 3)} ${parseYmd(e.date).getDate()}`;
  return { week, day };
}

async function rowTitle(e: ResolvedTimeEntry): Promise<string | null> {
  if (!e.task_number) return null;
  const row = await queryOne<{ t: string }>(
    `SELECT TOP 1 COALESCE(c.task_short_description, s.short_description) AS t
     FROM (SELECT ? AS n) x LEFT JOIN dbo.time_cards c ON c.task_number = x.n LEFT JOIN dbo.stories s ON s.number = x.n`,
    [e.task_number],
  );
  return row?.t ?? null;
}

/** The click-by-click instructions for the Time Sheet Portal (/tcp), from a read-only look at its layout. */
async function timesheetSteps(e: ResolvedTimeEntry): Promise<string> {
  const { week, day } = portalLabels(e);
  const title = await rowTitle(e);
  const row = e.task_number
    ? `the row whose task link is ${e.task_number}${title ? ` (title "${title}")` : ''}${e.category ? ` and category ${e.category}` : ''}. Titles repeat, so match on the task number`
    : `the "${e.category}" row (a category row with no task link)`;
  const addRow = e.task_number
    ? `If there is no such row, add it: in the left "Tasks" panel, type ${e.task_number} in the Search box (check the "All Tasks" filter and the Group Tasks / Other tabs if it doesn't show), then click that card's "Add … to time sheet" button. If you can't find it, reply FAILED rather than adding a different task.`
    : `If there is no such row, reply FAILED.`;
  return `2. Check the week selector shows "${week}". If not, use "Go to previous time sheet" / "Go to next time sheet" until it does. The status pill must read Pending; if not, reply FAILED.
3. In "Logged Time Cards", find ${row}. ${addRow}
4. Set that row's "${day}" cell to ${e.hours}. Clicking the cell should make it editable or open a small editor: select the existing value, type ${e.hours}, then press Enter or Tab (or click the editor's Save/OK button if it has one). Don't touch other cells or rows.
5. Confirm the change took: the cell shows ${e.hours} and the "${day}" day tile / row total updated. Wait a moment for it to save. Never click Submit.`;
}

/** Makes an approved time entry through the Time Sheet Portal UI, then verifies it with a read-only sync. */
export async function applyTimeEntry(entry: ResolvedTimeEntry, approvalId: string): Promise<SyncOutcome> {
  const label = describeTimeEntry(entry);
  const run = await createRun({ kind: 'sn_write', title: label, storyNumber: entry.task_number, meta: { approvalId, ...entry } });
  const what = entry.task_number ? `${entry.task_number}${entry.category ? ` (${entry.category})` : ''}` : `the ${entry.category} row`;
  const ui = await runChromeUiTask(run.id, {
    change: `On Matt's own timesheet, set the hours for ${what} on ${entry.day} ${entry.date} to ${entry.hours} (week of ${entry.week_starts_on}). Do not submit the timesheet.`,
    approvalId,
    landingUrl: config.servicenow.timesheetPortalUrl,
    steps: await timesheetSteps(entry),
  });
  if (ui.status !== 'DONE') {
    const error = ui.status === 'LOGIN_REQUIRED' ? 'ServiceNow login required: log in in Chrome, then approve again.' : ui.detail;
    await finishRun(run.id, ui.run, { ok: false, error });
    return { runId: run.id, ok: false, summary: error };
  }

  // Don't trust the reply: re-read the timesheet and check the value really landed.
  await addEvent(run.id, 'text', `Browser session reports: ${ui.detail}. Verifying with a sync…`);
  const sync = await (await startSync(run.id)).done;
  const fresh = await resolveTimeEntry({ task_number: entry.task_number, category: entry.category, day: entry.date, hours: entry.hours });
  const actual = typeof fresh === 'string' ? null : fresh.current_hours;
  if (!sync.ok || actual === null) {
    const summary = `Entered in the portal (${ui.detail}), but couldn't verify: ${sync.ok ? 'that week is not in the synced copy' : sync.summary}. Check the portal.`;
    await finishRun(run.id, { ...ui.run, result: summary }, { ok: true, error: 'unverified' });
    return { runId: run.id, ok: true, summary };
  }
  if (actual !== entry.hours) {
    const error = `The browser session reported success, but ServiceNow shows ${actual}h (expected ${entry.hours}h). Check the portal.`;
    await finishRun(run.id, ui.run, { ok: false, error });
    return { runId: run.id, ok: false, summary: error };
  }
  const summary = `Timesheet updated and verified: ${what} ${entry.day} ${entry.date} = ${actual}h`;
  await finishRun(run.id, { ...ui.run, result: summary }, { ok: true });
  return { runId: run.id, ok: true, summary };
}
