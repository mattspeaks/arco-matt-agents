"""Make house pill buttons crisp (user 2026-10-11: drill / back pill text looked stretched and pixelated).

Two causes in the pill SVG (image visual, data URI):
  1. textLength + lengthAdjust='spacingAndGlyphs' forced the label to a fixed width, stretching the glyphs.
  2. The SVG was declared at 2x the visual size, so Power BI's raster blurred when the page is shown larger (ActualSize, high DPI).
Fix: drop textLength / lengthAdjust, center the label (text-anchor middle) in the space beside the arrow, declare the SVG at 4x.
Arrow-less pills (2026-10-13): the house Help pill (navy, '?' circle + 'Help', HR Dashboards/build/help_pill_pass.py) and any
pill image without an arrow (first shape a rect with rx >= ~h/2, plus a <text>) are also declared at 4x (viewBox = the box,
unchanged); a lone label with no text-anchor is centered at w/2. Help pill content is already centered, so only the size changes.

Usage:
  python pill_crisp_pass.py <PBIP folder or .Report folder> [...]      rewrite built visual.json files in place
  python pill_crisp_pass.py --generators <file.py> [...]                patch generator source (f-string pill_svg variants)
Idempotent. Prints what it changed.
"""
import glob, os, re, sys
from urllib.parse import unquote, quote

SCALE = 4


def is_pill(svg, h):
    """Arrow-less house pill: first shape is a rect with fully rounded ends (rx >= h/2 - 2) spanning ~the box height, plus a label."""
    r = re.search(r"<svg[^>]*>\s*<rect\b([^>]*)>", svg)
    if not r or "<text" not in svg:
        return False
    rx = re.search(r"\brx=(['\"]{1,2})([\d.]+)\1", r.group(1))
    rh = re.search(r"\bheight=(['\"]{1,2})([\d.]+)\1", r.group(1))
    return bool(rx and rh and float(rh.group(2)) >= h - 4 and float(rx.group(2)) >= h / 2 - 2)


def fix_svg(svg):
    m = re.search(r"viewBox=(['\"]{1,2})0 0 ([\d.]+) ([\d.]+)\1", svg)
    if not m or "<text" not in svg:
        return svg
    q, w, h = m.group(1), float(m.group(2)), float(m.group(3))
    arrow = bool(re.search(r"h-?14 m-?6 -6", svg))            # arrow pill signature (drill / back pills)
    if not arrow and not is_pill(svg, h):                       # house pills only (Help pill or any arrow-less pill)
        return svg
    svg = re.sub(r"(<svg[^>]*?)width=(['\"]{1,2})[\d.]+\2\s+height=\2[\d.]+\2",
                 lambda k: f"{k.group(1)}width={k.group(2)}{w * SCALE:g}{k.group(2)} height={k.group(2)}{h * SCALE:g}{k.group(2)}", svg, count=1)
    svg = re.sub(r"\s*textLength=(['\"]{1,2})[\d.]+\1", "", svg)
    svg = re.sub(r"\s*lengthAdjust=(['\"]{1,2})\w+\1", "", svg)
    if not arrow:
        # arrow-less: a lone label with no anchor is centered in the pill; multi-part content (Help pill) is already centered
        if svg.count("<text") == 1 and "text-anchor" not in svg:
            svg = re.sub(r"<text x=(['\"]{1,2})[\d.]+\1", lambda k: f"<text x={k.group(1)}{w / 2:g}{k.group(1)} text-anchor={k.group(1)}middle{k.group(1)}", svg, count=1)
        return svg
    # arrow side: a right arrow path starts with "M<x> <y> h14", a left arrow with "h-14"
    p = re.search(r"d=(['\"]{1,2})M([\d.]+) [\d.]+ h(-?)14", svg)
    if p and "text-anchor" not in svg:
        ax = float(p.group(2))
        if p.group(3) == "-":           # left arrow: arrow occupies the left, text centered in the rest
            lo, hi = ax + 6, w - 12
        else:                            # right arrow: arrow starts at ax
            lo, hi = 12, ax - 6
        cx = (lo + hi) / 2
        svg = re.sub(r"<text x=(['\"]{1,2})[\d.]+\1", lambda k: f"<text x={k.group(1)}{cx:g}{k.group(1)} text-anchor={k.group(1)}middle{k.group(1)}", svg, count=1)
    return svg


def fix_uri_block(txt):
    changed = 0

    def rep(m):
        nonlocal changed
        raw = m.group(0)
        enc = "%3C" in raw[:80]
        body = unquote(raw) if enc else raw
        new = fix_svg(body)
        if new != body:
            changed += 1
        if enc:
            new = new.replace("#", "%23").replace("<", "%3C").replace(">", "%3E")
        return new

    out = re.sub(r"(?:%3Csvg|<svg)[^\"]*?(?:%3C/svg%3E|</svg>)", rep, txt)
    return out, changed


def run_pbip(root):
    n = 0
    for vj in glob.glob(os.path.join(root, "**", "visual.json"), recursive=True):
        t = open(vj, encoding="utf-8").read()
        if "data:image/svg+xml" not in t:          # fix_svg is idempotent; no text-anchor shortcut (it skipped 2x Help pills)
            continue
        new, c = fix_uri_block(t)
        if c:
            open(vj, "w", encoding="utf-8", newline="").write(new); n += c
    print(f"{root}: {n} pill SVG(s) fixed")


def run_generator(path):
    t = open(path, encoding="utf-8").read(); o = t
    t = re.sub(r" textLength='\{[^}]*\}' lengthAdjust='spacingAndGlyphs'", "", t)
    t = re.sub(r" textLength=''\{[^}]*\}'' lengthAdjust=''spacingAndGlyphs''", "", t)
    t = t.replace("width='{w * 2}' height='{h * 2}'", f"width='{{w * {SCALE}}}' height='{{h * {SCALE}}}'")
    if t != o:
        open(path, "w", encoding="utf-8", newline="").write(t)
    print(f"{path}: {'patched' if t != o else 'no pattern found (check pill_svg by hand)'}"
          + ("" if "text-anchor" in t else "  [label not centered: add text-anchor='middle' + centered x by hand]"))


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--generators":
        for a in args[1:]:
            run_generator(a)
    else:
        for a in args:
            run_pbip(a)
