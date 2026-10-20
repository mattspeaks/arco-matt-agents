"""Runs ONE read-only SELECT for the app's dwh_query tool and prints the result as JSON.

Usage:  py dwh_query.py --db gold --max-rows 50 --timeout 60   (the SQL comes on stdin)

The app (server/src/dwh/query.ts) has already checked the SQL: one SELECT / WITH statement, no write or DDL keywords,
allowed databases only, no sensitive columns. This script is the second line of defence:
- it repeats the basic keyword check;
- it runs the statement inside a transaction that is ALWAYS rolled back, so nothing can stick even if a write slipped
  through (the signed-in identity can write to gold);
- it returns at most --max-rows rows, cuts long values, and stops after --timeout seconds.
Auth: the user's `az login` token for https://database.windows.net (same as dwh_catalog.py).
"""
import argparse, datetime, decimal, json, re, shutil, struct, subprocess, sys, time

SERVER = "jpea7wyaqnne3hiyaakbzbit4i-sren67wzqvxuzidngaf3vjto3m.datawarehouse.fabric.microsoft.com"
DB_NAME = re.compile(r"^[A-Za-z0-9_]{1,128}$")
FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|DENY|INTO|BULK|OPENROWSET|"
    r"OPENDATASOURCE|OPENQUERY|OPENXML|DBCC|BACKUP|RESTORE|KILL|SHUTDOWN|RECONFIGURE|DECLARE|SET|WAITFOR|USE|COPY|"
    r"BEGIN|COMMIT|ROLLBACK|SAVE|GOTO|PRINT|RAISERROR|THROW)\b|\b(sp|xp)_\w+",
    re.IGNORECASE,
)


def out(obj, code=0):
    print(json.dumps(obj, default=str))
    sys.exit(code)


def strip(sql):
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"N?'(?:[^']|'')*'", "''", sql)
    return re.sub(r"\[[^\]]*\]", "[x]", sql)


def token():
    az = shutil.which("az") or shutil.which("az.cmd")
    if not az:
        out({"error": "az CLI not found"}, 1)
    r = subprocess.run([az, "account", "get-access-token", "--resource", "https://database.windows.net", "--query", "accessToken", "-o", "tsv"],
                       capture_output=True, text=True, timeout=90)
    tok = r.stdout.strip().lstrip("﻿")
    if r.returncode != 0 or not tok:
        out({"error": "No token: run `az login` and retry. " + r.stderr.strip()[:200]}, 1)
    return tok


def cell(v):
    if v is None:
        return None
    if isinstance(v, (bytes, bytearray)):
        return f"<{len(v)} bytes>"
    if isinstance(v, decimal.Decimal):
        return float(v) if abs(v) < 1e15 else str(v)
    if isinstance(v, (datetime.date, datetime.datetime, datetime.time)):
        return v.isoformat()
    if isinstance(v, str) and len(v) > 200:
        return v[:200] + "…"
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--max-rows", type=int, default=50)
    ap.add_argument("--timeout", type=int, default=60)
    a = ap.parse_args()
    sql = sys.stdin.read().strip().rstrip(";").strip()
    bare = strip(sql)
    if not DB_NAME.match(a.db):
        out({"error": "bad database name"}, 2)
    if not re.match(r"^\s*(SELECT|WITH)\b", bare, re.I) or ";" in bare or FORBIDDEN.search(bare):
        out({"error": "refused: only a single read-only SELECT is allowed"}, 2)

    import pyodbc
    tb = token().encode("utf-16-le")
    cs = f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SERVER};DATABASE={a.db};Encrypt=yes;TrustServerCertificate=no"
    conn = pyodbc.connect(cs, attrs_before={1256: struct.pack(f"<I{len(tb)}s", len(tb), tb)}, timeout=30, autocommit=False)
    conn.timeout = a.timeout  # per-statement timeout, seconds
    t = time.time()
    try:
        cur = conn.cursor()
        cur.execute(sql)
        if cur.description is None:
            out({"error": "the statement returned no result set"}, 2)
        cols = [d[0] for d in cur.description]
        rows = cur.fetchmany(a.max_rows + 1)
        truncated = len(rows) > a.max_rows
        rows = [[cell(v) for v in r] for r in rows[: a.max_rows]]
        cur.cancel()
        out({"columns": cols, "rows": rows, "truncated": truncated, "ms": int((time.time() - t) * 1000)})
    except pyodbc.Error as e:
        msg = str(e)
        out({"error": ("timed out after %ds" % a.timeout) if "timeout" in msg.lower() else msg[:600]}, 3)
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()


if __name__ == "__main__":
    main()
