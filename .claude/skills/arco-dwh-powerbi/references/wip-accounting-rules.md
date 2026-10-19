# WIP, backlog and accounting rules

Validated references (the user signed off on these numbers; reconcile new work to them):
- WIP: `Claude DWH Directory\ANH CEO Dashboard\WIP Report.SemanticModel` (+ .Report)
- Income statement / balance sheet: `Claude DWH Directory\ANH CEO Dashboard\Financial Statement.SemanticModel`
- Board-level implementation of these rules: `Claude DWH Directory\ANH Executive Board\build\` (gen_measures.py, sql\wip.sql, gl_pl.sql, balance_sheet.sql, billing.sql, project.sql, arco_benchmark.sql)
- Known bugs: `ANH Executive Board\GOLD_WIP_CY_COST_BUG.md`, `Fact_Project_Financial_Missing_Activity_Ticket.md`, `Fact_Billing_Customer_Fix_Ticket.md`, `Fact_AR_AP_Aging_Ticket.md`
- Project roster logic: `Claude DWH Directory\Dim_Project - Logic.docx`

## 1. Sources of truth
| Topic | Gold table |
|---|---|
| **Board revenue / GP headline** | `analytics.Fact_Company_Financial` (GL). WIP revenue runs below GL (ANH: WIP YTD $945M vs GL $1,204M) |
| Job WIP detail (contract, cost, billings, % complete, backlog, over/under, CY/PY) | `analytics.Fact_Project_Financial` (from `materialized_etl.Fact_Project_Financial_vw`) |
| JV share | `analytics.Dim_CFA[CFA Percentage]` (budPMJointVenture2.JVPercent) |
| Carryforward share of contract to future years | `analytics.Dim_Project_Carryforward` (from bJCOR; values are FRACTIONS of contract; sparse but usable) |
| Balance sheet | `analytics.Fact_BalanceSheet` (Description / Description2 / Description3, Balance) |
| GL budget | `analytics.Fact_Company_Financial_Budget` (overhead only, ~$71M expense + a token revenue line: NOT a business plan) |
| Billing / AR | `analytics.Fact_Billing` (bARTL + bARTH) |
| Job department by month | `silver.viewpoint.DepartmentHistory` (ProjectNumber, JCCo, Month, Department) |
| Project roster | `analytics.Dim_Project` (one row per project, `Controlling Company`, `Stage`) |

Fact_Project_Financial base columns: Estimated Contract = bJCOR.RevCost (accounting's monthly revenue override, not the live
contract), Estimated Cost = bJCOP.ProjCost, Billed / Billings to Date = bJCIP.BilledAmt, Cost / Cost to Date = bJCCP.ActualCost
(= Fact_Direct_Cost through that month to the penny). Grain JCCo x Project x month; all-zero rows dropped; CFA Number = ProjectNumber + '-' + JCCo.

## 2. Company scope and period
- **Executive / board work: GC companies only**: `Dim_Company[Company Type] = 'GC'` (excludes design firms, MCC self-perform sub, holding/Oth). ANH = Company Family 'ANH' + 'ACH' (ACC acquired by ANH). Apply the same GC rule to any "rest of ARCO" benchmark (ADB, AMNH, AMCC), and show other companies only as aggregates (no sister-company names).
- Validated WIP Report: Company Family NOT IN (null, 'ABS'), Short Name not blank, NO Company Type filter. Validated Financial Statement: same plus Company Type = 'GC'. Know which one you are reconciling to.
- Procore says "ARCO" on every project: map company via `Dim_Project[Controlling Company]`.
- **Closed month**: a month is closed once the 20th of the following month has passed:
  `[Financial Month] <= DATEADD(month, CASE WHEN DAY(GETDATE())>=20 THEN -1 ELSE -2 END, <first of current month>)`.
  As-of slicers run Jan 2024 -> last closed month, "blank = latest". (The validated Financial Statement allows the open month; board work does not.)
- WIP latest month is per COMPANY (`Is_Latest_WIP`), then summed: a JV or closed company stops getting monthly rows, so one latest month per job drops it. Current-month rows are empty placeholders.
- Slicer labels like "18 - ANKC" (GL number - short name), no blank member.

## 3. Job lifecycle (official = Dim_Project[Stage] = Department of the controlling record)
| Dept | Meaning |
|---|---|
| 01 | Open P- jobs (pre-con) |
| 02 | Open jobs |
| **03** | **WIP jobs** |
| 04 / 05 | Closed P- / closed jobs, current year |
| 06 | Spinoff |
| 07 | 100% license share |
| 08 | Permit |
| 09 / 10 | Overhead (09 = "Overhead Not Direct to OH" in every company; 10 is company-specific: in company 19 it is "GMA Open Jobs - Chicago", real jobs. Read the bJCDM description, not the code alone; verified 2026-10-08) |
| CCyyyy / CMyyyy | Closed contracts / closed misc jobs by year |
- `Is Active` = Stage 03, 06 or 07.
- **WIP job-month rule (validated)**: controlling company's department for THAT month is '03' (point-in-time history, not current Stage):
  ```sql
  SELECT a.* FROM gold.analytics.Fact_Project_Financial a
  JOIN silver.viewpoint.DepartmentHistory b ON a.[Project Number]=b.ProjectNumber AND a.[Financial Month]=b.[Month]
  JOIN gold.analytics.Dim_Project c ON b.ProjectNumber=c.[Project Number] AND b.JCCo=c.[Controlling Company]
  WHERE b.Department='03'      -- board work also adds AND a.[Estimated Contract] IS NOT NULL
  ```
  Partner-company rows of a JV are included (each row = that company's share). ANH backlog under this rule $962M (not $1.29B).
- Roster rules (Dim_Project): contract ends in '-'; no leading digit except companies 175 and 02; companies 06 and 101 excluded; 'OH' and InternalUse excluded; start 2016+; L&D 25104-37104 excluded; JV main record = the one without "JV", its company = Controlling Company.
- Vista P- jobs (dept 01/04) are pre-con, NOT pursuits. Procore is not a pipeline: nothing enters Procore until it is a project, Procore stopped logging lost pursuits after 2023, and there is no stage history. No CRM access yet, so no BD / win-rate pages. (A Procore stage-group mapping used in an earlier build was invented, not an ARCO standard.)

## 4. WIP measures
| Measure | Rule |
|---|---|
| Estimated Profit | Est Contract - Est Cost |
| % Complete (cost-to-cost) | Cost to Date / Est Cost (aggregate: DIVIDE(SUM, SUM)) |
| JTD earned revenue (`CY JTD Revenue`) | Cost to Date / Est Cost x Est Contract |
| CY JTD Profit | CY JTD Revenue - Cost to Date |
| Estimated Margin | SUM Est Profit / SUM Est Contract |
| Over / Under Billings | Billings to Date - CY JTD Revenue (**+ = overbilled, - = underbilled**), format `#,##0;(#,##0);0` |
| Backlog (remaining contract) | Est Contract - CY JTD Revenue at the as-of month (`Total Backlog Revenue`) |
| Backlog profit | Est Profit - CY JTD Profit, net of loss provision |
| PY columns | the **prior December** row (year-end), NULL for jobs started this year |
| CY Revenue | CY JTD Revenue - COALESCE(PY JTD Revenue, 0) |
| **CY Profit (use this)** | CY JTD Profit - COALESCE((PY Est Contract - PY Est Cost) x PY % Complete, 0) (= CY JTD Profit - PY JTD Profit) |
| WIP Gross Margin % YTD | CY Profit / CY Revenue |
| **CY Loss Provision** | IF(Est Profit < 0 AND Est Profit < CY JTD Profit, Est Profit - CY JTD Profit, 0) (negative; whole remaining loss recognized now). PY version same with PY columns |
| JV gross-up ("Full", 100% of job) | SUMX over project of SUM(col) / MAX(CFA %), CFA % = Dim_CFA / 100, missing = 100 |
| Month-over-month change | value - value at DATEADD(month, -1) (single month in context) |
| Margin fade | Est margin now vs 3 months ago (points); fading jobs feed the action text |

