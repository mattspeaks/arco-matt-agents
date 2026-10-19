"""Statistics toolkit for ARCO DWH deep dives. Import it (preferred) or use the CLI for quick checks.

    import os, sys; sys.path.insert(0, os.path.expanduser("~/.claude/skills/arco-dwh-powerbi/scripts"))
    import stats_toolkit as st
    df = st.load("SELECT ...", db="gold")            # or st.load(csv_path)
    st.profile(df)

Functions (all take/return pandas objects; read references/analytics-methods.md for when to use which):
    load, profile                       data in, shape / nulls / distinct / numeric summary
    robust_z, peer_outliers, fdr        outliers within a peer group (median/MAD on log scale) + Benjamini-Hochberg q-values
    benford, benford_by_group           first-digit test (chi-square + Nigrini MAD conformity), per person/vendor
    round_number_rate                   share of whole-dollar / multiple-of-N amounts vs the population rate (binomial test)
    near_duplicates                     same key + same amount within N days on different documents
    trend, changepoints                 STL decomposition, Mann-Kendall + Theil-Sen slope; PELT change points
    compare_groups                      Mann-Whitney, Cliff's delta, bootstrap CI of the median difference
    simpson_check                       does the overall gap hold inside every stratum (Family, Division, role)?
    anomaly_iforest                     multivariate anomaly score + which features drove each row
    survival                            Kaplan-Meier medians by group (keeps still-open items), log-rank test

CLI:
    python stats_toolkit.py profile  --csv x.csv
    python stats_toolkit.py benford  --csv x.csv --amount amt [--group emp]
    python stats_toolkit.py trend    --csv x.csv --date month --value amt
    python stats_toolkit.py peers    --csv x.csv --value spend --peer job --id emp
"""
import argparse, os, sys
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- data in
def load(src, db="gold"):
    """CSV path or SQL text (run with the az identity via fabric_query.connect)."""
    if isinstance(src, str) and src.lower().endswith(".csv") and os.path.exists(src):
        return pd.read_csv(src)
    from fabric_query import connect
    conn = connect(db)
    try:
        cur = conn.cursor()
        cur.execute(src)
        cols = [c[0] for c in cur.description]
        return pd.DataFrame.from_records([tuple(r) for r in cur.fetchall()], columns=cols)
    finally:
        conn.close()


def profile(df, top=5):
    rows = []
    for c in df.columns:
        s = df[c]
        r = {"column": c, "dtype": str(s.dtype), "nulls": int(s.isna().sum()), "null_%": round(100 * s.isna().mean(), 1),
             "distinct": int(s.nunique())}
        if pd.api.types.is_numeric_dtype(s) and s.notna().any():
            q = s.quantile([0, .01, .5, .99, 1])
            r.update(min=q.iloc[0], p01=q.iloc[1], median=q.iloc[2], p99=q.iloc[3], max=q.iloc[4],
                     zeros=int((s == 0).sum()), negatives=int((s < 0).sum()))
        else:
            r["top"] = "; ".join(f"{k}={v}" for k, v in s.value_counts().head(top).items())
        rows.append(r)
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- outliers
def robust_z(x, log=False):
    """(x - median) / (1.4826 * MAD). log=True for skewed money values (uses log1p of positives)."""
    x = pd.Series(x, dtype=float)
    v = np.log1p(x.clip(lower=0)) if log else x
    med = v.median()
    mad = 1.4826 * (v - med).abs().median()
    if not mad or np.isnan(mad):
        mad = v.std(ddof=0) or 1.0  # degenerate group (most values identical): fall back to SD
    return (v - med) / mad


def fdr(pvals):
    """Benjamini-Hochberg q-values (control the share of false flags when screening many people)."""
    p = np.asarray(pvals, dtype=float)
    q = np.full_like(p, np.nan)
    ok = ~np.isnan(p)
    if ok.any():
        from statsmodels.stats.multitest import multipletests
        q[ok] = multipletests(p[ok], method="fdr_bh")[1]
    return q


