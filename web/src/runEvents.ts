import { useEffect, useState } from 'react';
import { api } from './api';
import type { Run, RunEvent } from './types';

type Listener = (ev: RunEvent) => void;
const listeners = new Set<Listener>();

export function emitRunEvent(ev: RunEvent) {
  for (const l of listeners) l(ev);
}

export function onRunEvent(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** History from the API plus live events from the websocket, for one run. */
export function useRunEvents(runId: string | null | undefined) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    setEvents([]);
    setRun(null);
    if (!runId) return;
    let live: RunEvent[] = [];
    let loaded = false;
    const off = onRunEvent((ev) => {
      if (ev.run_id !== runId) return;
      if (loaded) setEvents((es) => [...es, ev]);
      else live.push(ev);
    });
    void api<{ run: Run; events: RunEvent[] }>(`/api/runs/${runId}`).then(({ run, events }) => {
      loaded = true;
      setRun(run);
      // Events that arrived while loading and aren't in the stored history yet.
      const last = events.at(-1)?.ts ?? '';
      setEvents([...events, ...live.filter((e) => e.ts > last)]);
      live = [];
    });
    return off;
  }, [runId]);

  return { events, run, setRun };
}
