"""Fabric REST helpers for Gold semantic model work (stdlib only)."""
import base64, json, os, time, urllib.request, urllib.error, subprocess

WS = "7edf4894-85d9-4c6f-a06d-300bbaa66edb"
API = "https://api.fabric.microsoft.com/v1"
HDR_SKILL = {"x-ms-fabric-skill": "semantic-model-authoring"}


def token(resource="https://api.fabric.microsoft.com"):
    return subprocess.check_output(
        ["az", "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        shell=True, text=True).strip()


_TOK = None


def req(url, method="GET", body=None, raw=False):
    global _TOK
    _TOK = _TOK or token()
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, method=method, data=data,
                               headers={"Authorization": "Bearer " + _TOK, "Content-Type": "application/json", **HDR_SKILL})
    try:
        resp = urllib.request.urlopen(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {url} -> {e.code}: {e.read().decode()[:2000]}")
    b = resp.read()
    return resp, (json.loads(b) if b and not raw else b)


def lro(resp, payload):
    if resp.status != 202:
        return payload
    loc = resp.headers["Location"]
    while True:
        time.sleep(int(resp.headers.get("Retry-After", 3) or 3))
        r2, st = req(loc)
        if st.get("status") in ("Succeeded", "Failed", "Cancelled"):
            break
    if st["status"] != "Succeeded":
        raise RuntimeError(json.dumps(st)[:3000])
    try:
        _, res = req(loc + "/result")
        return res
    except RuntimeError as e:
        if "404" in str(e) or "400" in str(e):
            return st
        raise


def models():
    _, b = req(f"{API}/workspaces/{WS}/semanticModels")
    return {m["displayName"]: m["id"] for m in b["value"]}


def get_definition(model_id, out_dir):
    resp, b = req(f"{API}/workspaces/{WS}/semanticModels/{model_id}/getDefinition?format=TMDL", "POST", {})
    res = lro(resp, b)
    for p in res["definition"]["parts"]:
        fp = os.path.join(out_dir, p["path"])
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        open(fp, "wb").write(base64.b64decode(p["payload"]))
    return [p["path"] for p in res["definition"]["parts"]]


def _parts(root):
    parts = []
    for d, _, fs in os.walk(root):
        for f in fs:
            fp = os.path.join(d, f)
            rel = os.path.relpath(fp, root).replace("\\", "/")
            if rel == ".platform" and not os.path.exists(fp):
                continue
            parts.append({"path": rel, "payload": base64.b64encode(open(fp, "rb").read()).decode(), "payloadType": "InlineBase64"})
    return parts


def update_definition(model_id, root):
    parts = [p for p in _parts(root) if p["path"] != ".platform"]
    resp, b = req(f"{API}/workspaces/{WS}/semanticModels/{model_id}/updateDefinition", "POST", {"definition": {"parts": parts}})
    return lro(resp, b)


def create_model(name, root, description=""):
    parts = [p for p in _parts(root) if p["path"] != ".platform"]
    resp, b = req(f"{API}/workspaces/{WS}/semanticModels", "POST",
                  {"displayName": name, "description": description, "definition": {"parts": parts}})
    return lro(resp, b)
