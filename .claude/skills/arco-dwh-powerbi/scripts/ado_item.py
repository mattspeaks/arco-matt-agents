"""Create an ADO User Story + child Tasks (+ file attachments) in the Data and Analytics project.

Usage:
  python ado_item.py spec.json            # create
  python ado_item.py spec.json --dry-run  # print what would be created

spec.json:
{
  "title": "DWH: <short name>",                  # house prefix "DWH: "
  "description_html": "<p>...</p>",              # findings (verified numbers), implementation, acceptance criteria
  "sprint": "Sprint 36",                         # or "current" (looks up the team's current iteration)
  "assigned_to": null,                           # email or null (leave unassigned unless the user names someone)
  "priority": 2,
  "value_area": "Architectural",                 # or "Business"
  "attachments": ["C:/path/to/spec.md"],          # attached to the story AND every task; refer to them as "the attached <file>"
  "tasks": [{"title": "...", "description_html": "<p>...</p>"}]
}
Rules: never put OneDrive or local paths in descriptions (attach the file instead); no em/en dashes; owners are teams.
"""
import json, os, re, subprocess, sys, urllib.error, urllib.parse, urllib.request

AZ_PYTHON = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\python.exe"
ORG = "https://dev.azure.com/ArcoBusinessServices"
PROJECT = "Data and Analytics"
AREA = "Data and Analytics"
ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798"


def az(args):
    r = subprocess.run([AZ_PYTHON, "-IBm", "azure.cli"] + args, capture_output=True)
    if r.returncode != 0:
        sys.exit("az failed: " + " ".join(args[:4]) + "\n" + r.stderr.decode("utf-8", "replace"))
    out = r.stdout.decode("utf-8", "replace").strip()
    return json.loads(out) if out.startswith(("{", "[")) else out


def token():
    return az(["account", "get-access-token", "--resource", ADO_RESOURCE, "--query", "accessToken", "-o", "tsv"])


def rest(tok, url, method="GET", body=None, ctype="application/json"):
    r = urllib.request.Request(url, data=body, method=method, headers={"Authorization": "Bearer " + tok, "Content-Type": ctype})
    try:
        return json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {url} -> {e.code}: {e.read().decode()[:800]}")


def current_sprint(tok):
    proj = urllib.parse.quote(PROJECT)
    team = urllib.parse.quote(PROJECT + " Team")
    res = rest(tok, f"{ORG}/{proj}/{team}/_apis/work/teamsettings/iterations?$timeframe=current&api-version=7.1")
    return res["value"][0]["path"]


def check_text(*texts):
    for t in texts:
        if re.search(r"OneDrive|C:[\\/]Users", t or "", re.I):
            sys.exit("STOP: description contains a OneDrive/local path. Attach the file and say 'the attached <file>'.")
        if re.search("[\u2013\u2014]", t or ""):
            sys.exit("STOP: em/en dash in description.")


def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    dry = "--dry-run" in sys.argv
    check_text(spec["title"], spec["description_html"], *[t["title"] + t["description_html"] for t in spec.get("tasks", [])])
    tok = token()
    sprint = spec.get("sprint", "current")
    iteration = current_sprint(tok) if sprint == "current" else f"{PROJECT}\\{sprint}"
    print("iteration:", iteration)
    if dry:
        print(json.dumps(spec, indent=1)[:2000]); return

    common = ["--project", PROJECT, "--area", AREA, "--iteration", iteration, "-o", "json"]
    if spec.get("assigned_to"):
        common += ["--assigned-to", spec["assigned_to"]]
    story = az(["boards", "work-item", "create", "--type", "User Story", "--title", spec["title"],
                "--description", spec["description_html"], "--fields",
                f"Microsoft.VSTS.Common.Priority={spec.get('priority', 2)}",
                f"Microsoft.VSTS.Common.ValueArea={spec.get('value_area', 'Business')}"] + common)
    ids = [story["id"]]
    print("story", story["id"])
    for t in spec.get("tasks", []):
        task = az(["boards", "work-item", "create", "--type", "Task", "--title", t["title"], "--description", t["description_html"]] + common)
        az(["boards", "work-item", "relation", "add", "--id", str(task["id"]), "--relation-type", "parent",
            "--target-id", str(story["id"]), "-o", "json"])
        ids.append(task["id"]); print("task", task["id"])

    proj = urllib.parse.quote(PROJECT)
    for path in spec.get("attachments", []):
        name = os.path.basename(path)
        att = rest(tok, f"{ORG}/{proj}/_apis/wit/attachments?fileName={urllib.parse.quote(name)}&api-version=7.1", "POST",
                   open(path, "rb").read(), "application/octet-stream")
        for wid in ids:
            rest(tok, f"{ORG}/{proj}/_apis/wit/workitems/{wid}?api-version=7.1", "PATCH",
                 json.dumps([{"op": "add", "path": "/relations/-", "value": {"rel": "AttachedFile", "url": att["url"]}}]).encode(),
                 "application/json-patch+json")
        print("attached", name, "to", ids)
    print(f"{ORG}/{proj}/_workitems/edit/{story['id']}")


if __name__ == "__main__":
    main()
