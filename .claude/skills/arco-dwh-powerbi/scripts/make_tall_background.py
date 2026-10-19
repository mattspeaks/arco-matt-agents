"""Make a taller copy of an ABS background SVG for a scrolling Power BI page, so the header never stretches.

Usage:
  python make_tall_background.py scroll 1500 out_dir          # ABS_Background_Scroll  -> ABS_Background_Scroll_1500.svg
  python make_tall_background.py kpis 1300 out_dir            # ABS_Background_KPIs    -> ABS_Background_KPIs_1300.svg (grey left rail stretched)
  python make_tall_background.py small 1300 out_dir           # ABS_Background_Small   (left rail, no KPI band)

Page settings that go with it (page.json): displayOption "ActualSize" (scroll page; house rule 2026-10-08), height = <page px>,
background image scaling 'Fit', transparency 0. Register the file in report.json resourcePackages (RegisteredResources).
Scale rule (fixed 2026-10-13): every mode uses svg height = round(2480 * H / 720) (= 4405 * H / 1280), so the
svg units per page px vertically match the width (4405 / 1280 = 3.44). With 'Fit' at 1280 wide the navy header
(234 units) renders at ~68 px and the grey band (y 234.5, 203 units) at ~59 px on any page height; the page just gets taller.
(The old scroll rule 3111 * H / 1110 stretched the header ~1.23x to ~84 px.)
  kpis/small: left rail rect height = svg height - 239
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BG = os.path.join(HERE, "..", "assets", "backgrounds")


def main(kind, page_h, out_dir):
    page_h = int(page_h)
    if kind == "scroll":
        src = open(os.path.join(BG, "ABS_Background_Scroll.svg"), encoding="utf-8").read()
        svg_h = round(2480 * page_h / 720)   # same units-per-px as the 4405 width at 1280 px
        out = src.replace('height="3111"', f'height="{svg_h}"', 1)
        name = f"ABS_Background_Scroll_{page_h}.svg"
    elif kind in ("kpis", "small"):
        fn = "ABS_Background_KPIs.svg" if kind == "kpis" else "ABS_Background_Small.svg"
        src = open(os.path.join(BG, fn), encoding="utf-8").read()
        svg_h = round(2480 * page_h / 720)
        out = src.replace('height="2480"', f'height="{svg_h}"', 1).replace(
            'width="620" height="2241"', f'width="620" height="{svg_h - 239}"', 1)
        name = f"{fn[:-4]}_{page_h}.svg"
    else:
        sys.exit("kind must be scroll | kpis | small")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, name)
    with open(path, "w", encoding="utf-8", newline="\n") as f:   # never PowerShell Set-Content (BOM)
        f.write(out)
    print(path)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
