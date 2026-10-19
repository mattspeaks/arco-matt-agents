import { query, queryOne } from './db/index.js';
import { createApproval, getApproval, type Approval } from './approvals.js';
import { publish } from './bus.js';
import { postApprovalCard, sendMessage } from './orchestrator.js';

// The Timesheet card: Matt types the hours to add for a story against this week's days. His Add click starts a chat
// turn that adds them in ServiceNow (servicenow skill, timesheet recipe), so the card is the preview and the approval.

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
type Day = (typeof DAYS)[number];

/** This week's Sunday (timesheet weeks start on Sunday), as YYYY-MM-DD in local time. */
function weekStart(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(start: string, i: number): string {
  const [y, m, d] = start.split('-').map(Number);
  const date = new Date(y, m - 1, d + i);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]} ${date.getMonth() + 1}/${date.getDate()}`;
}

/** Hours already logged against the story this week, from the app's copy of the timesheet. */
async function loggedThisWeek(story: string, start: string): Promise<Partial<Record<Day, number>>> {
  const sheet = await queryOne<{ sys_id: string }>('SELECT sys_id FROM dbo.timesheets WHERE week_starts_on = ?', [start]);
  if (!sheet) return {};
  const rows = await query<Record<Day, number | null>>(
    `SELECT ${DAYS.join(', ')} FROM dbo.time_cards WHERE time_sheet_id = ? AND (task_number = ? OR top_task_number = ?)`,
    [sheet.sys_id, story, story],
  );
  const out: Partial<Record<Day, number>> = {};
  for (const r of rows) for (const d of DAYS) if (Number(r[d])) out[d] = (out[d] ?? 0) + Number(r[d]);
  return out;
}

/** Puts a Timesheet card for the story in the chat (replacing an older unanswered one for the same story). */
export async function askTimeEntry(conversationId: string, story: string) {
  const old = await query<{ id: string }>(
    `SELECT id FROM dbo.approvals WHERE kind = 'time_entry' AND status = 'pending' AND JSON_VALUE(payload, '$.storyNumber') = ?`,
    [story],
  );
  for (const { id } of old) {
    await query(`UPDATE dbo.approvals SET status = 'superseded', outcome = 'Replaced by a newer timesheet card', decided_at = SYSUTCDATETIME() WHERE id = ?`, [id]);
    publish('approval', await getApproval(id));
  }
  const start = weekStart();
  const last = weekStart(new Date(Date.now() - 7 * 86_400_000));
  const approval = await createApproval({
    kind: 'time_entry',
    title: `${story}: add time to your timesheet`,
    payload: {
      conversationId,
      storyNumber: story,
      weekStart: start,
      logged: await loggedThisWeek(story, start),
      // The card can switch to last week (e.g. a forgotten Friday).
      weeks: [
        { start, label: 'This week', logged: await loggedThisWeek(story, start) },
        { start: last, label: 'Last week', logged: await loggedThisWeek(story, last) },
      ],
    },
    requestedByRunId: null,
  });
  await postApprovalCard(conversationId, approval.id);
  return { approval_id: approval.id, status: 'pending', note: 'The Timesheet card is in the chat and in Approvals. End your turn; his Add click comes back as a message.' };
}

/** Matt's answer. Add: validate the hours and ask the chat to add them (that turn may write). Skip: nothing. */
export async function decideTimeEntry(approval: Approval, approve: boolean, hours: Record<string, number> = {}, week?: string): Promise<string> {
  if (!approve) return 'Skipped';
  const raw = JSON.parse(approval.payload) as {
    conversationId: string;
    storyNumber: string;
    weekStart: string;
    logged?: Partial<Record<Day, number>>;
    weeks?: { start: string; logged: Partial<Record<Day, number>> }[];
  };
  const chosen = (week && raw.weeks?.find((w) => w.start === week)) || { start: raw.weekStart, logged: raw.logged };
  if (week && chosen.start !== week) throw new Error(`The card only covers this week and last week`);
  const p = { ...raw, weekStart: chosen.start, logged: chosen.logged };
  const entries: { i: number; day: Day; add: number }[] = [];
  for (const [i, day] of DAYS.entries()) {
    const add = Number(hours[day] ?? 0);
    if (!Number.isFinite(add) || add < 0 || Math.round(add * 4) !== add * 4) throw new Error(`${dayLabel(p.weekStart, i)}: use quarter hours`);
    if (add + (p.logged?.[day] ?? 0) > 24) throw new Error(`${dayLabel(p.weekStart, i)} would go over 24h`);
    if (add > 0) entries.push({ i, day, add });
  }
  if (!entries.length) throw new Error('Enter some hours first');
  const total = entries.reduce((s, e) => s + e.add, 0);
  await sendMessage(
    p.conversationId,
    [
      `Yes, add time to my timesheet for ${p.storyNumber} (week of ${p.weekStart}): ${entries.map((e) => `${dayLabel(p.weekStart, e.i)} +${e.add}h`).join(', ')}. That's ${total}h in all.`,
      `Use the servicenow skill's timesheet recipe. Read my live row for ${p.storyNumber} this week, add these hours to what's already there (if there's no row, add one with category Task work), and keep each day at 24h or less. Then resync the timesheet and tell me the new totals.`,
    ].join(' '),
    { answersApprovalId: approval.id },
  );
  return `Approved: adding ${total}h`;
}
