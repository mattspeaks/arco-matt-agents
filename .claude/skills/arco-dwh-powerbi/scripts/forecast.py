"""Backtested monthly forecasts for ARCO DWH series (spend, hours, headcount, tickets, revenue).

Every candidate is scored by rolling-origin backtest against the seasonal-naive baseline (same month last
year). Only recommend a model that beats it. Output includes 80% / 95% prediction intervals.

    python forecast.py --csv monthly.csv --date month --value amount --horizon 6
    python forecast.py --sql "SELECT ... month, SUM(x) amount ..." --db gold --date month --value amount

Library: import forecast as fc; res = fc.run(series, horizon=6); print(fc.report(res))
Needs 24+ months for seasonal models; with less it falls back to non-seasonal ETS and says so.
"""
import argparse, os, sys, warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _models(y, h, season):
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    from statsmodels.tsa.statespace.sarimax import SARIMAX
    seasonal = season if len(y) >= 2 * season else None
    out = {}
    if seasonal:
        out["seasonal_naive"] = lambda tr: np.tile(tr.values[-season:], h // season + 1)[:h]
    out["naive_last"] = lambda tr: np.repeat(tr.values[-1], h)
    out["ets"] = lambda tr: ExponentialSmoothing(tr, trend="add", damped_trend=True,
                                                 seasonal="add" if seasonal and len(tr) >= 2 * season else None,
                                                 seasonal_periods=seasonal).fit().forecast(h).values
    out["sarima"] = lambda tr: SARIMAX(tr, order=(1, 1, 1),
                                       seasonal_order=(0, 1, 1, season) if seasonal and len(tr) >= 2 * season + 2 else (0, 0, 0, 0)
                                       ).fit(disp=False).forecast(h).values
    return out, seasonal


def backtest(y, h=3, season=12, folds=6):
    models, seasonal = _models(y, h, season)
    rows = []
    for k in range(folds, 0, -1):
        end = len(y) - k * h  # origins step back h months at a time; each fold tests the next h months
        tr, te = y.iloc[:end], y.iloc[end:end + h]
        if len(te) == 0 or len(tr) < max(12, (2 * season if seasonal else 6)):
            continue
        for nm, f in models.items():
            try:
                p = f(tr)[:len(te)]
                rows.append({"model": nm, "origin": tr.index[-1], "mae": np.mean(np.abs(te.values - p)),
                             "mape": np.mean(np.abs((te.values - p) / np.where(te.values == 0, np.nan, te.values))) * 100})
            except Exception:
                pass
    bt = pd.DataFrame(rows)
    return bt.groupby("model")[["mae", "mape"]].mean().sort_values("mae") if len(bt) else bt, seasonal


def run(y, horizon=6, season=12, folds=6):
    y = y.asfreq("MS").fillna(0) if isinstance(y.index, pd.DatetimeIndex) else y
    scores, seasonal = backtest(y, h=min(horizon, 3), season=season, folds=folds)
    best = scores.index[0] if len(scores) else "ets"
    from statsmodels.tsa.statespace.sarimax import SARIMAX
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    idx = pd.date_range(y.index[-1] + pd.offsets.MonthBegin(), periods=horizon, freq="MS")
    if best == "sarima":
        r = SARIMAX(y, order=(1, 1, 1), seasonal_order=(0, 1, 1, season) if seasonal else (0, 0, 0, 0)).fit(disp=False)
        f = r.get_forecast(horizon); mean = f.predicted_mean.values
        ci80, ci95 = f.conf_int(alpha=.2).values, f.conf_int(alpha=.05).values
    else:
        models, _ = _models(y, horizon, season)
        mean = models[best](y)
        if best == "ets":
            fit = ExponentialSmoothing(y, trend="add", damped_trend=True, seasonal="add" if seasonal else None,
                                       seasonal_periods=seasonal).fit()
            sd = np.std(fit.resid)
        else:
            sd = np.std(np.diff(y.values, n=season if best == "seasonal_naive" else 1))
        widen = np.sqrt(np.arange(1, horizon + 1))
        ci80 = np.c_[mean - 1.2816 * sd * widen, mean + 1.2816 * sd * widen]
        ci95 = np.c_[mean - 1.96 * sd * widen, mean + 1.96 * sd * widen]
    fc = pd.DataFrame({"forecast": mean, "lo80": ci80[:, 0], "hi80": ci80[:, 1], "lo95": ci95[:, 0], "hi95": ci95[:, 1]}, index=idx)
    base = "seasonal_naive" if "seasonal_naive" in scores.index else "naive_last"
    return {"history": y, "backtest": scores, "best": best, "baseline": base, "forecast": fc, "seasonal": bool(seasonal)}


def report(res):
    s = res["backtest"]
    lift = ""
    if len(s) and res["baseline"] in s.index:
        b, m = s.loc[res["baseline"], "mae"], s.loc[res["best"], "mae"]
        lift = f"Best '{res['best']}' MAE {m:,.0f} vs baseline '{res['baseline']}' {b:,.0f} ({(1 - m / b) * 100:+.0f}% better)"
    return "\n".join([f"Months of history: {len(res['history'])}  seasonal: {res['seasonal']}",
                      "Backtest (rolling origin, mean error):", s.round(1).to_string(), lift,
                      "Forecast:", res["forecast"].round(0).to_string()])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv"); ap.add_argument("--sql"); ap.add_argument("--db", default="gold")
    ap.add_argument("--date", required=True); ap.add_argument("--value", required=True)
    ap.add_argument("--horizon", type=int, default=6)
    a = ap.parse_args()
    if a.csv:
        df = pd.read_csv(a.csv)
    else:
        from stats_toolkit import load
        df = load(a.sql, a.db)
    y = df.assign(_d=pd.to_datetime(df[a.date])).set_index("_d")[a.value].astype(float).resample("MS").sum()
    print(report(run(y, a.horizon)))
