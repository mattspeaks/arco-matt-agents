"""Data checks against the ARCO Fabric DWH: join match rates, grain/uniqueness, duplicates, columns.

Usage (default database gold; --db silver etc.):
  python gold_checks.py match  <fact table> "<fk col>" <dim table> "<pk col>"   # % of non-null FKs found in the dim (type-safe)
  python gold_checks.py grain  <table> "<col1>,<col2>,..."                      # rows vs distinct key (NULL-safe) + exact dup rows
  python gold_checks.py dupes  <table> "<col1>,<col2>,..." [--top 5]            # sample duplicate key groups
  python gold_checks.py cols   <table>                                          # columns + data types
  python gold_checks.py sample <table> [--top 5]

Tables are schema.table (e.g. analytics.Fact_Direct_Cost). Remember: collation is case-sensitive, names with spaces are fine
here (the script brackets them). Use these numbers in descriptions and tickets; never guess a key or a match rate.
"""
import argparse, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fabric_query import connect  # noqa: E402


def br(c):
    return "[" + c.strip().strip("[]") + "]"


def key(cols):
    return "CONCAT(" + ",'|',".join(f"ISNULL(CAST({br(c)} AS varchar(400)),'~')" for c in cols) + ")" if len(cols) > 1 \
        else f"CAST({br(cols[0])} AS varchar(400))"


def run(cur, sql):
    cur.execute(sql)
    return cur.fetchall()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["match", "grain", "dupes", "cols", "sample"])
    ap.add_argument("args", nargs="+")
    ap.add_argument("--db", default="gold")
    ap.add_argument("--top", type=int, default=5)
    a = ap.parse_args()
    cur = connect(a.db).cursor()

    if a.cmd == "match":
        fact, fk, dim, pk = a.args
        n, nul, hit = run(cur, f"""WITH d AS (SELECT DISTINCT CAST({br(pk)} AS varchar(400)) k FROM {dim} WHERE {br(pk)} IS NOT NULL)
            SELECT COUNT(*), SUM(CASE WHEN f.{br(fk)} IS NULL THEN 1 ELSE 0 END), SUM(CASE WHEN d.k IS NOT NULL THEN 1 ELSE 0 END)
            FROM {fact} f LEFT JOIN d ON d.k = CAST(f.{br(fk)} AS varchar(400))""")[0]
        nn = n - nul
        print(f"{fact}[{fk}] -> {dim}[{pk}]: rows={n:,} null={nul:,} matched={hit:,}/{nn:,} ({100*hit/nn if nn else 0:.1f}% of non-null)")
    elif a.cmd == "grain":
        t, cols = a.args[0], a.args[1].split(",")
        rows, distinct = run(cur, f"SELECT COUNT(*), COUNT(DISTINCT {key(cols)}) FROM {t}")[0]
        exact = run(cur, f"SELECT COUNT(*) FROM (SELECT DISTINCT * FROM {t}) x")[0][0]
        print(f"{t} grain {cols}: rows={rows:,} distinct_keys={distinct:,} -> {'UNIQUE' if rows == distinct else f'{rows-distinct:,} duplicate keys'}"
              f"; exact duplicate rows={rows-exact:,}")
        if rows != distinct and rows - exact == rows - distinct:
            print("  all key duplicates are exact duplicate rows (DISTINCT fixes it) - but first check the view is not dropping a source key column")
    elif a.cmd == "dupes":
        t, cols = a.args[0], a.args[1].split(",")
        sel = ", ".join(br(c) for c in cols)
        for r in run(cur, f"SELECT TOP {a.top} {sel}, COUNT(*) n FROM {t} GROUP BY {sel} HAVING COUNT(*) > 1 ORDER BY n DESC"):
            print(tuple(r))
    elif a.cmd == "cols":
        s, t = a.args[0].split(".", 1)
        for r in run(cur, f"SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='{s}' AND TABLE_NAME='{t}' ORDER BY ORDINAL_POSITION"):
            print(f"  {r[0]} ({r[1]})")
    elif a.cmd == "sample":
        cur.execute(f"SELECT TOP {a.top} * FROM {a.args[0]}")
        print([d[0] for d in cur.description])
        for r in cur.fetchall():
            print(tuple(r))


if __name__ == "__main__":
    main()
