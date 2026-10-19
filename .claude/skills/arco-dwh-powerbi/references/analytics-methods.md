# Statistics and machine learning for DWH deep dives

Use this whenever a question goes past "what is the number" into "is this real", "who is unusual", "what drives it",
"what happens next" or "how long does it take". Added 10/7/2026 after the Concur expense deep dive (the worked example
at the bottom). The house rules still apply: advisor mode (test competing approaches, bring back evidence), verify then
claim, PII, Family > Division, no em dashes in anything user-facing.

## 1. Tools and skills used

| What | Where | Use for |
|---|---|---|
| `scripts/stats_toolkit.py` | this skill | profile, peer outliers (robust z + FDR), Benford, round-number test, near-duplicates, trend + change points, group comparison, Simpson check, Isolation Forest anomaly, Kaplan-Meier survival |
| `scripts/ml_model.py` | this skill | prediction scorecard: out-of-time split, baseline vs gradient boosting, AUC with CI, PR AUC, precision/recall top 10%, calibration, permutation importance; blocks protected attributes |
| `scripts/forecast.py` | this skill | monthly forecasts: rolling-origin backtest of seasonal naive / naive / ETS / SARIMA, picks the winner, 80% / 95% intervals |
| `scripts/fabric_query.py` (`stats_toolkit.load`) | this skill | pull data with the user's az identity; `--csv` for anything over ~10K rows |
| Python libraries | pip (installed 10/7/2026) | pandas, numpy, scipy, scikit-learn, statsmodels, ruptures (change points), lifelines (survival), shap (optional tree explanations). **Gotcha:** installing these downgrades pandas to 2.x (lifelines pins pandas<3), which breaks pandas-3 pickles (Profit Fade build data). Re-pin after any install: `pip install pandas==3.0.6` (lifelines still runs on 3.x, smoke-tested 10/7/2026) |
| `fabric-skills:spark-cli` | companion skill | productionise a score: port the analysis to a scheduled Fabric notebook that writes a gold_uat / gold table (a model score must never live only on a laptop) |
| `anthropic-skills:xlsx` | companion skill | review workbooks (flag lists, duplicate sets); house grid style: navy header, black outline, centered numbers |
| `dataviz` | companion skill | charts outside Power BI (trend + forecast band, survival curves, Benford bars) |
| `powerbi-authoring:semantic-model-authoring` | companion skill | put scored tables into a model; keep scores as columns from Gold, not DAX re-implementations |
| `fabric-skills:fabriciq` | companion skill | quick natural-language checks against published models before deep work |
| `SuggestSkills` / `SearchPlugins` | tools | searched 10/7/2026 for stats / ML / anomaly / forecasting skills: none in the catalog, hence this file |

Import pattern:
```python
import os, sys; sys.path.insert(0, os.path.expanduser("~/.claude/skills/arco-dwh-powerbi/scripts"))
import stats_toolkit as st, ml_model as mm, forecast as fc
df = st.load(r"C:\...\scratchpad\x.csv")            # or st.load("SELECT ...", db="gold")
```

## 2. Pick the method from the question

