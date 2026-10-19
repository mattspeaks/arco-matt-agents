// Headless Reset Filters test against the PUBLISHED report (house rule 2026-10-06: run after every screenshot QA pass).
// For every visible page that has a "<Page> Reset" bookmark: screenshot as loaded -> clear every slicer (dirty the page)
// -> apply the Reset bookmark -> screenshot -> pixel-compare with the as-loaded image. A Reset that empties / collapses a
// matrix, re-sorts a table or misses a slicer default shows up as FAIL. Uses the viewer's az identity (AAD embed token).
//
// Usage (from any folder):
//   node reset_test.mjs <workspaceId> <reportId> <outDir> [pageDisplayName ...]
//   <workspaceId> = me for a DEV copy in My workspace (uses /myorg/reports/<id>; a groups/<personal id> URL returns 401)
// Prints one PASS / FAIL line per page; FAIL pages get <outDir>/<page>_loaded.png, _reset.png, _diff.png for review.
import { createRequire } from "module";
import { execSync } from "child_process";
import { mkdirSync } from "fs";
const CLI = `${process.env.APPDATA}/npm/node_modules/@microsoft/powerbi-report-authoring-cli`;
const require = createRequire(CLI + "/package.json");
const { chromium } = require("playwright");
const PBIJS = CLI + "/node_modules/powerbi-client/dist/powerbi.min.js";
const [,, ws, reportId, outDir, ...only] = process.argv;
mkdirSync(outDir, { recursive: true });
const az = (a) => execSync(`az ${a}`, { encoding: "utf8" }).trim();
const token = az("account get-access-token --resource https://analysis.windows.net/powerbi/api --query accessToken -o tsv");
const embedUrl = az(`rest --method get --resource https://analysis.windows.net/powerbi/api --url "https://api.powerbi.com/v1.0/myorg/${ws === "me" ? "" : `groups/${ws}/`}reports/${reportId}" --query embedUrl -o tsv`);

const browser = await chromium.launch({ headless: true, channel: "msedge" });
const pg = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await pg.setContent('<html><body style="margin:0"><div id="r" style="width:1600px;height:950px"></div></body></html>');
await pg.addScriptTag({ path: PBIJS });
await pg.evaluate(({ embedUrl, reportId, token }) => {
  const pbi = window["powerbi-client"];
  const svc = new pbi.service.Service(pbi.factories.hpmFactory, pbi.factories.wpmpFactory, pbi.factories.routerFactory);
  window.rep = svc.embed(document.getElementById("r"), { type: "report", id: reportId, embedUrl, accessToken: token, tokenType: 0,
    settings: { panes: { filters: { visible: false }, pageNavigation: { visible: false } } } });
  window.rendered = 0; window.rep.on("rendered", () => window.rendered++);
}, { embedUrl, reportId, token });
await pg.waitForFunction(() => window.rendered > 0, null, { timeout: 120000 });
const bms = await pg.evaluate(async () => (await rep.bookmarksManager.getBookmarks()).map(b => ({ name: b.name, displayName: b.displayName })));
const pages = await pg.evaluate(async () => (await rep.getPages()).map(p => ({ name: p.name, displayName: p.displayName })));
// wait until Power BI says the page finished rendering after `act`, then a short settle; capped so a quiet page cannot hang
let extra = 0;   // map tiles stream in after "rendered": pages with a map visual get extra settle time
async function settle(act, cap = 15000) {
  await pg.evaluate(() => { window.rendered = 0; });
  await act();
  await pg.waitForFunction(() => window.rendered > 0, null, { timeout: cap }).catch(() => {});
  await pg.waitForTimeout(1500 + extra);
}
let fails = 0;
for (const p of pages) {
  if (only.length && !only.includes(p.displayName)) continue;
  // page "X" -> bookmark "X Reset"; a renamed page falls back to the one Reset bookmark no other page name claims
  const claimed = new Set(pages.map(q => `${q.displayName} Reset`));
  const bm = bms.find(b => b.displayName === `${p.displayName} Reset`) ||
    (bms.filter(b => /Reset$/.test(b.displayName) && !claimed.has(b.displayName)).length === 1 ? bms.find(b => /Reset$/.test(b.displayName) && !claimed.has(b.displayName)) : null);
  if (!bm) { console.log(`SKIP ${p.displayName}: no Reset bookmark`); continue; }
  const safe = p.displayName.replace(/[^\w-]+/g, "_");
  await settle(() => pg.evaluate(async () => rep.reload()), 120000);
  extra = (await pg.evaluate(async (n) => { const x = (await rep.getPages()).find(y => y.name === n);
    return (await x.getVisuals()).some(v => /map/i.test(v.type)); }, p.name)) ? 8000 : 0;
  await settle(() => pg.evaluate(async (n) => { const x = (await rep.getPages()).find(y => y.name === n); await x.setActive(); }, p.name));
  const loaded = await pg.screenshot({ path: `${outDir}/${safe}_loaded.png` });
  let cleared = 0;
  await settle(async () => { cleared = await pg.evaluate(async (n) => {   // dirty the page: clear every slicer
    const x = (await rep.getPages()).find(y => y.name === n); let k = 0;
    for (const v of await x.getVisuals()) if (v.type === "slicer" || v.type === "advancedSlicerVisual") { try { await v.setSlicerState({ filters: [] }); k++; } catch (e) {} }
    return k;
  }, p.name); });
  const dirty = await pg.screenshot();
  await settle(() => pg.evaluate(async (n) => rep.bookmarksManager.apply(n), bm.name));
  const reset = await pg.screenshot({ path: `${outDir}/${safe}_reset.png` });
  const cmp = (a, b) => pg.evaluate(async ({ a, b }) => {   // pixel compare in the page (canvas), returns share of changed pixels
    const load = (s) => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = document.createElement("canvas"); c.width = ia.width; c.height = ia.height; const x = c.getContext("2d");
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) n++;
    return n / (da.length / 4);
  }, { a: a.toString("base64"), b: b.toString("base64") });
  const diff = await cmp(loaded, reset), moved = await cmp(loaded, dirty);
  // FAIL if Reset does not restore the page; WARN-level note if clearing changed nothing (no slicer defaults: test is weak)
  const ok = diff < 0.003;   // < 0.3% of pixels (antialiasing / map tiles); an emptied grid or collapsed matrix is far above
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${p.displayName}: ${(diff * 100).toFixed(2)}% pixels differ after clear + Reset (${cleared} slicers cleared, which changed ${(moved * 100).toFixed(1)}% of the page${moved < 0.003 ? " - no defaults to restore" : ""}; bookmark '${bm.displayName}')`);
}
await browser.close();
process.exit(fails ? 1 : 0);
