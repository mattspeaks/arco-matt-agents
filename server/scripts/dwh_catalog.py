"""Read-only catalog of an ARCO Fabric DWH database: every table / view and its columns, as TSV.

Usage:  py dwh_catalog.py --db gold --out data/catalog/gold.tsv

Runs ONE fixed metadata query (INFORMATION_SCHEMA); it takes no SQL input, so it can't change anything, even though the
signed-in identity may have write rights. Auth: the user's `az login` token for https://database.windows.net (the same
pattern as the arco-dwh-powerbi skill's fabric_query.py). Output columns: object (db.schema.table), kind (TABLE/VIEW),
column, data type.
"""
import argparse, os, shutil, struct, subprocess, sys

SERVER = "jpea7wyaqnne3hiyaakbzbit4i-sren67wzqvxuzidngaf3vjto3m.datawarehouse.fabric.microsoft.com"
DATABASES = {"gold", "silver", "gold_uat"}
QUERY = """
SELECT c.TABLE_SCHEMA, c.TABLE_NAME, t.TABLE_TYPE, c.COLUMN_NAME, c.DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS c
JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
WHERE c.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA', 'queryinsights')
ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
"""


def token():
    az = shutil.which("az") or shutil.which("az.cmd")
    if not az:
        sys.exit("az CLI not found")
    r = subprocess.run([az, "account", "get-access-token", "--resource", "https://database.windows.net", "--query", "accessToken", "-o", "tsv"],
                       capture_output=True, text=True, timeout=90)
    tok = r.stdout.strip().lstrip("﻿")
    if r.returncode != 0 or not tok:
        sys.exit("No token: run `az login` and retry. " + r.stderr.strip()[:200])
    return tok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, choices=sorted(DATABASES))
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    import pyodbc
    tb = token().encode("utf-16-le")
    cs = f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={SERVER};DATABASE={a.db};Encrypt=yes;TrustServerCertificate=no"
    conn = pyodbc.connect(cs, attrs_before={1256: struct.pack(f"<I{len(tb)}s", len(tb), tb)}, timeout=30)
    rows = conn.cursor().execute(QUERY).fetchall()
    conn.close()
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write("object\tkind\tcolumn\ttype\n")
        for s, t, k, c, d in rows:
            f.write(f"{a.db}.{s}.{t}\t{'VIEW' if k == 'VIEW' else 'TABLE'}\t{c}\t{d}\n")
    os.replace(tmp, a.out)
    print(f"{a.db}: {len({(r[0], r[1]) for r in rows})} tables/views, {len(rows)} columns -> {a.out}")


if __name__ == "__main__":
    main()
