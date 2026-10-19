r"""Publish a local PBIP as a DEV copy to the user's personal "My workspace" (standing dev loop, user rule 2026-10-12).

Why: the build / QA loop no longer uses Power BI Desktop (it took the user's screen). Every in-progress report is published to
My workspace as "DEV - <name>" and tested there in a hidden browser (`powerbi-report-author preview --host service --headless`,
reset_test.mjs, headless screenshots / clicks / exports). Acceptance and production copies still need the user's go.

What it does (idempotent; same item ids every run, so the dev link stays the same):
  1. finds My workspace (type Personal) for the signed-in az identity
  2. creates or updates the semantic model "DEV - <model name>" from <pbip>\<x>.SemanticModel
  3. creates or updates the report "DEV - <report name>" from <pbip>\<y>.Report, bound byConnection to that dev model
  4. refreshes the dev model (import tables are empty after a definition update) and waits for the result; --no-refresh skips
Prints the dev report link + ids. A refresh failure about credentials means the data source in the dev model needs a one-time
sign-in by the user (Settings > Semantic model > Data source credentials, OAuth2 / SSO): report it to MGR, don't retry blindly.

Usage:
  python publish_dev.py "<folder with .Report + .SemanticModel>" [--report "<Name>.Report"] [--model "<Name>.SemanticModel"]
                        [--no-refresh]
Never point it at a non-personal workspace: it refuses anything but My workspace.
"""
import base64, glob, json, os, re, shutil, subprocess, sys, tempfile, time

API = "https://api.fabric.microsoft.com/v1"
PBI = "https://api.powerbi.com/v1.0/myorg"
PREFIX = "DEV - "


def az(*args, skill="powerbi-report-cli", verbose=False, resource="https://api.fabric.microsoft.com"):
    cmd = ["az", "rest", "--resource", resource, "--headers", f"x-ms-fabric-skill={skill}", *args]
    if verbose:
        cmd.append("--verbose")
    return subprocess.run(cmd, capture_output=True, text=True, shell=os.name == "nt")


def get(url, **kw):
    r = az("--method", "get", "--url", url, **kw)
    if r.returncode:
        sys.exit(f"GET {url} failed: {(r.stderr or r.stdout)[-400:]}")
    return json.loads(r.stdout or "{}")


def lro(r, label):
    """Follow a Fabric long-running operation; return the result body ({} when none) or None on failure."""
    log = r.stdout + r.stderr
    st = re.findall(r"Response status: (\d+)", log)
    loc = re.search(r"'Location': '([^']+)'", log)
    if not loc:
        ok = bool(st) and st[0] in ("200", "201")
        print(label, "status", st, "" if ok else (r.stdout or r.stderr)[-600:])
        return (json.loads(r.stdout) if r.stdout.strip() else {}) if ok else None
    for _ in range(120):
        s = json.loads(az("--method", "get", "--url", loc.group(1)).stdout or "{}")
        if s.get("status") in ("Succeeded", "Failed"):
            print(label, s["status"], "" if s["status"] == "Succeeded" else json.dumps(s)[:800])
            if s["status"] != "Succeeded":
                return None
            res = az("--method", "get", "--url", loc.group(1).rstrip("/") + "/result")
            return json.loads(res.stdout) if res.stdout.strip() else {}
        time.sleep(5)
    print(label, "timed out")
    return None


def my_workspace():
    ws = [w for w in get(f"{API}/workspaces").get("value", []) if w.get("type") == "Personal"]
    if len(ws) != 1:
        sys.exit(f"could not find exactly one personal workspace (found {len(ws)})")
    return ws[0]["id"]


def find_item(ws, kind, name):
    for it in get(f"{API}/workspaces/{ws}/{kind}").get("value", []):
        if it["displayName"] == name:
            return it["id"]
    return None


def folder_parts(root, top_files, sub="definition"):
    parts = []
    def add(full):
        parts.append({"path": os.path.relpath(full, root).replace("\\", "/"),
                      "payload": base64.b64encode(open(full, "rb").read()).decode(), "payloadType": "InlineBase64"})
    for f in top_files:
        if os.path.exists(os.path.join(root, f)):
            add(os.path.join(root, f))
    for r, _, files in os.walk(os.path.join(root, sub)):
        for f in files:
            add(os.path.join(r, f))
    return parts