Validated carryforward split: `Backlog Rev Carryforward` = SUMX(WIP, Est Contract x Total CF); CY Backlog Revenue = Backlog - carryforward;
CY Expected Revenue = CY Revenue + CY Backlog Revenue; Backlog Profit Carryforward = SUMX(IF(Loss Provision <> 0, 0, Est Profit x Total CF));
CY Expected Profit = CY Backlog Profit + CY Profit.

Board measures: Backlog Months = Backlog / (WIP Revenue TTM / 12); WIP Revenue TTM = YTD CY Revenue + prior-Dec CY Revenue - CY Revenue 12 months earlier;
Awards TTM (net new incl. change orders) = Backlog - Backlog PY + WIP Revenue TTM; Book-to-Bill = Awards TTM / WIP Revenue TTM;
backlog burn straight-line to Projected Finish (missing/past = 12 months) split Rest of Year / Next Year / Beyond.
**Won work** = job reached WIP: first WIP month = award date; value = ANH share of latest WIP Est Contract.

## 5. Income statement and balance sheet (GL)
- `Fact_Company_Financial` hierarchy Description > Description2. Description sort: 1 Construction Income, 2 Direct Construction Cost,
  3 **Gross Profit**, 4 General & Administrative Costs, 5 **Net Operating Income**, 6 Other Income & Expense, 7 **Total Other Income & Expense**,
  8 Income Before Provision for Income Tax, 9 Corporate Income Tax, 10 **Net Income**, 11 EBITDA Adjustments, 12 **Total EBITDA Adjustments**, 13 **EBITDA**.
