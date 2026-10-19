"""Safely deploy a TMDL definition folder to a Gold semantic model in the ARCO DWH workspace.

Usage:
  python deploy_model.py "<definition folder>" [--model "Gold Safety"] [--backup-dir <dir>] [--check "<DAX>"] [--lint-only]
    <definition folder> holds definition.pbism + definition/ (the getDefinition layout). Model name defaults to the folder name.

Steps (stops on the first failure, nothing partial):
  1. lint     : every relationship / calc-column / measure reference resolves; measure names unique across the WHOLE model;
                no /// directly above a `relationship` (import fails); no em/en dashes; no BOM.
  2. identity : gold SQL source = Automatic (viewer SSO, no stored credential) and the Shared Dims link = Entra SSO.
  3. backup   : getDefinition of the live model into --backup-dir/<timestamp>/<model> (default: <folder>/../_backups).
  4. before   : DAX row counts for every table the model owns (DirectQuery SQL partitions) + any --check queries.
  5. deploy   : updateDefinition (atomic: a rejected import changes nothing).
  6. after    : identity re-check + the same DAX; prints before/after side by side and flags any count that changed.

Deploy downstream models BEFORE Gold Shared Dimensions when a shared column is removed.
"""
import argparse, datetime, glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fab, dax  # noqa: E402

COL = re.compile(r"^\t(column|measure) ('([^']+)'|([^\s=]+))")


def q(n):
    return f"'{n}'" if re.search(r"[^A-Za-z0-9_]", n) else n


def read(p):
    return open(p, encoding="utf-8", newline="").read()


def lint(root):
    d = os.path.join(root, "definition")
    errors, tables, measures, owned = [], {}, {}, []
    for f in glob.glob(os.path.join(d, "**", "*.tmdl"), recursive=True):
        raw = read(f)
        if raw.startswith("﻿"):
            errors.append(f"BOM: {f}")
        if re.search("[–—]", raw):
            errors.append(f"em/en dash: {os.path.relpath(f, root)}")
    for f in glob.glob(os.path.join(d, "tables", "*.tmdl")):
        t = read(f).replace("\r\n", "\n")
        name = re.search(r"^table\s+'?([^'\n]+?)'?\s*$", t, re.M).group(1).strip()
        tables[name] = set()
        for m in re.finditer(r"^\t(column|measure) ('([^']+)'|([^\s=]+))", t, re.M):
            n = m.group(3) or m.group(4)
            tables[name].add(n)
            if m.group(1) == "measure":
                measures.setdefault(n, []).append(name)
        if "= m\n" in t and "Sql.Database" in t:
            owned.append(name)
    for n, where in measures.items():
        if len(where) > 1:
            errors.append(f"measure name '{n}' used in several tables {where} (must be unique across the model)")
    rp = os.path.join(d, "relationships.tmdl")
    if os.path.exists(rp):
        rt = read(rp).replace("\r\n", "\n")
        if re.search(r"^\s*///[^\n]*\n\s*relationship ", rt, re.M):
            errors.append("/// description above a relationship (semantic models reject it)")
        for ref in re.findall(r"(?:fromColumn|toColumn): (.+)", rt):
            tb, c = ref.strip().split(".", 1)
            if c.strip("'") not in tables.get(tb.strip("'"), set()):
                errors.append(f"relationship references missing column {ref.strip()}")
    for f in glob.glob(os.path.join(d, "tables", "*.tmdl")):
        t = read(f).replace("\r\n", "\n")
        for expr in re.findall(r"^\t(?:column|measure) [^=\n]+= (.+)$", t, re.M):
            for tb, c in re.findall(r"(\w+)\[([^\]]+)\]", expr):
                if tb in tables and c not in tables[tb]:
                    errors.append(f"{os.path.basename(f)}: {tb}[{c}] not found")
    return errors, sorted(owned)


def assert_viewer_identity(model_id):
    _, c = fab.req(f"{fab.API}/workspaces/{fab.WS}/items/{model_id}/connections")
    for x in c["value"]:
        kind = x["connectionDetails"]["type"]
        if kind == "SQL":
            if x["connectivityType"] != "Automatic":
                sys.exit(f"STOP: SQL source bound to {x['connectivityType']} {x.get('id')} (must be Automatic = viewer SSO)")
        elif kind == "AnalysisServices":
            _, conn = fab.req(f"{fab.API}/connections/{x['id']}")
            cd = conn["credentialDetails"]
            if not (cd["credentialType"] == "SingleSignOn" and cd.get("singleSignOnType") == "MicrosoftEntraID"):
                sys.exit(f"STOP: Shared Dimensions link is not Entra SSO: {cd}")
    print("identity: viewer SSO on all sources")


def counts_query(tables):
    if not tables:
        return None
    return "EVALUATE ROW(" + ", ".join(f'"{t}", COUNTROWS({q(t)})' for t in tables) + ")"


def run_checks(model, queries):
    out = []
    for qq in queries:
        r = dax.run(model, qq)
        out.append(r if isinstance(r, dict) else r[0])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--model")
    ap.add_argument("--backup-dir")
    ap.add_argument("--check", action="append", default=[], help="extra DAX query (EVALUATE ROW(...)); repeatable")
    ap.add_argument("--lint-only", action="store_true")
    a = ap.parse_args()
    root = os.path.abspath(a.folder)
    model = a.model or os.path.basename(root.rstrip("\\/"))

    errors, owned = lint(root)
    if errors:
        print("LINT FAILED:"); [print("  -", e) for e in errors]; sys.exit(1)
    print(f"lint ok ({len(owned)} owned SQL tables)")
    if a.lint_only:
        return

    ids = fab.models()
    if model not in ids:
        sys.exit(f"model '{model}' not found in ARCO DWH")
    mid = ids[model]
    assert_viewer_identity(mid)

    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    bdir = os.path.join(a.backup_dir or os.path.join(os.path.dirname(root), "_backups"), stamp, model)
    fab.get_definition(mid, bdir)
    print("backup:", bdir)

    queries = [x for x in [counts_query(owned)] + a.check if x]
    before = run_checks(model, queries)
    fab.update_definition(mid, root)
    print("deployed")
    assert_viewer_identity(mid)
    after = run_checks(model, queries)

    changed = False
    for b, af in zip(before, after):
        if "error" in af:
            print("AFTER ERROR:", af["error"][:500]); changed = True; continue
        for k in af:
            flag = "" if b.get(k) == af.get(k) else "   <-- CHANGED"
            changed |= bool(flag)
            print(f"  {k:45} before={b.get(k)!s:>16}  after={af.get(k)!s:>16}{flag}")
    print("RESULT:", "CHECK CHANGES ABOVE" if changed else "all checks unchanged")
    print("rollback if needed: python deploy_model.py", json.dumps(bdir))


if __name__ == "__main__":
    main()
