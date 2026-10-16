import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, fmtTime } from '../api';
import { useRunEvents } from '../runEvents';
import type { Approval, ChatMessage, Conversation } from '../types';
import { ApprovalCard } from './ActivityPanel';

const ACTIVE_KEY = 'arco.activeConversation';

function loadActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function ChatPanel({
  conversations,
  approvals,
  focus,
  onFocusConsumed,
  onOpenRun,
  onError,
}: {
  conversations: Conversation[];
  approvals: Approval[];
  focus: { conversationId: string; draft?: string } | null;
  onFocusConsumed: () => void;
  onOpenRun: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(loadActive);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { events } = useRunEvents(pendingRunId);

  const active = conversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    if (!activeId && conversations.length) setActiveId(conversations[0].id);
  }, [activeId, conversations]);

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {
      /* storage unavailable */
    }
    setMessages([]);
    setPendingRunId(null);
    if (!activeId) return;
    void api<ChatMessage[]>(`/api/conversations/${activeId}/messages`)
      .then((ms) => {
        setMessages(ms);
        // Still working if the latest message that belongs to a turn is the request that started it.
        const last = [...ms].reverse().find((m) => m.run_id);
        if (last?.role === 'user' && last.run_id) setPendingRunId(last.run_id);
      })
      .catch(() => setActiveId(null));
  }, [activeId]);

  useEffect(() => {
    const onChat = (e: Event) => {
      const m = (e as CustomEvent<ChatMessage>).detail;
      if (m.conversation_id !== activeId) return;
      setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]));
      // A reply can also come from an Approve/Reject click, so follow any new user turn.
      if (m.role === 'user' && m.run_id) setPendingRunId(m.run_id);
      else if (m.role !== 'user' && m.run_id) setPendingRunId((id) => (id === m.run_id ? null : id));
    };
    window.addEventListener('arco:chat', onChat);
    return () => window.removeEventListener('arco:chat', onChat);
  }, [activeId]);

  useEffect(() => {
    if (!focus) return;
    setActiveId(focus.conversationId);
    if (focus.draft) setText(focus.draft);
    onFocusConsumed();
    inputRef.current?.focus();
  }, [focus, onFocusConsumed]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, events.length]);

  const newConversation = async () => {
    const c = await api<Conversation>('/api/conversations', { body: {} });
    setActiveId(c.id);
    return c.id;
  };

  const send = async () => {
    const body = text.trim();
    if (!body || pendingRunId) return;
    try {
      const id = activeId ?? (await newConversation());
      setText('');
      const { runId } = await api<{ runId: string }>(`/api/conversations/${id}/messages`, { body: { text: body } });
      setPendingRunId(runId);
    } catch (e) {
      setText(body);
      onError((e as Error).message);
    }
  };

  const stop = () => pendingRunId && void api(`/api/runs/${pendingRunId}/cancel`, { body: {} });

  const activity = events.filter((e) => e.type === 'tool_use' || e.type === 'text').slice(-6);

  return (
    <section className="panel chat-panel" aria-label="Orchestrator chat">
      <div className="panel-head">
        <select className="input select" value={activeId ?? ''} onChange={(e) => setActiveId(e.target.value || null)} aria-label="Conversation">
          {!conversations.length && <option value="">No conversations yet</option>}
          {conversations.some((c) => !c.story_number) && (
            <optgroup label="Main">
              {conversations.filter((c) => !c.story_number).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </optgroup>
          )}
          {conversations.some((c) => c.story_number) && (
            <optgroup label="Stories">
              {conversations.filter((c) => c.story_number).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.busy_run_id ? '● ' : ''}{c.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button className="btn ghost" onClick={() => void newConversation()}>
          + New
        </button>
      </div>

      <div className="panel-body chat-list" ref={listRef}>
        {messages.length === 0 && !pendingRunId && (
          <div className="empty">
            <div className="empty-title">Talk to the orchestrator</div>
            <div className="muted small">Try: "Check the board for #PowerBI stories and propose a plan" or "QC the Safety Scorecards project".</div>
          </div>
        )}
        {messages.map((m) => {
          if (m.role === 'approval') {
            const approval = approvals.find((a) => a.id === m.content);
            // Report workflow cards live in the story chat as well as in Approvals.
            if (approval?.kind.startsWith('pbi_')) {
              return (
                <div key={m.id} className="chat-card">
                  <ApprovalCard approval={approval} onError={onError} />
                </div>
              );
            }
            const state = !approval ? 'not found' : approval.status === 'pending' ? 'waiting for you in Approvals (top right)' : (approval.outcome ?? approval.status);
            return (
              <div key={m.id} className={`approval-note small ${approval?.status ?? ''}`}>
                Approval requested: <strong>{approval?.title ?? '…'}</strong> · {state}
              </div>
            );
          }
          return (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="msg-meta small muted">
              {m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Orchestrator' : m.role === 'app' ? 'App' : 'Error'} · {fmtTime(m.created_at)}
              {m.run_id && m.role !== 'user' && (
                <button className="link small" onClick={() => onOpenRun(m.run_id!)}>
                  trace
                </button>
              )}
            </div>
            <div className="msg-body md">
              {m.role === 'user' ? <p className="prewrap">{m.content}</p> : <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>}
            </div>
          </div>
          );
        })}
        {pendingRunId && (
          <div className="msg assistant working">
            <div className="msg-meta small muted">
              <span className="spinner" /> Orchestrator is working…
              <button className="link small" onClick={() => onOpenRun(pendingRunId)}>
                trace
              </button>
            </div>
            <ul className="activity">
              {activity.map((e, i) => (
                <li key={i} className={`small ${e.type}`}>
                  {e.type === 'tool_use' ? '⚙ ' : ''}
                  {(e.summary ?? '').slice(0, 220)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="composer">
        <textarea
          ref={inputRef}
          className="input"
          rows={3}
          placeholder={active?.busy_run_id || pendingRunId ? 'Waiting for the orchestrator…' : 'Message the orchestrator (Enter to send, Shift+Enter for a new line)'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {pendingRunId ? (
          <button className="btn danger" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="btn primary" onClick={() => void send()} disabled={!text.trim()}>
            Send
          </button>
        )}
      </div>
    </section>
  );
}