def peer_outliers(df, value, peer, id_col=None, min_n=10, log=True, fallback_peer=None):
    """Robust z of `value` within its peer group, one-sided p-value (high side) and BH q-value.
    Groups smaller than min_n use `fallback_peer` (e.g. Concur role) or are left unscored."""
    d = df.copy()
    d["_peer"] = d[peer].fillna("")
    n = d.groupby("_peer")[value].transform("count")
    if fallback_peer is not None:
        small = (n < min_n) | (d["_peer"] == "")
        d.loc[small, "_peer"] = "fallback: " + d.loc[small, fallback_peer].fillna("").astype(str)
        n = d.groupby("_peer")[value].transform("count")
    d["peer_group"], d["peer_n"] = d["_peer"], n
    d["peer_median"] = d.groupby("_peer")[value].transform("median")
    d["robust_z"] = d.groupby("_peer")[value].transform(lambda s: robust_z(s, log=log))
    d.loc[d.peer_n < min_n, "robust_z"] = np.nan
    d["p_high"] = stats.norm.sf(d["robust_z"])
    d["q_high"] = fdr(d["p_high"])
    return d.drop(columns="_peer")


# ---------------------------------------------------------------- forensic amount tests
BENFORD = np.log10(1 + 1 / np.arange(1, 10))


def _first_digit(a):
    a = pd.Series(a, dtype=float).abs()
    a = a[a >= 10]  # Nigrini: drop tiny amounts
    return (a / 10 ** np.floor(np.log10(a))).astype(int).clip(1, 9)


def benford(amounts):
    """First-digit test. Returns (table, summary). MAD conformity (Nigrini): <.006 close, <.012 acceptable,
    <.015 marginal, else nonconformity. Needs ~300+ amounts to mean anything."""
    d = _first_digit(amounts)
    n = len(d)
    obs = d.value_counts().reindex(range(1, 10), fill_value=0).values
    exp = BENFORD * n
    tab = pd.DataFrame({"digit": range(1, 10), "observed": obs, "observed_%": obs / max(n, 1), "benford_%": BENFORD})
    tab["z"] = (tab["observed_%"] - BENFORD) / np.sqrt(BENFORD * (1 - BENFORD) / max(n, 1))
    mad = float(np.mean(np.abs(tab["observed_%"] - BENFORD))) if n else np.nan
    chi2, p = stats.chisquare(obs, exp) if n else (np.nan, np.nan)
    verdict = ("too few" if n < 300 else "close" if mad < .006 else "acceptable" if mad < .012
               else "marginal" if mad < .015 else "nonconformity")
    return tab, {"n": n, "mad": mad, "chi2": chi2, "p": p, "verdict": verdict}


def benford_by_group(df, amount, group, min_n=100, expected="population", dedupe=True):
    """First-digit deviation per person/vendor; rank who deviates most. Small groups are unreliable: min_n >= 100.
    expected="population" (default) compares each group to the whole population's digit mix, which removes
    company-wide shape (fixed allowances, price points); "benford" uses the theoretical curve.
    dedupe=True counts each distinct amount once per group, so recurring identical charges (monthly bills,
    the same flight) don't look like manipulation. Tested on Concur 10/2026: theoretical + no dedupe flagged
    40% of associates (useless); population + dedupe is the default."""
    d0 = df[[group, amount]].dropna()
    if dedupe:
        d0 = d0.drop_duplicates()
    ref = BENFORD if expected == "benford" else \
        _first_digit(d0[amount]).value_counts(normalize=True).reindex(range(1, 10), fill_value=0).values
    out = []
    for g, s in d0.groupby(group)[amount]:
        d = _first_digit(s)
        if len(d) < min_n:
            continue
        o = d.value_counts(normalize=True).reindex(range(1, 10), fill_value=0).values
        chi2, p = stats.chisquare(o * len(d), ref * len(d))
        top = int(np.argmax(o - ref)) + 1
        out.append({group: g, "n": len(d), "benford_mad": float(np.mean(np.abs(o - ref))), "p": p,
                    "most_over_digit": top})
    r = pd.DataFrame(out)
    if len(r):
        r["q"] = fdr(r["p"])
        r = r.sort_values("benford_mad", ascending=False)
    return r


