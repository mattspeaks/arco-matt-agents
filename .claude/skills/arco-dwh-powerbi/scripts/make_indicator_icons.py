"""ARCO indicator icon set: badge SVGs, issue tiles, a preview sheet, and the DAX image measures that draw them.

Usage:
  python make_indicator_icons.py                 # writes assets/icons/*.svg + assets/icons/preview.svg
  python make_indicator_icons.py dax "Projects Red" "[Projects Red]" "[Projects Red Level]" "Red projects"
      -> prints DAX for <name> Icon (24px badge) and <name> Tile (issue tile) image measures
         (set dataCategory: ImageUrl on both measures in TMDL)

Shape AND glyph carry the meaning (color-blind safe): octagon ! = act, triangle ! = watch, circle check = ok,
circle i = check / info, grey circle dash = no data; up / down trend badges.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets", "icons")
W = "#FFFFFF"

LEVELS = {  # level: (name, color, shape, glyph, glyph color)
    3: ("act", "#D64550", "octagon", "bang", W),
    2: ("watch", "#E3B505", "triangle", "bang_low", "#252423"),
    1: ("ok", "#2E7D32", "circle", "check", W),
    4: ("check", "#6B8F9C", "circle", "info", W),
    0: ("nodata", "#A6A6A6", "circle", "dash", W),
}
SHAPES = {
    "octagon": "<polygon points='7,1 17,1 23,7 23,17 17,23 7,23 1,17 1,7' fill='{c}'/>",
    "triangle": "<path d='M12 1.6 L23 21.4 Q23.3 22.4 22.2 22.4 L1.8 22.4 Q0.7 22.4 1 21.4 Z' fill='{c}'/>",
    "circle": "<circle cx='12' cy='12' r='11' fill='{c}'/>",
}
GLYPHS = {
    "bang": "<rect x='10.6' y='5.5' width='2.8' height='8.6' rx='1.4' fill='{g}'/><circle cx='12' cy='17.8' r='1.6' fill='{g}'/>",
    "bang_low": "<rect x='10.7' y='8' width='2.6' height='7.4' rx='1.3' fill='{g}'/><circle cx='12' cy='18.6' r='1.5' fill='{g}'/>",
    "check": "<path d='M6.8 12.6 L10.3 16 L17.4 8.6' fill='none' stroke='{g}' stroke-width='2.8' stroke-linecap='round' stroke-linejoin='round'/>",
    "info": "<circle cx='12' cy='6.8' r='1.6' fill='{g}'/><rect x='10.6' y='10' width='2.8' height='8.4' rx='1.4' fill='{g}'/>",
    "dash": "<rect x='6.5' y='10.7' width='11' height='2.6' rx='1.3' fill='{g}'/>",
    "up": "<path d='M12 5.5 L18 12.5 L14 12.5 L14 18.5 L10 18.5 L10 12.5 L6 12.5 Z' fill='{g}'/>",
    "down": "<path d='M12 18.5 L18 11.5 L14 11.5 L14 5.5 L10 5.5 L10 11.5 L6 11.5 Z' fill='{g}'/>",
}


def badge(level=None, shape=None, color=None, glyph=None, gcolor=W):
    if level is not None:
        _, color, shape, glyph, gcolor = LEVELS[level]
    return SHAPES[shape].format(c=color) + GLYPHS[glyph].format(g=gcolor)


def svg(body, w=24, h=24):
    return f"<svg xmlns='http://www.w3.org/2000/svg' width='{w}' height='{h}' viewBox='0 0 {w} {h}'>{body}</svg>"


def tile(level, value, label, w=240, h=72):
    _, c, *_ = LEVELS[level]
    b = badge(level)
    return svg(
        f"<rect x='0.5' y='0.5' width='{w - 1}' height='{h - 1}' rx='8' fill='#FFFFFF' stroke='#000000'/>"
        f"<rect x='0.5' y='0.5' width='6' height='{h - 1}' rx='3' fill='{c}'/>"
        f"<g transform='translate(18 18) scale(1.5)'>{b}</g>"
        f"<text x='66' y='38' font-family='Arial' font-size='26' font-weight='700' fill='#000000'>{value}</text>"
        f"<text x='66' y='58' font-family='Arial' font-size='11.5' fill='#000000'>{label}</text>", w, h)


def write_assets():
    os.makedirs(OUT, exist_ok=True)
    files = {f"{n}.svg": svg(badge(lv)) for lv, (n, *_) in LEVELS.items()}
    files["trend_up_good.svg"] = svg(badge(shape="circle", color="#2E7D32", glyph="up"))
    files["trend_down_bad.svg"] = svg(badge(shape="circle", color="#D64550", glyph="down"))
    files["trend_up_bad.svg"] = svg(badge(shape="circle", color="#D64550", glyph="up"))
    files["trend_down_good.svg"] = svg(badge(shape="circle", color="#2E7D32", glyph="down"))
    for n, s in files.items():
        open(os.path.join(OUT, n), "w", encoding="utf-8", newline="\n").write(s)
    # preview sheet
    parts = ["<rect width='1000' height='430' fill='#F2F2F2'/>",
             "<rect width='1000' height='48' fill='#003865'/>",
             "<text x='20' y='31' font-family='Arial' font-size='18' font-weight='700' fill='#FFFFFF'>ARCO indicator set</text>",
             "<text x='20' y='80' font-family='Arial' font-size='13' font-weight='700' fill='#003865'>BADGES (table icon column, card icon, legend)</text>"]
    x = 20
    names = [(3, "Act"), (2, "Watch"), (1, "OK"), (4, "Check"), (0, "No data")]
    for lv, t in names:
        parts.append(f"<g transform='translate({x} 96) scale(1.6)'>{badge(lv)}</g>")
        parts.append(f"<text x='{x + 48}' y='121' font-family='Arial' font-size='13' fill='#252423'>{t}</text>")
        x += 130
    for i, (sh, c, g, t) in enumerate([("circle", "#2E7D32", "up", "Up, good"), ("circle", "#D64550", "down", "Down, bad")]):
        xx = 670 + i * 160
        parts.append(f"<g transform='translate({xx} 96) scale(1.6)'>{badge(shape=sh, color=c, glyph=g)}</g>")
        parts.append(f"<text x='{xx + 48}' y='121' font-family='Arial' font-size='13' fill='#252423'>{t}</text>")
    parts.append("<text x='20' y='180' font-family='Arial' font-size='13' font-weight='700' fill='#003865'>ISSUE TILES (worst first; green hidden; one 'All clear' tile when nothing fires)</text>")
    tiles = [(3, "3", "Red projects"), (2, "$257K", "Time awaiting approval"), (4, "6", "No status note"), (1, "All clear", "No overdue tasks")]
    for i, (lv, v, l) in enumerate(tiles):
        parts.append(f"<g transform='translate({20 + i * 245} 196)'>{tile(lv, v, l)}</g>")
    parts.append("<text x='20' y='310' font-family='Arial' font-size='13' font-weight='700' fill='#003865'>IN A TABLE</text>")
    rows = [(3, "Chicago Randolph Expansion", "Slip 22% vs baseline", "J. Smith (PM)"), (2, "Network Refresh", "Budget trending +12%", "A. Lee (PM)"),
            (1, "Badge Reader Upgrade", "On plan", "R. Diaz (PM)")]
    parts.append("<rect x='20' y='320' width='960' height='100' fill='#FFFFFF' stroke='#000000'/>")
    parts.append("<rect x='20' y='320' width='960' height='22' fill='#003865'/>")
    for xx, h in [(30, "Status"), (100, "Project"), (420, "Issue"), (720, "Owner")]:
        parts.append(f"<text x='{xx}' y='336' font-family='Arial' font-size='11' font-weight='700' fill='#FFFFFF'>{h}</text>")
    for j, (lv, p, iss, o) in enumerate(rows):
        y = 346 + j * 25
        parts.append(f"<g transform='translate(42 {y}) scale(0.85)'>{badge(lv)}</g>")
        for xx, t in [(100, p), (420, iss), (720, o)]:
            parts.append(f"<text x='{xx}' y='{y + 15}' font-family='Arial' font-size='11.5' fill='#252423'>{t}</text>")
    open(os.path.join(OUT, "preview.svg"), "w", encoding="utf-8", newline="\n").write(svg("".join(parts), 1000, 430))
    print("wrote", len(files) + 1, "files to", os.path.abspath(OUT))


def dax_literal(s):
    return '"' + s.replace("#", "%23").replace('"', '""') + '"'


def dax(name, value_expr, level_expr, label):
    pre = '"data:image/svg+xml;utf8,"'
    icon_cases = ",\n    ".join(f"{lv}, {dax_literal(svg(badge(lv)))}" for lv in (3, 2, 1, 4))
    print(f"-- {name} Icon   (dataCategory: ImageUrl)\n{name} Icon =\n{pre} & SWITCH({level_expr},\n    {icon_cases},\n    {dax_literal(svg(badge(0)))})\n")
    t = {lv: tile(lv, "VALUE", "LABEL") for lv in (3, 2, 1, 4)}
    cases = ",\n    ".join(f"{lv}, {dax_literal(t[lv])}" for lv in t)
    print(f"-- {name} Tile   (dataCategory: ImageUrl; show in a table/matrix image cell or a cardVisual image)\n{name} Tile =\n"
          f"VAR v = FORMAT({value_expr}, \"#,0\")\nVAR s = SWITCH({level_expr},\n    {cases},\n    {dax_literal(tile(0, 'VALUE', 'LABEL'))})\n"
          f"RETURN {pre} & SUBSTITUTE(SUBSTITUTE(s, \"VALUE\", v), \"LABEL\", \"{label}\")\n")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "dax":
        dax(*sys.argv[2:6])
    else:
        write_assets()
