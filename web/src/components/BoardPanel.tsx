import { useMemo, useState, useEffect } from 'react';
import { DAYS, type Board, type Story, type Timesheet } from '../types';
import { api, parseJson } from '../api';

const COLLAPSED_BY_DEFAULT = ['Complete', 'Cancelled', 'Draft'];
const PERSON_KEY = 'arco.boardPerson';
const EVERYONE = '';
const UNASSIGNED = '__unassigned__';

function loadPerson(): string {
  try {
    return localStorage.getItem(PERSON_KEY) ?? EVERYONE;
  } catch {
    return EVERYONE;
  }
}

export function hoursFor(number: string, timesheet: Timesheet | null): number {
  return (timesheet?.cards ?? [])
    .filter((c) => c.task_number === number || c.top_task_number === number)
    .reduce((sum, c) => sum + Number(c.total || 0), 0);
}

export function BoardPanel({ board, timesheet, onOpenStory }: { board: Board | null; timesheet: Timesheet | null; onOpenStory: (s: Story) => void }) {
  const [tab, setTab] = useState<'board' | 'time'>('board');
  const [queueOnly, setQueueOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [person, setPersonState] = useState(loadPerson);
  const setPerson = (p: string) => {
    setPersonState(p);
    try {
      localStorage.setItem(PERSON_KEY, p);
    } catch {
      /* storage unavailable */
    }
  };

  // Everyone with a story on the board, most stories first, with Matt pulled out as "Me".
  const people = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const s of board?.stories ?? []) {
      const who = s.assigned_to?.trim();
      if (who) counts.set(who, (counts.get(who) ?? 0) + 1);
      else unassigned++;
    }
    const others = [...counts.entries()].filter(([name]) => name !== board?.me).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { me: board?.me ? (counts.get(board.me) ?? 0) : 0, others, unassigned };
  }, [board]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(COLLAPSED_BY_DEFAULT));

  const byLane = useMemo(() => {
    const groups = new Map<string, Story[]>();
    for (const lane of board?.lanes ?? []) groups.set(lane.label, []);
    const q = search.trim().toLowerCase();
    for (const s of board?.stories ?? []) {
      if (queueOnly && !s.domain) continue;
      if (person === UNASSIGNED ? s.assigned_to?.trim() : person !== EVERYONE && s.assigned_to?.trim() !== person) continue;
      if (q && !`${s.number} ${s.short_description} ${s.assigned_to}`.toLowerCase().includes(q)) continue;
      const lane = s.state_label ?? 'Unknown';
      if (!groups.has(lane)) groups.set(lane, []);
      groups.get(lane)!.push(s);
    }
    return groups;
  }, [board, queueOnly, search, person]);

  const toggle = (lane: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      return next;
    });

  const agentLanes = board ? Object.values(board.laneMapping) : [];

  return (
    <section className="panel board-panel" aria-label="ServiceNow board">
      <div className="panel-head">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'board'} className={tab === 'board' ? 'tab active' : 'tab'} onClick={() => setTab('board')}>
            Board <span className="count">{board?.stories.length ?? 0}</span>
          </button>
          <button role="tab" aria-selected={tab === 'time'} className={tab === 'time' ? 'tab active' : 'tab'} onClick={() => setTab('time')}>
            Timesheet <span className="count">{timesheet?.sheet ? `${Number(timesheet.sheet.total_hours)}h` : '–'}</span>
          </button>
        </div>
      </div>

      {tab === 'board' ? (
        <>
          <div className="board-filters">
            <input className="input" placeholder="Search stories…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className={`input person-filter ${person ? 'active' : ''}`} value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Assigned to">
              <option value={EVERYONE}>Everyone</option>
              {board?.me && <option value={board.me}>Me ({people.me})</option>}
              {people.others.map(([name, n]) => (
                <option key={name} value={name}>
                  {name} ({n})
                </option>
              ))}
              {people.unassigned > 0 && <option value={UNASSIGNED}>Unassigned ({people.unassigned})</option>}
              {person && person !== UNASSIGNED && person !== board?.me && !people.others.some(([n]) => n === person) && <option value={person}>{person} (0)</option>}
            </select>
            <label className="check">
              <input type="checkbox" checked={queueOnly} onChange={(e) => setQueueOnly(e.target.checked)} /> Agent queue
            </label>
          </div>
          <div className="panel-body">
            {!board && <p className="muted pad">Loading…</p>}
            {board && board.stories.length === 0 && <p className="muted pad">No stories yet. Click "Sync ServiceNow".</p>}
            {[...byLane.entries()].map(([lane, stories]) => (
              <div key={lane} className="lane">
                <button className="lane-head" onClick={() => toggle(lane)} aria-expanded={!collapsed.has(lane)}>
                  <span className="chev">{collapsed.has(lane) ? '▸' : '▾'}</span>
                  <span className="lane-name">{lane}</span>
                  {agentLanes.includes(lane) && <span className="tag subtle">agent</span>}
                  <span className="count">{stories.length}</span>
                </button>
                {!collapsed.has(lane) &&
                  stories.map((s) => {
                    const hrs = hoursFor(s.number, timesheet);
                    const tags = parseJson<string[]>(s.tags, []);
                    return (
                      <button key={s.sys_id} className="card" onClick={() => onOpenStory(s)}>
                        <div className="card-top">
                          <span className="mono small">{s.number}</span>
                          {s.domain && <span className={`tag ${s.domain}`}>{s.domain.toUpperCase()}</span>}
                          {board?.closeouts?.[s.number] &&
                            (board.closeouts[s.number].closed ? (
                              <span className="tag pass">✓ closed</span>
                            ) : (
                              <span className="tag subtle" title="Close-out checklist">
                                close-out {board.closeouts[s.number].done}/{board.closeouts[s.number].total}
                              </span>
                            ))}
                          {s.story_points && <span className="muted small push">{s.story_points} pts</span>}
                        </div>
                        <div className="card-title">{s.short_description}</div>
                        <div className="card-meta small muted">
                          <span>{s.assigned_to || 'Unassigned'}</span>
                          {hrs > 0 && <span>· {hrs}h this week</span>}
                          {tags.length > 0 && <span>· {tags.join(' ')}</span>}
                        </div>
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
        </>
      ) : (
        <TimesheetView timesheet={timesheet} />
      )}
    </section>
  );
}

/** A week's Sunday, YYYY-MM-DD, in local time (timesheet weeks start on Sunday). */
function sundayOf(weeksBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() - 7 * weeksBack);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function TimesheetView({ timesheet }: { timesheet: Timesheet | null }) {
  const [weeksBack, setWeeksBack] = useState(0); // 0 = this week, 1 = last week
  const [shown, setShown] = useState<Timesheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const week = sundayOf(weeksBack);

  // Re-read whenever the app's copy changes (App re-fetches the current timesheet after every sync).
  useEffect(() => {
    let live = true;
    setLoading(true);
    api<Timesheet>(`/api/timesheet?week=${week}`)
      .then((t) => live && setShown(t))
      .catch(() => live && setShown(null))
      .finally(() => live && setLoading(false));
    setSyncing(false);
    return () => {
      live = false;
    };
  }, [week, timesheet]);

  const refresh = () => {
    setSyncing(true);
    void api('/api/sync', { body: { week } }).catch(() => setSyncing(false));
  };

  const switcher = (
    <div className="ts-weeks">
      <div className="tabs small" role="tablist" aria-label="Week">
        {([['Last week', 1], ['This week', 0]] as const).map(([label, i]) => (
          <button key={label} role="tab" aria-selected={weeksBack === i} className={weeksBack === i ? 'tab active' : 'tab'} onClick={() => setWeeksBack(i)}>
            {label}
          </button>
        ))}
      </div>
      <button className="btn ghost small" disabled={syncing} onClick={refresh} title={`Ask the orchestrator to re-read the week of ${week} from ServiceNow`}>
        {syncing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );

  if (!shown?.sheet)
    return (
      <div className="panel-body">
        {switcher}
        <p className="muted pad">
          {loading ? 'Loading…' : `The app has no copy of the week of ${week} yet. Use Refresh to read it from ServiceNow.`}
        </p>
      </div>
    );
  const { sheet, cards } = shown;
  const totals = DAYS.map((d) => cards.reduce((s, c) => s + Number(c[d] || 0), 0));
  return (
    <div className="panel-body">
      {switcher}
      <div className="ts-head">
        <div>
          <div className="small muted">Week of</div>
          <div className="strong">{String(sheet.week_starts_on).slice(0, 10)}</div>
        </div>
        <span className="tag subtle">{sheet.state}</span>
        <div className="small muted">synced {new Date(sheet.synced_at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
        <div className="push strong">{Number(sheet.total_hours)}h</div>
      </div>
      <table className="ts-table">
        <thead>
          <tr>
            <th>Task</th>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <th key={i} className="num">{d}</th>
            ))}
            <th className="num">Σ</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.sys_id} className={Number(c.total) === 0 ? 'dim' : ''}>
              <td>
                <div className="mono small">{c.task_number ?? c.category}</div>
                <div className="small muted ellipsis" title={c.task_short_description ?? ''}>
                  {c.task_short_description ?? ''}
                </div>
              </td>
              {DAYS.map((d) => (
                <td key={d} className="num">{Number(c[d]) ? Number(c[d]) : ''}</td>
              ))}
              <td className="num strong">{Number(c.total) || ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="strong">Total</td>
            {totals.map((t, i) => (
              <td key={i} className="num">{t || ''}</td>
            ))}
            <td className="num strong">{Number(sheet.total_hours)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="small muted pad">To log time, ask the orchestrator, or use the Timesheet card in a story chat. Every change goes through a card.</p>
    </div>
  );
}
