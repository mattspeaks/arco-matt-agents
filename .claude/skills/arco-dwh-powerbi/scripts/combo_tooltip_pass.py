"""Every series on hover (user rule 2026-10-08). Power BI combo charts (columns + lines) and multi-series column / bar charts
show only the hovered series and never draw the line chart's vertical hover line. Adding the series to the Tooltips role
repeats the hovered series (tested: "Hires 217" twice), so instead each such chart gets its own hidden report-page tooltip:
a small house-style table with the category (+ legend) and EVERY series measure, wired as the chart's tooltip (type Canvas).
Hovering a column or a line marker then shows all values for that month / year. Pure line / area charts are skipped (they
already draw the vertical line with every series).

Usage:  python combo_tooltip_pass.py "<path to .Report>" [...]        (idempotent)
Library: apply(files) where files = {"definition/pages/<p>/visuals/<v>/visual.json": dict, ...} (local or service parts);
         returns the number of charts wired; adds page.json / visual.json entries and updates definition/pages/pages.json."""
import glob, hashlib, json, os, sys

COMBO = {"lineClusteredColumnComboChart", "lineStackedColumnComboChart"}
MULTI = {"clusteredColumnChart", "clusteredBarChart", "columnChart", "barChart", "stackedColumnChart", "stackedBarChart",
         "hundredPercentStackedColumnChart", "hundredPercentStackedBarChart"}
PAGE_SCHEMA = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json"
VIS_SCHEMA = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.11.0/schema.json"
CAT_W, SER_W, VAL_W = 110, 130, 92


def lit(v): return {"expr": {"Literal": {"Value": v}}}
def color(h): return {"solid": {"color": lit(f"'{h}'")}}
def _key(p): return json.dumps(p.get("field"), sort_keys=True)


def wants(v):
    t = v.get("visualType"); qs = v.get("query", {}).get("queryState", {})
    return t in COMBO or (t in MULTI and len(qs.get("Y", {}).get("projections", [])) >= 2)


def title_of(v):
    t = v.get("visualContainerObjects", {}).get("title", [{}])[0].get("properties", {}).get("text", {})
    return t.get("expr", {}).get("Literal", {}).get("Value", "''").strip("'").replace("''", "'") or "Details"


def table(name, title, cats, sers, vals):
    cols = cats + sers + vals
    widths = [CAT_W] * len(cats) + [SER_W] * len(sers) + [VAL_W] * len(vals)
    w, h = sum(widths) + 60, 112                     # +60: borders + scrollbar gutter (tested: +30 showed a horizontal scrollbar)
    grid = {"outlineStyle": lit("15D"), "outlineColor": color("#000000")}
    proj = [{k: c[k] for k in ("field", "queryRef", "nativeQueryRef", "displayName") if k in c} for c in cols]
    vis = {"$schema": VIS_SCHEMA, "name": name, "position": {"x": 6, "y": 6, "z": 1000, "height": h - 12, "width": w - 12, "tabOrder": 1000},
           "visual": {"visualType": "tableEx", "query": {"queryState": {"Values": {"projections": proj}}},
                      "objects": {
                          "grid": [{"properties": {"gridHorizontalColor": color("#000000"), "gridVertical": lit("true"),
                                                   "gridVerticalColor": color("#000000"), "outlineWeight": lit("1D"), **grid}}],
                          "columnHeaders": [{"properties": {"backColor": color("#003865"), "fontColor": color("#FFFFFF"), "fontSize": lit("9D"),
                                                            "wordWrap": lit("true"), "autoSizeColumnWidth": lit("false"), **grid}}],
                          "values": [{"properties": {"fontSize": lit("9D"), "wordWrap": lit("true"), "fontColorPrimary": color("#000000"),
                                                     "fontColorSecondary": color("#000000"), **grid}}],
                          "total": [{"properties": {"totals": lit("false")}}],
                          "columnWidth": [{"properties": {"value": lit(f"{wd}D")}, "selector": {"metadata": c["queryRef"]}} for c, wd in zip(cols, widths)],
                          "columnFormatting": [{"properties": {"alignment": lit("'Center'"), "styleHeader": lit("true")},
                                                "selector": {"metadata": c["queryRef"]}} for c in cols]},   # house rule: numbers + dates centered
                      "visualContainerObjects": {
                          "title": [{"properties": {"show": lit("true"), "text": lit("'" + title.replace("'", "''") + "'"), "fontSize": lit("10D"),
                                                    "bold": lit("true"), "fontColor": color("#FFFFFF"), "background": color("#003865")}}],
                          "background": [{"properties": {"show": lit("true"), "color": color("#FFFFFF")}}],
                          "border": [{"properties": {"show": lit("true"), "color": color("#000000"), "radius": lit("10D")}}],
                          "visualHeader": [{"properties": {"show": lit("false")}}]},
                      "drillFilterOtherVisuals": True}}
    return vis, w, h


