"""Honest model scorecard for ARCO DWH predictions (classification or regression).

Always: out-of-time split (train on older rows, test on newer), a simple baseline next to the model,
uncertainty on the headline metric, and permutation importance so drivers are explainable.

    python ml_model.py --csv jobs.csv --target faded --time-col close_month --cutoff 2025-07-01 \
        --features margin_pct,pct_complete,contract_m,ob_ub_pct --cat family,job_type --id job --out scored.csv

Library use:
    import ml_model as mm
    res = mm.fit_eval(df, target="faded", features=[...], cat=[...], time_col="close_month", cutoff="2025-07-01")
    print(mm.report(res))

Classification metrics: ROC AUC (bootstrap 95% CI), PR AUC vs prevalence, precision/recall in the top k%,
Brier score + calibration table (do predicted 30% events happen ~30% of the time?).
Regression metrics: MAE / RMSE vs a naive baseline (training median), R2.
Rule: never use EEO / protected attributes (race, gender, age, veteran, disability) as features.
"""
import argparse
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (average_precision_score, brier_score_loss, mean_absolute_error, mean_squared_error,
                             r2_score, roc_auc_score)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

PROTECTED = ("race", "ethnic", "gender", "sex", "birth", "age", "veteran", "disab", "eeo", "marital")


def _check_features(features, allow=()):
    # match on word tokens, so "stage", "mileage", "percentage" are not blocked by "age"; a non-person feature that
    # really is called age (job age in months, asset age) must be passed in allow= explicitly (Profit Fade, 10/7/2026)
    import re
    def hit(f):
        toks = [t for t in re.split(r"[^a-z]+", f.lower()) if t]
        return any(t == p or (len(p) > 3 and t.startswith(p)) for t in toks for p in PROTECTED)
    bad = [f for f in features if hit(f) and f not in set(allow)]
    if bad:
        raise ValueError(f"Protected attributes are not allowed as model features: {bad} "
                         "(if one is not about a person, e.g. job age, pass it in allow=)")


def _prep(num, cat, scale):
    steps = [("num", make_pipeline(SimpleImputer(strategy="median"), *( [StandardScaler()] if scale else [])), num)]
    if cat:
        steps.append(("cat", make_pipeline(SimpleImputer(strategy="most_frequent"),
                                           OneHotEncoder(handle_unknown="ignore", min_frequency=10)), cat))
    return ColumnTransformer(steps)


def _boot_ci(f, y, p, n=1000, seed=0):
    rng = np.random.default_rng(seed); vals = []
    y, p = np.asarray(y), np.asarray(p)
    for _ in range(n):
        i = rng.integers(0, len(y), len(y))
        if len(np.unique(y[i])) > 1:
            vals.append(f(y[i], p[i]))
    return tuple(np.percentile(vals, [2.5, 97.5])) if vals else (np.nan, np.nan)


