"""Run DAX against a dataset via Power BI executeQueries. Usage: python dax.py <model name> "<DAX>" """
import json, sys, os, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fab

_PBI = None


def run(model_name, query, ids={}):
    global _PBI
    _PBI = _PBI or fab.token("https://analysis.windows.net/powerbi/api")
    if not ids:
        ids.update(fab.models())
    url = f"https://api.powerbi.com/v1.0/myorg/groups/{fab.WS}/datasets/{ids[model_name]}/executeQueries"
    body = json.dumps({"queries": [{"query": query}], "serializerSettings": {"includeNulls": True}}).encode()
    r = urllib.request.Request(url, data=body, method="POST",
                               headers={"Authorization": "Bearer " + _PBI, "Content-Type": "application/json"})
    try:
        res = json.loads(urllib.request.urlopen(r).read())
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()[:1500]}
    t = res["results"][0]
    if "error" in t:
        return {"error": t["error"]}
    return t["tables"][0]["rows"]


if __name__ == "__main__":
    print(json.dumps(run(sys.argv[1], sys.argv[2]), indent=1, default=str)[:4000])
