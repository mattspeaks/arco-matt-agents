import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query, queryOne } from '../db/index.js';

export interface SyncPayload {
  errors: string[];
  board: { name: string; filter: string };
  choices: { value: string; label: string; sequence: number }[];
  stories: SnStory[];
  timesheet: { sys_id: string; week_starts_on: string; week_ends_on: string; state: string; total_hours: number } | null;
  time_cards: SnTimeCard[];
}

export interface SnStory {
  sys_id: string;
  number: string;
  short_description: string;
  description: string;
  acceptance_criteria: string;
  state_value: string;
  state_label: string;
  priority: string;
  assigned_to: string;
  sprint: string;
  story_points: string;
  sys_updated_on: string;
}

export interface SnTimeCard {
  sys_id: string;
  task_number: string | null;
  task_class: string | null;
  task_short_description: string | null;
  top_task_number: string | null;
  category: string;
  sunday: number;
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  total: number;
  state: string;
}

export interface StoryRow {
  sys_id: string;
  number: string;
  short_description: string | null;
  description: string | null;
  acceptance_criteria: string | null;
  state_value: string | null;
  state_label: string | null;
  priority: string | null;
  assigned_to: string | null;
  sprint: string | null;
  story_points: string | null;
  tags: string | null;
  domain: string | null;
  on_board: boolean;
  sn_updated_on: string | null;
  synced_at: string;
}