- **Subtotals are their own gold rows: never SUM across Description; always pick one line.** Revenue = "Construction Income", GP = "Gross Profit".
- YTD Amount = sum of monthly Amount within the year (gold column). QTD = sum of Amount for same lines, same year/quarter, month <= current.
- Signs: revenue positive; G&A stored negative (multiply by -1 for display). `% of Income` = YTD line / YTD Construction Income.
- G&A accounts: GL Account starting "7" or "9100". YTD budget = latest budget / 12 x month number (straight-line).
- Monthly GL GP swings +/- $220M: present YTD / TTM, not single months.
- Periods: YTD Jan 1 -> As Of; PYTD to EDATE(-12); TTM 12 months to As Of; PTTM the 12 before.
- Balance sheet: Description "Assets" / "Liabilities & Stockholders Equity"; Description2 Current / Property & Equipment / Other Assets, Current / Long Term Liabilities, Stockholders Equity; Description3 lines incl. Cash & Equivalents, Contract Receivables, Retention Receivables, **Costs in Excess of Billings (= underbillings)**, **Billings in Excess of Costs (= overbillings)**, AP net of retention / retention / affiliates. Balance = month-end; PY = same month -12. Liabilities and equity are positive. Balance Check = Assets - L&E should be 0 (holding cos 91 / 213 don't balance in Gold, ~$57M; exclude or footnote).
- Ratios: Working Capital, Current Ratio, AR Days (GL) = Contract Receivables / (Revenue TTM / 365), Cash to Overbillings.
- GL vs WIP GP gap YTD: green <= 10%, amber <= 25%; action = controller reconciles.

## 6. Billing / AR
- `Fact_Billing`: Invoiced Amount is net of tax; `Current Due` (Amount - Retainage) is NOT open AR; Company Number = bARTH.ARCo; customer key must use Customer + CustGroup.
- Roll to **invoice grain** (company, trimmed project, invoice) so reversals / credit memos net out. Open = Invoiced - Paid only when no Date Paid and > 0.
  Age invoice date -> today in 0-30 / 31-60 / 61-90 / 91-180; > 180 days with no pay date = "unreconciled AR" (cash-application gaps; ANH open AR ~$264M, > 180 ~$18-24M, not $313M).
- DSO (Billing) = Open AR 0-180 / (Billed TTM / 365); Collection Rate TTM = Collected / Billed.
- Owner billing minimum bill = Vista JTD cost + Keystyle unapproved (Fact_AP_Unapproved Gross Amount) + Textura pending - billed to date (all gross of retainage).
  Textura pending = status NOT IN ('Awaiting','Rejected') AND Export Job ID IS NULL (status alone is unreliable; Awaiting rows duplicate amounts);
  exclude the job-level "General Construction" Textura contract (ARCO's owner-facing contract). Vista vs Keystyle phase spellings differ: group by the 7-char cost code.

## GL BIE / CIE entry (Connor Hartman, Co 10 June 2026 entry + backup, 2026-10-08)
- BIE: Dr 4000 Construction Revenue / Cr 2760 for the net Over (Under) Billings column of the WIP (ties the GL to the cent).
- CIE: Dr 1370 Costs in Excess - Contracts / Cr the cost accounts (5000-5070) for job-to-date cost on jobs the company carries in
  department 01 Open P-, 02 Open, 04 Closed P- current year, 08 Permit (its OWN department, every job, including jobs with no contract
  estimate) + the CY Loss Provision line = the loss provision balance at the month (negative), not the change since December.
  Rebuild from Fact_Direct_Cost x DepartmentHistory (Bonding Schedule/build/sql/expected_cie.sql): Co 10 6/30 to $0.24.
- Departments that feed it can change month to month as jobs move. Dept 9 overhead is booked to CIE in non-quarter months
  (Accounting) but is excluded for WIP / bonding (CFO). Several companies (47, 98, 82, 85, 8, 77 at 6/30) still don't follow the rule:
  open question with Accounting.

## X-card jobs (Tracy Ashley, VP Accounting, 2026-10-08)
- X-jobs (project number ending -X, e.g. MCG100-X in Co 10) belong in WIP / bonding. When an X-job has its own WIP line it is 100%
  complete each month for that month's activity (no estimated cost is projected): earned = billed, over/under = 0, backlog = 0.
- Many X-cards are folded into their base job and never show as their own line (MCI100 in Co 34): keep the base job's combined cost;
  do NOT swap cost to Fact_Direct_Cost there (tested: Co 34 ties the GL exactly with the combined cost, off $11-14M without it).

## 7. Known Gold bugs and workarounds (put in ADO tickets, never in report text)
**Before building ANY report on gold WIP, read this list and apply every open workaround until its ticket is verified in the data
(user 2026-10-07: the Bonding Schedule was built on gold Fact_Project_Financial while 5972 was open and the Project Health silver
workaround already existed; bonding totals were wrong for a day). A ticket marked Resolved is not proof: re-run the comparison below.**
**RESOLVED IN PROD 2026-10-08 16:53 UTC (items 0, 1 and 2 below):** prod `materialized_etl.Fact_Project_Financial_vw` = the validated
gold_uat v2 view; table 530,251 rows, unique [Project Financial Number], 0 row differences vs gold_uat Fact_Project_Financial_v2 both ways;
C781 co 7 and MF100 co 237 no longer carry past their $0 overrides; billings tie bJCIP to the cent; cost ties Fact_Direct_Cost every closed
month; ratios blank (never 0) without an estimate; CY Costs = 0 bug gone (0 of 186,370 rows with no prior-December row); jobs missing went
from 5,213 to 61 company/job pairs, all of which net to $0 billing (dropped by design). The Bonding Schedule Share_Moved workaround is no longer
needed for gold reads after this date. Open: Sep 2026 cost in bJCCP leads bJCCD by $175M (silver load / posting timing, not 5972); still run
the regression standard below after ANY change to this view. History of the bug follows.
0. **ADO 5972 (filed 2026-09-28, deployed 2026-10-07 2:04 PM CT, view + table recreated): Fact_Project_Financial project gate.** Old gate =
   nonzero bJCOR override only, so normally billed jobs and months were dropped. The fix widened the gate to bJCOR|bJCOP|bJCCP|bJCIP,
   BUT the view still carries the last NONZERO override forward and ignores a $0 override, so JV jobs whose contract moved to another
   company's -JV line now count twice (C781: co 7 $40.5M + co 232 $41.1M; MF100: co 237 $50.2M kept after its override went to $0 in
   Jan 2026). 8/31 bonding scope: 57 rows / 56 jobs, $563M contract, $330M backlog overstated. Gold also still has NO contract for jobs
   that never had an override (C930 co 7: bJCCM $664M), which the silver workaround fills from bJCCM ContractAmt.
   Workaround = silver WIP (`Project Health/build/sql/wip.sql`: four-source gate, $0 override respected on JV jobs, bJCCM fallback,
   cost from bJCCD). Comparison script pattern: gold vs that query on the same scope by company x job x month (rows, contract, cost,
   billed, backlog); test `latest bJCOR override = 0 but gold contract > 0` for the JV double count.
   **Tested 2026-10-07 (Bonding Schedule), do NOT swap the whole fact to silver:** against the GL BIE by company, gold's over/under
   ties best (abs gap $149M / $157M / $251M at 3/31, 6/30, 8/31) vs a silver hybrid ($217M+) and pure silver (~$1,000M: a $0 JV
   contract makes every billing BIE). Use gold + JV share correction: JV job (a -JV bJCCM line) and the company's latest bJCOR
   override (as of the month) is $0 -> contract, est cost, backlog, cost of backlog = 0; leave revenue, over/under, BIE, CIE as gold.
   Reference: Bonding Schedule/build/sql/fact_wip.sql (Share_Moved). Removed $330M of double-counted 8/31 backlog.
   **Gold fix back-tested 2026-10-07** (estimate picks keep $0 entries, nonzero-first then non-JV tie-break, NULLIF(value,0); plus the
   net-zero-month date range): GL BIE/CIE tie unchanged, 03/06/07 backlog -$240M to -$481M, 2026 YTD revenue vs GL within $11.5M.
   **Regression standard for any Fact_Project_Financial change:** (1) independent silver rebuild compared row by row with NULL-safe
   comparisons (`CASE WHEN a=b OR (a IS NULL AND b IS NULL)`; `NOT (a=b)` silently passes NULLs), (2) cost = Fact_Direct_Cost and
   billed = bJCIP by company x month, (3) GL BIE / CIE by GC company at quarter-ends, (4) CY revenue vs GL Construction Income YTD,
   (5) whole-job contract across companies vs bJCCM. Never test a rule with the view's own filters.
1. **CY Costs = 0 when there is no prior-December row** (`ISNULL([Cost to Date]-[PY Cost to Date],0)`): CY GP overstated (ARCO Aug-26 gold $1.69B vs $433M; MCI100 $295M "profit"). Workaround: CY Profit recompute above. The validated WIP Report's CY Profit / CY Expected Profit inherit the bug; contract, cost, billings, backlog, over/under are fine.
2. **Jobs missing from Fact_Project_Financial** when no nonzero bJCOR.RevCost (5,213 projects, $2.46B billing). Fix = UNION bJCOR/bJCIP/bJCCP/bJCOP in the ContractMaster CTE.
3. **RESOLVED 2026-10-07: bJCCP reloaded and current again** (ties to Fact_Direct_Cost to the penny every closed month; open month can lead bJCCD by a load). Note bJCCP rolls sub-job suffixes (N512-LG, MCI100-X) into the base project while Fact_Direct_Cost keeps them, so tie out by company/month, not project. Original finding: **Cost to Date frozen / 0 since 2025** (found 2026-10-02): `silver.viewpoint.bJCCP` stopped loading after Nov 2024 (MAX(Mth) 2024-11-01), and the view takes cost from it. bJCCD (job cost detail) is current and equals Fact_Direct_Cost to the penny. Workaround: build WIP from silver (gate = bJCOR OR bJCOP OR bJCIP OR bJCCD; cost from bJCCD; carry est contract / est cost forward; bJCCM ContractAmt fallback). Reference query: `Project Health\build\sql\wip.sql`. Ticket: `Project Health\GOLD_WIP_COST_TO_DATE_ZERO_TICKET.md`.
3b. **RESOLVED 2026-10-09: bug 6010 cost-to-project collision.** Overhead / bonus / allocation job cost reused real job numbers (23100 First Park carried $259.6M). Gold now has `Fact_Direct_Cost[Ops Project Number]` (blank for that cost) and the Gold Financials model joins cost to Dim_Project on it (10,066,730 rows, $35.36B attributed; totals unchanged at $42,148,619,800.10). In SQL, attribute job cost to projects on `[Ops Project Number]`, never the raw `[Project Number]`; company totals still use all rows.
3. Fact_BalanceSheet out of balance for holding companies (~$57M, cos 91 / 213).
4. Fact_Billing customer join broken (needs CustGroup); paid amounts/dates incomplete.
5. Fact_Manpower, Fact_Observations and Fact_Submittal DO have ANH rows, but their `[Project Number]` column holds the Procore project ID: join on `Dim_Project[Procore ID]`, not the job number (verified 2026-10-02: 1004206 = B180). WIP contract vs live Vista contract (bJCCM.ContractAmt) can differ: warn when Vista >= $10k and 1% above WIP.

## 8. People metrics (UKG) that show up on finance boards
- Exclude interns / co-ops from turnover. Hire dates from Fact_Associate_Job_History reason 100/101.

## 9. Targets
- No ANH business plan in Gold. Use a TARGETS dict of placeholders and say "placeholder until the plan is loaded" on the page.

## Subcontract insurance compliance: use myCOI directly (user, 2026-10-02)
- Source of truth: `gold.mycoi_analytics.Fact_Insurance_Compliance` (one row per assignment; `[Contract Unique Id]` = Vista SL,
  e.g. `K834-1013`; `[Api Assignment Compliance]` Compliant / Non-Compliant / Undecided; `[My Coi Detail]`;
  `[Earliest Policy Expiration Date]`; `[Is Disabled]`). Raw detail in `silver.mycoi` (assignment_main, assignment_policy_details,
  assignment_non_compliant_notes, vendor, division).
- Do NOT use the Vista sync (bSLHD.udmycoiStatus / bSLCT Complied flags): known VP/PC issue, udmycoiStatus is blank on every
  matched subcontract and bSLCT flags nearly every sub "out of compliance".
- Status ladder used in Project Health: PM Hold > Out of Compliance (myCOI non-compliant) > Pending (myCOI undecided) >
  Policy expiring (< 30 days) > Compliant; no myCOI row = "Not in myCOI" (shown neutral, not a failure: A/E / consultant
  agreements and older jobs are not tracked). Coverage 2026-10-02: ~40% of Vista subcontracts on Course of Construction jobs.
  Reference: `Project Health\build\sql\phd_Fact_Sub_SubLedger.sql`.

## Project dates: use the Procore project fields (tested 2026-10-03)
- Dim_Project [Actual Start Date] / [Estimated Completion Date] / [Projected Finish Date] = the Procore project Dates panel
  (silver procore.projects start_date / completion_date / projected_finish_date; warranty dates also there). Filled on 141/141
  Course of Construction jobs. These are PROCORE dates, not Vista: label them that way.
- Procore prime contract dates (Fact_PrimeContract Contract Start / Est Completion / Substantial Completion) are sparse
  (23-34 of 141) and not more current: show substantial completion only as a reference.
- Days-to-finish and the past-finish check use the same date: projected finish, else completion date. On 104/141 jobs projected
  finish was never re-forecast (= original completion) and 79 are past while still in construction: a PM data-hygiene signal.


## JV / partner jobs: whole-job numbers (user + tested 2026-10-03)
- **Procore snapshot = the controlling company's.** Its PM owns the job and the snapshot (user rule). Four gold tables, one per family
  format: ACH = Fact_ACC_Budget_Snapshot, ANH = Fact_ANC_..., ADB = Fact_ADB_..., AMNH = Fact_AMNC_.... Pick each job's table by the
  controlling company's family; fall back to the table with the latest snapshot only if that table has none. A job can appear in several
  tables (each JV partner may snapshot it); on 20 such partner jobs the controlling table was always the newest.
  Column map: ADB Total Contract / Total Estimated Cost / Current Over Under / Cost To Date / Vendor Contract-Executed / Vendor COs-Executed /
  Forecasted Addl / Owner COs; AMNC like ACC (Revised Budget, Total Estimated Costs, Projected Over Under, JTD Costs, Approved Commitments,
  Draft Commitments = pending, Approved PCOs PCCOs, Open PCOs). Over/under = contract - est cost in all four. Cost codes / categories match.
- **Vista WIP for a JV job = sum of EVERY JV company's books** (each company books its share of cost, billings and contract via JC
  overrides / -JV lines). Don't limit the WIP to ANH/ACH company numbers. Tested: all-company sum matched the Procore snapshot cost on
  28 of 30 partner jobs and owner invoices on 29 of 30 (ANH-only: 0); on 76 ANH-controlled jobs with outside JV partners, contract
  matched the snapshot on 62 vs 2 with ANH-only books. Scope the job list instead (controlled by, or CFA share held by, ANH/ACH).
