import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fmtDuration, fmtTime, parseJson } from '../api';
import type { Approval, Run } from '../types';
import { GapsCard, ProceedCard, PublishCard, ReviewCard, TimeEntryCard, useDecide } from './FlowCards';
import { useCardState } from '../cardState';

const KIND_LABEL: Record<Run['kind'], string> = { sync: 'Sync', orchestrator: 'Chat', worker: 'Worker', sn_write: 'SN write' };

export function StatusPill({ status }: { status: Run['status'] }) {
  return (
    <span className={`pill ${status}`}>
      {status === 'running' && <span className="spinner" />}
      {status.replace('_', ' ')}
    </span>
  );
}

export function ActivityPanel({
  runs,
  approvals,
  onOpenRun,
  onError,
}: {
  runs: Run[];
  approvals: Approval[];
  onOpenRun: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const pending = approvals.filter((a) => a.status === 'pending');
  const decided = approvals.filter((a) => a.status !== 'pending').slice(0, 5);
  const inFlight = runs.filter((r) => ['running', 'queued', 'awaiting_approval'].includes(r.status));
  const recent = runs.filter((r) => !inFlight.includes(r) && r.kind !== 'orchestrator').slice(0, 25);

  return (
    <section className="panel activity-panel" aria-label="Activity">
      <div className="panel-body">
        <h2 className="section-title">
          Approvals <span className={`count ${pending.length ? 'hot' : ''}`}>{pending.length}</span>
        </h2>
        {pending.length === 0 && <p className="muted small pad-x">Nothing waiting on you.</p>}
        {pending.map((a) => (
          <ApprovalCard key={a.id} approval={a} onError={onError} />
        ))}
        {decided.length > 0 && (
          <details className="decided">
            <summary className="small muted">Recently decided</summary>
            {decided.map((a) => (
              <div key={a.id} className="decided-row small">
                <span className={`pill ${a.status === 'approved' ? 'succeeded' : 'cancelled'}`}>{a.status}</span>
                <span className="ellipsis">{a.title}</span>
                {a.outcome && <div className="muted">{a.outcome}</div>}
              </div>
            ))}
          </details>
        )}

        <h2 className="section-title">
          In flight <span className="count">{inFlight.length}</span>
        </h2>
        {inFlight.length === 0 && <p className="muted small pad-x">No agents running.</p>}
        {inFlight.map((r) => (
          <RunRow key={r.id} run={r} onOpen={onOpenRun} />
        ))}

        <h2 className="section-title">Recent runs</h2>
        {recent.map((r) => (
          <RunRow key={r.id} run={r} onOpen={onOpenRun} />
        ))}
      </div>
    </section>
  );
}

function RunRow({ run, onOpen }: { run: Run; onOpen: (id: string) => void }) {
  const meta = parseJson<{ verdict?: string }>(run.meta, {});
  return (
    <button className="run-row" onClick={() => onOpen(run.id)}>
      <div className="run-row-top">
        <span className="tag subtle">{run.worker ?? KIND_LABEL[run.kind]}</span>
        {meta.verdict && <span className={`tag ${meta.verdict === 'PASS' ? 'pass' : 'fail'}`}>{meta.verdict}</span>}
        <StatusPill status={run.status} />
      </div>
      <div className="run-title ellipsis">{run.title}</div>
      <div className="small muted">
        {fmtTime(run.created_at)}
        {run.started_at && ` · ${fmtDuration(run.started_at, run.ended_at)}`}
        {run.error && run.status === 'failed' && <span className="err"> · {run.error.slice(0, 80)}</span>}
      </div>
    </button>
  );
}

const DECIDED_LABEL: Record<Approval['status'], string> = { pending: '', approved: 'Approved', rejected: 'Rejected', superseded: 'Replaced by a newer preview' };

const KIND_TITLE: Partial<Record<Approval['kind'], string>> = {
  sn_write: 'ServiceNow change',
  sn_confirm: 'ServiceNow change',
  timesheet_write: 'Timesheet entry',
  start_worker: 'Start worker',
  lesson: 'New lesson',
  pbi_start: 'Start report work',
  pbi_revise: 'Revise report',
  story_close: 'Close story',
  pbi_gaps: 'Data gaps',
  pbi_proceed: 'Proceed or pause',
  gap_design: 'Gap design',
};

export function ApprovalCard({ approval, onError }: { approval: Approval; onError: (m: string) => void }) {
  if (approval.kind === 'pbi_review') return <ReviewCard approval={approval} onError={onError} />;
  if (approval.kind === 'pbi_publish') return <PublishCard approval={approval} onError={onError} />;
  if (approval.kind === 'time_entry') return <TimeEntryCard approval={approval} onError={onError} />;
  if (approval.kind === 'pbi_gaps') return <GapsCard approval={approval} onError={onError} />;
  if (approval.kind === 'pbi_proceed') return <ProceedCard approval={approval} onError={onError} />;
  return <BasicApprovalCard approval={approval} onError={onError} />;
}

function BasicApprovalCard({ approval, onError }: { approval: Approval; onError: (m: string) => void }) {
  // Shared with the other copy of this card (chat / Approvals panel): see cardState.ts.
  const [note, setNote] = useCardState(approval.id, 'note', '');
  const { busy, decide: send } = useDecide(approval, onError);
  const p = parseJson<Record<string, string | undefined>>(approval.payload, {});
  const decide = (approve: boolean) => send(approve, { note });

  return (
    <div className={`approval ${approval.kind}`}>
      <div className="approval-kind small">{KIND_TITLE[approval.kind] ?? approval.kind}</div>
      <div className="approval-title">{approval.title}</div>
      {['sn_confirm', 'pbi_start', 'pbi_revise', 'story_close', 'pbi_gaps', 'pbi_proceed', 'gap_design'].includes(approval.kind) && p.preview && (
        <div className="approval-preview md small">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.preview}</ReactMarkdown>
        </div>
      )}
      {approval.kind === 'sn_write' && (
        <dl className="kv small">
          <dt>Story</dt>
          <dd className="mono">{p.story_number}</dd>
          {p.new_state && (
            <>
              <dt>Move to</dt>
              <dd>{p.new_state}</dd>
            </>
          )}
          {p.work_note && (
            <>
              <dt>Work note</dt>
              <dd>
                <pre className="note">{p.work_note}</pre>
              </dd>
            </>
          )}
        </dl>
      )}
      {approval.kind === 'timesheet_write' && (
        <dl className="kv small">
          <dt>Row</dt>
          <dd className="mono">{[p.task_number, p.category].filter(Boolean).join(' · ') || '–'}</dd>
          <dt>Day</dt>
          <dd>
            {p.day} {p.date}
          </dd>
          <dt>Hours</dt>
          <dd>
            {p.current_hours ?? '?'}h → <strong>{p.hours}h</strong>
          </dd>
        </dl>
      )}
      {approval.kind === 'start_worker' && (
        <dl className="kv small">
          <dt>Worker</dt>
          <dd>{p.worker}</dd>
          <dt>Project</dt>
          <dd className="mono ellipsis">{p.projectPath ?? '–'}</dd>
          <dt>Brief</dt>
          <dd>
            <pre className="note">{p.brief}</pre>
          </dd>
        </dl>
      )}
      {approval.kind === 'lesson' && (
        <dl className="kv small">
          <dt>Worker</dt>
          <dd>{p.worker}</dd>
          <dt>Rule</dt>
          <dd>{p.rule}</dd>
          {p.why && (
            <>
              <dt>Why</dt>
              <dd>{p.why}</dd>
            </>
          )}
        </dl>
      )}
      {approval.status === 'pending' ? (
        <>
          <input className="input small" placeholder="Note (optional, sent with your decision)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="approval-actions">
            <button className="btn primary" disabled={busy} onClick={() => void decide(true)}>
              {approval.kind === 'gap_design' ? 'Approve design' : 'Approve'}
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => void decide(false)}>
              {approval.kind === 'gap_design' ? 'Not yet' : 'Reject'}
            </button>
          </div>
        </>
      ) : (
        <div className={`approval-decided small ${approval.status}`}>
          {DECIDED_LABEL[approval.status]}
          {approval.decision_note ? `: ${approval.decision_note}` : ''}
          {approval.outcome && approval.kind.startsWith('pbi_') && <div className="muted">{approval.outcome}</div>}
        </div>
      )}
    </div>
  );
}
