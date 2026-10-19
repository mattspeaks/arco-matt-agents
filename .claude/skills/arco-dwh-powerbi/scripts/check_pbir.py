"""Lint a PBIP project against the ARCO house rules before asking the user to open/reload it in Desktop.

Usage:
  python check_pbir.py "C:\\SNOW Logic\\My Report.Report" [--fix-bom]
  python check_pbir.py "C:\\path\\to\\Project.pbip folder" [--fix-bom]   # scans every *.Report / *.SemanticModel below

Checks:
  BOM        any file starting with EF BB BF (Desktop refuses: "Only text with UTF8 encoding without BOM")  [--fix-bom strips]
  DASH       em dash U+2014 / en dash U+2013 in report text (titles, textboxes, tooltips) or TMDL display strings
  BORDER     tableEx / pivotTable without grid outlineStyle 15 + black outline
  HEADER     KPI card showing header icons other than the '?' tooltip, or a grid / chart hiding its default icons (user rule 2026-10-07)
  HOVERALL   combo (columns + lines) or multi-series column / bar chart without a report-page tooltip listing every series
             (hover shows only one series; fix: scripts/combo_tooltip_pass.py) (user rule 2026-10-08)
  NOHEADER   grid / chart with its header turned off (they keep focus mode, export, drill)
  RESETMATCH Reset Filters bookmark not slicers-only + applyOnlyToTargetVisuals, or a slicer default differs (then run reset_test.mjs)
  SPACING    framed visuals facing each other closer than 10px (visuals 'almost touching')
  HIDDENFILTER page filter on a population field, or a card / KPI with a hidden category filter (number silently narrowed)
  HEADERGAP  content (KPI cards, tiles, charts) starting less than 10px below the navy header / nav bar
  CENTERHDR  centered column whose header is not centered (columnFormatting styleHeader true)
  CENTERCODE grid date columns / date measures / short code columns (Family, FT/PT, Status, Pay Type, codes) not centered
  CENTER     tableEx / pivotTable NUMERIC measures (formatString or ImageUrl in the model TMDL) not centered; text measures stay left
  HELP       page with no actionButton linking to a help / How To Guide page (warning)
  PILL       Help / Back / drill / link button not built as the house pill (plain Power BI button with icon or text) (warning)
  FEEDBACK   page with no measure-bound color AND no badge / tile image measure = no RAG feedback (warning)
  GUIDE      report with no "How To Guide" page (error)
  SINGLESELECT slicer preset to exactly one value (one-person page) that allows multi-select
  SLICERSTYLE slicer styled like a tile (own header background, border, shadow, item fill) or Select all pre-ticked
  MATRIXCOLS matrix with a Columns field: width = rows + members x value width; verify members count fits (warning)
  WRAP       grid column narrower than the longest word of its header (word split across lines) (warning)
  WIDTH      grid whose column widths exceed the visual width (horizontal scroll), or many columns with no widths set (warning)
  CLEAR      visible page without a Clear All Filters button (error)
  RESET      page whose slicers have saved default selections but no Reset Filters bookmark button (error)
  BTNALIGN / BTNPOS  filter button icon+text not centered, or not top left under the logo (warning)
  DISPLAY    displayOption: every non-scroll page (height <= 720, 1280 x 720 16:9; report, drill-through, list, How To Guide)
             MUST be FitToPage, missing or any other value is an error (user rule 2026-10-13); taller scroll pages
             MUST be ActualSize, missing or any other value is an error (user rule 2026-10-08, hard rule 2026-10-13).
             Tooltip pages (page "type": "Tooltip" or pageBinding "type": "Tooltip") are exempt (user decision 2026-10-13)
  FILTEREXPR filterConfig filter (visual / page / report) wraps a QueryExpression in {"expr": ...}; filters take bare
             Literal / Column / Measure ... (Desktop fails schema validation on open) (error; 2026-10-15)
  CFCOL      table / matrix with a conditional-format helper measure (name starts "CF ", or contains "Color" / "Colour" /
             "Fill ") bound in queryState Values / Rows / Columns: it renders as a visible column of hex text. Bind it only
             in objects (values / columnFormatting fontColor / backColor) (error; 2026-10-15 HR Analytics Low PTO)
  TABLEROLE  tableEx with a queryState role other than Values (e.g. Tooltips): tableEx has only the Values role; Desktop
             rebuilds the query and surfaces the CF measures as columns (error; 2026-10-15)
  Exit status: 1 when any ERROR is reported, else 0.
  NAVPOS / NAVTEXT   page navigator not sitting on the header separator, or tab labels truncated (warning)
  CLIP       KPI / card shorter than its title + value fonts need (value top gets chopped); still LOOK at a screenshot (warning)
  VOCAB      "cohort", "business unit" or "fulfiller" in report text (error) or model (warning): Family > Division; (IT support)/(IT queue)
  SELALL / COLLAPSE  dropdown slicer without multi-select 'Select all', 'Select all' pre-ticked, or hierarchy slicer not opening collapsed (warning)
  SLICERFIT  slicer in the top filter bar taller than 64 px or with container padding (blank room under it) (warning)
  FRAME      chart / table / card / tile visual without a black border + drop shadow (warning)
  RADIUS     navy banner (section bar) without 10 px rounded corners (warning)
  TEXTCOLOR  legend / axis / data label / slicer / button / table text in gray or slate (warning): all text #000000
  ORGSLICER  page with separate Family and Division/company slicers (error): use one hierarchical "Family > Division" slicer
  TECHNAME   table / schema names (bronze_, Dim_, Fact_, gold., ...) in How To Guide text (error): business users
  BANNER     "SO WHAT / NOW WHAT" paragraph text in a visual, measure or guide (warning; banned 2026-10-02)
  TMDL       the sibling .SemanticModel (definition.pbir byPath, else <name>.SemanticModel; byConnection = INFO skip) must be
             valid TMDL: real parse with the Desktop TmdlSerializer when available, plus a text check (BOM, 'description:'
             property instead of a /// doc comment, tab/space mixing, unterminated ``` block, dash in names) (error; scripts/check_tmdl.py)
Exit code 1 if any BOM / DASH / BORDER problems remain.
"""
import glob, json, os, re, sys

BOM = b"\xef\xbb\xbf"

