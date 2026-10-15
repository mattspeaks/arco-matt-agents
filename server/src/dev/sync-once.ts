// `npx tsx src/dev/sync-once.ts` — runs one ServiceNow sync without the web server (handy for debugging the browser path).
import { closeDb, initDb, query } from '../db/index.js';
import { startSync } from '../servicenow/sync.js';
import { bus } from '../bus.js';

bus.on('live', (e: { type: string; payload: { type?: string; summary?: string } }) => {
  if (e.type === 'run_event') console.log(`  [${e.payload.type}] ${e.payload.summary?.slice(0, 160)}`);
});

await initDb();
const { done } = await startSync();
const outcome = await done;
console.log(outcome.ok ? 'OK:' : 'FAILED:', outcome.summary);
const lanes = await query<{ state_label: string; n: number }>(
  'SELECT state_label, COUNT(*) n FROM dbo.stories WHERE on_board = 1 GROUP BY state_label',
);
console.table(lanes);
await closeDb();