/** Hashtags in the title/description decide which manager owns a story (v1 routing, §4.2). */
export function routeStory(s: Pick<SnStory, 'short_description' | 'description'>): { tags: string[]; domain: string | null } {
  const tags = [...new Set(`${s.short_description ?? ''} ${s.description ?? ''}`.match(/#[A-Za-z][\w-]*/g) ?? [])];
  const lower = tags.map((t) => t.toLowerCase());
  for (const [domain, routeTags] of Object.entries(config.servicenow.routingTags)) {
    if (routeTags.some((t) => lower.includes(t.toLowerCase()))) return { tags, domain };
  }
  return { tags, domain: null };
}

export async function saveSync(p: SyncPayload, opts: { timesheetOnly?: boolean } = {}): Promise<{ stories: number; timeCards: number }> {
  const stories = p.stories.map((s) => ({ ...s, ...routeStory(s), tags: JSON.stringify(routeStory(s).tags) }));

  if (!opts.timesheetOnly) await query(
    `MERGE dbo.stories AS t
     USING (SELECT * FROM OPENJSON(?) WITH (
        sys_id CHAR(32), number NVARCHAR(40), short_description NVARCHAR(400), description NVARCHAR(MAX),
        acceptance_criteria NVARCHAR(MAX), state_value NVARCHAR(40), state_label NVARCHAR(100), priority NVARCHAR(100),
        assigned_to NVARCHAR(200), sprint NVARCHAR(200), story_points NVARCHAR(20), tags NVARCHAR(400),
        domain NVARCHAR(20), sys_updated_on NVARCHAR(40))) AS s
     ON t.sys_id = s.sys_id
     WHEN MATCHED THEN UPDATE SET number = s.number, short_description = s.short_description, description = s.description,
        acceptance_criteria = s.acceptance_criteria, state_value = s.state_value, state_label = s.state_label,
        priority = s.priority, assigned_to = s.assigned_to, sprint = s.sprint, story_points = s.story_points,
        tags = s.tags, domain = s.domain, on_board = 1, sn_updated_on = s.sys_updated_on, synced_at = SYSUTCDATETIME()
     WHEN NOT MATCHED BY TARGET THEN INSERT (sys_id, number, short_description, description, acceptance_criteria,
        state_value, state_label, priority, assigned_to, sprint, story_points, tags, domain, on_board, sn_updated_on)
        VALUES (s.sys_id, s.number, s.short_description, s.description, s.acceptance_criteria, s.state_value,
        s.state_label, s.priority, s.assigned_to, s.sprint, s.story_points, s.tags, s.domain, 1, s.sys_updated_on)
     WHEN NOT MATCHED BY SOURCE THEN UPDATE SET on_board = 0;`,
    [JSON.stringify(stories)],
  );

  if (p.choices.length) {
    await query(
      `MERGE dbo.lanes AS t
       USING (SELECT * FROM OPENJSON(?) WITH (value NVARCHAR(40), label NVARCHAR(100), sequence INT)) AS s
       ON t.value = s.value
       WHEN MATCHED THEN UPDATE SET label = s.label, sequence = s.sequence
       WHEN NOT MATCHED BY TARGET THEN INSERT (value, label, sequence) VALUES (s.value, s.label, s.sequence)
       WHEN NOT MATCHED BY SOURCE THEN DELETE;`,
      [JSON.stringify(p.choices)],
    );
  }

  if (p.timesheet) {
    const ts = p.timesheet;
    await query(
      `MERGE dbo.timesheets AS t USING (SELECT ? AS sys_id) AS s ON t.sys_id = s.sys_id
       WHEN MATCHED THEN UPDATE SET week_starts_on = ?, week_ends_on = ?, state = ?, total_hours = ?, synced_at = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (sys_id, week_starts_on, week_ends_on, state, total_hours) VALUES (?, ?, ?, ?, ?);`,
      [ts.sys_id, ts.week_starts_on, ts.week_ends_on, ts.state, ts.total_hours, ts.sys_id, ts.week_starts_on, ts.week_ends_on, ts.state, ts.total_hours],
    );
    await query('DELETE FROM dbo.time_cards WHERE time_sheet_id = ?', [ts.sys_id]);
    if (p.time_cards.length) {
      await query(
        `INSERT INTO dbo.time_cards (sys_id, time_sheet_id, task_number, task_class, task_short_description, top_task_number,
           category, sunday, monday, tuesday, wednesday, thursday, friday, saturday, total, state)
         SELECT sys_id, ?, task_number, task_class, task_short_description, top_task_number, category,
           sunday, monday, tuesday, wednesday, thursday, friday, saturday, total, state
         FROM OPENJSON(?) WITH (sys_id CHAR(32), task_number NVARCHAR(40), task_class NVARCHAR(80),
           task_short_description NVARCHAR(400), top_task_number NVARCHAR(40), category NVARCHAR(100),
           sunday DECIMAL(5,2), monday DECIMAL(5,2), tuesday DECIMAL(5,2), wednesday DECIMAL(5,2),
           thursday DECIMAL(5,2), friday DECIMAL(5,2), saturday DECIMAL(5,2), total DECIMAL(6,2), state NVARCHAR(40))`,
        [ts.sys_id, JSON.stringify(p.time_cards)],
      );
    }
  }
  return { stories: stories.length, timeCards: p.time_cards.length };
}

/** Shapes the servicenow skill's snapshot recipes return (`references/reading.md`). */
export interface BoardSnapshot {
  __arco: 'board-v2';
  stories: {
    sys_id: string; number: string; title: string; state_value: string; state_label: string; priority: string;
    assigned_to: string; sprint: string; points: string; updated: string; tags: string[];
  }[];
}
export interface TimesheetSnapshot {
  __arco: 'timesheet-v2';
  sheet: { sys_id: string; week_starts_on: string; week_ends_on: string; state: string; total_hours: number } | null;
  cards: SnTimeCard[];
}

function domainFor(tags: string[]): string | null {
  const lower = tags.map((t) => t.toLowerCase());
  for (const [domain, routeTags] of Object.entries(config.servicenow.routingTags)) {
    if (routeTags.some((t) => lower.includes(t.toLowerCase()))) return domain;
  }
  return null;
}

/**
 * The skill returns sys_ids dashed (the Chrome extension blanks bare 32-hex strings as "encoded data").
 * Returns the plain 32-hex id, or null if it was blanked anyway.
 */
function snId(raw: string | null | undefined): string | null {
  const id = String(raw ?? '').replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(id) ? id : null;
}

/** Saves a board snapshot read by the orchestrator. Descriptions aren't in it, so existing ones are kept. */
export async function saveBoardSnapshot(p: BoardSnapshot): Promise<number> {
  // Matched on the story number, so a blanked sys_id only matters for stories the app hasn't seen before.
  const rows = p.stories
    .filter((s) => /^[A-Z]+\d+$/.test(s.number))
    .map((s) => ({ ...s, sys_id: snId(s.sys_id), tags: JSON.stringify(s.tags ?? []), domain: domainFor(s.tags ?? []) }));
  await query(
    `MERGE dbo.stories AS t
     USING (SELECT * FROM OPENJSON(?) WITH (
        sys_id CHAR(32), number NVARCHAR(40), title NVARCHAR(400), state_value NVARCHAR(40), state_label NVARCHAR(100),
        priority NVARCHAR(100), assigned_to NVARCHAR(200), sprint NVARCHAR(200), points NVARCHAR(20), tags NVARCHAR(400),
        domain NVARCHAR(20), updated NVARCHAR(40))) AS s
     ON t.number = s.number
     WHEN MATCHED THEN UPDATE SET sys_id = COALESCE(s.sys_id, t.sys_id), number = s.number, short_description = s.title, state_value = s.state_value,
        state_label = s.state_label, priority = s.priority, assigned_to = s.assigned_to, sprint = s.sprint,
        story_points = s.points, tags = s.tags, domain = s.domain, on_board = 1, sn_updated_on = s.updated, synced_at = SYSUTCDATETIME()
     WHEN NOT MATCHED BY TARGET AND s.sys_id IS NOT NULL THEN INSERT (sys_id, number, short_description, state_value, state_label, priority,
        assigned_to, sprint, story_points, tags, domain, on_board, sn_updated_on)
        VALUES (s.sys_id, s.number, s.title, s.state_value, s.state_label, s.priority, s.assigned_to, s.sprint, s.points,
        s.tags, s.domain, 1, s.updated)
     WHEN NOT MATCHED BY SOURCE THEN UPDATE SET on_board = 0;`,
    [JSON.stringify(rows)],
  );
  return rows.length;
}

/** Saves a timesheet snapshot read by the orchestrator (replaces that week's rows). */
export async function saveTimesheetSnapshot(p: TimesheetSnapshot): Promise<number> {
  if (!p.sheet) return 0;
  // A blanked sheet id falls back to the stored sheet for that week; blanked card ids get a local key
  // (the app only displays cards; changes are made live through the skill).
  const known = await queryOne<{ sys_id: string }>('SELECT sys_id FROM dbo.timesheets WHERE week_starts_on = ?', [p.sheet.week_starts_on]);
  const sheetId = snId(p.sheet.sys_id) ?? known?.sys_id;
  if (!sheetId) throw new Error('Timesheet snapshot has no usable sheet id');
  const cards = p.cards.map((c) => ({ ...c, sys_id: snId(c.sys_id) ?? randomUUID().replace(/-/g, '') }));
  await saveSync(
    { errors: [], board: { name: '', filter: '' }, choices: [], stories: [], timesheet: { ...p.sheet, sys_id: sheetId }, time_cards: cards },
    { timesheetOnly: true },
  );
  return p.cards.length;
}

export async function listStories(filter: { lane?: string; domain?: string; search?: string; includeOffBoard?: boolean } = {}) {
  const where: string[] = [];
  const params: string[] = [];
  if (!filter.includeOffBoard) where.push('on_board = 1');
  if (filter.lane) {
    where.push('state_label = ?');
    params.push(filter.lane);
  }
  if (filter.domain) {
    where.push('domain = ?');
    params.push(filter.domain);
  }
  if (filter.search) {
    where.push('(number LIKE ? OR short_description LIKE ? OR description LIKE ?)');
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }
  return query<StoryRow>(
    `SELECT * FROM dbo.stories ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY number`,
    params,
  );
}

export async function getStory(number: string): Promise<StoryRow | undefined> {
  return queryOne<StoryRow>('SELECT * FROM dbo.stories WHERE number = ?', [number]);
}

export async function getLanes(): Promise<{ value: string | null; label: string; sequence: number }[]> {
  const fromSn = await query<{ value: string; label: string; sequence: number }>('SELECT value, label, sequence FROM dbo.lanes ORDER BY sequence');
  if (fromSn.length) return fromSn;
  return config.servicenow.laneOrder.map((label, i) => ({ value: null, label, sequence: i }));
}

/** Map a lane label to ServiceNow's stored state value, from sys_choice or values seen on synced stories. */
export async function stateValueFor(label: string): Promise<string | undefined> {
  const lane = await queryOne<{ value: string }>('SELECT value FROM dbo.lanes WHERE label = ?', [label]);
  if (lane) return lane.value;
  const seen = await queryOne<{ state_value: string }>('SELECT TOP 1 state_value FROM dbo.stories WHERE state_label = ?', [label]);
  return seen?.state_value;
}

export async function getCurrentTimesheet() {
  const sheet = await queryOne<{ sys_id: string; week_starts_on: Date; week_ends_on: Date; state: string; total_hours: number; synced_at: string }>(
    'SELECT TOP 1 * FROM dbo.timesheets ORDER BY week_starts_on DESC',
  );
  const cards = sheet
    ? await query('SELECT * FROM dbo.time_cards WHERE time_sheet_id = ? ORDER BY category, task_number', [sheet.sys_id])
    : [];
  return { sheet: sheet ?? null, cards };
}

export async function markStoryState(sysId: string, stateValue: string, stateLabel: string) {
  await query('UPDATE dbo.stories SET state_value = ?, state_label = ?, synced_at = SYSUTCDATETIME() WHERE sys_id = ?', [
    stateValue,
    stateLabel,
    sysId,
  ]);
}

export async function lastSyncAt(): Promise<string | null> {
  // The board snapshot stamps every on-board story, so the newest stamp is the last refresh.
  const row = await queryOne<{ t: string | null }>('SELECT MAX(synced_at) AS t FROM dbo.stories WHERE on_board = 1');
  return row?.t ?? null;
}
