import { listRunEvents } from './runs.js';

// Facts, not guesses: when a turn had tool calls that were denied or failed, the app (not the model) appends the exact
// records from the run log to the reply: which call, what it was, who refused it, the verbatim error.

interface Ev {
  ts: string;
  type: string;
  summary: string;
  data?: string | null;
}

function parse(d?: string | null): Record<string, unknown> {
  try {
    return d ? (JSON.parse(d) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function source(text: string): string {
  if (/auto mode classifier/i.test(text)) return "Claude Code's permission classifier (the safety check on each action)";
  if (/sn-write-guard|ARCO write guard|write guard/i.test(text)) return "The app's ServiceNow write guard (server/hooks/sn-write-guard.mjs)";
  if (/hook/i.test(text)) return 'A Claude Code hook';
  if (/\b(4\d\d|5\d\d)\b.*(servicenow|api\/now)|api\/now/i.test(text)) return 'ServiceNow (the API returned an error)';
  return 'The tool itself';
}

/** Markdown block for the reply, or '' when the turn had no failed tool calls. */
export async function failureReport(runId: string): Promise<string> {
  const events = (await listRunEvents(runId)) as Ev[];
  const uses = new Map<string, Ev>();
  for (const e of events) if (e.type === 'tool_use') uses.set(String(parse(e.data).id ?? ''), e);
  const failed = events.filter((e) => e.type === 'tool_error');
  if (!failed.length) return '';
  const lines = [`**What failed (from the run log, run \`${runId.slice(0, 8)}\`; open "trace" for the full timeline):**`];
  failed.forEach((e, i) => {
    const d = parse(e.data);
    const text = String(d.text ?? e.summary).trim();
    const use = uses.get(String(d.tool_use_id ?? ''));
    const input = use ? (parse(use.data).input as Record<string, unknown> | undefined) : undefined;
    const code = typeof input?.text === 'string' ? input.text : undefined;
    const hits = code ? [...new Set(code.match(/\/api\/now\/[\w/]+/g) ?? [])].join(', ') : '';
    const method = code ? [...new Set(code.match(/method:\s*'(\w+)'/g)?.map((m) => m.replace(/method:\s*'|'/g, '')) ?? [])].join('/') : '';
    const when = new Date(e.ts).toLocaleString('en-US', { timeZone: 'America/Chicago' });
    lines.push('', `${i + 1}. ${when} CT · \`${use?.summary.slice(0, 120) ?? 'unknown call'}\``);
    if (hits) lines.push(`   - Request in the script: ${method || 'GET'} ${hits}`);
    lines.push(`   - Refused by: ${source(text)}`, '   - Exact error:', '', '```text');
    lines.push(text.replace(/\s*If you have other tasks that don't depend on this action[\s\S]*$/i, '').slice(0, 1200), '```');
  });
  return lines.join('\n');
}
