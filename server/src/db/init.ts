// `npm run db:init` — creates the database and tables without starting the server.
import { closeDb, initDb, query } from './index.js';

await initDb();
const tables = await query<{ name: string }>('SELECT name FROM sys.tables ORDER BY name');
console.log(`Database ready. Tables: ${tables.map((t) => t.name).join(', ')}`);
await closeDb();