def round_number_rate(df, amount, group, multiple=50, min_amount=100, min_n=10):
    """Share of amounts >= min_amount that are whole multiples of `multiple`, vs the population rate.
    Binomial test per group + BH q-value."""
    d = df[df[amount] >= min_amount].copy()
    d["_round"] = (d[amount] % multiple == 0)
    base = d["_round"].mean()
    g = d.groupby(group)["_round"].agg(n="count", k="sum").reset_index()
    g = g[g.n >= min_n]
    g["rate"] = g.k / g.n
    g["base_rate"] = base
    g["p"] = [stats.binomtest(int(k), int(n), base, alternative="greater").pvalue for k, n in zip(g.k, g.n)]
    g["q"] = fdr(g["p"])
    return g.sort_values("q")


def near_duplicates(df, keys, amount, date, doc, days=0, min_amount=25):
    """Rows sharing `keys` + amount, dated within `days`, on different documents (reports/invoices).
    Returns the rows with a dup_set id. days=0 = exact date."""
    d = df[df[amount] >= min_amount].copy().sort_values(keys + [amount, date])
    d[date] = pd.to_datetime(d[date])
    d["_g"] = d.groupby(keys + [amount]).ngroup()
    gap = d.groupby("_g")[date].diff().dt.days
    d["_new"] = gap.isna() | (gap > days)
    d["dup_set"] = d["_new"].cumsum()
    sets = d.groupby("dup_set")[doc].nunique()
    d = d[d.dup_set.isin(sets[sets > 1].index)]
    return d.drop(columns=["_g", "_new"])


# ---------------------------------------------------------------- trends
def trend(df, date, value, freq="MS", period=12, agg="sum"):
    """Aggregate to a regular series, STL-decompose (when 2+ seasons), Mann-Kendall test on the
    seasonally adjusted series, Theil-Sen slope per period. Returns (series_df, summary)."""
    s = df.assign(_d=pd.to_datetime(df[date])).set_index("_d")[value].resample(freq).agg(agg)
    out = pd.DataFrame({"value": s})
    adj = s.copy()
    if len(s) >= 2 * period:
        from statsmodels.tsa.seasonal import STL
        r = STL(s, period=period, robust=True).fit()
        out["trend"], out["seasonal"], out["resid"] = r.trend, r.seasonal, r.resid
        adj = s - r.seasonal
    t = np.arange(len(adj))
    tau, p = stats.kendalltau(t, adj.values)
    slope, intercept, lo, hi = stats.theilslopes(adj.values, t)
    base = abs(adj.mean()) or 1
    return out, {"periods": len(s), "kendall_tau": tau, "p": p, "slope_per_period": slope, "slope_95ci": (lo, hi),
                 "slope_%_of_mean": 100 * slope / base, "seasonal_adjusted": len(s) >= 2 * period,
                 "verdict": "rising" if p < .05 and slope > 0 else "falling" if p < .05 and slope < 0 else "no clear trend"}


def changepoints(series, penalty=None, model="rbf", min_size=3):
    """PELT change points on a 1-D series (index = dates). Returns the dates where the level shifts."""
    import ruptures as rpt
    y = np.asarray(series, dtype=float).reshape(-1, 1)
    pen = penalty if penalty is not None else 3 * np.log(len(y))
    bk = rpt.Pelt(model=model, min_size=min_size).fit(y).predict(pen=pen)[:-1]
    idx = list(getattr(series, "index", range(len(y))))
    return [idx[b] for b in bk]


# ---------------------------------------------------------------- comparisons
def compare_groups(a, b, n_boot=2000, seed=0):
    """Two samples (e.g. approval hours: Division X vs everyone else). Non-parametric."""
    a, b = pd.Series(a).dropna().values, pd.Series(b).dropna().values
    u, p = stats.mannwhitneyu(a, b, alternative="two-sided")
    cliffs = 2 * u / (len(a) * len(b)) - 1
    rng = np.random.default_rng(seed)
    diffs = [np.median(rng.choice(a, len(a))) - np.median(rng.choice(b, len(b))) for _ in range(n_boot)]
    size = "negligible" if abs(cliffs) < .147 else "small" if abs(cliffs) < .33 else "medium" if abs(cliffs) < .474 else "large"
    return {"n_a": len(a), "n_b": len(b), "median_a": np.median(a), "median_b": np.median(b),
            "median_diff": np.median(a) - np.median(b), "median_diff_95ci": tuple(np.percentile(diffs, [2.5, 97.5])),
            "mann_whitney_p": p, "cliffs_delta": cliffs, "effect": size}


