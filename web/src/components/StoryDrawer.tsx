import { useEffect } from 'react';
import { fmtTime, parseJson } from '../api';
import { DAYS, type Board, type Run, type Story, type Timesheet } from '../types';
import { StatusPill } from './ActivityPanel';
import { CloseoutCard, useChecklist } from './CloseoutCard';
import { api } from '../api';

export function StoryDrawer({
  story,
  board,
  timesheet,
  runs,
  onClose,
  onOpenRun,
  onError,
  hasChat,
  onDiscuss,
}: {
  story: Story;
  board: Board;
  timesheet: Timesheet | null;
  runs: Run[];
  onClose: () => void;
  onOpenRun: (id: string) => void;
  onError: (m: string) => void;
  hasChat: boolean;
  onDiscuss: () => void;
}) {
  const checklist = useChecklist(story.number);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cards = (timesheet?.cards ?? []).filter((c) => c.task_number === story.number || c.top_task_number === story.number);
  const tags = parseJson<string[]>(story.tags, []);
  const snUrl = `${board.instanceUrl}/rm_story.do?sys_id=${story.sys_id}`;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Story detail">
        <div className="drawer-head">
          <div>
            <div className="small muted mono">{story.number}</div>
            <h2 className="drawer-title">{story.short_description}</h2>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="drawer-meta small">
          <span className="tag subtle">{story.state_label}</span>
          {story.domain && <span className={`tag ${story.domain}`}>{story.domain.toUpperCase()}</span>}
          {tags.map((t) => (
            <span key={t} className="tag subtle">{t}</span>
          ))}
          <span className="muted">{story.assigned_to || 'Unassigned'}</span>
          {story.story_points && <span className="muted">· {story.story_points} pts</span>}
          <a className="link small push" href={snUrl} target="_blank" rel="noreferrer">
            Open in ServiceNow ↗
          </a>
        </div>
        <div className="drawer-body">
          <div className="row-actions">
            <button className="btn primary" onClick={onDiscuss}>
              {hasChat ? 'Open story chat' : 'Discuss with orchestrator'}
            </button>
          </div>
          {!story.domain && (
            <p className="small muted">
              Not in an agent queue. Add a routing hashtag (e.g. #PowerBI or #DWH) to the story's description in ServiceNow, then sync.
            </p>
          )}
          <section>
            <h3 className="section-title">Close-out</h3>
            {checklist ? (
              <CloseoutCard story={story.number} onError={onError} />
            ) : checklist === null ? (
              <>
                <p className="small muted">Your definition of done for this story. It starts on its own after a publish.</p>
                <button className="btn ghost small" onClick={() => void api(`/api/stories/${story.number}/checklist`, { body: {} }).catch((e) => onError((e as Error).message))}>
                  Start close-out checklist
                </button>
              </>
            ) : null}
          </section>
          <section>
            <h3 className="section-title">Description</h3>
            <div className="prewrap story-text">{story.description || <span className="muted">None</span>}</div>
          </section>
          <section>
            <h3 className="section-title">Acceptance criteria</h3>
            <div className="prewrap story-text">{story.acceptance_criteria || <span className="muted">None. The orchestrator will ask for them before building.</span>}</div>
          </section>
          <section>
            <h3 className="section-title">Time this week</h3>
            {cards.length === 0 ? (
              <p className="small muted">No time card rows for this story this week.</p>
            ) : (
              cards.map((c) => (
                <div key={c.sys_id} className="small">
                  {c.category}: {DAYS.map((d) => Number(c[d]) || 0).join(' / ')} = <strong>{Number(c.total)}h</strong>
                </div>
              ))
            )}
          </section>
          <section>
            <h3 className="section-title">Agent runs</h3>
            {runs.length === 0 && <p className="small muted">None yet.</p>}
            {runs.map((r) => (
              <button key={r.id} className="run-row" onClick={() => onOpenRun(r.id)}>
                <div className="run-row-top">
                  <span className="tag subtle">{r.worker ?? r.kind}</span>
                  <StatusPill status={r.status} />
                </div>
                <div className="run-title ellipsis">{r.title}</div>
                <div className="small muted">{fmtTime(r.created_at)}</div>
              </button>
            ))}
          </section>
          <p className="small muted">Synced {fmtTime(story.synced_at)}</p>
        </div>
      </aside>
    </div>
  );
}
