// stdio MCP server for data workers (report model builder, gap designer): one tool, dwh_query. It's a thin call to
// the local app, which checks the SQL and runs it read-only (server/src/dwh/query.ts). Workers never get a connection.
// Plain JS (no build step) because claude.exe launches it directly with node.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API = process.env.ARCO_API ?? 'http://127.0.0.1:4317';
const RUN_ID = process.env.ARCO_RUN_ID ?? '';

const server = new McpServer({ name: 'arcoworker', version: '0.1.0' });

server.registerTool(
  'dwh_query',
  {
    description:
      'Run ONE read-only T-SQL SELECT against an ARCO DWH database (gold, silver or a source bronze database) to check data: distinct values, null counts, key uniqueness, whether two columns match, row counts. Returns at most 50 rows; there is a timeout and a per-run limit, so aggregate (COUNT, GROUP BY, TOP) instead of listing rows. Use two-part names (analytics.Dim_Company) in the chosen database. Columns the ontology flags sensitive (and pay / personal data) are allowed only inside COUNT(...). Never bronze_confidential. Every query is logged for Matt.',
    inputSchema: {
      database: z.string().describe('gold, silver, or a source bronze database from the catalog (e.g. bronze_ukg)'),
      sql: z.string().describe('One SELECT or WITH … SELECT statement'),
      purpose: z.string().describe('One line: what you are checking and why'),
    },
  },
  async (args) => {
    const res = await fetch(`${API}/api/worker/dwh_query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...args, runId: RUN_ID }),
    });
    const text = await res.text();
    return { content: [{ type: 'text', text: res.ok ? text : `Error ${res.status}: ${text}` }], isError: !res.ok };
  },
);

await server.connect(new StdioServerTransport());
