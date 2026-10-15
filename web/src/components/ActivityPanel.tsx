import { useState } from 'react';
import { api, fmtDuration, fmtTime, parseJson } from '../api';
import type { Approval, Run } from '../types';

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

function ApprovalCard({ approval, onError }: { approval: Approval; onError: (m: string) => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const p = parseJson<Record<string, string | undefined>>(approval.payload, {});

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await api(`/api/approvals/${approval.id}/decision`, { body: { approve, note: note || undefined } });
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className={`approval ${approval.kind}`}>
      <div className="approval-kind small">
        {approval.kind === 'sn_write' ? 'ServiceNow change' : approval.kind === 'start_worker' ? 'Start worker' : 'New lesson'}
      </div>
      <div className="approval-title">{approval.title}</div>
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
      <input className="input small" placeholder="Note (optional, sent with your decision)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="approval-actions">
        <button className="btn primary" disabled={busy} onClick={() => void decide(true)}>
          Approve
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => void decide(false)}>
          Reject
        </button>
      </div>
    </div>
  );
}
