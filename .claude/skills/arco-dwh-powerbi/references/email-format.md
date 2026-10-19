# Email format: LOCKED STANDARD (approved by Sean 2026-10-06)

Every email draft, reply or new message uses exactly this format. Do not experiment with other list methods
(`<ul>/<ol>`, tables): both were tried and rejected. The reference email is the 2026-10-06 reply to Austin Moore
("RE: Arco Working Capital Surety Whitepaper", bonding report ask), approved as "perfect".

## Layout
- Greeting, blank line, opening sentence, blank line.
- Bold Title Case section headers (e.g. **Scope**, **New Columns**, **Items Where I May Need Decisions or Help**, **Next Steps**) when the email has more than one topic.
- **The first bullet sits on the line directly under its header: no blank line between a header and its list.**
- **No blank lines between list items.** One blank line after each list / before the next header.
- Bullets for any list of 2+ items (scope items, fields, options, examples); never cram a list into a sentence.
- Numbered list for questions / decisions the reader must answer, each item led by a bold short label ("**Mega job threshold:** ...").
- Sub-points indented one level further under their parent item, marked "o".
- Each item fits on one line (short, one idea); trim wording rather than wrap.
- Prose paragraphs (e.g. under **Next Steps**) have a blank line before and after.
- No em dashes or en dashes (use ":" "()" ";" or "-").
- Readers are business users: no table, schema or column names; name source systems (Vista, Procore, UKG) only.
- Sign-off: Sean uses his Outlook signature ("Cheers," + title block). End the body after the last paragraph plus one blank line; do not type "Thanks, Sean".

## Outlook HTML (Microsoft connector)
- Allowed tags only: div, p, br, b/strong, i/em, ul/ol/li, h1-h6, table tags, a, code, pre, hr, strike.
  **No `style=`, `class=` or `id=` attributes** (the draft is rejected).
- Every line is its own `<div>`; a blank line is `<div><br></div>`. Never join two lines with `<br>`.
- Lists are plain indented `<div>` lines, never `<ul>/<ol>` (Outlook adds a blank-line margin above them and the connector
  blocks the style that removes it) and never tables (Outlook shows dotted gridlines while composing):
  - bullet: `<div>&nbsp;&nbsp;&nbsp;&nbsp;&#8226;&nbsp;&nbsp;Text</div>` (4 nbsp, bullet, 2 nbsp)
  - numbered: `<div>&nbsp;&nbsp;&nbsp;&nbsp;1.&nbsp;&nbsp;<b>Label:</b> text</div>`
  - sub-point: `<div>` + 11 `&nbsp;` + `o&nbsp;&nbsp;Text</div>`
- To change a reply draft's body, create a new reply draft and delete the old one (`outlook_update_draft` with a body
  replaces the quoted thread too). Don't delete a draft Sean has edited by hand; leave it and tell him.

## Skeleton (copy this)
```html
<div>Austin,</div><div><br></div>
<div>Opening sentence confirming the ask:</div><div><br></div>
<div><b>Scope</b></div>
<div>&nbsp;&nbsp;&nbsp;&nbsp;&#8226;&nbsp;&nbsp;Item</div>
<div>&nbsp;&nbsp;&nbsp;&nbsp;&#8226;&nbsp;&nbsp;Item with sub-points:</div>
<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;o&nbsp;&nbsp;Sub</div>
<div>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;o&nbsp;&nbsp;Sub</div>
<div><br></div>
<div><b>Items Where I May Need Decisions or Help</b></div>
<div>&nbsp;&nbsp;&nbsp;&nbsp;1.&nbsp;&nbsp;<b>Label:</b> short question?</div>
<div>&nbsp;&nbsp;&nbsp;&nbsp;2.&nbsp;&nbsp;<b>Label:</b> short question?</div>
<div><br></div>
<div><b>Next Steps</b></div><div><br></div>
<div>What happens next.</div><div><br></div>
```
