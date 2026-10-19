import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, parseJson } from '../api';
import type { Approval } from '../types';

// Cards for the Power BI report workflow that need more than Approve / Reject: the Review card (open in Desktop,
// then Approve or Not ready) and the Publish card (workspace dropdown).

function useDecide(approval: Approval, onError: (m: string) => void) {
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean, extra: { note?: string; workspaceId?: string } = {}) => {
    setBusy(true);
    try {
      await api(`/api/approvals/${approval.id}/decision`, { body: { approve, note: extra.note || undefined, workspaceId: extra.workspaceId } });
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  };
  return { busy, decide };
}

function Decided({ approval, label }: { approval: Approval; label: string }) {
  return (
    <div className={`approval-decided small ${approval.status}`}>
      {label}
      {approval.decision_note ? `: ${approval.decision_note}` : ''}
      {approval.outcome && <div className="muted">{approval.outcome}</div>}
    </div>
  );
}

export function ReviewCard({ approval, onError }: { approval: Approval; onError: (m: string) => void }) {
  const p = parseJson<Record<string, string>>(approval.payload, {});
  const { busy, decide } = useDecide(approval, onError);
  const [opened, setOpened] = useState(false);
  const [opening, setOpening] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const open = async () => {
    setOpening(true);
    try {
      const r = await api<{ laneMove: 'requested' | 'already' | 'chat_busy' }>(`/api/flows/${p.storyNumber}/open`, { body: { approvalId: approval.id } });
      setOpened(true);
      setInfo(
        r.laneMove === 'requested'
          ? 'Opening in Power BI Desktop. The orchestrator is moving the story to Ready for testing.'
          : r.laneMove === 'chat_busy'
            ? 'Opening in Power BI Desktop. The story chat was busy, so ask the orchestrator to move the story to Ready for testing.'
            : 'Opening in Power BI Desktop.',
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="approval pbi_review">
      <div className="approval-kind small">Review report</div>
      <div className="approval-title">{approval.title}</div>
      <dl className="kv small">
        <dt>QC</dt>
        <dd>
          <span className={`tag ${p.qcVerdict === 'PASS' ? 'pass' : p.qcVerdict === 'FAIL' ? 'fail' : 'subtle'}`}>{p.qcVerdict}</span>
        </dd>
        <dt>Branch</dt>
        <dd className="mono ellipsis">{p.branch}</dd>
        <dt>Changed</dt>
        <dd>{p.files} files this round</dd>
      </dl>
      {p.summary && (
        <div className="approval-preview md small">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.summary}</ReactMarkdown>
        </div>
      )}
      {approval.status === 'pending' ? (
        <>
          <div className="approval-actions">
            <button className={`btn ${opened ? 'ghost' : 'primary'}`} disabled={opening} onClick={() => void open()}>
              {opened ? 'Open again' : 'Open in Power BI Desktop'}
            </button>
          </div>
          {info && <p className="small muted">{info}</p>}
          <input className="input small" placeholder="What isn't right? (optional; the orchestrator will ask)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="approval-actions">
            <button className="btn primary" disabled={busy || !opened} title={opened ? '' : 'Open the report first'} onClick={() => void decide(true, { note })}>
              Approve
            </button>
            <button className="btn ghost" disabled={busy || !opened} title={opened ? '' : 'Open the report first'} onClick={() => void decide(false, { note })}>
              Not ready
            </button>
          </div>
        </>
      ) : (
        <Decided approval={approval} label={approval.status === 'approved' ? 'Approved' : approval.status === 'rejected' ? 'Not ready' : 'Replaced'} />
      )}
    </div>
  );
}

interface Target {
  id: string;
  name: string;
  blocked: boolean;
}

export function PublishCard({ approval, onError }: { approval: Approval; onError: (m: string) => void }) {
  const p = parseJson<Record<string, string>>(approval.payload, {});
  const { busy, decide } = useDecide(approval, onError);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const pending = approval.status === 'pending';

  useEffect(() => {
    if (!pending) return;
    api<{ workspaces: Target[]; suggested?: string }>(`/api/fabric/workspaces?story=${encodeURIComponent(p.storyNumber ?? '')}`)
      .then((r) => {
        setTargets(r.workspaces);
        setWorkspaceId((id) => id || r.suggested || '');
      })
      .catch((e) => onError(`Couldn't list workspaces: ${(e as Error).message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, p.storyNumber]);

  return (
    <div className="approval pbi_publish">
      <div className="approval-kind small">Publish report</div>
      <div className="approval-title">{approval.title}</div>
      {pending ? (
        <>
          <label className="small muted" htmlFor={`ws-${approval.id}`}>
            Workspace
          </label>
          <select id={`ws-${approval.id}`} className="input select-full" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} disabled={!targets}>
            {!targets && <option value="">Loading workspaces…</option>}
            {targets && <option value="">Choose a workspace…</option>}
            {targets?.map((w) => (
              <option key={w.id} value={w.id} disabled={w.blocked}>
                {w.name}
                {w.blocked ? ' (TEST/PROD: not allowed)' : ''}
              </option>
            ))}
          </select>
          <p className="small muted">
            A report{p.modelName ? ' and model' : ''} with the same name in that workspace is updated in place, otherwise
            created. Then the app pushes <span className="mono">{p.branch}</span> and opens a PR. Merging it and updating
            the app stay with you.
          </p>
          <div className="approval-actions">
            <button className="btn primary" disabled={busy || !workspaceId} onClick={() => void decide(true, { workspaceId })}>
              Publish + open PR
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => void decide(false)}>
              Not now
            </button>
          </div>
        </>
      ) : (
        <Decided approval={approval} label={approval.status === 'approved' ? 'Approved' : 'Not published'} />
      )}
    </div>
  );
}