- **Owner invoices (Fact_Billing) sit 100% in the controlling company**, so an ANH-only filter drops AR on partner jobs; scope by job.
- Show the ANH share separately (hybrid: JC overrides when the override set is complete, else Dim_CFA %), never by shrinking the facts.

## Buyout "late" = past the trade's buy-by point, not a flat % complete (tested 2026-10-03)
- Buy-by point per CSI division = job % complete by which 90% of past jobs had the trade 50%+ committed (1,409 jobs with Procore
  snapshot history from <= 10% complete, all families). Examples: 31 earthwork 15%, 26 electrical 16%, 22 plumbing 17%, 23 HVAC 19%,
  03 concrete 25%, 07 envelope 33%, 09 finishes 45%, 32 exterior improvements 68%, 10 specialties 81%, 12 furnishings 82%; other = 50%.
- Versus the old flat 25% rule: late flags on Course of Construction jobs 31 -> 13, no early trade lost. Values live in gen_measures.py BUY_BY.

## Buyout "bought out" = a signed commitment, not 95% of the estimate (user + test 2026-10-04)
- GC practice: a trade is bought out once its subcontract / PO is signed; work progress is tracked separately. Rule: committed +
  commitment COs > 0 (or < $5K left, or signed in Procore after the snapshot). Awarded not signed = amber; nothing awarded = open/late.
