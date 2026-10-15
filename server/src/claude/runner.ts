import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { CLAUDE_BIN, DATA_DIR } from '../config.js';
import { addEvent, flushEvents, updateRun } from '../runs.js';

/**
 * Runs the unmodified `claude` CLI headless (`-p --output-format stream-json`) under the user's own
 * Claude Code login. Every stream message is recorded as a run event; the app never touches credentials.
 */
export interface ClaudeRunOptions {
  runId: string;
  prompt: string;
  cwd: string;
  model?: string;
  agent?: string;
  appendSystemPrompt?: string;
  mcpConfig?: object;
  strictMcp?: boolean;
  chrome?: boolean;
  resumeSessionId?: string | null;
  permissionMode?: 'default' | 'acceptEdits' | 'plan';
  addDirs?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  env?: Record<string, string>;
  /** Extra settings for this session (e.g. hooks), passed with --settings. */
  settings?: object;
  /** Raw stream-json messages, for callers that need tool results verbatim (e.g. ServiceNow sync). */
  onMessage?: (msg: StreamMessage) => void;
}

export interface ClaudeRunResult {
  ok: boolean;
  cancelled: boolean;
  sessionId?: string;
  result: string;
  costUsd?: number;
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StreamMessage = Record<string, any>;

const TMP_DIR = resolve(DATA_DIR, 'tmp');
const active = new Map<string, { child: ChildProcess; cancelled: boolean }>();

export function isRunActive(runId: string): boolean {
  return active.has(runId);
}

export function cancelClaudeRun(runId: string): boolean {
  const entry = active.get(runId);
  if (!entry?.child.pid) return false;
  entry.cancelled = true;
  if (process.platform === 'win32') {
    // claude.exe spawns MCP servers; kill the whole tree.
    spawn('taskkill', ['/pid', String(entry.child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    entry.child.kill('SIGTERM');
  }
  return true;
}

/**
 * The server's environment minus anything that would make the child behave like a nested session of whatever
 * Claude Code session started `npm run dev`, or override the claude.ai login (an API key also disables Chrome).
 */
function childEnv(): NodeJS.ProcessEnv {
  const keep = new Set(['CLAUDE_CODE_GIT_BASH_PATH']);
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (keep.has(k) || !/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_PID$|CLAUDE_EFFORT$|ANTHROPIC_API_KEY$)/.test(k)) env[k] = v;
  }
  return env;
}

export function runClaude(o: ClaudeRunOptions): Promise<ClaudeRunResult> {
  mkdirSync(TMP_DIR, { recursive: true });
  const tmpFiles: string[] = [];
  const tmp = (name: string, content: string) => {
    const path = resolve(TMP_DIR, `${o.runId}-${name}`);
    writeFileSync(path, content, 'utf8');
    tmpFiles.push(path);
    return path;
  };

  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (o.model) args.push('--model', o.model);
  if (o.agent) args.push('--agent', o.agent);
  if (o.appendSystemPrompt) args.push('--append-system-prompt-file', tmp('system.md', o.appendSystemPrompt));
  if (o.mcpConfig) args.push('--mcp-config', tmp('mcp.json', JSON.stringify(o.mcpConfig)));
  if (o.strictMcp) args.push('--strict-mcp-config');
  if (o.settings) args.push('--settings', tmp('settings.json', JSON.stringify(o.settings)));
  if (o.chrome) args.push('--chrome');
  if (o.resumeSessionId) args.push('--resume', o.resumeSessionId);
  if (o.permissionMode) args.push('--permission-mode', o.permissionMode);
  for (const dir of o.addDirs ?? []) args.push('--add-dir', dir);
  // Comma-joined single values: these flags are variadic, so the prompt always goes through stdin.
  if (o.allowedTools?.length) args.push('--allowedTools', o.allowedTools.join(','));
  if (o.disallowedTools?.length) args.push('--disallowedTools', o.disallowedTools.join(','));

  return new Promise((resolvePromise) => {
    let sessionId: string | undefined;
    let final: StreamMessage | undefined;
    let stderr = '';

    const child = spawn(CLAUDE_BIN, args, {
      cwd: o.cwd,
      env: { ...childEnv(), ...o.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const entry = { child, cancelled: false };
    active.set(o.runId, entry);
    void updateRun(o.runId, { status: 'running', started: true });

    child.stdin.on('error', () => {}); // process may exit before reading stdin
    child.stdin.end(o.prompt);
    child.stderr.on('data', (d) => (stderr = (stderr + d.toString()).slice(-8000)));

    const handle = (msg: StreamMessage) => {
      const nested = msg.parent_tool_use_id ? '↳ ' : '';
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id;
        void updateRun(o.runId, { session_id: sessionId });
        const servers = (msg.mcp_servers ?? []).map((s: StreamMessage) => `${s.name}:${s.status}`);
        void addEvent(o.runId, 'init', `Session started · ${msg.model} · ${msg.permissionMode ?? '?'} permissions`, {
          model: msg.model,
          mcp: servers,
          cwd: msg.cwd,
          permissionMode: msg.permissionMode,
        });
      } else if (msg.type === 'assistant') {
        for (const block of msg.message?.content ?? []) {
          if (block.type === 'text' && block.text?.trim()) {
            void addEvent(o.runId, 'text', nested + block.text);
          } else if (block.type === 'tool_use') {
            void addEvent(o.runId, 'tool_use', `${nested}${shortToolName(block.name)} ${describeInput(block.name, block.input)}`, {
              id: block.id,
              name: block.name,
              input: block.input,
            });
          }
        }
      } else if (msg.type === 'user') {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type !== 'tool_result') continue;
            const text = toolResultText(block);
            void addEvent(o.runId, block.is_error ? 'tool_error' : 'tool_result', nested + text.slice(0, 300), {
              tool_use_id: block.tool_use_id,
              text: text.slice(0, 8000),
            });
          }
        }
      } else if (msg.type === 'result') {
        final = msg;
        const cost = typeof msg.total_cost_usd === 'number' ? ` · est. $${msg.total_cost_usd.toFixed(3)}` : '';
        void addEvent(o.runId, 'result', `${msg.subtype} · ${msg.num_turns ?? '?'} turns · ${Math.round((msg.duration_ms ?? 0) / 1000)}s${cost}`);
      }
    };

    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      let msg: StreamMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        void addEvent(o.runId, 'stdout', line.slice(0, 500));
        return;
      }
      handle(msg);
      try {
        o.onMessage?.(msg);
      } catch (err) {
        console.error('[runner] onMessage handler failed', err);
      }
    });

