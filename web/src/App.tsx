import { useCallback, useEffect, useState } from 'react';
import { api, connectLive, fmtTime, type LiveMessage } from './api';
import { emitRunEvent } from './runEvents';
import type { Approval, Board, Conversation, Run, Story, Timesheet } from './types';
import { BoardPanel } from './components/BoardPanel';
import { ChatPanel } from './components/ChatPanel';
import { ActivityPanel } from './components/ActivityPanel';
import { RunDrawer } from './components/RunDrawer';
import { StoryDrawer } from './components/StoryDrawer';

function upsert<T extends { id: string }>(list: T[], item: T, prepend = true): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return prepend ? [item, ...list] : [...list, item];
  const next = list.slice();
  next[i] = { ...next[i], ...item };
  return next;
}

export function App() {
  const [board, setBoard] = useState<Board | null>(null);
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [connected, setConnected] = useState(false);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [openStory, setOpenStory] = useState<Story | null>(null);
  // Switches the chat panel to a conversation (e.g. a story chat), optionally with a draft message.
  const [chatFocus, setChatFocus] = useState<{ conversationId: string; draft?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBoard = useCallback(() => {
    void api<Board>('/api/board').then(setBoard).catch((e) => setError(e.message));
    void api<Timesheet>('/api/timesheet').then(setTimesheet).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadBoard();
    void api<Run[]>('/api/runs').then(setRuns);
    void api<Approval[]>('/api/approvals').then(setApprovals);
    void api<Conversation[]>('/api/conversations').then(setConversations);
  }, [loadBoard]);

  useEffect(
    () =>
      connectLive((m: LiveMessage) => {
        switch (m.type) {
          case 'run':
            setRuns((rs) => upsert(rs, m.payload as Run));
            break;
          case 'run_event':
            emitRunEvent(m.payload);
            break;
          case 'approval':
            if (m.payload) setApprovals((as) => upsert(as, m.payload as Approval));
            break;
          case 'conversation':
            if (m.payload) setConversations((cs) => upsert(cs, m.payload as Conversation));
            break;
          case 'chat_message':
            window.dispatchEvent(new CustomEvent('arco:chat', { detail: m.payload }));
            break;
          case 'board':
            loadBoard();
            break;
        }
      }, setConnected),
    [loadBoard],
  );

  const syncRun = runs.find((r) => r.kind === 'sync' && (r.status === 'running' || r.status === 'queued'));
  const startSync = async () => {
    try {
      await api('/api/sync', { body: {} });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>◆</span>
          <span>ARCO Agents</span>
        </div>
        <div className="topbar-right">
          <span className="muted small">Board synced {fmtTime(board?.syncedAt)}</span>
          <button className="btn" onClick={startSync} disabled={!!syncRun}>
            {syncRun ? <><span className="spinner" /> Syncing…</> : 'Sync ServiceNow'}
          </button>
          <span className={`conn ${connected ? 'on' : 'off'}`} title={connected ? 'Live' : 'Reconnecting…'} />
        </div>
      </header>

      {error && (
        <div className="banner" role="alert">
          {error} <button className="link" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <main className="layout">
        <BoardPanel board={board} timesheet={timesheet} onOpenStory={setOpenStory} />
        <ChatPanel
          conversations={conversations}
          approvals={approvals}
          focus={chatFocus}
          onFocusConsumed={() => setChatFocus(null)}
          onOpenRun={setOpenRunId}
          onError={setError}
        />
        <ActivityPanel runs={runs} approvals={approvals} onOpenRun={setOpenRunId} onError={setError} />
      </main>

      {openRunId && <RunDrawer runId={openRunId} onClose={() => setOpenRunId(null)} onOpenRun={setOpenRunId} />}
      {openStory && board && (
        <StoryDrawer
          story={openStory}
          board={board}
          timesheet={timesheet}
          runs={runs.filter((r) => r.story_number === openStory.number)}
          onClose={() => setOpenStory(null)}
          onOpenRun={setOpenRunId}
          hasChat={conversations.some((c) => c.story_number === openStory.number)}
          onDiscuss={() => {
            const story = openStory;
            api<Conversation & { created: boolean }>(`/api/stories/${story.number}/conversation`, { body: {} })
              .then((conv) => {
                setChatFocus({
                  conversationId: conv.id,
                  draft: conv.created ? `Let's work on ${story.number} (${story.short_description}). Read the story and propose a plan.` : undefined,
                });
                setOpenStory(null);
              })
              .catch((e) => setError((e as Error).message));
          }}
        />
      )}
    </div>
  );
}