- Why: Procore "Total Estimated Costs" is the PM's forecast at completion, so estimate minus committed on a signed trade is mostly the
  PM's uncommitted forecast (74% of the gap on active jobs): future sub COs or savings. On finished jobs, 95% of later commitment growth
  on signed trades came from sub COs, and trades first signed at <50%, 50-80%, 80-90% and 90-95% behaved the same (~40% added
  commitments later), so no % cutoff is supported. Only 5 of 337 partly committed lines had 2+ vendors. Show the gap as "Not under contract".

## Pending sub COs: only ANC and ADB Procore budgets carry them (found 2026-10-03)
- ANC [Pending Sub CO] and ADB [Vendor COs-Pending] are pending sub change orders. ACC [Pending Commitment] and AMNC [Draft Commitments]
  are unsigned subcontracts, NOT COs: never use them as "sub COs not with the owner". Procore commitment PCO tables are nearly empty
  (2 rows); Procore subcontract pending CO fields were 0 on the test job. Name the sub via the cost code -> Procore subcontract vendor
  (work_order_contracts.vendor_company), which matched Textura on N679.

## PM monthly deadlines (user 2026-10-03 + ARCO Design/Build PM Training, Fall 2022)
- **Procore snapshot (cost status report) due by the 25th of every month**, every month from executed LOA/LOI or contract until the
  job is 100% complete (billed in full, no estimated cost remaining, no over/under, 100% complete). Flag snapshots against the due
  date ("missed the Sep 25 snapshot"), not a rolling day count.
