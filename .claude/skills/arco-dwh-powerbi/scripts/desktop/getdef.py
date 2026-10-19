"""Read-only: download a Fabric item's definition (semantic model or report) to a folder via getDefinition (LRO).
Usage: python getdef.py <workspaceId> <semanticModels|reports> <itemId> <outDir> [TMDL]"""
import base64, json, os, re, subprocess, sys, time

ws, kind, iid, out = sys.argv[1:5]
fmt = "?format=TMDL" if len(sys.argv) > 5 and kind == "semanticModels" else ""


def az(*a):
    return subprocess.run(["az", "rest", "--resource", "https://api.fabric.microsoft.com", *a, "--verbose"],
                          capture_output=True, text=True, shell=os.name == "nt")


r = az("--method", "post", "--url", f"https://api.fabric.microsoft.com/v1/workspaces/{ws}/{kind}/{iid}/getDefinition{fmt}")
loc = re.search(r"'Location': '([^']+)'", r.stdout + r.stderr)
res = None
if loc:
    for _ in range(150):
        s = json.loads(az("--method", "get", "--url", loc.group(1)).stdout or "{}")
        if s.get("status") in ("Succeeded", "Failed"):
            if s["status"] == "Succeeded":
                res = json.loads(az("--method", "get", "--url", loc.group(1).rstrip("/") + "/result").stdout)
            break
        time.sleep(4)
elif r.stdout.strip():
    res = json.loads(r.stdout)
if not res:
    sys.exit("getDefinition FAILED: " + (r.stderr or r.stdout)[-400:])
for p in res["definition"]["parts"]:
    f = os.path.join(out, p["path"])
    os.makedirs(os.path.dirname(f), exist_ok=True)
    open(f, "wb").write(base64.b64decode(p["payload"]))
print(kind, "saved:", len(res["definition"]["parts"]), "parts ->", out)
