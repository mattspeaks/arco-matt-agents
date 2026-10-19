# Color palettes

Decide per report: which audience? If the CIO (IT reports: Timecard, PMO / SNOW, capacity, HR-IT) will use it, charts
use the CIO color-blind palette. Board / finance / ANH reports use the standard brand palette. Ask if unsure.

## 1. Standard brand palette (theme dataColors, in order)
`#003865` navy, `#6B8F9C` slate, `#E66C37` orange, `#6B007B` purple, `#E044A7` pink, `#744EC2` violet, `#D9B300` gold, `#D64550` red.
Status accents on dark/navy surfaces (ANH board, Project Health): good `#2E7D32`, watch `#D9B300`, bad `#D64550`, neutral `#C8C6C4`.

## 2. House RAG (tables, matrices, heat maps, KPI card backgrounds) - ALWAYS, every audience
| Meaning | Fill | Notes |
|---|---|---|
| Green / on track | `#C6EFCE` | |
| Amber / watch | `#FFEB9C` | |
| Red / act | `#FFC7CE` | strong red `#EC7063`; heat-scale reds `#F5B7B1`, `#FADBD8` |
| Neutral / no data | `#FFFFFF` or `#EDEDED` | |
| Process check (info, color unchanged) | `#D6E1EA` | |
Old neon pastels (`#94FF9D`, `#F0E199`, `#EFB5B9`) are replaced by the house RAG when refreshing old reports.
Numbers are printed in tables, so RAG is fine there even for the CIO (he explicitly reversed a color-blind table attempt).

## 3. CIO color-blind palette (bar, column, line, scatter CHARTS only)
The CIO is partly color blind: never put gold next to orange or green next to red in a chart. One meaning per color.
| Series | Hex |
|---|---|
| Projects | `#F2C811` yellow |
| Operations / Ops-Ticketed | `#003865` dark blue |
| Ops-No Ticket, Available Capacity, anything needing attention | `#E66C37` orange |
| Non-Project / Other Work | `#A4262C` deep red |
| Time Off / off / n.a. | `#A6A6A6` gray |
RAG expressed in a chart: Red = orange `#E66C37`, Yellow = slate `#6B8F9C`, Green = navy `#003865`.
Non work-type charts (e.g. trend by leader): theme order navy, slate, orange, purple, pink (he likes it).
Status charts: Submitted navy, Incomplete slate, Missing orange, OT Review purple.
Exception kept on purpose: Time Card Summary heat map red `#de6a73` = 0 hrs, yellow `#e1c233` = incomplete.

## DAX color measure patterns
```
RED, AMBER, GREEN, GREY = "#FFC7CE", "#FFEB9C", "#C6EFCE", "#EDEDED"
[X Color]       = SWITCH([X RAG], "Red", "#FFC7CE", "Yellow", "#FFEB9C", "Green", "#C6EFCE", "#EDEDED")
[X Chart Color] = SWITCH([X RAG], "Red", "#E66C37", "Yellow", "#6B8F9C", "Green", "#003865", "#A6A6A6")
[Count Color]   = IF([Projects Red] > 0, "#FFC7CE", "#FFFFFF")      -- white when nothing to flag
```
Bind card backgrounds / table cell backColor / chart dataPoint fill to these measures (field-value conditional formatting).

## Choosing the RAG form in grids (user rule 2026-10-02: "color code the grid... choose what makes the most sense")
Pick the form by what the column says; never color everything.
| Column type | Form | Example |
|---|---|---|
| Overall status of the row | Badge icon column (first column, sorts worst first) | project / issue / buyout status |
| A measure with a threshold (good / watch / act) | Cell background fill, house RAG `#C6EFCE` / `#FFEB9C` / `#FFC7CE`, blank when no data | profit %, profit change, over/under, AR 90+, snapshot age, days to finish |
| Only the bad side matters | Fill only when bad (amber or red), no green | AR 90+, a line over budget, out-of-compliance |
| Share of a whole / progress | Data bar (light navy `#9DB7CC`, text still shown) | % complete, buyout % |
| Money totals, names, dates with no threshold | No color | contract, cost code, subcontractor |
Implement fills as color measures (`Fill <thing>` returning a hex or BLANK) bound to `values.backColor` per column
(`selector.metadata` = the column queryRef + dataViewWildcard); data bars go in that column's `columnFormatting` entry
(`dataBars`: positiveColor / negativeColor / axisColor / reverseDirection / hideText). Say the thresholds in the "?" tooltip.
Reference: `Project Health\build\gen_measures.py` (_Colors folder) + `gen_report.py` table(cond=..., bars=...).

**Cards follow the same rule (user, 2026-10-02: "why is there no RAG on the cards?")**: every KPI / fact card whose number has a
threshold gets a RAG background (fact card container background = Fill measure), e.g. AR aging buckets (0-30 green, 31-90 amber,
91-180 red), pending / draft COs amber when > 0, net / projected cash red when negative else green, buyout open amber, snapshot age,
days to finish. Plain amounts (contract, billed, received, retainage, remaining) and names / dates stay white. Review every card on
every page before handing over. Text measures in grids stay LEFT; only numeric / date / badge columns are centered (check_pbir CENTER
now reads the model to tell them apart).

