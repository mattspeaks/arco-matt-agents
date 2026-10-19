import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, parseJson } from '../api';
import type { Approval } from '../types';

// Cards for the Power BI report workflow that need more than Approve / Reject: the Review card (open in Desktop,
// then Approve or Not ready) and the Publish card (workspace dropdown).

function useDecide(approval: Approval, onError: (m: string) => void) {
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean, extra: { note?: string } & Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      await api(`/api/approvals/${approval.id}/decision`, { body: { ...extra, approve, note: extra.note || undefined } });
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

interface ReportOption {
  id: string;
  name: string;
}

const BAD_NAME = /[<>:"/\\|?*]/;

export function PublishCard({ approval, onError }: { approval: Approval; onError: (m: string) => void }) {
  const p = parseJson<Record<string, string>>(approval.payload, {});
  const { busy, decide } = useDecide(approval, onError);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [suggested, setSuggested] = useState('');
  const [repoName, setRepoName] = useState(p.reportName ?? '');
  const [workspaceId, setWorkspaceId] = useState('');
  const [reports, setReports] = useState<ReportOption[] | null>(null);
  const [reportId, setReportId] = useState(''); // '' = create a new report
  const [name, setName] = useState(p.reportName ?? '');
  const pending = approval.status === 'pending';

  useEffect(() => {
    if (!pending) return;
    api<{ workspaces: Target[]; suggested?: string; repoName?: string }>(`/api/fabric/workspaces?story=${encodeURIComponent(p.storyNumber ?? '')}`)
      .then((r) => {
        setTargets(r.workspaces);
        setSuggested(r.suggested ?? '');
        if (r.repoName) setRepoName(r.repoName);
        setWorkspaceId((id) => id || r.suggested || '');
      })
      .catch((e) => onError(`Couldn't list workspaces: ${(e as Error).message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, p.storyNumber]);

  // Picking a workspace loads its reports and pre-selects the one this story's report should update.
  useEffect(() => {
    if (!pending || !workspaceId) return;
    setReports(null);
    api<{ reports: ReportOption[]; match: string; repoName: string }>(`/api/fabric/workspaces/${workspaceId}/reports?story=${encodeURIComponent(p.storyNumber ?? '')}`)
      .then((r) => {
        setReports(r.reports);
        setReportId(r.match);
        setName(r.reports.find((x) => x.id === r.match)?.name ?? r.repoName);
      })
      .catch((e) => onError(`Couldn't list reports: ${(e as Error).message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, workspaceId, p.storyNumber]);

  const target = reports?.find((r) => r.id === reportId);
  const trimmed = name.trim();
  const nameError = !trimmed ? 'Enter a name' : BAD_NAME.test(trimmed) ? 'No < > : " / \\ | ? *' : '';
  const wsName = targets?.find((w) => w.id === workspaceId)?.name;

  return (
    <div className="approval pbi_publish">
      <div className="approval-kind small">Publish report</div>
      <div className="approval-title">{approval.title}</div>
      {p.qcVerdict && (
        <details className="final-qc" open={pending && p.qcVerdict !== 'PASS'}>
          <summary className="small">
            Final QC on what you&apos;re publishing:{' '}
            <span className={`tag ${p.qcVerdict === 'PASS' ? 'pass' : p.qcVerdict === 'FAIL' ? 'fail' : 'subtle'}`}>{p.qcVerdict}</span>
            {Number(p.manualFiles) > 0 && <span className="muted"> · includes {p.manualFiles} file(s) you changed in Desktop</span>}
          </summary>
          <div className="approval-preview md small">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.qcReport || '_No report._'}</ReactMarkdown>
          </div>
        </details>
      )}
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
                {w.id === suggested ? '  (suggested)' : ''}
                {w.blocked ? ' (TEST/PROD: not allowed)' : ''}
              </option>
            ))}
          </select>

          {workspaceId && (
            <>
              <label className="small muted" htmlFor={`rep-${approval.id}`}>
                Report in {wsName}
              </label>
              <select
                id={`rep-${approval.id}`}
                className="input select-full"
                value={reportId}
                disabled={!reports}
                onChange={(e) => {
                  setReportId(e.target.value);
                  setName(reports?.find((x) => x.id === e.target.value)?.name ?? repoName);
                }}
              >
                {!reports && <option value="">Loading reports…</option>}
                {reports && <option value="">Create a new report</option>}
                {reports?.map((r) => (
                  <option key={r.id} value={r.id}>
                    Update: {r.name}
                  </option>
                ))}
              </select>

              <label className="small muted" htmlFor={`name-${approval.id}`}>
                Report name (in Fabric and in the repo)
              </label>
              <input id={`name-${approval.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
              {nameError && <p className="small err">{nameError}</p>}

              <ul className="small muted publish-summary">
                <li>
                  {target ? (
                    <>
                      Updates <strong>{target.name}</strong>
                      {trimmed && trimmed !== target.name ? (
                        <>
                          {' '}
                          and renames it to <strong>{trimmed}</strong>
                        </>
                      ) : null}
                      , plus the semantic model it&apos;s bound to.
                    </>
                  ) : (
                    <>
                      Creates a new report <strong>{trimmed || '…'}</strong>
                      {p.modelName ? ' and its semantic model, unless one with that name is already there' : ''}.
                    </>
                  )}
                </li>
                {trimmed && trimmed !== repoName && (
                  <li>
                    Renames <span className="mono">{repoName}</span> to <span className="mono">{trimmed}</span> in the repo (folder, .pbip and display name)
                    before the PR, so git and Fabric match.
                  </li>
                )}
                <li>
                  Pushes <span className="mono">{p.branch}</span> and opens a PR. Merging it and updating the app stay with you.
                </li>
              </ul>
            </>
          )}

          <div className="approval-actions">
            <button className="btn primary" disabled={busy || !workspaceId || !reports || !!nameError} onClick={() => void decide(true, { workspaceId, reportId, name: trimmed })}>
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

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/** Hours to add to a story's timesheet row, one box per day of the week. */
export function TimeEntryCard({ approval, onError }: { approval: Approval; onError: (m: string) => void }) {
  const p = parseJson<{ storyNumber?: string; weekStart?: string; logged?: Record<string, number> }>(approval.payload, {});
  const { busy, decide } = useDecide(approval, onError);
  const [hours, setHours] = useState<Record<string, string>>({});
  const start = p.weekStart ? new Date(`${p.weekStart}T00:00:00`) : new Date();
  const days = WEEKDAYS.map((key, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return {
      key,
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      date: d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
      today: d.toDateString() === new Date().toDateString(),
    };
  });
  const parsed: Record<string, number> = Object.fromEntries(WEEKDAYS.map((k) => [k, Number(hours[k] || 0)]));
  const invalid = WEEKDAYS.some((k) => {
    const n = parsed[k];
    return Number.isNaN(n) || n < 0 || Math.round(n * 4) !== n * 4 || n + (p.logged?.[k] ?? 0) > 24;
  });
  const total = WEEKDAYS.reduce((sum, k) => sum + (parsed[k] || 0), 0);

  return (
    <div className="approval time_entry">
      <div className="approval-kind small">Timesheet</div>
      <div className="approval-title">{approval.title}</div>
      {approval.status === 'pending' ? (
        <>
          <p className="small muted">Hours to add for {p.storyNumber}, in quarter hours. What's already logged against it is under each day.</p>
          <div className="time-grid">
            {days.map((d) => (
              <label key={d.key} className={`time-day ${d.today ? 'today' : ''}`}>
                <span className="small">
                  <strong>{d.label}</strong> {d.date}
                </span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={24}
                  step={0.25}
                  inputMode="decimal"
                  placeholder="0"
                  value={hours[d.key] ?? ''}
                  onChange={(e) => setHours((h) => ({ ...h, [d.key]: e.target.value }))}
                />
                <span className="small muted">{p.logged?.[d.key] ? `${p.logged[d.key]}h logged` : '–'}</span>
              </label>
            ))}
          </div>
          <div className="small">
            Adding <strong>{total}h</strong>
            {invalid && <span className="err"> · Use quarter hours, and keep each day at 24h or less</span>}
          </div>
          <div className="approval-actions">
            <button className="btn primary" disabled={busy || invalid || total <= 0} onClick={() => void decide(true, { hours: parsed })}>
              Add to timesheet
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => void decide(false)}>
              Skip
            </button>
          </div>
        </>
      ) : (
        <Decided approval={approval} label={approval.status === 'approved' ? 'Added' : 'Skipped'} />
      )}
    </div>
  );
}
