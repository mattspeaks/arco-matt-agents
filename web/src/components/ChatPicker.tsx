import { useEffect, useRef, useState } from 'react';
import type { Approval, Conversation, Run } from '../types';

// The chat switcher. A native <select> can't animate its options, so this is a small custom listbox:
// - working: a turn or a worker (builder, QC, model builder…) is running for the chat → a moving progress bar
// - waiting: an approval card in the chat is pending → the row blinks until Matt answers it

export interface ChatStatus {
  working: boolean;
  waiting: number;
}

export function chatStatuses(conversations: Conversation[], runs: Run[], approvals: Approval[]): Map<string, ChatStatus> {
  const live = runs.filter((r) => r.status === 'running' || r.status === 'queued');
  const pendingByConv = new Map<string, number>();
  for (const a of approvals) {
    if (a.status !== 'pending') continue;
    try {
      const id = (JSON.parse(a.payload) as { conversationId?: string }).conversationId;
      if (id) pendingByConv.set(id, (pendingByConv.get(id) ?? 0) + 1);
    } catch {
      /* not a chat card */
    }
  }
  return new Map(
    conversations.map((c) => [
      c.id,
      {
        working: !!c.busy_run_id || live.some((r) => r.conversation_id === c.id || (!!c.story_number && r.story_number === c.story_number)),
        waiting: pendingByConv.get(c.id) ?? 0,
      },
    ]),
  );
}

export function ChatPicker({
  conversations,
  activeId,
  statuses,
  onPick,
}: {
  conversations: Conversation[];
  activeId: string | null;
  statuses: Map<string, ChatStatus>;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = conversations.find((c) => c.id === activeId) ?? null;
  const live = conversations.filter((c) => !c.archived_at);
  const archived = conversations.filter((c) => c.archived_at);
  const groups: [string, Conversation[]][] = [
    ['Main', live.filter((c) => !c.story_number)],
    ['Stories', live.filter((c) => c.story_number)],
    [`Archived (${archived.length})`, archived],
  ];
  const othersWaiting = conversations.filter((c) => c.id !== activeId && (statuses.get(c.id)?.waiting ?? 0) > 0).length;
  const othersWorking = conversations.filter((c) => c.id !== activeId && statuses.get(c.id)?.working).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const row = (c: Conversation) => {
    const s = statuses.get(c.id);
    const cls = ['chat-pick-row', c.id === activeId ? 'current' : '', s?.waiting ? 'waiting' : '', s?.working ? 'working' : ''].join(' ');
    return (
      <li key={c.id} role="option" aria-selected={c.id === activeId}>
        <button
          className={cls}
          onClick={() => {
            onPick(c.id);
            setOpen(false);
          }}
        >
          <span className="chat-pick-title">
            {c.closeout?.closed ? '✓ ' : ''}
            {c.title}
          </span>
          <span className="chat-pick-tags">
            {s?.waiting ? <span className="chat-tag waiting">needs you{s.waiting > 1 ? ` (${s.waiting})` : ''}</span> : null}
            {s?.working ? <span className="chat-tag working">working</span> : null}
            {c.closeout && !c.closeout.closed && !c.archived_at ? (
              <span className="chat-tag">
                close-out {c.closeout.done}/{c.closeout.total}
              </span>
            ) : null}
          </span>
          {s?.working && <span className="chat-progress" aria-hidden="true" />}
        </button>
      </li>
    );
  };

  const activeStatus = active ? statuses.get(active.id) : undefined;
  return (
    <div className="chat-pick" ref={ref}>
      <button
        className={`input select chat-pick-button ${othersWaiting ? 'waiting' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Conversation"
        onClick={() => setOpen((o) => !o)}
        title={othersWaiting ? `${othersWaiting} other chat${othersWaiting === 1 ? '' : 's'} need${othersWaiting === 1 ? 's' : ''} you` : undefined}
      >
        <span className="chat-pick-title">{active?.title ?? (conversations.length ? 'Pick a chat' : 'No conversations yet')}</span>
        {othersWaiting > 0 && <span className="chat-tag waiting">{othersWaiting} need{othersWaiting === 1 ? 's' : ''} you</span>}
        {othersWorking > 0 && <span className="chat-tag working">{othersWorking} working</span>}
        {activeStatus?.working && <span className="chat-progress" aria-hidden="true" />}
      </button>
      {open && (
        <div className="chat-pick-pop">
          {groups
            .filter(([, cs]) => cs.length)
            .map(([label, cs]) => (
              <div key={label} className="chat-pick-group">
                <div className="chat-pick-label">{label}</div>
                <ul role="listbox" aria-label={label}>
                  {cs.map(row)}
                </ul>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
