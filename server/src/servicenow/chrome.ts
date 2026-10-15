import { readFileSync } from 'node:fs';
import { toolResultText, type StreamMessage } from '../claude/runner.js';

// ServiceNow work happens in the orchestrator chat, in response to Matt's own messages, through Claude in Chrome
// and the servicenow skill (.claude/skills/servicenow). No background session touches ServiceNow.

// On Windows only one Claude session can hold the Chrome connection (named pipe), so Chrome turns run one at a time.
let chain: Promise<unknown> = Promise.resolve();

export function withChrome<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/** Text blocks of a tool result, following Claude Code's <persisted-output> pointer when a result was saved to disk. */
export function resultTexts(block: StreamMessage): string[] {
  const texts: string[] = Array.isArray(block.content)
    ? block.content.filter((c: StreamMessage) => c.type === 'text').map((c: StreamMessage) => String(c.text))
    : [toolResultText(block)];
  const out: string[] = [];
  for (const text of texts) {
    const saved = /<persisted-output>[\s\S]*?saved to:\s*(.+?\.(?:json|txt))\s/i.exec(text);
    if (!saved) {
      out.push(text);
      continue;
    }
    try {
      const raw = readFileSync(saved[1].trim(), 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) for (const c of parsed) if (c?.type === 'text') out.push(String(c.text));
      else out.push(raw);
    } catch {
      out.push(text);
    }
  }
  return out;
}

/** The JSON object in a tool result whose __arco field is one of the given markers, if any. */
export function findMarked<T extends { __arco: string }>(text: string, markers: string[]): T | null {
  if (!markers.some((m) => text.includes(m))) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return obj && markers.includes(obj.__arco) ? (obj as T) : null;
  } catch {
    return null;
  }
}
