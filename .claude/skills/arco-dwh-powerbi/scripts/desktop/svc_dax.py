"""Read-only DAX against a PUBLISHED semantic model (Power BI executeQueries). Queries in the file are separated by lines
"-- NEXT"; each runs as its own request. Usage: python svc_dax.py <workspaceId> <datasetId> <dax file>"""
import json, os, re, subprocess, sys, tempfile

ws, ds, path = sys.argv[1:4]
for q in [x.strip() for x in re.split(r"(?m)^-- NEXT\s*$", open(path, encoding="utf-8").read()) if x.strip()]:
    body = os.path.join(tempfile.gettempdir(), "svc_dax_body.json")
    open(body, "w", encoding="utf-8").write(json.dumps({"queries": [{"query": q}], "serializerSettings": {"includeNulls": True}}))
    r = subprocess.run(["az", "rest", "--method", "post", "--resource", "https://analysis.windows.net/powerbi/api", "--url",
                        f"https://api.powerbi.com/v1.0/myorg/groups/{ws}/datasets/{ds}/executeQueries",
                        "--headers", "Content-Type=application/json", "--body", "@" + body],
                       capture_output=True, text=True, shell=os.name == "nt")
    os.remove(body)
    try:
        rows = json.loads(r.stdout)["results"][0]["tables"][0]["rows"]
        print("----")
        for row in rows:
            print(" | ".join(f"{k}: {v}" for k, v in row.items()))
    except Exception:
        print("ERROR:", (r.stdout or r.stderr)[-500:])