def apply(files):
    meta_path = "definition/pages/pages.json"
    meta = files[meta_path]
    n = 0
    for path in sorted(p for p in list(files) if p.endswith("/visual.json") and "/pages/" in p):
        d = files[path]; v = d.get("visual")
        if not v or not wants(v):
            continue
        page_id, vis_id = path.split("/")[2], path.split("/")[4]
        qs = v["query"]["queryState"]
        ys = qs.get("Y", {}).get("projections", []) + qs.get("Y2", {}).get("projections", [])
        vals, seen = [], set()
        for p in ys:
            if _key(p) not in seen:
                vals.append(p); seen.add(_key(p))
        tips = qs.get("Tooltips", {}).get("projections", [])           # drop series copies an earlier version put in Tooltips
        keep = [p for p in tips if _key(p) not in seen]
        if tips and len(keep) != len(tips):
            if keep: qs["Tooltips"]["projections"] = keep
            else: qs.pop("Tooltips", None)
        pid = "tc" + hashlib.md5(f"{page_id}|{vis_id}".encode()).hexdigest()[:18]
        vname = "tb" + pid[2:20]
        tv, w, h = table(vname, title_of(v), qs.get("Category", {}).get("projections", []), qs.get("Series", {}).get("projections", []), vals)
        files[f"definition/pages/{pid}/page.json"] = {
            "$schema": PAGE_SCHEMA, "name": pid, "displayName": "Tip " + title_of(v)[:40], "displayOption": "FitToPage",
            "height": h, "width": w, "type": "Tooltip", "visibility": "HiddenInViewMode",
            "pageBinding": {"name": "Tooltip" + pid[2:10], "type": "Tooltip"}}
        files[f"definition/pages/{pid}/visuals/{vname}/visual.json"] = tv
        if pid not in meta["pageOrder"]:
            meta["pageOrder"].append(pid)
        vco = v.setdefault("visualContainerObjects", {})
        new_tip = [{"properties": {"show": lit("true"), "type": lit("'Canvas'"), "section": lit(f"'{pid}'")}}]
        if vco.get("visualTooltip") != new_tip:
            vco["visualTooltip"] = new_tip
        n += 1
    return n


def run(report):
    root = os.path.join(report, "definition")
    files = {}
    for f in glob.glob(os.path.join(root, "pages", "**", "*.json"), recursive=True):
        files[os.path.relpath(f, report).replace("\\", "/")] = json.load(open(f, encoding="utf-8-sig"))
    before = {k: json.dumps(o, sort_keys=True) for k, o in files.items()}
    n = apply(files)
    for rel, obj in files.items():
        if before.get(rel) != json.dumps(obj, sort_keys=True):      # write only new / changed files
            p = os.path.join(report, rel.replace("/", os.sep)); os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8", newline="\n") as h:
                json.dump(obj, h, indent=2, ensure_ascii=False); h.write("\n")
    print(f"{os.path.basename(report)}: {n} chart(s) show every series on hover")


if __name__ == "__main__":
    for r in sys.argv[1:]:
        run(r)
