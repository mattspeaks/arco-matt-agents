// Regression test for the data bots' read-only query gate (dwh/query.ts). `npm run test:query`; add --live to also run
// a few real read-only queries (needs `az login`).
import { checkQuery, formatResult, runQuery } from '../src/dwh/query.js';

const allowed: [string, string][] = [
  ['gold', 'SELECT COUNT(*) FROM analytics.Dim_Company'],
  ['gold', "SELECT TOP 25 [Company Family], COUNT(*) AS n FROM analytics.Dim_Company WHERE [Company Type] = 'GC' GROUP BY [Company Family] ORDER BY n DESC"],
  ['gold', 'WITH x AS (SELECT [Company Number] FROM analytics.Dim_Company) SELECT COUNT(*) FROM x;'],
  ['gold', 'SELECT COUNT(*) FROM gold.analytics.Dim_Company c JOIN silver.viewpoint.bHQCO h ON h.HQCo = c.[Company Number]'],
  ['silver', "SELECT 'please update; drop table x' AS note"],
  ['gold', "SELECT [Company Number], 'INSERT' AS label FROM analytics.Dim_Company -- delete this comment\n"],
  ['gold', 'SELECT COUNT(DISTINCT [Email Address]) FROM analytics.Dim_Associate_Public'],
  ['bronze_ukg', 'SELECT TOP 10 code, reporting_category FROM dbo.org_level_3s'],
  ['gold', 'SELECT [Data Set] FROM analytics.Some_Table'],
  ['gold', 'SELECT COUNT(*) AS matched FROM analytics.Dim_Associate_Public a JOIN analytics.Fact_Textura t ON t.Email = a.[Email Address]'],
  ['gold', 'SELECT a.Department, COUNT(DISTINCT a.[Email Address]) AS people FROM analytics.Dim_Associate_Public a GROUP BY a.Department'],
  ['gold', 'SELECT [Amount] * -1 AS revenue, x * 2 AS y FROM analytics.Fact_Company_Financial'],
];
const refused: [string, string][] = [
  ['gold', 'UPDATE analytics.Dim_Company SET [Company Type] = NULL'],
  ['gold', 'SELECT 1; DROP TABLE analytics.Dim_Company'],
  ['gold', 'SELECT * INTO analytics.copy FROM analytics.Dim_Company'],
  ['gold', 'CREATE VIEW analytics.v AS SELECT 1 AS x'],
  ['gold', "EXEC sp_executesql N'SELECT 1'"],
  ['gold', "SELECT * FROM OPENROWSET(BULK 'x')"],
  ['gold', 'SELECT * FROM bronze_confidential.dbo.anything'],
  ['bronze_confidential', 'SELECT 1'],
  ['gold_uat', 'SELECT 1'],
  ['gold', 'SELECT * FROM arco_meta_dw.dbo.x'],
  ['gold', 'SELECT * FROM otherdb.dbo.x'],
  ['gold', 'SELECT * FROM srv.gold.analytics.Dim_Company'],
  ['gold', 'DECLARE @x int = 1; SELECT @x'],
  ['gold', 'SELECT 1 WAITFOR DELAY \'00:10\''],
  ['gold', 'SELECT [Email Address] FROM analytics.Dim_Associate_Public'],
  ['gold', 'SELECT TOP 5 [Pay Rate] FROM payroll_analytics.Fact_Pay'],
  ['silver', 'SELECT ssn FROM ukg.employees'],
  ['gold', '/* hi */ BEGIN TRAN SELECT 1'],
  ['gold', 'SELECT TOP 5 * FROM analytics.Dim_Associate_Public'],
  ['gold', 'SELECT TOP 5 a.* FROM analytics.Dim_Associate_Public a'],
  ['gold', 'WITH c AS (SELECT [Email Address] AS e FROM analytics.Dim_Associate_Public) SELECT TOP 5 e FROM c'],
  ['gold', 'SELECT (SELECT TOP 1 [Email Address] FROM analytics.Dim_Associate_Public) AS e'],
  ['gold', ''],
];

let fail = 0;
for (const [db, sql] of allowed) {
  const r = checkQuery(db, sql);
  if (!r.ok) {
    fail++;
    console.log(`SHOULD ALLOW  [${db}] ${sql}\n  -> ${r.reason}`);
  }
}
for (const [db, sql] of refused) {
  const r = checkQuery(db, sql);
  if (r.ok) {
    fail++;
    console.log(`SHOULD REFUSE [${db}] ${sql}`);
  } else console.log(`refused ok    [${db}] ${sql.slice(0, 60)}  (${r.reason.slice(0, 80)})`);
}

if (process.argv.includes('--live')) {
  const id = `test-${Date.now()}`;
  for (const [db, sql] of [
    ['gold', 'SELECT COUNT(*) AS companies, COUNT(DISTINCT [Company Family]) AS families FROM analytics.Dim_Company'],
    ['gold', 'SELECT TOP 8 [Company Family], COUNT(*) AS n FROM analytics.Dim_Company GROUP BY [Company Family] ORDER BY n DESC'],
    ['gold', 'SELECT TOP 3 [Company Number] FROM analytics.Dim_Company'],
    ['silver', 'SELECT COUNT(*) AS n FROM viewpoint.bHQCO'],
    ['gold', 'SELECT TOP 100 [Company Number] FROM analytics.Dim_Company'],
  ] as const) {
    console.log(`\n[${db}] ${sql}\n${formatResult(await runQuery(id, db, sql))}`);
  }
}
console.log(fail ? `\n${fail} FAILED` : '\nAll query-gate checks passed');
process.exit(fail ? 1 : 0);
