import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, fmtDuration, fmtTime, parseJson } from '../api';
import { useRunEvents } from '../runEvents';
import type { Run, RunEvent } from '../types';
import { StatusPill } from './ActivityPanel';

export function RunDrawer({ runId, onClose, onOpenRun }: { runId: string; onClose: () => void; onOpenRun: (id: string) => void }) {
  const { events, run, setRun } = useRunEvents(runId);

  // Refresh the run row (status/result) whenever a result event lands.
  const last = events.at(-1);
  useEffect(() => {
    if (last?.type === 'result' || last?.type === 'saved') {
      const t = setTimeout(() => void api<{ run: Run }>(`/api/runs/${runId}`).then((r) => setRun(r.run)), 800);
      return () => clearTimeout(t);
    }
  }, [last, runId, setRun]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meta = parseJson<Record<string, unknown>>(run?.meta, {});
  const active = run && ['running', 'queued'].includes(run.status);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Run detail">
        <div className="drawer-head">
          <div>
            <div className="small muted">
              {run?.kind} {run?.worker && `· ${run.worker}`} {run?.story_number && `· ${run.story_number}`}
            </div>
            <h2 className="drawer-title">{run?.title ?? 'Loading…'}</h2>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {run && (
          <div className="drawer-meta small">
            <StatusPill status={run.status} />
            <span className="muted">Started {fmtTime(run.started_at ?? run.created_at)}</span>
            {run.started_at && <span className="muted">· {fmtDuration(run.started_at, run.ended_at)}</span>}
            {run.cost_usd != null && <span className="muted">· est. ${Number(run.cost_usd).toFixed(3)} (plan usage)</span>}
            {run.parent_run_id && (
              <button className="link small" onClick={() => onOpenRun(run.parent_run_id!)}>
                parent run
              </button>
            )}
            {active && (
              <button className="btn danger small push" onClick={() => void api(`/api/runs/${run.id}/cancel`, { body: {} })}>
                Cancel
              </button>
            )}
          </div>
        )}

        <div className="drawer-body">
          {run?.error && <div className="banner inline">{run.error}</div>}
          {typeof meta.verdict === 'string' && <div className={`tag ${meta.verdict === 'PASS' ? 'pass' : 'fail'}`}>QC {meta.verdict}</div>}
          {run?.result && (
            <section>
              <h3 className="section-title">Result</h3>
              <div className="md result">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.result}</ReactMarkdown>
              </div>
            </section>
          )}
          {run?.prompt && run.kind === 'worker' && (
            <details>
              <summary className="small muted">Brief sent to the worker</summary>
              <pre className="note">{run.prompt}</pre>
            </details>
          )}
          <section>
            <h3 className="section-title">
              Timeline <span className="count">{events.length}</span>
            </h3>
            <ol className="timeline">
              {events.map((e, i) => (
                <EventRow key={i} ev={e} />
              ))}
            </ol>
          </section>
        </div>
      </aside>
    </div>
  );
}

function EventRow({ ev }: { ev: RunEvent }) {
  const [open, setOpen] = useState(false);
  const data = typeof ev.data === 'string' ? parseJson<unknown>(ev.data, ev.data) : ev.data;
  const detail =
    data && typeof data === 'object' && 'text' in (data as object)
      ? String((data as { text: unknown }).text)
      : data && typeof data === 'object' && 'input' in (data as object)
        ? JSON.stringify((data as { input: unknown }).input, null, 2)
        : data
          ? JSON.stringify(data, null, 2)
          : null;
  return (
    <li className={`ev ${ev.type}`}>
      <span className="ev-time mono small muted">{new Date(ev.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
      <span className="ev-type small">{ev.type.replace('_', ' ')}</span>
      <div className="ev-body">
        <div className={ev.type === 'text' ? 'prewrap' : 'ellipsis-2'}>{ev.summary}</div>
        {detail && ev.type !== 'text' && (
          <>
            <button className="link small" onClick={() => setOpen(!open)}>
              {open ? 'hide' : 'details'}
            </button>
            {open && <pre className="note">{detail.slice(0, 8000)}</pre>}
          </>
        )}
      </div>
    </li>
  );
}
