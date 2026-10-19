"""Gold load health check (S2G_Full_Daily_PL / Gold_UAT_Daily_PL).

Usage:
  python pipeline_health.py            # latest run vs the previous run + source-view health
  python pipeline_health.py --views    # only test every materialized_etl source view (schema drift check)

What it reports:
  1. Latest two runs in gold.dbo.pipeline_execution_log (status values are UPPER CASE: 'SUCCESS' / 'FAILED'; collation is
     case-sensitive, so never filter on 'Success').
  2. Tables loaded in the previous run but missing from the latest run (a crash often logs no FAILED row; the missing table
     is the one that broke ForEach_Table).
  3. FAILED rows with their error text.
  4. Every source view the loader reads (gold.config_pipeline.gold_objects -> materialized_etl.<table>_vw) opened with
     SELECT TOP 0 *. A view that errors (e.g. "Invalid column name") is silver schema drift: a source column was dropped or
     renamed upstream. The gold table keeps yesterday's rows until the view is fixed.
"""
import argparse, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fabric_query import connect  # noqa: E402


def check_views(cur):
    cur.execute("SELECT schema_name, table_name, source_view_schema, source_view_name, is_active FROM config_pipeline.gold_objects ORDER BY execution_order")
    rows = cur.fetchall()
    bad = []
    for s, t, vs, vn, active in rows:
        try:
            cur.execute(f"SELECT TOP 0 * FROM [{vs}].[{vn}]")
            cur.fetchall()
        except Exception as e:
            import re
            parts = [p.split(" (")[0].strip() for p in str(e).split("[SQL Server]")[1:]]
            msg = " | ".join(dict.fromkeys(p for p in parts if p)) or str(e)[:300]
            bad.append((s, t, vn, active, msg))
    print(f"source views checked: {len(rows)}; failing: {len(bad)}")
    for s, t, vn, active, msg in bad:
        print(f"  BROKEN  {s}.{t}  <- materialized_etl.{vn}{'' if active else ' (inactive)'}: {msg}")
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--views", action="store_true")
    a = ap.parse_args()
    cur = connect("gold").cursor()
    if not a.views:
        cur.execute("SELECT TOP 2 run_id, MIN(run_date), MAX(run_date), COUNT(*), SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) "
                    "FROM dbo.pipeline_execution_log GROUP BY run_id ORDER BY MIN(run_date) DESC")
        runs = cur.fetchall()
        for r in runs:
            print(f"run {r[0]}: {r[1]:%Y-%m-%d %H:%M} -> {r[2]:%H:%M} UTC  tables={r[3]}  failed_rows={r[4]}")
        if len(runs) == 2:
            latest, prev = runs[0][0], runs[1][0]
            cur.execute("SELECT schema_name + '.' + table_name FROM dbo.pipeline_execution_log WHERE run_id = ? "
                        "EXCEPT SELECT schema_name + '.' + table_name FROM dbo.pipeline_execution_log WHERE run_id = ?", prev, latest)
            missing = [x[0] for x in cur.fetchall()]
            print("missing from latest run:", missing or "none")
            cur.execute("SELECT run_date, schema_name, table_name, LEFT(error_message, 400) FROM dbo.pipeline_execution_log "
                        "WHERE run_id = ? AND status = 'FAILED'", latest)
            for r in cur.fetchall():
                print("  FAILED", r[1] + "." + r[2], r[3])
            cur.execute("SELECT TOP 1 run_date, schema_name, table_name FROM dbo.pipeline_execution_log WHERE run_id = ? ORDER BY run_date DESC", latest)
            last = cur.fetchone()
            print(f"last logged step: {last[1]}.{last[2]} at {last[0]:%H:%M:%S} UTC (the next table in execution order is the likely failure)")
    check_views(cur)


if __name__ == "__main__":
    main()
