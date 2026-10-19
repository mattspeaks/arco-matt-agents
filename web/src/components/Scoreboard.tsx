import { useEffect, useRef, useState } from 'react';
import type { SprintScore } from '../types';

// Matt's sprint at a glance, top centre: points done (the headline), stories in flight and not started, and how far
// through the sprint he is. Points going up gets a little celebration.

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const shortDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

export function Scoreboard({ score }: { score: SprintScore }) {
  const { sprint, done, inFlight, notStarted, totalPoints } = score;
  const pct = totalPoints ? Math.round((done.points / totalPoints) * 100) : 0;
  // Sprint time elapsed, to compare against points done.
  const elapsed =
    sprint?.start && sprint.end
      ? Math.min(100, Math.max(0, Math.round(((Date.now() - new Date(`${sprint.start}T00:00:00`).getTime()) / (new Date(`${sprint.end}T23:59:59`).getTime() - new Date(`${sprint.start}T00:00:00`).getTime())) * 100)))
      : null;

  const last = useRef(done.points);
  const [bump, setBump] = useState<number | null>(null);
  useEffect(() => {
    if (done.points > last.current) {
      setBump(done.points - last.current);
      const t = setTimeout(() => setBump(null), 2400);
      last.current = done.points;
      return () => clearTimeout(t);
    }
    last.current = done.points;
  }, [done.points]);

  return (
    <div className="scoreboard" aria-label="Your sprint">
      <div className="score-sprint small">
        <div className="strong">{sprint?.name ?? 'This sprint'}</div>
        <div className="muted">
          {sprint?.start && sprint.end ? `${shortDate(sprint.start)} – ${shortDate(sprint.end)}` : ''}
          {sprint?.daysLeft != null ? ` · ${sprint.daysLeft === 0 ? 'last day' : `${sprint.daysLeft} day${sprint.daysLeft === 1 ? '' : 's'} left`}` : ''}
        </div>
      </div>
      <div
        className="score-bar"
        title={`${fmt(done.points)} of ${fmt(totalPoints)} points done${elapsed != null ? `, ${elapsed}% of the sprint gone` : ''}`}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="score-fill" style={{ width: `${pct}%` }} />
        {elapsed != null && <div className="score-time" style={{ left: `${elapsed}%` }} />}
      </div>
      <div className={`score-done ${bump ? 'bump' : ''}`} title={`${done.count} ${done.count === 1 ? 'story' : 'stories'} Complete`}>
        <span className="score-big">{fmt(done.points)}</span>
        <span className="small muted"> / {fmt(totalPoints)} pts done</span>
        {bump && <span className="score-plus">+{fmt(bump)}</span>}
      </div>
      <div className="score-stat small" title={`${fmt(inFlight.points)} points in Work in progress → Deploy/Launch`}>
        <span className="strong">{inFlight.count}</span> in flight
      </div>
      <div className="score-stat small" title={`${fmt(notStarted.points)} points in Backlog, Draft or Ready`}>
        <span className="strong">{notStarted.count}</span> not started
      </div>
    </div>
  );
}