def fit_eval(df, target, features, cat=(), time_col=None, cutoff=None, test_size=0.25, task=None, seed=0,
             group_col=None, allow=()):
    """group_col: rows of one entity (job, person) must not straddle the split. With time_col, each group is placed by
    its LATEST time_col value (e.g. job close month), and the default cutoff leaves test_size of GROUPS for test."""
    features, cat = list(features), list(cat)
    _check_features(features + cat, allow)
    d = df.dropna(subset=[target]).copy()
    if time_col:
        d[time_col] = pd.to_datetime(d[time_col])
        t = d.groupby(group_col)[time_col].transform("max") if group_col else d[time_col]
        tg = d.groupby(group_col)[time_col].max() if group_col else d[time_col]
        cut = pd.to_datetime(cutoff) if cutoff else tg.quantile(1 - test_size)
        tr, te = d[t < cut], d[t >= cut]
        split = f"out-of-time: train < {cut.date()} ({len(tr)}), test >= {cut.date()} ({len(te)})"
        if group_col:
            split += f"; grouped by {group_col}: {tr[group_col].nunique()} train / {te[group_col].nunique()} test groups, 0 shared"
    elif group_col:
        g = d[group_col].drop_duplicates().sample(frac=test_size, random_state=seed)
        te = d[d[group_col].isin(g)]; tr = d.drop(te.index)
        split = f"RANDOM grouped split by {group_col} ({len(tr)}/{len(te)} rows): only acceptable when rows have no time order"
    else:
        te = d.sample(frac=test_size, random_state=seed); tr = d.drop(te.index)
        split = f"RANDOM split ({len(tr)}/{len(te)}): only acceptable when rows have no time order"
    task = task or ("class" if d[target].nunique() <= 2 else "reg")
    X = features + cat
    if task == "class":
        base = make_pipeline(_prep(features, cat, True), LogisticRegression(max_iter=2000))  # no class_weight: it inflates probabilities and breaks calibration
        model = make_pipeline(_prep(features, cat, False), HistGradientBoostingClassifier(random_state=seed, max_iter=300,
                                                                                          learning_rate=0.05, l2_regularization=1.0))
    else:
        base = make_pipeline(_prep(features, cat, True), Ridge())
        model = make_pipeline(_prep(features, cat, False), HistGradientBoostingRegressor(random_state=seed, max_iter=300,
                                                                                         learning_rate=0.05))
    base.fit(tr[X], tr[target]); model.fit(tr[X], tr[target])
    res = {"task": task, "split": split, "n_train": len(tr), "n_test": len(te), "features": X}
    if task == "class":
        y = te[target].astype(int).values
        pb, pm = base.predict_proba(te[X])[:, 1], model.predict_proba(te[X])[:, 1]
        res["prevalence"] = y.mean()
        for nm, p in (("baseline_logistic", pb), ("gradient_boosting", pm)):
            k = max(1, int(.1 * len(y))); top = np.argsort(-p)[:k]
            res[nm] = {"roc_auc": roc_auc_score(y, p), "roc_auc_95ci": _boot_ci(roc_auc_score, y, p),
                       "pr_auc": average_precision_score(y, p), "brier": brier_score_loss(y, p),
                       "precision_top10%": y[top].mean(), "recall_top10%": y[top].sum() / max(y.sum(), 1)}
        best = max(("baseline_logistic", pb), ("gradient_boosting", pm), key=lambda t: res[t[0]]["roc_auc"])
        res["best"] = best[0]
        cal = pd.DataFrame({"p": best[1], "y": y}); cal["bin"] = pd.qcut(cal.p, 10, duplicates="drop")
        res["calibration"] = cal.groupby("bin", observed=True).agg(predicted=("p", "mean"), actual=("y", "mean"), n=("y", "size"))
        scorer = "roc_auc"
    else:
        y = te[target].values
        naive = np.full(len(y), tr[target].median())
        for nm, p in (("naive_median", naive), ("baseline_ridge", base.predict(te[X])), ("gradient_boosting", model.predict(te[X]))):
            res[nm] = {"mae": mean_absolute_error(y, p), "rmse": mean_squared_error(y, p) ** .5, "r2": r2_score(y, p)}
        res["best"] = min(("baseline_ridge", "gradient_boosting"), key=lambda n: res[n]["mae"])
        scorer = "neg_mean_absolute_error"
    est = model if res["best"] == "gradient_boosting" else base
    pi = permutation_importance(est, te[X], te[target], scoring=scorer, n_repeats=10, random_state=seed)
    res["importance"] = pd.DataFrame({"feature": X, "importance": pi.importances_mean, "sd": pi.importances_std}) \
        .sort_values("importance", ascending=False)
    res["model"] = est
    return res


def report(res):
    lines = [f"Task: {res['task']}   Split: {res['split']}"]
    if res["task"] == "class":
        lines.append(f"Test prevalence: {res['prevalence']:.1%} (PR AUC of a random model = this)")
        for nm in ("baseline_logistic", "gradient_boosting"):
            m = res[nm]
            lines.append(f"  {nm:18s} AUC {m['roc_auc']:.3f} (95% CI {m['roc_auc_95ci'][0]:.3f}-{m['roc_auc_95ci'][1]:.3f})  "
                         f"PR AUC {m['pr_auc']:.3f}  Brier {m['brier']:.3f}  top10% precision {m['precision_top10%']:.1%} "
                         f"recall {m['recall_top10%']:.1%}")
        lines.append(f"Best: {res['best']}. AUC guide: .5 coin flip, .6-.7 weak, .7-.8 useful, .8+ strong (check for leakage).")
        lines.append("Calibration (predicted vs actual by decile):\n" + res["calibration"].round(3).to_string())
    else:
        for nm in ("naive_median", "baseline_ridge", "gradient_boosting"):
            m = res[nm]; lines.append(f"  {nm:18s} MAE {m['mae']:,.2f}  RMSE {m['rmse']:,.2f}  R2 {m['r2']:.3f}")
        lines.append(f"Best: {res['best']} (must beat naive_median to be worth using)")
    lines.append("Permutation importance (test set):\n" + res["importance"].head(15).round(4).to_string(index=False))
    return "\n".join(lines)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True); ap.add_argument("--target", required=True)
    ap.add_argument("--features", required=True); ap.add_argument("--cat", default="")
    ap.add_argument("--time-col"); ap.add_argument("--cutoff"); ap.add_argument("--id"); ap.add_argument("--out")
    a = ap.parse_args()
    df = pd.read_csv(a.csv)
    feats = [f for f in a.features.split(",") if f]; cats = [c for c in a.cat.split(",") if c]
    r = fit_eval(df, a.target, feats, cats, a.time_col, a.cutoff)
    print(report(r))
    if a.out:
        m = r["model"]
        df["score"] = m.predict_proba(df[feats + cats])[:, 1] if r["task"] == "class" else m.predict(df[feats + cats])
        df.to_csv(a.out, index=False); print("wrote", a.out)