def simpson_check(df, outcome, group, strata, weight=None):
    """Rate/mean of `outcome` by `group` overall and inside each stratum. If the direction flips in
    most strata, the overall gap is a mix effect, not a real difference."""
    f = (lambda x: np.average(x[outcome], weights=x[weight])) if weight else (lambda x: x[outcome].mean())
    overall = df.groupby(group).apply(f, include_groups=False).rename("overall")
    by = df.groupby([strata, group]).apply(f, include_groups=False).unstack(group)
    return overall, by


# ---------------------------------------------------------------- multivariate anomaly
def anomaly_iforest(df, features, id_col=None, log_cols=(), contamination="auto", seed=0, driver_pct=0.97):
    """Isolation Forest on quantile-normalised features. Adds anomaly_score (0-1 percentile, higher = more unusual)
    and top_drivers (features where the row sits at or above the `driver_pct` percentile) so every flag is explainable.
    Quantile scaling, not robust z: behaviour ratios are zero-inflated (most people have 0 duplicates, 0 late claims),
    MAD = 0 and robust z explodes (seen on Concur 10/2026). log_cols kept for API compatibility (ranks ignore it)."""
    from sklearn.ensemble import IsolationForest
    from sklearn.preprocessing import QuantileTransformer
    df = df.sort_index()          # SQL row order varies; IsolationForest samples by position, so sort for repeatable flags
    X = df[features].astype(float).fillna(0).copy()
    Q = QuantileTransformer(output_distribution="normal", n_quantiles=min(1000, len(X)), random_state=seed).fit_transform(X)
    m = IsolationForest(n_estimators=500, contamination=contamination, random_state=seed).fit(Q)
    out = df.copy()
    out["anomaly_score"] = pd.Series(-m.score_samples(Q), index=df.index).rank(pct=True)
    pct = X.rank(pct=True)
    out["top_drivers"] = [", ".join(f"{c} (p{int(pct.at[i, c] * 100)})" for c in pct.loc[i].nlargest(3).index
                                    if pct.at[i, c] >= driver_pct and X.at[i, c] > 0) for i in X.index]
    return out


# ---------------------------------------------------------------- time to event
def survival(df, duration, event, group=None):
    """Kaplan-Meier: median time to event keeping still-open items (event=0) instead of dropping them.
    Returns (medians_df, logrank_p or None)."""
    from lifelines import KaplanMeierFitter
    from lifelines.statistics import multivariate_logrank_test
    rows = []
    groups = [(None, df)] if group is None else list(df.groupby(group))
    for g, d in groups:
        k = KaplanMeierFitter().fit(d[duration], d[event])
        rows.append({"group": g if g is not None else "all", "n": len(d), "events": int(d[event].sum()),
                     "median": k.median_survival_time_,
                     "p75": k.percentile(0.25), "p90": k.percentile(0.10)})
    p = None
    if group is not None and df[group].nunique() > 1:
        p = multivariate_logrank_test(df[duration], df[group], df[event]).p_value
    return pd.DataFrame(rows), p


# ---------------------------------------------------------------- CLI
def _cli():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["profile", "benford", "trend", "peers"])
    ap.add_argument("--csv", required=True)
    ap.add_argument("--amount"); ap.add_argument("--group"); ap.add_argument("--date"); ap.add_argument("--value")
    ap.add_argument("--peer"); ap.add_argument("--id")
    a = ap.parse_args()
    df = pd.read_csv(a.csv)
    pd.set_option("display.width", 220)
    if a.cmd == "profile":
        print(profile(df).to_string(index=False))
    elif a.cmd == "benford":
        tab, s = benford(df[a.amount]); print(tab.round(4).to_string(index=False)); print(s)
        if a.group:
            print(benford_by_group(df, a.amount, a.group).head(25).to_string(index=False))
    elif a.cmd == "trend":
        out, s = trend(df, a.date, a.value); print(out.tail(24).round(1).to_string()); print(s)
        print("change points:", changepoints(out["value"]))
    elif a.cmd == "peers":
        r = peer_outliers(df, a.value, a.peer, a.id)
        print(r.sort_values("q_high").head(30).to_string(index=False))


if __name__ == "__main__":
    _cli()