    const linesDone = new Promise<void>((r) => lines.on('close', () => r()));
    const exited = new Promise<number | null>((r) => {
      child.on('close', (code) => r(code));
      child.on('error', (err) => {
        stderr += `\n${err.message}`;
        r(-1);
      });
    });

    void Promise.all([exited, linesDone]).then(async ([code]) => {
      active.delete(o.runId);
      for (const f of tmpFiles) rmSync(f, { force: true });
      await flushEvents(o.runId);
      const isError = !final || final.is_error === true || (code !== 0 && code !== null);
      resolvePromise({
        ok: !entry.cancelled && !isError,
        cancelled: entry.cancelled,
        sessionId,
        result: typeof final?.result === 'string' ? final.result : '',
        costUsd: typeof final?.total_cost_usd === 'number' ? final.total_cost_usd : undefined,
        error: entry.cancelled
          ? 'Cancelled'
          : isError
            ? (final?.is_error ? String(final.result || final.subtype) : `claude exited with code ${code}. ${stderr.trim()}`).slice(0, 4000)
            : undefined,
      });
    });
  });
}

/** Records the outcome on the run row. Callers can override the status (e.g. sync parse failure). */
export async function finishRun(runId: string, res: ClaudeRunResult, override?: { ok?: boolean; error?: string; meta?: object }) {
  const ok = override?.ok ?? res.ok;
  await updateRun(runId, {
    status: res.cancelled ? 'cancelled' : ok ? 'succeeded' : 'failed',
    result: res.result,
    error: override?.error ?? res.error ?? null,
    cost_usd: res.costUsd ?? null,
    ...(override?.meta ? { meta: JSON.stringify(override.meta) } : {}),
    ended: true,
  });
}

export function toolResultText(block: StreamMessage): string {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    return block.content
      .map((c: StreamMessage) => (c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : ''))
      .join('\n');
  }
  return '';
}

function shortToolName(name: string): string {
  return name.replace(/^mcp__claude-in-chrome__/, 'chrome.').replace(/^mcp__arco__/, 'arco.');
}

function describeInput(name: string, input: StreamMessage | undefined): string {
  if (!input) return '';
  if (name.endsWith('javascript_tool')) return `(${String(input.text ?? '').length} chars of JS)`;
  const key = ['url', 'file_path', 'path', 'pattern', 'command', 'query', 'number', 'story_number', 'worker', 'action'].find(
    (k) => typeof input[k] === 'string',
  );
  return (key ? String(input[key]) : JSON.stringify(input)).slice(0, 160);
}
