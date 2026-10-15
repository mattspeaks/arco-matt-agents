import { useMemo, useState } from 'react';
import { DAYS, type Board, type Story, type Timesheet } from '../types';
import { parseJson } from '../api';

const COLLAPSED_BY_DEFAULT = ['Complete', 'Cancelled', 'Draft'];

export function hoursFor(number: string, timesheet: Timesheet | null): number {
  return (timesheet?.cards ?? [])
    .filter((c) => c.task_number === number || c.top_task_number === number)
    .reduce((sum, c) => sum + Number(c.total || 0), 0);
}

export function BoardPanel({ board, timesheet, onOpenStory }: { board: Board | null; timesheet: Timesheet | null; onOpenStory: (s: Story) => void }) {
  const [tab, setTab] = useState<'board' | 'time'>('board');
  const [queueOnly, setQueueOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(COLLAPSED_BY_DEFAULT));

  const byLane = useMemo(() => {
    const groups = new Map<string, Story[]>();
    for (const lane of board?.lanes ?? []) groups.set(lane.label, []);
    const q = search.trim().toLowerCase();
    for (const s of board?.stories ?? []) {
      if (queueOnly && !s.domain) continue;
      if (q && !`${s.number} ${s.short_description} ${s.assigned_to}`.toLowerCase().includes(q)) continue;
      const lane = s.state_label ?? 'Unknown';
      if (!groups.has(lane)) groups.set(lane, []);
      groups.get(lane)!.push(s);
    }
    return groups;
  }, [board, queueOnly, search]);

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

function TimesheetView({ timesheet }: { timesheet: Timesheet | null }) {
  if (!timesheet?.sheet) return <p className="muted pad">No timesheet synced for this week yet.</p>;
  const { sheet, cards } = timesheet;
  const totals = DAYS.map((d) => cards.reduce((s, c) => s + Number(c[d] || 0), 0));
  return (
    <div className="panel-body">
      <div className="ts-head">
        <div>
          <div className="small muted">Week of</div>
          <div className="strong">{String(sheet.week_starts_on).slice(0, 10)}</div>
        </div>
        <span className="tag subtle">{sheet.state}</span>
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
      <p className="small muted pad">Read-only for now. Agents can see this, but can't log time.</p>
    </div>
  );
}