def upsert(ws, kind, name, parts, tmp, label):
    body = os.path.join(tmp, f"{kind}.json")
    item = find_item(ws, kind, name)
    if item:
        json.dump({"definition": {"parts": parts}}, open(body, "w"))
        res = lro(az("--method", "post", "--url", f"{API}/workspaces/{ws}/{kind}/{item}/updateDefinition",
                     "--headers", "Content-Type=application/json", "--body", f"@{body}", verbose=True), f"{label} update:")
    else:
        json.dump({"displayName": name, "definition": {"parts": parts}}, open(body, "w"))
        res = lro(az("--method", "post", "--url", f"{API}/workspaces/{ws}/{kind}",
                     "--headers", "Content-Type=application/json", "--body", f"@{body}", verbose=True), f"{label} create:")
        item = (res or {}).get("id") or find_item(ws, kind, name)
    if res is None or not item:
        sys.exit(f"{label} publish failed")
    return item


def refresh(ws, model):
    """My workspace is addressed as /myorg/datasets (a groups/<personal id> URL returns 401)."""
    pbi = dict(resource="https://analysis.windows.net/powerbi/api")
    r = az("--method", "post", "--url", f"{PBI}/datasets/{model}/refreshes", "--headers",
           "Content-Type=application/json", "--body", '{"notifyOption":"NoNotification"}', verbose=True, **pbi)
    st = re.findall(r"Response status: (\d+)", r.stdout + r.stderr)
    if not st or st[0] != "202":
        print("refresh request failed:", st, (r.stdout or r.stderr)[-600:])
        return False
    for _ in range(180):
        time.sleep(10)
        h = get(f"{PBI}/datasets/{model}/refreshes?$top=1", **pbi).get("value", [{}])[0]
        if h.get("status") in ("Completed", "Failed", "Disabled", "Cancelled"):
            print("refresh", h.get("status"), "" if h.get("status") == "Completed" else h.get("serviceExceptionJson", "")[:800])
            return h.get("status") == "Completed"
    print("refresh still running after 30 min")
    return False


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    folder = a[0]
    def opt(k):
        return a[a.index(k) + 1] if k in a else None
    rep = opt("--report") or os.path.basename(glob.glob(os.path.join(folder, "*.Report"))[0])
    sm = opt("--model") or os.path.basename(glob.glob(os.path.join(folder, "*.SemanticModel"))[0])
    rep_dir, sm_dir = os.path.join(folder, rep), os.path.join(folder, sm)
    rep_name, sm_name = PREFIX + rep[:-len(".Report")], PREFIX + sm[:-len(".SemanticModel")]

    ws = my_workspace()
    tmp = tempfile.mkdtemp(prefix="pbi_dev_")
    try:
        model = upsert(ws, "semanticModels", sm_name, folder_parts(sm_dir, ["definition.pbism"]), tmp, "model")
        rdir = os.path.join(tmp, os.path.basename(rep_dir))
        shutil.copytree(rep_dir, rdir, ignore=shutil.ignore_patterns(".pbi"))
        pbir = os.path.join(rdir, "definition.pbir")
        d = json.load(open(pbir, encoding="utf-8-sig"))
        d["datasetReference"] = {"byConnection": {"connectionString": f"semanticmodelid={model}"}}
        with open(pbir, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(d, fh, indent=2)
        report = upsert(ws, "reports", rep_name, folder_parts(rdir, ["definition.pbir"], sub="definition") +
                        [p for p in folder_parts(rdir, [], sub="StaticResources")], tmp, "report")
        ok = True if "--no-refresh" in a else refresh(ws, model)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    link = f"https://app.powerbi.com/groups/me/reports/{report}"
    print(json.dumps({"workspace": ws, "model_id": model, "report_id": report, "report": rep_name, "link": link,
                      "refresh_ok": ok}, indent=2))
    if not ok:
        sys.exit(2)


if __name__ == "__main__":
    main()