- **Owner bills (pay apps) due by the 30th** (user, ANH). ADB 2022 calendar: finalize owner pay apps 1st business day, follow up ~7th.
- Rest of the close calendar (ADB 2022 deck): 10th DBM invoice approval deadline + close AR (no more pay app changes); 12th director
  approval; 13th-14th controller approval; 15th close AP (job cost reports go out); 25th cost status reports due; 30th/31st financials.
- Training rules worth surfacing: bill owners timely (don't be underbilled: cash flow), approve invoices daily (only approved invoices
  hit cost to date), issue sub COs BEFORE approving their invoices, sub COs on the same phase code as the original commitment.
- The user has a fuller schedule to share; update this section when it arrives.

## Procore snapshot cadence = monthly cycle, not snapshot age (user + test 2026-10-04, O137)
- The monthly snapshot (cost status for the PRIOR month) is due the 25th: "July 2026" is taken ~Aug 22-25 (713 of 817 month-named
  ANC snapshots were taken the month after the named month). An ad hoc snapshot (e.g. "End of Phase 1" on Sep 1) must not count.
- Credit each snapshot to a cycle (Cycle_Month in snapshot.sql): a month in the name -> the following month's 25th; no month name ->
  the 10th-to-9th window it was taken in. Stale = latest cycle < the last due date's month (1 missed = watch, 2+ = act).