# visual header rule (user 2026-10-07): KPI cards = no icons (only "?" with a tooltip); grids / charts = full default header
CARD_TYPES = {"card", "cardVisual", "multiRowCard", "kpi"}
GRID_CHART_TYPES = {"tableEx", "pivotTable", "barChart", "clusteredBarChart", "hundredPercentStackedBarChart", "columnChart",
                    "clusteredColumnChart", "hundredPercentStackedColumnChart", "lineChart", "areaChart", "stackedAreaChart",
                    "lineStackedColumnComboChart", "lineClusteredColumnComboChart", "ribbonChart", "waterfallChart", "scatterChart",
                    "pieChart", "donutChart", "treemap", "funnel", "gauge", "map", "filledMap", "azureMap", "shapeMap", "decompositionTreeVisual"}
HEADER_ICONS = ["showVisualInformationButton", "showVisualWarningButton", "showVisualErrorButton", "showDrillRoleSelector", "showDrillUpButton",
                "showDrillToggleButton", "showDrillDownLevelButton", "showDrillDownExpandButton", "showPinButton", "showFocusModeButton",
                "showFilterRestatementButton", "showOptionsMenu", "showCopyVisualImageButton", "showSmartNarrativeButton",
                "showSeeDataLayoutToggleButton", "showCommentButton", "showCopilotSummaryButton", "showFollowVisualButton",
                "showPersonalizeVisualButton", "showSetAlertButton"]


def _pt(o, key):
    """first numeric literal for `key` anywhere under o (e.g. fontSize '13D' -> 13.0)"""
    m = re.search(r'"%s":\s*\{\s*"expr":\s*\{\s*"Literal":\s*\{\s*"Value":\s*"([0-9.]+)' % key, json.dumps(o))
    return float(m.group(1)) if m else None


def kpi_height_needed(v):
    """Rough px a card needs: title band (if shown) + value line (+ cardVisual label) + padding. 1pt = 1.333px."""
    o, vco = v.get("objects", {}), v.get("visualContainerObjects", {})
    val = _pt(o.get("labels", []), "fontSize") or _pt(o.get("value", []), "fontSize") or (27 if v.get("visualType") == "card" else 15)
    tp = (vco.get("title") or [{}])[0].get("properties", {})
    title = (_pt(vco.get("title", []), "fontSize") or 11) if tp and "false" not in json.dumps(tp.get("show", {})) else 0
    label = (_pt(o.get("label", []), "fontSize") or 0) if v.get("visualType") == "cardVisual" else 0
    if title and '"background"' not in json.dumps(tp):   # brandbook band card (no title band): 12pt + 12pt fits in 47-48 px
        return title * 1.333 * 1.25 + val * 1.333 * 1.25 + label * 1.333 * 1.2 + 6
    return title * 1.333 * 1.5 + val * 1.333 * 1.45 + label * 1.333 * 1.3 + 10


def header_separator_y(page, pdir):
    """Page-pixel y of the bottom of the navy header band (SVG y 236.5 on every ABS background).
    Power BI page background scaling: 'Fit' stretches to the page, 'Fill' keeps aspect and covers (centered crop)."""
    s = json.dumps(page.get("objects", {}).get("background", []))
    m = re.search(r'"ItemName": "([^"]+\.svg)"', s)
    if not m:
        return None
    rr = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(pdir))), "StaticResources", "RegisteredResources", m.group(1))
    if not os.path.exists(rr):
        return None
    head = open(rr, encoding="utf-8", errors="replace").read(400)
    wm, hm = re.search(r'width="([0-9.]+)"', head), re.search(r'height="([0-9.]+)"', head)
    if not (wm and hm) or "fill=\"#003865\"" not in open(rr, encoding="utf-8", errors="replace").read():
        return None
    sw, sh = float(wm.group(1)), float(hm.group(1))
    pw, ph = page.get("width", 1280), page.get("height", 720)
    if "'Fit'" in s:
        return 236.5 * ph / sh
    k = max(pw / sw, ph / sh)
    return 236.5 * k - (sh * k - ph) / 2


NUMERIC_MEASURES = None   # set in main() from the model TMDL
CENTER_FIELDS = set()     # date columns / date measures from the sibling .SemanticModel (main)
SHORT_CODES = {"Company Family", "FT / PT", "Employment Status Text", "Pay Basis", "Pay Type", "ScheduleCode", "Code",
               "Leave Code", "Status", "Gender", "FLSA", "State_Abbrev", "Seq", "Basis", "Family", "Type"}


