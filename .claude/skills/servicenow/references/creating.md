# Creating stories

Creating a story writes to ServiceNow for Matt, so it follows the same steps as every write: draft → approval card
→ Matt's Approve → create → verify → resync. One card can cover a batch.

## 1. Draft

**Short description:** an imperative title of 3–10 words, the way the board reads ("Add YTD measures to Safety
Scorecard", "Pull Procore RFIs into gold"). No product prefix.

**Description:** don't write "As a user I want…". Use:
```
Objective: <what needs to be done, concrete and testable>

Context: <why it matters; leave this out if there's nothing useful to say>
```

**Turning notes or a conversation into stories:** split the work into separately mergeable pieces (roughly one PR
each). Keep the details Matt gave, and don't invent requirements.

**Fields**

| Field | Default | Notes |
|---|---|---|
| `assignment_group` | `d2ab7f44472d21102a2bef4d646d4329` | ABS Data and Analytics. Always set it |
| `state` | `-10` (Backlog) | `-6` Draft or `1` Ready only if Matt says so. Ready + a routing hashtag means "ready for an agent". The guard allows only these three on create |
| `short_description` | required | |
| `description` | Objective / Context | |
| `acceptance_criteria` | Matt's criteria | If he gave none, draft concrete ones from the objective and label them as a draft in the preview |
| `story_points` | `3` | The team mostly uses 1, 2, 3, 5 or 8. Suggest another value only when the scope clearly differs |
| `priority` | `4` (4 - Low) | |
| `product`, `epic` | infer from the group | See the lookup below. Show both in the preview so Matt can correct them |
| `assigned_to` | Matt | Unless he names someone else (user lookup below) |
| `sprint` | empty (backlog) | The current sprint only if he says "this sprint". The app's board copy shows current-sprint stories only, so tell him a backlog story won't appear on the app's board until it's in a sprint |
| Routing hashtag | from the work | Put `#PowerBI`, `#SemanticModel`, `#Report`, `#DWH`, `#NewTable` or `#Pipeline` at the end of the short description or description, whichever the team uses (look at recent stories) |

Epics can't be created (the guard allows writes to `rm_story` only). If the work needs a new epic, say so in the
preview and suggest Matt creates it.

## 2. Look up product, epic, people and duplicates (reads)

Product and epic: take the values recent ABS D&A stories use, and match the epic on meaning:
```js
const G = 'd2ab7f44472d21102a2bef4d646d4329';
const rows = await SN(`/api/now/table/rm_story?sysparm_query=assignment_group=${G}^ORDERBYDESCsys_created_on&sysparm_limit=40&sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_fields=product,epic`);
const tally = {};
for (const r of rows) {
  const k = `${r.product.display_value} | ${r.epic.display_value}`;
  tally[k] = tally[k] || { product: r.product.value.replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-'), epic: r.epic.value.replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-'), n: 0 };
  tally[k].n++;
}
tally;
```
To see a product's open epics:
`rm_epic?sysparm_query=product=<product>^stateNOT IN3,4&sysparm_fields=sys_id,number,short_description`.

People: `sys_user?sysparm_query=sys_id=javascript:gs.getUserID()&sysparm_fields=sys_id,name` returns Matt. For anyone
else, use `nameLIKE<name>^active=true`. Return the sys_ids dashed, as in reading.md.

Duplicates: search open stories in the group (`assignment_group=<G>^stateNOT IN3,4^short_descriptionLIKE<keyword>`)
for two or three key words from the title. Mention any near-duplicates in the preview.

## 3. Preview: `mcp__arco__request_approval`, then end your turn

- Title: `New story: <title>`, or `New stories (n): <first title>, …`
- Preview: one compact table for the batch, then each story in full, exactly as it will be written:

```
| # | Title | Product | Epic | Pts | State | Sprint | Assigned |
|---|---|---|---|---|---|---|---|
| 1 | Add YTD measures to Safety Scorecard | Data & Analytics | D&A Enhancements 2026 | 3 | Backlog | (backlog) | Matt |

**1 · Add YTD measures to Safety Scorecard**
Objective: …
Context: …
Acceptance criteria: …

Possible duplicate: STRY00xxxxx "…" (Ready)
```

If Matt says "dry run" or "draft only", stop after showing the preview in chat, and don't call request_approval.

## 4. Create: only in the turn started by Matt's Approve ("Yes, go ahead: …")

Create in a call of its own: no updates to existing stories in the same snippet. Remove the dashes from the sys_ids.
Create sequentially. If one fails, stop and report which were created; don't retry blindly.

```js
const PAYLOADS = [
  {
    short_description: '<title>',
    description: '<Objective / Context>',
    acceptance_criteria: '<criteria>',
    assignment_group: 'd2ab7f44472d21102a2bef4d646d4329',
    state: '-10',
    story_points: '3',
    priority: '4',
    product: '<product sys_id>',
    epic: '<epic sys_id>',
    assigned_to: '<user sys_id>',
  },
];
const created = [];
for (const body of PAYLOADS) {
  const r = await SN('/api/now/table/rm_story?sysparm_display_value=true&sysparm_fields=number,sys_id,short_description,state', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  created.push({ number: r.number, sys_id: r.sys_id.replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-'), title: r.short_description, state: r.state });
}
created;
```

## 5. Verify and resync

- Check that each returned state is the one you intended. Reply with each new number linked to
  `https://arcoconstruction.service-now.com/rm_story.do?sys_id=<sys_id without dashes>`.
- Run the story snapshot from reading.md for each new story, then the board snapshot. If Matt then wants to work one of them, suggest its story chat.