- System "YYYY-MM-DD Auto-Snapshot" entries exist only in the AMNH (AMNC) template, created the 26th; they COUNT (that family relies on
  them). ANH/ACC jobs never have them. PM-named snapshots tagged "Auto-Snapshot for ACC/ANC" are normal monthly snapshots.

## Procore snapshots / contract / change events: validated rules (Nicole Westrich, ANH Construction Apps, 2026-10-05)
- **Project Status snapshots only** (`[Snapshot Type] = 'project_status_snapshot'`). Every "Auto-Snapshot" is `ad_hoc`: hub copies
  ("Auto-Snapshot for ANC/ACC") of another family's status snapshot, AMNH system 26th auto-snapshots, tests ("Test #1"), phase snapshots.
  Pick the snapshot table per job = the controlling family's table if it has status snapshots, else whichever table has them (N610 is
  ANH-controlled but run by ADB: status snapshots only in ADB; 544 / SM147 in ANC). PMs sometimes save the monthly snapshot as ad hoc
  (~110 in 2026): those jobs correctly show as missed snapshots.
- **PC vs Vista contract** (revised 2026-10-06 with Nicole): compare APPROVED with APPROVED: Vista current contract (bJCCM ContractAmt,
  "Total Current Contract" in Vista) vs Procore prime contract Revised Contract Amount from `kroo_procore__prime_contracts` (gold's prime
  roll-up is stale: N685 gold $21.69M vs Procore $21,138,953). Never use Vista's WIP projected contract (bJCOR override) here: it is the
  accountant's forecast incl. anticipated COs (N685 $20.7M, B211 $142.5M vs $108.0M). 15 flags = Procore-approved owner COs not posted
  to Vista (e.g. DT102 +$623K). Owner = PM. Show the WIP projection as information next to the current contract.
- **Vista projections not set up** (Vista WIP contract $0 while Procore has a contract): its own check, owner project accountant;
  never report it as "cost over estimate" (N654).
- **Unpriced change events** come from the Kroo Procore feed `bronze_procore.dbo.kroo_procore__change_events` + line items (readable
  through the gold connection, cross-database, also in the service): status open/pending/hold, `event_scope = 'out_of_scope'`, no prime
  PCO cost, excluding Allowance / Contingency / Scope Transfer event types (owner allowances are in the contract). Exposure = cost -
  revenue (floor 0). In Scope = ARCO-absorbed, never counted; TBD shown separately. $39.7M -> $17.2M on active jobs.
- **Procore-inactive jobs** (`silver.procore.projects.active = 0`) are left off the ANH Monthly Job Cleanup Report: hide them with a
  report-level filter (Active + Not in Procore ticked) so they can be added back from the Filters pane.
- **Owner and sub CO detail** (2026-10-05): owner COs = `bronze_procore.dbo.kroo_procore__prime_change_orders` (one row per CO, void
  excluded); gold's prime contract roll-up drops unnumbered ("TBD") COs from the dollars (N654: $41K vs $57K pending) and lags approved
  (603K vs 644K), so CO cards should total the CO list. Pending sub COs for every family = `kroo_procore__commitment_change_orders`
  status pending / proceeding (draft listed, not counted); replaces the snapshot's ANC/ADB-only pending sub CO column.
- **Superintendent fallback**: Vista has PM, PX, PA and coordinator on every active job; only the superintendent is sometimes blank (22 of
  149). Fill it from `kroo_procore__project_roles` (role = 'Superintendent', active), names joined with "; " (Procore allows several).
  Field data already in gold (incidents, inspections, observations): use gold, not bronze.
