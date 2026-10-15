// Stop hook for orchestrator turns: if the session changed ServiceNow (a PATCH/POST through javascript_tool that
// the write guard let through) and hasn't re-read the matching snapshot since, don't let the turn end yet.
// rm_story writes need a board-v2 snapshot; time_card writes need a timesheet-v2 snapshot. The app saves those
// snapshots from the stream, which keeps its local copy current.
import { readFileSync } from 'node:fs';

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  // One forced continuation per stop; never loop.
  if (event.stop_hook_active || !event.transcript_path) process.exit(0);

  let lines = [];
  try {
    lines = readFileSync(event.transcript_path, 'utf8').split('\n').filter(Boolean);
  } catch {
    process.exit(0);
  }

  const textOf = (block) => {
    const parts = Array.isArray(block.content) ? block.content.map((c) => c?.text ?? '') : [String(block.content ?? '')];
    const text = parts.join('\n');
    const saved = /<persisted-output>[\s\S]*?saved to:\s*(.+?\.(?:json|txt))\s/i.exec(text);
    if (!saved) return text;
    try {
      return readFileSync(saved[1].trim(), 'utf8');
    } catch {
      return text;
    }
  };

  const pending = new Map(); // tool_use id -> tables written
  let needBoard = false;
  let needTimesheet = false;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use' && block.name === 'mcp__claude-in-chrome__javascript_tool') {
        const code = String(block.input?.text ?? '');
        if (!/method\s*:\s*['"`](PATCH|POST)['"`]/i.test(code)) continue;
        pending.set(block.id, { story: /\/table\/rm_story/.test(code), card: /\/table\/time_card/.test(code) });
      } else if (block.type === 'tool_result') {
        const text = textOf(block);
        const wrote = pending.get(block.tool_use_id);
        if (wrote) {
          pending.delete(block.tool_use_id);
          if (!/Blocked by the app's ServiceNow write guard/.test(text)) {
            needBoard ||= wrote.story;
            needTimesheet ||= wrote.card;
          }
        }
        if (/"__arco"\s*:\s*"board-v2"/.test(text)) needBoard = false;
        if (/"__arco"\s*:\s*"timesheet-v2"/.test(text)) needTimesheet = false;
      }
    }
  }

  const missing = [needBoard && 'board snapshot', needTimesheet && 'timesheet snapshot'].filter(Boolean);
  if (!missing.length) process.exit(0);
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: `You changed ServiceNow this turn. As the final step, re-run the ${missing.join(' and ')} from the servicenow skill (references/reading.md) so the app's local copy updates, then finish your reply.`,
    }),
  );
  process.exit(0);
});