| Question | Method (toolkit function) | Watch out for |
|---|---|---|
| What's in this data? | `profile` | nulls, zeros, negatives, impossible dates, blank strings (Concur uses " ") |
| Is there a trend or just seasonality? | `trend` (STL + Mann-Kendall + Theil-Sen slope with CI) | needs 24+ months for seasonal adjustment; report slope as $/period and % of mean |
| Did something change, and when? | `changepoints` (PELT) | a step change (policy, system cut-over) is a different story from steady growth; check pipeline / extract changes first |
| Is group A really different from B? | `compare_groups` (Mann-Whitney, Cliff's delta, bootstrap CI of the median gap) | report effect size (negligible / small / medium / large), not just p; big n makes tiny gaps "significant" |
| Does the gap survive mix? | `simpson_check` | split by Family, Division, role, job type; if it flips inside strata, it is a mix effect |
| Who is unusual vs their peers? | `peer_outliers` (median / MAD robust z on log dollars, BH q-values) | peer = UKG job title with 10+ people, else a fallback group; money is log-normal, so raw "x times the median" over-flags |
| Is a rate higher than normal? | `round_number_rate` pattern / binomial test vs the company rate + `fdr` | always compare to the population rate, never a fixed cutoff |
| Do the amounts look made up? | `benford` (population), `benford_by_group` (per person, vs population mix, distinct amounts) | population first; per person is supporting evidence only (recurring charges skew it); needs 100+ distinct amounts |
| Same thing claimed twice? | `near_duplicates` (same keys + amount, within N days, different documents) | day windows only where dates legitimately drift (airfare booking vs travel); recurring daily charges (hotel, parking) need exact date |
| Who is unusual on many measures at once? | `anomaly_iforest` (quantile-scaled, drivers as percentiles) | feed behaviour ratios, not just size; never let an anomaly score alone send someone to review |
| How long until X (approval, fill, close, exit)? | `survival` (Kaplan-Meier medians, p75 / p90, log-rank) | dropping still-open items biases durations short; KM keeps them |
| Can we predict X? | `ml_model.fit_eval` + `report` | out-of-time split, baseline first, AUC CI, calibration, no protected attributes, check leakage (features known only after the outcome) |
| What happens next month / quarter? | `forecast.run` + `report` | must beat seasonal naive in the backtest; show the 80% / 95% band, not a single line |
| What are the natural segments? | sklearn KMeans / HDBSCAN on quantile-scaled features (not wrapped yet) | name segments by their profile; check stability with a second seed |

## 3. Guardrails (non-negotiable)

1. **Baseline first.** Every model or forecast is shown next to a dumb baseline (training median, logistic regression, seasonal naive). If it does not beat it, say so and use the baseline.
2. **Out-of-time validation.** Train on older rows, test on newer. A random split is only acceptable when rows have no time order (`ml_model` prints which one it used).
3. **Uncertainty with every number.** Confidence intervals on slopes and AUCs, prediction intervals on forecasts, q-values on screens.
4. **Multiple-comparison control.** Screening hundreds of people or vendors manufactures false positives: use BH q-values (`fdr`), not raw p < .05.
5. **Effect size, not just significance.** With 20K rows everything is "significant"; report Cliff's delta, $ impact, or rate ratios.
6. **Simpson check** across Family / Division / role before claiming a group difference.
7. **Minimum n.** Peer groups 10+, per-person rate tests 10 to 15+ events, per-person Benford 100+ distinct amounts, seasonal models 24+ months.
8. **Protected attributes never as model inputs** (race, ethnicity, gender, age / birth date, veteran, disability, marital). `ml_model` raises an error. For HR models also check outcomes by group afterwards (adverse-impact check) and route results through HR leadership (eeo.md).
9. **A flag is a reason to look, not a finding.** Lists that name people say so on the first tab, carry "why flagged" in plain words, and stay restricted (CONFIDENTIAL workbook, restricted workspace; never in an Artifact, ADO, email body or general report).
10. **Explain every flag.** Each flagged row lists its drivers (signals, anomaly drivers as percentiles). No black-box scores in reports.
11. **Validate by hand.** Before sharing, open the top 5 to 10 flags in the source system (or the line-level data) and confirm the pattern is real. Concur example: the duplicate pairs really were the same item on two reports, both paid.
12. **Test competing versions and show the comparison** (advisor rule): v1 vs v2 crosstab, flagged counts per signal, what moved and why.
13. **Productionise in Fabric.** A score used by a report runs as a scheduled Fabric notebook writing a Gold table (spark-cli skill); thresholds live in one config cell; the report reads the table.

## 4. Lessons learned (tested, keep)

| Theory tested | Result | Rule now |
|---|---|---|
| "x times peer median" for high spend (v1) | flagged 136 people; on log dollars with robust z only 4 were real outliers | use `peer_outliers` on log dollars; show the multiple only as context |
| Concur role as peer group | far too broad ("Office Associate" spans desk staff to constant travellers) | UKG job title when 10+ share it, else Concur role |
| Benford per person vs theoretical curve | flagged 40% of people (recurring identical charges) | per person: compare to the population mix, distinct amounts, strict q and MAD; supporting only |
| 3-day near-duplicate window for all types | caught nightly hotels / parking at the same rate | exact date by default; window only for airfare |
| Duplicate key including vendor | missed "DELTA" vs "Delta Air Lines" | match without vendor; show vendor in the detail |
| Robust z on zero-inflated ratios in Isolation Forest | MAD = 0, z exploded (+20) and dominated drivers | quantile scaling (now the toolkit default) |
| Late claims as an irregular-spend signal | pushed 200+ people up a tier | treat late claims as compliance (own list), not fraud risk |
| Kaplan-Meier vs "paid only" medians | small difference for Concur (few open reports) | still use KM: it matters when many items are open (tickets, requisitions) |
| Same SQL, same seed, different flags (Concur 10/2026: Watch 181 vs 183) | SQL without ORDER BY returns rows in varying order; Isolation Forest samples by row position | sort rows by a stable key before any seeded model (`anomaly_iforest` now sorts by index); prove determinism by running twice |
| SARIMA vs ETS vs seasonal naive on Concur monthly spend | SARIMA MAE 7.4% vs seasonal naive 13.8% | let the backtest choose; never assume |
| Profit Fade: grouped CV vs out-of-time by job finish (10/7/2026) | logistic AUC 0.69 (grouped CV) vs 0.78 (CI .71-.84) out-of-time; boosting 0.64; but test fade rate 5% vs 13% train, so odds over-predicted ~2x and mid-job $ forecast $9.9M vs $2.3M actual | ranking can hold while dollars break: always check calibration and $ out-of-time, not just AUC; recalibrate the intercept on the recent era before quoting expected dollars |
| Split by a panel's "last month" column as the finish date | every job's spine ran to the last closed month, so 625 of 873 jobs "finished" Aug 2026 and the split was meaningless | derive the event date from the data (first month 95% complete, close month) and check its distribution before splitting |
| Checkpoints of one job on both sides of the split | leaks the job's own outcome into training | `fit_eval(..., group_col="job")`: groups placed by their latest time; it prints "0 shared" |
| Recently finished jobs as test labels | fade rate 0% within 6 months of finish, 6% at 12-24, 15% after 24 (closeout adjustments land late; troubled jobs close later) | label maturity: test only on outcomes old enough to be final, or flag a recent-era drop as possibly immature |
| `_check_features` substring match on "age" | blocked job age in months (would also block "stage", "mileage") | token match + `allow=` for non-person features named age |
| pandas pickles across a pip install | installing shap / statsmodels downgraded pandas 3.0 to 2.3; pandas-3 pickles no longer load (StringDtype) | store model data as CSV / parquet, not pickle; check versions after any pip install |
| Isotonic calibration fit on the final model's in-sample predictions (Project Risk Index, 10/7/2026) | top projects all came out 0.99 | calibrate on out-of-fold predictions (GroupKFold by project), recent era only |
| Weather as a risk driver (NASA POWER daily by ZIP, 0.5 degree grid) | raw weather "matters" only through season; anomaly vs the cell's calendar-month normal, with region + month controls, showed no significant rate change | test weather as anomaly vs normal with season controls; Open-Meteo free tier is too small for years x hundreds of sites, NASA POWER works (~1 s per point, no key) |
| Rate drivers with crew-hour offset (NB GLM, project-clustered SEs) | inspection / observation rates "raise" event rates: documentation intensity, not cause | label logging-volume features as attention signals; never advise fewer inspections |
| Open-at-month-end counts from Procore submittals | 80% of Closed submittals have no Closed At, so they look open forever | check close-date coverage by status before point-in-time counts; fall back to Distributed At / Updated At |

## 5. Worked example: Concur irregular-spend screen v2 (10/7/2026)

Project folder: DWH root `Concur Expense\` (plan + CONFIDENTIAL workbook). Steps, in order:
1. Pull 12 months of lines (exclude Transaction Type 'Parent'), report cycle (paid date from the workflow "Paid" step), monthly totals since 2018.
2. Discretionary spend = Travel, Transportation, Meals & Entertainment, gifts, per diem, employee engagement (excludes project pass-through like apartments, utilities, materials).
3. Signals: `peer_outliers` (job title, log, z >= 2.5, $25K+); `near_duplicates` ($500+ extra); weekend M&E and round-dollar binomial tests vs company rates with q < .05; mileage + fuel each > $1.5K; `anomaly_iforest` on 9 behaviour measures (top 1%); `benford_by_group` supporting; late claims as a separate compliance list.
4. Tiers: Review now = 2+ strong signals, or anomaly top 1% plus 1 strong, or $2K+ duplicates; Watch = 1 strong, anomaly top 2%, or digit pattern.
5. Result: 35 Review now, 183 Watch (v1: 51 / 175); duplicates $164K, $133K paid twice; trend +$66K / month (p < .001), no change point; 6-month forecast $48.7M; ADB / ACH approvals about 2 days slower than other Families (log-rank p < .001).