- **Change event detail ties to the tile** (user 2026-10-10): any unpriced change event KPI gets an event-level list on the same page
  (CE #, title, type, created, cost, revenue, unpriced, days open; largest first) built from the SAME filter, so the total ties to the tile.
  ANH Project Health: `sql/change_event_list.sql` (tested: ties to change_events.sql on all 217 jobs).
- **Procore field activity** (user 2026-10-10): daily logs, meetings, photos, inspections, submittals per job (each used on ~82-92% of active
  ANH jobs; observations / RFIs ~1/3, left out). Inspections = gold Fact_Inspection (Deleted = 0, overdue flag); submittals = gold
  Fact_Submittal (its [Project Number] is the Procore project id; open = [Status Status] 'Open', past due = Due Date < today). Daily log
  headers, meetings and images exist only in bronze_procore (Kroo feed): read cross-database and logged as a gold gap. A job that never used a
  tool shows "Not used in Procore" (no-data badge), never a failure; gaps are rated only on Course of Construction jobs (no daily log in
  7 days, no meeting / photos in 30 days, overdue inspections, past-due submittals = amber). `sql/field_activity.sql`.
- **Weekends** (user 2026-10-10): ARCO does not usually work weekends. Procore auto-creates empty weekend daily logs: list a Saturday /
  Sunday log only when it has crew (manpower workers > 0) or was completed; never count empty ones toward last-log age. Daily log
  coverage = weekdays logged / weekdays in the window, both computed in the same SQL at refresh (not DAX TODAY: Fabric is UTC and the
  numbers drift apart). Weekend logs with crew are listed but not counted in the ratio (never over 100%). Weekday test DATEFIRST-proof:
  `DATEDIFF(day, '19000101', d) % 7 IN (5, 6)`.
- **Procore deep links** (confirmed by the user 2026-10-10; company 39265 = ARCO): base `https://app.procore.com/webclients/host/companies/39265/projects/{Procore project id}/tools/`
  + `hubs/project-hub/` (project), `submittals/{Fact_Submittal [Submittal ID]}`, `inspections/{Fact_Inspection id}`, `dailylog/list?date=YYYY-MM-DD`, `meetings/details/{meetings.procore_id}`,
  `photos/albums/{images.image_category_id}?page=1&sort=-exposure_date` (album; `photos` when no album). Never the old
  `app.procore.com/{project}/project/...` form. Photo files themselves are signed, expiring links: never embed them.

## Job status is per COMPANY for JV jobs; GL BIE / CIE rule (Connor Hartman, Austin Moore 2026-10-07)
- Vista departments are defined and assigned per company. The same project can be "02 Open" in the controlling company and "03 WIP"
  in a JV partner company (C756: co 7 = 02, co 77 = 03; C1106: co 7 = 05, co 40 = 03 with $175M backlog). For anything that must tie to
  a company's books (bonding, GL tie-out) take the department of the ROW'S OWN company in DepartmentHistory, controlling company as
  fallback. ARCO GC 8/31/2026 (03/06/07): controlling-company rule $7.62B backlog vs own-company rule $8.31B.
- GL Billings in Excess (2760) = net over / under on WIP, Spinoff and License Share jobs (03/06/07) + 100% of billings on Open P- / Open
  jobs (01/02). GL Costs in Excess (1380) = 100% of cost on 01/02 jobs + a loss-job adjustment (books the full loss); Dept 9 overhead jobs
  go to CIE in non-quarter months. Before 8/31/2026 many companies booked the entry only at quarter-end; monthly from 8/31.
  Reference: `Bonding Schedule\build` (fact_wip.sql, gen_measures.py "Expected GL BIE / CIE").
- **Sub insurance compliance (myCOI)** (user 2026-10-09): gold `mycoi_analytics.Fact_Insurance_Compliance` is one row per subcontract
  (Contract Unique Id = Vista SL). Alert only on myCOI "Non-Compliant" (incl. "Non-Compliant - In Progress", pending Nicole's call) with
  $5K+ left to bill. "Policy expiring within 30 days" is myCOI-Compliant (myCOI requests renewals): show amber, never alert (it kept almost
  every job from ever reading 100%: 67 -> 54 jobs flagged, 46 fully compliant). ~39% of open subs are not in myCOI at all (16 jobs never set
  up, design / professional-services contracts, older subs on jobs set up later): a setup gap, not non-compliance.
- **Alert only on ACTIVE non-compliant subs (user 2026-10-10)**: Out of Compliance = myCOI Non-Compliant AND the sub is working or
  billing: a Vista AP invoice (posted bAPTL/bAPTH or unapproved bAPUL/bAPUI) on the SL in 90 days, a Textura payment on the contract in
  90 days, or the sub's crews in Procore daily logs on the job in 30 days (Procore vendor -> Vista crosswalk from Subcontractor 360).
  Non-compliant but not started = "Non-Compliant (Not Active)", amber, not counted (PM collects the cert before mobilization). Active
  ANH/ACH jobs 10/10: 159 subs / 67 jobs -> 67 subs / 40 jobs (19 of the 67 are on site with no billing in 90 days). Gold myCOI vs the
  Vista bridge (Viewpoint myCOI.ARCO_Interface + udmyCOIPolicyDetails) checked 10/10: gold complete, status agrees 795/801.
