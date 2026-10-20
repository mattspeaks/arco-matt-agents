// Refreshes the read-only copy of the shared Gold semantic models now (the app also does it daily on demand).
// npx tsx server/scripts/fetch-gold-models.ts
import { ensureGoldModels } from '../src/dwh/goldModels.js';

const t = Date.now();
const st = await ensureGoldModels(true);
console.log(JSON.stringify({ ...st, seconds: Math.round((Date.now() - t) / 1000) }, null, 2));
process.exit(st.error ? 1 : 0);
