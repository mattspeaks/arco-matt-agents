import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Checklist } from '../types';

// Matt's close-out checklist for a story: his definition of done. Shown in the story chat and the story panel; both
// copies read the same server state and refresh on the live 'checklist' event.

export function useChecklist(story: string) {
  const [checklist, setChecklist] = useState<Checklist | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void api<Checklist | null>(`/api/stories/${story}/checklist`)
      .then((c) => live && setChecklist(c))
      .catch(() => live && setChecklist(null));
    const onUpdate = (e: Event) => {
      const c = (e as CustomEvent<Checklist>).detail;
      if (c?.story_number === story) setChecklist(c);
    };
    window.addEventListener('arco:checklist', onUpdate);
    return () => {
      live = false;
      window.removeEventListener('arco:checklist', onUpdate);
    };
  }, [story]);
  return checklist;
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '');

export function CloseoutCard({ story, onError }: { story: string; onError: (m: string) => void }) {
  const checklist = useChecklist(story);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState('');

  if (checklist === undefined) return <div className="approval closeout small muted">Loading close-out…</div>;
  if (checklist === null) return null;

  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const base = `/api/stories/${story}/checklist`;
  const done = checklist.items.filter((i) => i.done).length;
  const total = checklist.items.length;
  const closed = !!checklist.closed_at;

  return (
    <div className={`approval closeout ${closed ? 'closed' : ''}`}>
      <div className="approval-kind small">Close-out</div>
      <div className="approval-title">
        {story}: your definition of done{' '}
        <span className={`tag ${done === total ? 'pass' : 'subtle'}`}>
          {done}/{total}
        </span>
      </div>
      <ul className="checklist">
        {checklist.items.map((i) => (
          <li key={i.id} className={i.done ? 'done' : ''}>
            <label>
              <input type="checkbox" checked={i.done} disabled={busy || closed} onChange={(e) => void call(() => api(`${base}/items/${i.id}`, { body: { done: e.target.checked } }))} />
              <span>{i.label}</span>
            </label>
            <div className="small muted checklist-meta">
              {i.done && <span>{i.doneBy === 'app' ? 'checked by the app' : 'you'} · {when(i.doneAt)}</span>}
              {i.auto === 'pr' && !i.done && <span>ticks itself when the PR completes</span>}
              {i.note && editing !== i.id && <span>· {i.note}</span>}
              {!closed && editing !== i.id && (
                <button
                  className="link small"
                  onClick={() => {
                    setEditing(i.id);
                    setNote(i.note ?? '');
                  }}
                >
                  {i.note ? 'edit note' : 'add note'}
                </button>
              )}
              {!closed && !i.done && !i.auto && editing !== i.id && (
                <button className="link small" disabled={busy} onClick={() => void call(() => api(`${base}/items/${i.id}`, { method: 'DELETE' }))}>
                  remove
                </button>
              )}
            </div>
            {editing === i.id && (
              <form
                className="checklist-note"
                onSubmit={(e) => {
                  e.preventDefault();
                  setEditing(null);
                  void call(() => api(`${base}/items/${i.id}`, { body: { note } }));
                }}
              >
                <input className="input small" autoFocus placeholder="e.g. signed off by the Controller by email" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn ghost small" type="submit">
                  Save
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {closed ? (
        <div className="approval-decided small approved">Closed {when(checklist.closed_at ?? undefined)}. Moving the story to Complete is yours, in ServiceNow.</div>
      ) : (
        <>
          <form
            className="checklist-note"
            onSubmit={(e) => {
              e.preventDefault();
              const label = adding.trim();
              if (!label) return;
              setAdding('');
              void call(() => api(`${base}/items`, { body: { label } }));
            }}
          >
            <input className="input small" placeholder="Add an item for this story" value={adding} onChange={(e) => setAdding(e.target.value)} />
            <button className="btn ghost small" type="submit" disabled={busy || !adding.trim()}>
              Add
            </button>
          </form>
          <div className="approval-actions">
            <button className="btn primary" disabled={busy || done < total} title={done < total ? 'Tick every item first' : ''} onClick={() => void call(() => api(`/api/stories/${story}/close`, { body: {} }))}>
              Close story…
            </button>
          </div>
        </>
      )}
    </div>
  );
}
