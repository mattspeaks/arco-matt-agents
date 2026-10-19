"""Run SQL against the ARCO Fabric DWH (gold / silver / gold_uat / bronze_*) using the signed-in Azure CLI identity.

Usage:
  python fabric_query.py "SELECT TOP 5 * FROM analytics.Dim_Company"             # default database gold
  python fabric_query.py --db silver "SELECT TOP 5 * FROM viewpoint.bJCCM"
  python fabric_query.py --db gold --file path\\to\\script.sql                     # runs GO-separated batches
  python fabric_query.py --db gold --csv out.csv "SELECT ..."                       # write CSV instead of JSON
  python fabric_query.py --max 200 "SELECT ..."                                     # cap printed rows (default 500)

Auth: gets an Entra token for https://database.windows.net in-process (no token file, so no PowerShell BOM gotcha).
Falls back to %TEMP%\\fabric_sql_token.txt if the az call fails. Needs ODBC Driver 18 for SQL Server + pyodbc.
"""
import argparse, csv, json, os, re, shutil, struct, subprocess, sys

SERVER = "jpea7wyaqnne3hiyaakbzbit4i-sren67wzqvxuzidngaf3vjto3m.datawarehouse.fabric.microsoft.com"
AZ_PYTHON = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\python.exe"
SQL_COPT_SS_ACCESS_TOKEN = 1256


def get_token(resource="https://database.windows.net"):
    args = ["account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"]
    cmds = []
    if os.path.exists(AZ_PYTHON):
        cmds.append([AZ_PYTHON, "-IBm", "azure.cli"] + args)
    az = shutil.which("az") or shutil.which("az.cmd")
    if az:
        cmds.append([az] + args)
    for c in cmds:
        try:
            r = subprocess.run(c, capture_output=True, text=True, timeout=90)
            tok = r.stdout.strip().lstrip("\ufeff")
            if r.returncode == 0 and tok:
                return tok
        except Exception:
            pass
    path = os.path.join(os.environ.get("TEMP", "."), "fabric_sql_token.txt")
    if os.path.exists(path):
        return open(path, encoding="utf-8-sig").read().strip()
    sys.exit("No token: run `az login` (user identity) and retry.")


def connect(db):
    import pyodbc
    tb = get_token().encode("utf-16-le")
    ts = struct.pack(f"<I{len(tb)}s", len(tb), tb)
    cs = f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SERVER};DATABASE={db};Encrypt=yes;TrustServerCertificate=no"
    return pyodbc.connect(cs, attrs_before={SQL_COPT_SS_ACCESS_TOKEN: ts}, timeout=30)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sql", nargs="?")
    ap.add_argument("--db", default="gold")
    ap.add_argument("--file")
    ap.add_argument("--csv")
    ap.add_argument("--max", type=int, default=500)
    a = ap.parse_args()
    text = open(a.file, encoding="utf-8-sig").read() if a.file else a.sql
    if not text:
        ap.error("give SQL text or --file")
    batches = [b for b in re.split(r"^\s*GO\s*$", text, flags=re.I | re.M) if b.strip()]
    conn = connect(a.db)
    cur = conn.cursor()
    for i, b in enumerate(batches):
        cur.execute(b)
        while True:
            if cur.description:
                cols = [c[0] for c in cur.description]
                rows = cur.fetchall()
                if a.csv:
                    with open(a.csv, "w", newline="", encoding="utf-8") as f:
                        w = csv.writer(f)
                        w.writerow(cols)
                        w.writerows(rows)
                    print(f"batch {i + 1}: wrote {len(rows)} rows to {a.csv}")
                else:
                    out = [cols] + [list(r) for r in rows[: a.max]]
                    print(json.dumps(out, default=str))
                    if len(rows) > a.max:
                        print(f"... {len(rows) - a.max} more rows (use --csv or --max)")
            if not cur.nextset():
                break
        conn.commit()
    conn.close()


if __name__ == "__main__":
    main()