def scan(root, fix):
    errs, warns = [], []
    for dp, _, fs in os.walk(root):
        for f in fs:
            if not f.endswith((".json", ".tmdl", ".pbir", ".pbism", ".pbip", ".platform", ".svg", ".m", ".dax")):
                continue
            p = os.path.join(dp, f)
            raw = open(p, "rb").read()
            if raw.startswith(BOM):
                if fix:
                    open(p, "wb").write(raw[3:])
                    warns.append(f"BOM stripped  {p}")
                else:
                    errs.append(f"BOM     {p}")
            txt = raw.decode("utf-8", "replace")
            if f.endswith((".json", ".tmdl")) and ("\u2014" in txt or "\u2013" in txt):
                n = txt.count("\u2014") + txt.count("\u2013")
                errs.append(f"DASH    {p}  ({n} em/en dash)")
            for term, fix_ in (("cohort", "Family"), (r"business[ _]?unit", "Family > Division"), ("fulfiller", "'<name> (IT support)' / '<group> (IT queue)'")):
                if f.endswith((".json", ".tmdl", ".svg")) and re.search(r"(?i)" + term, txt):
                    (errs if f.endswith((".json", ".svg")) else warns).append(f"VOCAB   {p}  ('{term}' in visible text: use {fix_})")
            if f.endswith(".svg") and "guide" in f.lower():
                hits = sorted(set(re.findall(r"\b(?:bronze_\w+|silver\.\w+|gold(?:_uat)?\.\w+|Dim_\w+|Fact_\w+|\w+_vw|analytics\.\w+|ukg_analytics)\b", txt)))
                if hits:
                    errs.append(f"TECHNAME {p}  (table/schema names in guide: {', '.join(hits[:6])})")
            if f.endswith(".json") and "spacingAndGlyphs" in txt:
                warns.append(f"PILLBLUR {p}  (pill label stretched with textLength/spacingAndGlyphs; run scripts/pill_crisp_pass.py)")
            if f.endswith((".json", ".tmdl", ".svg")) and re.search(r"(?i)\b(SO WHAT|NOW WHAT)\b", txt):
                warns.append(f"BANNER   {p}  uses 'SO WHAT / NOW WHAT' text; use icon / count indicators + owners instead")
    # FILTEREXPR (2026-10-15): filterConfig filters are raw QueryFilters; an {"expr": X} wrapper anywhere inside one makes
    # Desktop reject the file on open ("additional property 'expr'"). The wrapper only belongs in objects / properties.
    def _filter_expr_hits(node, path, out):
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(v, dict) and set(v) == {"expr"} and isinstance(v["expr"], dict):
                    out.append(f"{path}/{k}")
                _filter_expr_hits(v, f"{path}/{k}", out)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                _filter_expr_hits(v, f"{path}/{i}", out)
    for fj in glob.glob(os.path.join(root, "**", "definition", "**", "*.json"), recursive=True):
        try:
            fd = json.load(open(fj, encoding="utf-8-sig"))
        except Exception:
            continue
        fc = fd.get("filterConfig") if isinstance(fd, dict) else None
        for i, flt in enumerate((fc or {}).get("filters", []) or []):
            hits = []
            _filter_expr_hits(flt.get("filter"), f"/filterConfig/filters/{i}/filter", hits)
            for h in hits:
                errs.append(f"FILTEREXPR {fj}  {h}: {{\"expr\": ...}} wrapper in a filter; use the bare QueryExpression")
    for vj in glob.glob(os.path.join(root, "**", "visual.json"), recursive=True):
        try:
            d = json.load(open(vj, encoding="utf-8-sig"))
        except Exception as e:
            errs.append(f"JSON    {vj}: {e}")
            continue
        v = d.get("visual", {})
        t = v.get("visualType")
        if t == "slicer":
            o_ = v.get("objects", {}); vco_ = v.get("visualContainerObjects", {})
            on_ = lambda k: any(x.get("properties", {}).get("show", {}).get("expr", {}).get("Literal", {}).get("Value") == "true" for x in vco_.get(k, []))
            bad = [n_ for n_, hit in (("header background", any("background" in h.get("properties", {}) for h in o_.get("header", []))),
                                      ("item fill", any("background" in h.get("properties", {}) for h in o_.get("items", []))),
                                      ("border", on_("border")), ("shadow", on_("dropShadow")),
                                      ("Select all pre-ticked", "isInvertedSelectionMode" in json.dumps(o_.get("data", [])))) if hit]
            _sel = json.dumps(o_.get("selection", [])); _gen = json.dumps(o_.get("general", []))
            _one = re.search(r'"Values": \[\[\{"Literal": \{"Value": "[^"]*"\}\}\]\]', _gen)
            _q = [p_.get("queryRef", "") for p_ in v.get("query", {}).get("queryState", {}).get("Values", {}).get("projections", [])]
            _person = len(_q) == 1 and re.search(r"Full Name|Employee|Associate|Person", _q[0])   # one-person picker, not a status / family filter
            if _one and _person and not re.search(r'"(strictS|s)ingleSelect": \{"expr": \{"Literal": \{"Value": "true"', _sel):
                warns.append(f"SINGLESELECT {vj}  (preset to one value but multi-select: a one-person page must be strict single-select)")
            if bad:
                warns.append(f"SLICERSTYLE {vj}  ({', '.join(bad)})")
        # no plain white text boxes (user rule 2026-10-09): notes use amber banner / navy info bar / KPI card styles
        if t in ("card", "cardVisual", "multiRowCard"):
            _q = [p_.get("queryRef", "") for s_ in v.get("query", {}).get("queryState", {}).values() for p_ in s_.get("projections", [])]
            _bgj = json.dumps(v.get("visualContainerObjects", {}).get("background", []))
            if len(_q) == 1 and re.search(r"(?i)(note|text|caption|message|sentence)\b", _q[0].split(".")[-1]) \
                    and (not _bgj or _bgj == "[]" or re.search(r"(?i)'#?FFFFFF'", _bgj)) and not (d.get("isHidden") or "Tooltip" in vj):
                warns.append(f"WHITEBOX {vj}  (text note '{_q[0].split('.')[-1]}' in a white card; use amber banner, navy info bar or a KPI card)")
        if t == "textbox":
            _bg = v.get("visualContainerObjects", {}).get("background", [])
            _bgj = json.dumps(_bg)
            _bg_off = (not _bg) or '"show": {"expr": {"Literal": {"Value": "false"' in _bgj
            _white = re.search(r"(?i)'#?FFFFFF'|\"#?FFFFFF\"", _bgj)
            _hidden = d.get("isHidden") or "Tooltip" in vj or "How To" in vj
            _gen_j = json.dumps(v.get("objects", {}).get("general", []))
            _on_dark = re.search(r'(?i)"color": "#FFFFFF"', _gen_j)            # white text = header chrome on navy, fine
            _has_border = '"Value": "true"' in json.dumps(v.get("visualContainerObjects", {}).get("border", []))
            if (_bg_off or _white) and _has_border and not _hidden and not _on_dark:
                _txt = re.sub(r"\s+", " ", " ".join(re.findall(r'"Value": "([^"]{8,})"', json.dumps(v.get("objects", {}).get("general", []))))) [:60]
                warns.append(f"WHITEBOX {vj}  (white/no-fill text box{': ' + _txt if _txt else ''}; use amber banner, navy info bar or a KPI card)")
        # CFCOL / TABLEROLE (2026-10-15): CF helper measures must never be projections of a grid; tableEx only has Values
        if t in ("tableEx", "pivotTable"):
            _qs = v.get("query", {}).get("queryState", {}) or {}
            for _role in ("Values", "Rows", "Columns"):
                for _pj in (_qs.get(_role) or {}).get("projections", []) or []:
                    _m = (_pj.get("field") or {}).get("Measure")
                    _nm = (_m or {}).get("Property", "")
                    if _m and (_nm.startswith("CF ") or re.search(r"(?i)colou?r|fill ", _nm)):
                        errs.append(f"CFCOL   {vj}  (CF measure '{_nm}' bound in {_role}: shows as a column; bind it in objects only)")
            if t == "tableEx":
                for _role in [r_ for r_ in _qs if r_ != "Values"]:
                    errs.append(f"TABLEROLE {vj}  (tableEx role '{_role}' is invalid: only Values; Desktop surfaces CF measures as columns)")
        if t in ("tableEx", "pivotTable"):
            _rag ={c.get("selector", {}).get("metadata") for k in ("values", "columnFormatting") for c in v.get("objects", {}).get(k, [])
                    if any(x in c.get("properties", {}) for x in ("backColor", "fontColor"))}   # styleHeader would paint the RAG fill into the header
            _nohdr = [c.get("selector", {}).get("metadata", "").split(".")[-1] for c in v.get("objects", {}).get("columnFormatting", [])
                      if "'Center'" in json.dumps(c.get("properties", {}).get("alignment", {}))
                      and c.get("selector", {}).get("metadata") not in _rag
                      and c.get("properties", {}).get("styleHeader", {}).get("expr", {}).get("Literal", {}).get("Value") != "true"]
            if _nohdr:
                warns.append(f"CENTERHDR {vj}  (centered data but header not centered: {', '.join(_nohdr[:6])}; set styleHeader true)")
        if t in ("tableEx", "pivotTable"):
            _cen = {c.get("selector", {}).get("metadata") for c in v.get("objects", {}).get("columnFormatting", []) if "Center" in json.dumps(c)}
            _miss = [p_.get("queryRef") for s_ in v.get("query", {}).get("queryState", {}).values() for p_ in s_.get("projections", [])
                     if (p_.get("queryRef") in CENTER_FIELDS or p_.get("field", {}).get("Column", {}).get("Property") in SHORT_CODES)
                     and p_.get("queryRef") not in _cen]
            if _miss:
                warns.append(f"CENTERCODE {vj}  (dates / short codes not centered: {', '.join(m.split('.')[-1] for m in _miss[:6])})")
        # every series on hover (user rule 2026-10-08): combo / multi-series column charts get a report-page tooltip (combo_tooltip_pass.py)
        _qs = v.get("query", {}).get("queryState", {})
        _multi = t in ("clusteredColumnChart", "clusteredBarChart", "columnChart", "barChart", "stackedColumnChart", "stackedBarChart") and len(_qs.get("Y", {}).get("projections", [])) >= 2
        if (t in ("lineClusteredColumnComboChart", "lineStackedColumnComboChart") or _multi) and "Canvas" not in json.dumps(v.get("visualContainerObjects", {}).get("visualTooltip", [])):
            warns.append(f"HOVERALL {vj}  ({t}: hover shows one series only; run scripts/combo_tooltip_pass.py for an every-series tooltip page)")
        # header icons (user rule 2026-10-07): KPI cards show no icons (only the "?" when they have a tooltip);
        # grids and charts always keep the header with its default icons (focus mode, export, drill)
        _vh = [vh.get("properties", {}) for vh in v.get("visualContainerObjects", {}).get("visualHeader", []) if not vh.get("selector")]
        _hp = _vh[0] if _vh else {}
        _off = "false" in json.dumps(_hp.get("show", {}))
        if t in CARD_TYPES:
            if not _off:
                _showing = [k for k in HEADER_ICONS if "false" not in json.dumps(_hp.get(k, {}))]
                if _showing:
                    errs.append(f"HEADER  {vj}  ({t} KPI card shows header icons ({len(_showing)}, e.g. {', '.join(_showing[:3])}): header off, "
                                "or only the '?' when it has a tooltip; copy the kpi_band.json visualHeader block)")
        elif t in GRID_CHART_TYPES:
            _tip_page = '"type": "Tooltip"' in open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(vj))), "page.json"), encoding="utf-8-sig").read()
            if _off and not _tip_page:     # tooltip pages can't be hovered or clicked: no header icons there
                errs.append(f"NOHEADER {vj}  ({t} has its header turned off: grids and charts keep focus mode / export / drill)")
            else:
                hidden = [k for k, val in _hp.items() if k not in ("show", "showTooltipButton") and k.startswith("show") and "false" in json.dumps(val)]
                if hidden:
                    errs.append(f"HEADER  {vj}  ({t} hides default header icons: {', '.join(hidden)})")
        if t in ("card", "cardVisual", "multiRowCard", "kpi"):
            need = kpi_height_needed(v)
            h = d.get("position", {}).get("height", 0)
            if need and h < need:
                warns.append(f"CLIP     {vj}  ({t} {int(h)}px tall, needs ~{int(need)}px for its title + value fonts: top of value may be cut off)")
        # all visual text is black (#000000), never gray / slate; white only on navy / charcoal surfaces
        grayish = []
        for obj, keys in (("legend", ("labelColor",)), ("categoryAxis", ("labelColor", "titleColor")), ("valueAxis", ("labelColor", "titleColor")),
                          ("labels", ("color",)), ("header", ("fontColor",)), ("items", ("fontColor",)), ("text", ("fontColor",)),
                          ("values", ("fontColor",)), ("categoryLabels", ("color",))):
            for e in v.get("objects", {}).get(obj, []):
                for k in keys:
                    c = json.dumps(e.get("properties", {}).get(k, {}))
                    hx = re.search(r"#([0-9A-Fa-f]{6})", c)
                    rgb = [int(hx.group(1)[i:i + 2], 16) for i in (0, 2, 4)] if hx else None
                    gray_hex = rgb and hx.group(1).upper() not in ("000000", "FFFFFF") and max(rgb) - min(rgb) < 24
                    if '"ColorId": 1' in c or gray_hex:
                        grayish.append(f"{obj}.{k}")
        if grayish:
            warns.append(f"TEXTCOLOR {vj}  ({t} gray / slate text: {', '.join(sorted(set(grayish)))}; use #000000)")
        if t == "slicer":
            so = v.get("objects", {})
            mode = json.dumps(so.get("data", []))
            nproj = len(v.get("query", {}).get("queryState", {}).get("Values", {}).get("projections", []))
            strict_one = '"strictSingleSelect": {"expr": {"Literal": {"Value": "true"}}}' in json.dumps(so.get("selection", []))
            if ("Dropdown" in mode or nproj > 1) and not strict_one:   # strict single-select person pickers are intentional (SINGLESELECT rule)
                sel = json.dumps(so.get("selection", []))
                if not re.search(r'"selectAllCheckboxEnabled":\s*\{\s*"expr":\s*\{\s*"Literal":\s*\{\s*"Value":\s*"true"', sel)                         or re.search(r'"singleSelect":\s*\{\s*"expr":\s*\{\s*"Literal":\s*\{\s*"Value":\s*"true"', sel):
                    warns.append(f"SELALL   {vj}  (dropdown slicer needs multi-select + 'Select all'; default to all unless a business preset)")
            if "Dropdown" in mode and re.search(r'"isInvertedSelectionMode":\s*\{\s*"expr":\s*\{\s*"Literal":\s*\{\s*"Value":\s*"true"', mode):
                warns.append(f"SELALL   {vj}  (dropdown opens with 'Select all' pre-ticked: remove data isInvertedSelectionMode so it opens with nothing ticked)")
            if nproj > 1:
                lv = [l for e in d.get("visual", {}).get("expansionStates", []) for l in e.get("levels", [])]
                if len(lv) < nproj or not all(l.get("isCollapsed") for l in lv):
                    warns.append(f"COLLAPSE {vj}  (hierarchy slicer must open collapsed: expansionStates levels isCollapsed + isPinned)")
        pos_ = d.get("position", {})
        if t == "slicer" and 60 <= pos_.get("y", 0) < 170 and "parentGroupName" not in d and not d.get("isHidden") and "Population" not in json.dumps(v.get("query", {})):
            pad = json.dumps(v.get("visualContainerObjects", {}).get("padding", []))
            if pos_.get("height", 0) > 64 or not re.search(r'"top":\s*\{\s*"expr":\s*\{\s*"Literal":\s*\{\s*"Value":\s*"0D"', pad):
                warns.append(f"SLICERFIT {vj}  (filter-bar slicer {int(pos_.get('height', 0))}px / default padding: fit to height (padding 0, ~60px) and center in the bar)")
        frame_types = ("barChart", "columnChart", "clusteredBarChart", "clusteredColumnChart", "lineChart", "scatterChart", "donutChart",
                       "pieChart", "tableEx", "pivotTable", "card", "cardVisual", "multiRowCard", "kpi", "gauge")
        is_tile = t == "image" and '"sourceField"' in json.dumps(v.get("objects", {}))
        badge = t == "image" and pos_.get("width", 99) <= 30            # 24px status-badge overlay on a tile: never framed
        _lbl = json.dumps(v.get("objects", {}).get("labels", []) + v.get("objects", {}).get("value", []))
        kpi_band = t in ("card", "cardVisual") and ("'#FFFFFF'" in _lbl or '"ColorId": 0, "Percent": 0' in _lbl)  # white-on-navy KPI band
        badge = badge or (t == "image" and "Photo" in json.dumps(v.get("objects", {})))   # associate photo has its own rounded stroke
        if ((t in frame_types and pos_.get("y", 0) >= 60) or is_tile) and not badge and not kpi_band:
            vco_ = v.get("visualContainerObjects", {})
            bd, sh = json.dumps(vco_.get("border", [])), json.dumps(vco_.get("dropShadow", []))
            if "#000000" not in bd or '"true"' not in bd or '"true"' not in sh:
                warns.append(f"FRAME    {vj}  ({t} needs a black border (show, #000000, radius 10) with drop shadow on)")
        if t in ("textbox", "shape") and "'#003865'" in json.dumps(v.get("visualContainerObjects", {}).get("background", []))                 and pos_.get("height", 99) <= 40 and pos_.get("width", 0) >= 150                 and '"10D"' not in json.dumps(v.get("visualContainerObjects", {}).get("border", [])):
            warns.append(f"RADIUS   {vj}  (banner without 10 px rounded corners: border show + navy + radius 10)")
        if t in ("tableEx", "pivotTable"):
            s = json.dumps(v.get("objects", {}).get("grid", []))
            if '"15D"' not in s.replace(" ", "") and "15D" not in s:
                errs.append(f"BORDER  {vj}  ({t} missing outlineStyle 15)")
            elif "#000000" not in s:
                errs.append(f"BORDER  {vj}  ({t} outline not black)")
            q = json.dumps(v.get("query", {}))
            widths = [float(re.sub(r"[^0-9.]", "", json.dumps(c["properties"]["value"]["expr"]["Literal"]["Value"])) or 0)
                      for c in v.get("objects", {}).get("columnWidth", []) if "value" in c.get("properties", {})]
            ncols = q.count('"queryRef"')
            vw = d.get("position", {}).get("width", 0)
            if widths and sum(widths) > vw - 36:
                warns.append(f"WIDTH    {vj}  ({t} columns {int(sum(widths))}px > visual {int(vw)}px: horizontal scroll)")
            elif not widths and ncols >= 8:
                warns.append(f"WIDTH    {vj}  ({t} has {ncols} columns and no columnWidth set: verify no horizontal scroll)")
            hpt = _pt(v.get("objects", {}).get("columnHeaders", []), "fontSize") or 9
            cwmap = {c.get("selector", {}).get("metadata"): float(re.sub(r"[^0-9.]", "", json.dumps(c["properties"]["value"]["expr"]["Literal"]["Value"])) or 0)
                     for c in v.get("objects", {}).get("columnWidth", []) if "value" in c.get("properties", {})}
            qs_ = v.get("query", {}).get("queryState", {})
            for role_, st_ in qs_.items():
                if t == "pivotTable" and role_ == "Values" and qs_.get("Columns", {}).get("projections"):
                    continue   # value headers show the column-group member (e.g. the year), not the measure name
                for p_ in st_.get("projections", []):
                    w_ = cwmap.get(p_.get("queryRef"))
                    label = p_.get("displayName") or p_.get("nativeQueryRef") or p_.get("queryRef", "").split(".")[-1]
                    longest = max((len(x) for x in label.split()), default=0)
                    need_ = longest * hpt * 1.333 * 0.6 + 12
                    if w_ and label.strip() and w_ < need_ - 2:
                        warns.append(f"WRAP     {vj}  ({t} column '{label}' {int(w_)}px < ~{int(need_)}px for its longest header word: word splits across lines)")
            qs2 = v.get("query", {}).get("queryState", {})
            if t == "pivotTable" and qs2.get("Columns", {}).get("projections") and cwmap:
                rows_w = sum(w for q_, w in cwmap.items() if any(p_.get("queryRef") == q_ for p_ in qs2.get("Rows", {}).get("projections", [])))
                val_w = sum(w for q_, w in cwmap.items() if any(p_.get("queryRef") == q_ for p_ in qs2.get("Values", {}).get("projections", [])))
                if val_w:
                    fit = int((d.get("position", {}).get("width", 0) - 36 - rows_w) // val_w)
                    warns.append(f"MATRIXCOLS {vj}  (columns come from a field: only {fit} column(s) fit at {int(val_w)}px; check the member count in the data)")
            cf = json.dumps(v.get("objects", {}).get("columnFormatting", []))
            if '"Measure"' in q:
                # numeric measures (formatString in the model) must be centered; text measures (no format) stay left
                projs = v.get("query", {}).get("queryState", {}).get("Values", {}).get("projections", [])
                centered = {c.get("selector", {}).get("metadata") for c in v.get("objects", {}).get("columnFormatting", []) if "Center" in json.dumps(c)}
                missing = [p_["field"]["Measure"]["Property"] for p_ in projs if "Measure" in p_.get("field", {})
                           and (NUMERIC_MEASURES is None or p_["field"]["Measure"]["Property"] in NUMERIC_MEASURES)
                           and p_.get("queryRef") not in centered]
                if missing:
                    errs.append(f"CENTER  {vj}  ({t} numeric measures not centered: {', '.join(missing[:5])})")
    for pages in sorted({os.path.normpath(x) for x in glob.glob(os.path.join(root, "**", "definition", "pages"), recursive=True)}):
        names = [json.load(open(x, encoding="utf-8-sig")).get("displayName", "") for x in glob.glob(os.path.join(pages, "*", "page.json"))]
        if not any("how to" in n.lower() or "guide" in n.lower() for n in names):
            errs.append(f"GUIDE   {os.path.dirname(os.path.dirname(pages))}  (no How To Guide page)")
    for pj in glob.glob(os.path.join(root, "**", "page.json"), recursive=True):
        pdir = os.path.dirname(pj)
        page = json.load(open(pj, encoding="utf-8-sig"))
        name = page.get("displayName", pdir)
        _h, _w, _do = page.get("height", 720), page.get("width", 1280), page.get("displayOption")
        _tooltip = page.get("type") == "Tooltip" or (page.get("pageBinding") or {}).get("type") == "Tooltip"
        if _tooltip:    # user decision 2026-10-13: report-page tooltip pages are exempt from DISPLAY
            pass
        elif _h <= 720:   # user rule 2026-10-13: every non-scroll page (any page type) MUST be FitToPage; missing is a violation
            if _do != "FitToPage":
                errs.append(f"DISPLAY  page '{name}' is {_w}x{_h} (no scroll) but displayOption is '{_do if _do is not None else 'missing'}': must be FitToPage")
        elif _do != "ActualSize":   # user rule 2026-10-08, hard rule 2026-10-13: scroll pages MUST be ActualSize; missing is a violation
            errs.append(f"DISPLAY  page '{name}' is {_w}x{_h} (scroll) but displayOption is '{_do if _do is not None else 'missing'}': must be ActualSize")
        vis = [json.load(open(x, encoding="utf-8-sig")) for x in glob.glob(os.path.join(pdir, "visuals", "*", "visual.json"))]
        # house pill buttons (brandbook "Pill buttons", user 2026-10-06/07): Help / Back / drill / link buttons are a vector pill image with
        # an INVISIBLE actionButton on top. A link button that still shows its own icon or text is the old crammed / pixelated style.
        for _v in vis:
            _vi = _v.get("visual", {})
            if _vi.get("visualType") != "actionButton":
                continue
            _lk = (_vi.get("visualContainerObjects", {}).get("visualLink") or [{}])[0].get("properties", {})
            _ty = str(_lk.get("type", {}).get("expr", {}).get("Literal", {}).get("Value", "")).strip("'")
            if _ty not in ("Back", "PageNavigation", "Drillthrough", "WebUrl"):
                continue
            _ob = _vi.get("objects", {})
            _shown = lambda k: any(str(e.get("properties", {}).get("show", {}).get("expr", {}).get("Literal", {}).get("Value", "true")) == "true"
                                   and "selector" not in e for e in _ob.get(k, [])) or (k in _ob and not any("selector" not in e for e in _ob.get(k, [])))
            if _shown("icon") or _shown("text"):
                warns.append(f"PILL     page '{name}' {_ty} button {_v.get('name', '')[:12]} uses the plain Power BI button; use the house pill "
                             f"(image + invisible overlay: Bonding Schedule build add_pill / add_back / add_help, or HR Dashboards help_pill_pass.py / pill_pass.py)")
        if page.get("visibility") == "HiddenInViewMode" or "guide" in name.lower() or "help" in name.lower():
            continue
        vfiles = glob.glob(os.path.join(pdir, "visuals", "*", "visual.json"))
        allv = " ".join(open(x, encoding="utf-8-sig").read() for x in vfiles)
        vis = [json.load(open(x, encoding="utf-8-sig")) for x in vfiles]
        # breathing room: framed visuals facing each other must be >= 10px apart (user 2026-10-06)
        _FR = {"tableEx", "pivotTable", "cardVisual", "card", "barChart", "columnChart", "clusteredBarChart", "clusteredColumnChart",
               "lineChart", "lineClusteredColumnComboChart", "lineStackedColumnComboChart", "azureMap", "donutChart", "scatterChart"}
        _fv = [x for x in vis if x.get("visual", {}).get("visualType") in _FR and not x.get("isHidden")]
        _tight = []
        for _a in _fv:
            for _b in _fv:
                if _a is _b:
                    continue
                _pa, _pb = _a["position"], _b["position"]
                _ta, _tb = _a["visual"]["visualType"], _b["visual"]["visualType"]
                if min(_pa["x"] + _pa["width"], _pb["x"] + _pb["width"]) - max(_pa["x"], _pb["x"]) > 20 and _pb["y"] >= _pa["y"] + _pa["height"] - 4 \
                        and _pb["y"] - (_pa["y"] + _pa["height"]) < 9.5 and not (_ta == _tb == "cardVisual"):
                    _tight.append(f"{_a['name'][:8]}/{_b['name'][:8]} {round(_pb['y'] - _pa['y'] - _pa['height'], 1)}px")
                if min(_pa["y"] + _pa["height"], _pb["y"] + _pb["height"]) - max(_pa["y"], _pb["y"]) > 20 and _pb["x"] >= _pa["x"] + _pa["width"] - 4 \
                        and _pb["x"] - (_pa["x"] + _pa["width"]) < 9.5 and not (_ta == _tb and _ta in ("cardVisual", "card")):
                    _tight.append(f"{_a['name'][:8]}|{_b['name'][:8]} {round(_pb['x'] - _pa['x'] - _pa['width'], 1)}px")
        if _tight:
            warns.append(f"SPACING  page '{name}' visuals closer than 10px: {', '.join(_tight[:5])} (HR Dashboards/build/spacing_pass.py)")
        # HIDDENFILTER (user 2026-10-06: Overview 'all populations' silently excluded interns via leftover filters): a headline number
        # must not be narrowed by a filter the user can't see. Flags category filters (In / Not In on a column, not the house
        # not-blank helpers) on the page or on any card / KPI visual, and any population-type field filtered outside its slicer.
        _GOV = ("Associate Type", "Population", "Pay Basis", "Employee Type", "FT / PT")   # Employment Status = Active IS the source flag: allowed
        def _hidden(fl):
            out = []
            for f_ in fl:
                _c = f_.get("field", {}).get("Column", {}); _b = json.dumps(f_.get("filter", {}))
                if not _c or not f_.get("filter") or "notblank" in f_.get("name", "").lower() or "eeonb" in f_.get("name", "") or '"Value": "null"' in _b:
                    continue
                out.append(f"{_c.get('Property')}{' (NOT)' if '\"Not\"' in _b else ''}")
            return out
        _pf = _hidden(page.get("filterConfig", {}).get("filters", []))
        if [x for x in _pf if x.split(" (")[0] in _GOV]:
            warns.append(f"HIDDENFILTER page '{name}' page filter on {', '.join(_pf[:3])}: population rules belong in the visible slicer (HR Dashboards/build/population_cleanup_pass.py; scripts/reconcile.py)")
        for _d in vis:
            if _d.get("visual", {}).get("visualType") in ("card", "cardVisual", "kpi", "multiRowCard"):
                _vf = _hidden(_d.get("filterConfig", {}).get("filters", []))
                if _vf:
                    warns.append(f"HIDDENFILTER page '{name}' card {_d.get('name', '')[:8]} has a hidden filter on {', '.join(_vf[:3])}: its number won't match the slicers / source flag")
        # content must start >= 10 px below the navy header / nav bar (user 2026-10-06); KPI-band (charcoal) backgrounds and
        # filter-band pages hold their cards / slicers inside the band by design
        _sep = header_separator_y(page, pdir)
        _bgm = re.search(r'"ItemName": "([^"]+\.svg)"', json.dumps(page.get("objects", {}).get("background", [])))
        _bgf = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(pdir))), "StaticResources", "RegisteredResources", _bgm.group(1)) if _bgm else ""
        _charcoal = bool(_bgf) and os.path.exists(_bgf) and "3A3A3A" in open(_bgf, encoding="utf-8", errors="replace").read().upper()
        _vt = lambda d: d.get("visual", {}).get("visualType")
        _band = any(_vt(d) in ("slicer", "advancedSlicerVisual") and d["position"]["y"] < 150 and d["position"]["x"] >= 150 for d in vis)
        if _sep and not _charcoal and not _band:
            _edge = max((d["position"]["x"] + d["position"]["width"] for d in vis if _vt(d) in ("slicer", "advancedSlicerVisual")
                         and d["position"]["x"] < 10 and not d.get("isHidden")), default=0)
            _hits = [d for d in vis if _vt(d) != "pageNavigator" and not d.get("isHidden") and d["position"]["x"] >= _edge - 1
                     and _sep - 5 <= d["position"]["y"] < _sep + 9.5]
            if _hits:
                warns.append(f"HEADERGAP page '{name}' {len(_hits)} visual(s) start {round(min(d['position']['y'] for d in _hits) - _sep, 1)}px below the header (min 10) (HR Dashboards/build/header_gap_pass.py)")
        # Reset bookmark must equal the page defaults (user 2026-10-06: Reset emptied a table / changed a view)
        for _d in vis:
            _lk = json.dumps(_d.get("visual", {}).get("visualContainerObjects", {}).get("visualLink", []))
            _m = re.search(r"\"bookmark\": \{\"expr\": \{\"Literal\": \{\"Value\": \"'([^']+)'\"", _lk)
            if "'Bookmark'" not in _lk or not _m:
                continue
            _bp = os.path.join(os.path.dirname(os.path.dirname(pdir)), "bookmarks", _m.group(1) + ".bookmark.json")
            if not os.path.exists(_bp):
                continue
            _sec = json.load(open(_bp, encoding="utf-8-sig")).get("explorationState", {}).get("sections", {}).get(os.path.basename(pdir), {})
            _vc = _sec.get("visualContainers", {}); _bad = []
            _opt = json.load(open(_bp, encoding="utf-8-sig")).get("options", {})
            _sl = sorted(_x.get("name") for _x in vis if _x.get("visual", {}).get("visualType") in ("slicer", "advancedSlicerVisual"))
            # tested 2026-10-06: Reset must touch the slicers ONLY (page-wide bookmarks collapse / empty every matrix)
            if not _opt.get("applyOnlyToTargetVisuals"):
                _bad.append("applyOnlyToTargetVisuals not true (page-wide Reset collapses matrices)")
            if sorted(_opt.get("targetVisualNames") or []) != _sl:
                _bad.append("targetVisualNames is not exactly the page's slicers")
            if sorted(_vc) != _sl:
                _bad.append("bookmark carries non-slicer visuals or misses a slicer")
            for _x in vis:
                _xv = _x.get("visual", {}); _nm = _x.get("name")
                if _xv.get("visualType") in ("slicer", "advancedSlicerVisual"):
                    _df = next((g.get("properties", {}).get("filter") for g in _xv.get("objects", {}).get("general", []) if g.get("properties", {}).get("filter")), None)
                    _bf = next((g.get("properties", {}).get("filter") for g in _vc.get(_nm, {}).get("singleVisual", {}).get("objects", {}).get("merge", {}).get("general", []) if g.get("properties", {}).get("filter")), None)
                    if json.dumps(_df, sort_keys=True) != json.dumps(_bf, sort_keys=True):
                        _bad.append(f"{_nm[:8]} slicer default")
            if _bad:
                warns.append(f"RESETMATCH page '{name}' Reset bookmark: {', '.join(_bad[:5])} (HR Dashboards/build/reset_bookmarks_pass.py; then scripts/reset_test.mjs)")
        # filter buttons: Clear All on every page; Reset (bookmark) where slicers carry saved default selections
        buttons = [d for d in vis if d.get("visual", {}).get("visualType") == "actionButton"]
        def link_type(d):
            return json.dumps(d["visual"].get("visualContainerObjects", {}).get("visualLink", []))
        clear = [d for d in buttons if "ClearAllSlicers" in link_type(d)]
        reset = [d for d in buttons if "'Bookmark'" in link_type(d)]
        preset = any(d.get("visual", {}).get("visualType") in ("slicer", "advancedSlicerVisual") and
                     '"filter"' in json.dumps(d["visual"].get("objects", {}).get("general", [])) for d in vis)
        fam_sl = [d for d in vis if d.get("visual", {}).get("visualType") in ("slicer", "advancedSlicerVisual")]
        has_fam = [d for d in fam_sl if re.search(r'"Property":\s*"[^"]*Family', json.dumps(d["visual"].get("query", {})))]
        has_div = [d for d in fam_sl if re.search(r'"Property":\s*"(?:Division|Company Name|Company|Business Unit|Company_Label)"', json.dumps(d["visual"].get("query", {})))]
        if has_fam and has_div and not any(d in has_div for d in has_fam):
            errs.append(f"ORGSLICER page '{name}' has separate Family and Division slicers; use one hierarchical 'Family > Division' slicer")
        if not clear:
            errs.append(f"CLEAR   page '{name}' has no Clear All Filters button")
        if preset and not reset:
            errs.append(f"RESET   page '{name}' has pre-set slicer defaults but no Reset Filters (bookmark) button")
        for d in clear + reset:
            o = d["visual"].get("objects", {})
            dflt = lambda k: json.dumps([e for e in o.get(k, []) if e.get("selector", {}).get("id") == "default"])
            if "'center'" not in dflt("icon") or "'center'" not in dflt("text"):
                warns.append(f"BTNALIGN page '{name}' filter button icon/text not centered in its box")
            pos = d.get("position", {})
            if pos.get("x", 0) > 200 or pos.get("y", 0) > 170:
                warns.append(f"BTNPOS   page '{name}' filter button at ({int(pos.get('x', 0))}, {int(pos.get('y', 0))}); belongs top left under the logo")
        # page navigator: bottom edge on the header separator (y 68-69 on ABS backgrounds) and every tab label fully visible
        visible = [json.load(open(x, encoding="utf-8-sig")) for x in glob.glob(os.path.join(os.path.dirname(pdir), "*", "page.json"))]
        visible = [pg.get("displayName", "") for pg in visible if pg.get("visibility") != "HiddenInViewMode"]
        for d in vis:
            if d.get("visual", {}).get("visualType") != "pageNavigator":
                continue
            pos = d.get("position", {})
            bottom = pos.get("y", 0) + pos.get("height", 0)
            sep = header_separator_y(page, pdir)
            # tab bottom outline (1 px) must land ON the band edge: navigator bottom = separator - 1 (+-0.3). The old +-1.5 tolerance let
            # tabs spill visibly onto the KPI / filter bar (user 2026-10-04, ANH Workforce).
            if sep and abs(bottom - (sep - 1)) > 0.3:
                warns.append(f"NAVPOS   page '{name}' page navigator bottom at y {bottom:.2f}; must be header separator - 1 = {sep - 1:.2f} (HR Dashboards/build/nav_align.py)")
            fs = _pt(d["visual"].get("objects", {}).get("text", []), "fontSize") or 14
            tab = (pos.get("width", 0) - 4 * max(len(visible) - 1, 0)) / max(len(visible), 1)
            need = max((len(n) for n in visible), default=0) * fs * 1.333 * 0.56 + 16
            if need > tab:
                warns.append(f"NAVTEXT  page '{name}' nav tabs ~{int(tab)}px but longest label needs ~{int(need)}px: text truncates ('...')")
        if "'help'" not in allv and "PageNavigation" not in allv:
            warns.append(f"HELP     page '{name}' has no help / How To Guide button")
        color_bound = re.search(r'"(?:color|fillColor|backColor|fill)":\s*\{\s*"solid":\s*\{\s*"color":\s*\{\s*"expr":\s*\{\s*"Measure"', allv)
        # badge / tile images count too: image visuals whose source is a measure, or (Icon|Tile|SVG|Badge) measures in grids/cards
        image_bound = re.search(r'"sourceField":\s*\{\s*"expr":\s*\{\s*"Measure"', allv) or \
            re.search(r'"Property":\s*"[^"]*\b(?:Icon|Tile|SVG|Badge|Flag)\b[^"]*"', allv)
        if not (color_bound or image_bound):
            warns.append(f"FEEDBACK page '{name}' has no measure-bound color or badge / tile image (no RAG feedback)")
    return errs, warns


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    root, fix = sys.argv[1], "--fix-bom" in sys.argv
    global NUMERIC_MEASURES
    NUMERIC_MEASURES = None   # None = model not found: treat every measure as numeric
    tm = glob.glob(os.path.join(root, "**", "*.tmdl"), recursive=True)
    _sem_ = re.sub(r"\.Report[\\/]?$", ".SemanticModel", root.rstrip("\\/"))
    if not tm and os.path.isdir(_sem_):   # report folder passed: read measure formats from the sibling model
        tm = glob.glob(os.path.join(_sem_, "**", "*.tmdl"), recursive=True)
    if tm:
        import re as _re
        NUMERIC_MEASURES = set()
        for f_ in tm:
            for m_ in _re.finditer(r"\n\tmeasure '?([^'=\n]+?)'? =.*?(?=\n\tmeasure |\n\tcolumn |\n\tpartition |\Z)", open(f_, encoding="utf-8-sig").read(), _re.S):
                body = m_.group(0)
                if "formatString:" in body or "dataCategory: ImageUrl" in body:
                    NUMERIC_MEASURES.add(m_.group(1).strip())
    global CENTER_FIELDS
    _sem = re.sub(r"\.Report[\\/]?$", ".SemanticModel", root.rstrip("\\/"))
    for f_ in glob.glob(os.path.join(_sem, "definition", "tables", "*.tmdl")):
        _s = open(f_, encoding="utf-8-sig").read()
        _tm = re.search(r"^table '?([^'\n]+?)'?\s*$", _s, re.M)
        if not _tm:
            continue
        for _m in re.finditer(r"\n\tcolumn '?([^'=\n]+?)'?(?: =[^\n]*)?\n(.*?)(?=\n\t(?:column|measure|partition|hierarchy) |\Z)", _s, re.S):
            if "dataType: dateTime" in _m.group(2):
                CENTER_FIELDS.add(f"{_tm.group(1)}.{_m.group(1).strip()}")
        for _m in re.finditer(r"\n\tmeasure '?([^'=\n]+?)'? =(.*?)(?=\n\tmeasure |\n\tcolumn |\n\tpartition |\Z)", _s, re.S):
            _fs = re.search(r"formatString: ([^\n]+)", _m.group(2))
            if _fs and re.search(r"(dd|yy|mmm)", _fs.group(1)) and "#" not in _fs.group(1):
                CENTER_FIELDS.add(f"{_tm.group(1)}.{_m.group(1).strip()}")
    errs, warns = scan(root, fix)
    # TMDL validity of the model(s) behind this report (2026-10-13: a 'description:' property line stopped Desktop opening a report)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import check_tmdl
    _root = os.path.normpath(root)
    _reports = [_root] if _root.endswith(".Report") else sorted(glob.glob(os.path.join(_root, "**", "*.Report"), recursive=True))
    _models = {os.path.normpath(x) for x in glob.glob(os.path.join(_root, "**", "*.SemanticModel"), recursive=True)}
    for _r in _reports:
        _m, _info = check_tmdl.model_for_report(_r)
        if _m:
            _models.add(os.path.normpath(_m))
        elif _info:
            print("INFO ", _info)
    for _m in sorted(_models):
        _e, _w, _i = check_tmdl.check_model(_m)
        for x in _i:
            print("INFO ", x)
        errs += _e
        warns += _w
    for w in warns:
        print("WARN ", w)
    for e in errs:
        print("ERROR", e)
    print(f"\n{len(errs)} error(s), {len(warns)} warning(s)")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
