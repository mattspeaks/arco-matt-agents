"""Reconcile a report's headline numbers against the source-of-truth flag in the PUBLISHED model (house rule 2026-10-06:
Overview 'all populations' showed 2,658 while the UKG Active flag was 2,729: hidden intern filters + 3 people with job history but
no employment record). Run after every publish that touches a filter, a population rule or a headcount measure; FAIL blocks "done".

Usage:
  python reconcile.py <workspaceId> <datasetId> "<headline DAX>" "<source-of-truth DAX>" [label]
  e.g. python reconcile.py 66fb...346e 337f...9a47 "[Active Headcount]" \
       "CALCULATE ( COUNTROWS ( 'Employment Current' ), 'Employment Current'[Employment Status Text] = \"Active\" )" "HR Analytics headcount"
Evaluates both with NO filters (all populations, all families) and prints PASS / FAIL with the difference.
Remember the report side too: a measure can reconcile while a card still carries a hidden visual / page filter (check_pbir.py
reports HIDDENFILTER for those)."""
import json, os, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fab  # noqa: E402

ws, ds, head, truth = sys.argv[1:5]
label = sys.argv[5] if len(sys.argv) > 5 else "headline"
q = f'EVALUATE ROW ( "head", {head}, "truth", {truth} )'
tok = fab.token("https://analysis.windows.net/powerbi/api")
req = urllib.request.Request(f"https://api.powerbi.com/v1.0/myorg/groups/{ws}/datasets/{ds}/executeQueries",
                             data=json.dumps({"queries": [{"query": q}]}).encode(), method="POST",
                             headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
row = json.loads(urllib.request.urlopen(req).read())["results"][0]["tables"][0]["rows"][0]
h, t = row.get("[head]"), row.get("[truth]")
print(f"{'PASS' if h == t else 'FAIL'} {label}: headline {h} vs source {t} (diff {None if h is None or t is None else h - t})")
sys.exit(0 if h == t else 1)
