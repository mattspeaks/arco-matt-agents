import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config, DATA_DIR, REPO_ROOT } from '../config.js';
import { runClaude, toolResultText, type ClaudeRunResult, type StreamMessage } from '../claude/runner.js';
import { addEvent } from '../runs.js';

// On Windows only one Claude session can hold the Chrome connection (named pipe), so browser jobs run one at a time.
let chain: Promise<unknown> = Promise.resolve();

export function withChrome<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export interface ChromeScriptResult<T> {
  run: ClaudeRunResult;
  payload: T | null;
  loginRequired: boolean;
}

interface Part {
  __arco: string;
  part: number;
  parts: number;
  chunk: string[];
}

/**
 * Has a headless Claude session open the ServiceNow instance in Matt's browser and execute one vetted snippet.
 * The payload is read straight from the javascript_tool results in the stream (or the file Claude Code persists
 * large results to), never from the model's reply, so the model never re-types data.
 */
export function runChromeScript<T>(runId: string, marker: string, code: string, purpose: string): Promise<ChromeScriptResult<T>> {
  const sn = config.servicenow;
  const host = new URL(sn.instanceUrl).host;
  const landing = `${sn.instanceUrl}/$vtb.do?sysparm_board=${sn.boardSysId}`;

  const prompt = `You are a mechanical ServiceNow data bot (${purpose}). Do exactly these steps and nothing else:
1. Call tabs_context_mcp with createIfEmpty true. If a tab is already on ${host}, use it; otherwise navigate a tab to ${landing}
2. If the page is a login / SSO screen, close the tab (step 5) and reply exactly: LOGIN_REQUIRED
3. Call javascript_tool (action "javascript_exec") on that tab with EXACTLY the code below. Do not modify, reformat, or split it.
4. The result has "part" and "parts" fields. If parts > 1, call javascript_tool on the same tab once for each remaining part,
   with exactly \`window.__arcoPart(1)\`, then \`window.__arcoPart(2)\`, and so on up to parts - 1. Don't read the chunks.
5. Always finish by closing every tab in your tab group with tabs_close_mcp, even after an error, so no tabs are left behind.
6. Reply with only DONE, or ERROR: <one-line reason>. Never repeat or summarize the returned data.

\`\`\`js
${code}
\`\`\``;

  return withChrome(async () => {
    const parts = new Map<number, Part>();
    let total = 0;

    const onMessage = (msg: StreamMessage) => {
      if (msg.type !== 'user' || !Array.isArray(msg.message?.content)) return;
      for (const block of msg.message.content) {
        if (block.type !== 'tool_result') continue;
        for (const text of resultTexts(block)) {
          const part = parsePart(text, marker);
          if (part) {
            parts.set(part.part, part);
            total = part.parts;
          }
        }
      }
    };

    const run = await runClaude({
      runId,
      prompt,
      cwd: REPO_ROOT,
      model: config.claude.syncModel,
      chrome: true,
      strictMcp: true,
      mcpConfig: { mcpServers: {} },
      allowedTools: ['mcp__claude-in-chrome__*'],
      disallowedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'Skill'],
      onMessage,
    });

    let payload: T | null = null;
    if (total > 0 && parts.size === total) {
      const json = [...Array(total).keys()].map((i) => parts.get(i)!.chunk.join('')).join('');
      try {
        const obj = JSON.parse(json);
        if (obj?.__arco === marker) payload = obj as T;
      } catch (err) {
        const dump = resolve(DATA_DIR, 'tmp', `${runId}-payload.txt`);
        mkdirSync(dirname(dump), { recursive: true });
        writeFileSync(dump, json, 'utf8');
        await addEvent(runId, 'error', `Could not parse reassembled payload (saved to ${dump}): ${(err as Error).message}`);
      }
    } else if (total > 0) {
      await addEvent(runId, 'error', `Received ${parts.size} of ${total} result parts.`);
    }

    const loginRequired = run.result.includes('LOGIN_REQUIRED');
    if (loginRequired) await addEvent(runId, 'error', 'ServiceNow needs you to log in again in the browser.');
    return { run, payload, loginRequired };
  });
}

export interface ChromeUiResult {
  run: ClaudeRunResult;
  status: 'DONE' | 'FAILED' | 'LOGIN_REQUIRED' | 'UNKNOWN';
  detail: string;
}

// UI-only: read the page, click, type. No javascript_tool, so a write looks (and is) exactly what Matt would do by hand.
const UI_TOOLS = [
  'tabs_context_mcp', 'tabs_create_mcp', 'tabs_close_mcp', 'navigate', 'read_page', 'get_page_text', 'find', 'form_input', 'computer', 'browser_batch',
].map((t) => `mcp__claude-in-chrome__${t}`);

/**
 * Has a headless Claude session make one change Matt approved, through the ServiceNow UI in his browser.
 * The caller verifies the result independently (a read-only sync) rather than trusting the reply.
 */
export function runChromeUiTask(runId: string, p: { change: string; approvalId: string; landingUrl: string; steps: string }): Promise<ChromeUiResult> {
  const prompt = `Matt approved this change in his local work app (approval ${p.approvalId}) and asked you to make it for him in ServiceNow, in his own logged-in browser, the way he would by hand:

  ${p.change}

Rules: make only this change. Use the page like a person: read it, click, type. Never run JavaScript. Never click Submit,
Delete, Cancel-record or anything that changes other records. If anything is unclear or doesn't match what's described,
stop rather than guess.

Steps:
1. Call tabs_context_mcp with createIfEmpty true, then navigate that tab to ${p.landingUrl} and wait for it to load.
   If you see a login / SSO screen, go to the last step and reply LOGIN_REQUIRED.
${p.steps}
Last step: close every tab in your tab group with tabs_close_mcp, even after a failure, so no tabs are left behind.

Reply with one line only: DONE: <what you changed, with the value shown on the page afterwards>, or FAILED: <why>, or LOGIN_REQUIRED.`;

  return withChrome(async () => {
    const run = await runClaude({
      runId,
      prompt,
      cwd: REPO_ROOT,
      model: config.claude.syncModel,
      chrome: true,
      strictMcp: true,
      mcpConfig: { mcpServers: {} },
      allowedTools: UI_TOOLS,
      disallowedTools: ['mcp__claude-in-chrome__javascript_tool', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'Skill'],
    });
    const line = run.result.trim().split('\n').filter(Boolean).pop() ?? '';
    const m = /^(DONE|FAILED|LOGIN_REQUIRED)\b:?\s*(.*)$/.exec(line);
    const status = (m?.[1] as ChromeUiResult['status']) ?? 'UNKNOWN';
    const detail = m?.[2] || line || run.error || 'No reply from the browser session.';
    if (status === 'LOGIN_REQUIRED') await addEvent(runId, 'error', 'ServiceNow needs you to log in again in the browser.');
    return { run, status, detail };
  });
}

/** Text blocks of a tool result, following Claude Code's <persisted-output> pointer when a result was saved to disk. */
function resultTexts(block: StreamMessage): string[] {
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

function parsePart(text: string, marker: string): Part | null {
  if (!text.includes(marker)) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (obj?.__arco === marker && typeof obj.part === 'number' && Array.isArray(obj.chunk)) return obj as Part;
  } catch {
    /* not a part */
  }
  return null;
}
