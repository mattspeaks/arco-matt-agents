import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, REPO_ROOT } from '../config.js';
import { query, queryOne } from '../db/index.js';
import { createApproval, type Approval } from '../approvals.js';
import { getConversation, postApprovalCard, postAppNote, sendMessage } from '../orchestrator.js';
import { createRun, getRun } from '../runs.js';
import { startWorkerRun } from '../workers.js';
import { ensureCatalog } from '../dwh/catalog.js';
import { ensureOntology } from '../dwh/ontology.js';
import { ensureGoldModels, goldModelsLine } from '../dwh/goldModels.js';
import { getFlow, gapsMarkdown, sourcesMarkdown, type FlowData, type GapMapping } from './flow.js';

// Working a "Data Gaps for - STRY…" story: dwh-gap-designer (read-only) separates name confusion from real gaps and
// writes text proposals (gold column additions, new gold / silver tables). Nothing is written to the DWH. Matt reviews
// the design on a card; approving it adds it to the gaps story as a work note and sends the approved name mappings
// back to the original report's story, whose model builder then uses them.

const DWH_REPO = () => resolve(config.dwh.repoPath);

/** The gaps story's original report story: given, or from a title like "Data Gaps for - STRY0024370 - …". */
async function originOf(gapsStory: string, given?: string): Promise<string | undefined> {
  if (given) return given.toUpperCase();
  const row = await queryOne<{ short_description: string | null }>('SELECT short_description FROM dbo.stories WHERE number = ?', [gapsStory]);
  return /STRY\d+/i.exec(row?.short_description ?? '')?.[0]?.toUpperCase();
}

function parseMappings(result: string): GapMapping[] {
  const m = /```gap-mappings\s*\n([\s\S]*?)```/.exec(result);
  if (!m) return [];
  try {
    const raw = JSON.parse(m[1]) as Record<string, unknown>[];
    return (Array.isArray(raw) ? raw : [])
      .filter((x) => x && typeof x.gap === 'string' && typeof (x.resolved_to ?? x.resolvedTo) === 'string')
      .map((x) => ({
        gap: String(x.gap).trim().slice(0, 200),
        resolvedTo: String(x.resolved_to ?? x.resolvedTo).trim().slice(0, 200),
        evidence: typeof x.evidence === 'string' ? x.evidence.trim().slice(0, 300) : undefined,
      }));
  } catch {
    return [];
  }
}

/** Starts the gap designer from the gaps story's chat. Read-only, so no start card. Its design comes back as a card. */
export async function startGapDesign(p: { parentRunId?: string | null; originStory?: string; notes?: string }) {
  const parent = p.parentRunId ? await getRun(p.parentRunId) : undefined;
  const conv = parent?.conversation_id ? await getConversation(parent.conversation_id) : undefined;
  if (!conv?.story_number) throw new Error('Start the gap design from the Data Gaps story\'s own chat');
  const gapsStory = conv.story_number;
  const origin = await originOf(gapsStory, p.originStory);
  const originFlow = origin ? await getFlow(origin) : undefined;
  const gaps = (originFlow?.data.gaps ?? []).filter((g) => g.kind !== 'derivable');
  const [catalog, ontology, gold] = await Promise.all([ensureCatalog(), ensureOntology(), ensureGoldModels()]);
  // Matt's latest declined design for this story, with his feedback: the rerun applies it.
  const previous = await queryOne<{ payload: string; decision_note: string | null }>(
    `SELECT TOP 1 payload, decision_note FROM dbo.approvals WHERE kind = 'gap_design' AND status = 'rejected' AND decision_note IS NOT NULL
       AND JSON_VALUE(payload, '$.storyNumber') = ? ORDER BY decided_at DESC`,
    [gapsStory],
  );
  const repo = existsSync(DWH_REPO()) ? DWH_REPO() : undefined;

  const brief = [
    `Data gaps story ${gapsStory}${origin ? `, raised by the report work on ${origin}` : ''}: work every gap below and write your proposal.`,
    gaps.length
      ? `## The gaps (from the report model builder on ${origin})\n${gapsMarkdown(gaps)}\n\n${sourcesMarkdown(gaps)}`
      : `## The gaps\nNot found in the app (the original report story is ${origin ?? 'unknown'}). Read them from the ServiceNow story's description: it's in the app's story copy, or ask in your result.`,
    previous?.decision_note &&
      `## Matt's feedback on the previous design (authoritative: apply every point)\n${previous.decision_note}\n\n### The previous design he declined\n${(JSON.parse(previous.payload) as { preview?: string }).preview?.slice(0, 9000) ?? '(not kept)'}`,
    p.notes && `## Notes from Matt / the orchestrator\n${p.notes}`,
    [
      '## Where',
      `- Ontology: ${ontology.asOf ? `${ontology.path} (${ontology.entities} entities, as of ${ontology.asOf.slice(0, 10)})` : `not available (${ontology.error ?? 'unknown'})`}`,
      `- Catalogs (tab-separated object, kind, column, type): ${catalog.filter((c) => c.asOf).map((c) => c.path).join(', ')}`,
      goldModelsLine(gold),
      `- ARCO data facts Matt confirmed (read first; they override your own findings): ${resolve(REPO_ROOT, 'memory', 'arco-data-lessons.md')}`,
      repo ? `- DWH repo (read-only, for how gold is built): ${repo}` : '- DWH repo: not found locally; rely on the catalogs and say so',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');

  const run = await createRun({
    kind: 'worker',
    worker: 'dwh-gap-designer',
    storyNumber: gapsStory,
    parentRunId: parent?.id,
    title: `dwh-gap-designer · ${gapsStory}: design for ${gaps.length || 'the'} data gap${gaps.length === 1 ? '' : 's'}${origin ? ` (from ${origin})` : ''}`,
    meta: { brief, projectPath: repo },
  });
  await postAppNote(conv.id, `Gap designer started on ${gaps.length || 'the'} gap${gaps.length === 1 ? '' : 's'}${origin ? ` from ${origin}` : ''}. Its proposal comes back as a card here.`);
  void (async () => {
    try {
      await startWorkerRun(run.id);
      const done = await getRun(run.id);
      if (done?.status !== 'succeeded') throw new Error(`the gap designer ${done?.status ?? 'failed'}${done?.error ? `: ${done.error}` : ''}`);
      const result = done.result ?? '';
      const mappings = parseMappings(result);
      const card = await createApproval({
        kind: 'gap_design',
        title: `${gapsStory}: gap design${mappings.length ? ` (${mappings.length} name mapping${mappings.length === 1 ? '' : 's'} to approve)` : ''}`,
        payload: {
          conversationId: conv.id,
          storyNumber: gapsStory,
          originStory: origin ?? '',
          mappings: JSON.stringify(mappings),
          preview: result.replace(/```gap-mappings[\s\S]*?```/, '').trim().slice(0, 14000),
          runId: run.id,
        },
        requestedByRunId: parent?.id,
      });
      await postApprovalCard(conv.id, card.id);
    } catch (err) {
      await postAppNote(conv.id, `**Gap design stopped:** ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
  return { run_id: run.id, status: 'running', note: 'The gap designer is running; its proposal comes back as a card in this chat. End your turn.' };
}

/** Matt's decision on a gap design. Approve: work note on the gaps story; the name mappings go to the original story. */
export async function decideGapDesign(approval: Approval, approve: boolean, note?: string): Promise<string> {
  const p = JSON.parse(approval.payload) as { conversationId: string; storyNumber: string; originStory: string; mappings: string };
  if (!approve) {
    if (!note?.trim()) {
      await postAppNote(p.conversationId, 'Gap design not approved. Tell the orchestrator here what to change, or decline it with a comment, and it reruns the designer with your feedback.');
      return 'Not approved';
    }
    // Answer first: if the chat is busy this throws and the card stays pending, so the feedback isn't lost.
    await sendMessage(
      p.conversationId,
      [
        `I'm not approving the gap design for ${p.storyNumber} yet. My feedback:`,
        '',
        note.trim(),
        '',
        '1. Answer any question I asked above.',
        '2. For each fact I stated about our data (what something really is, a source we will never use, what a column means), propose a lesson with propose_lesson, worker "arco-data", one per fact, so every data bot remembers it.',
        '3. Then call start_gap_design again. The app gives the designer the previous design and this feedback.',
      ].join('\n'),
      { answersApprovalId: approval.id },
    );
    return 'Not approved: feedback sent; the designer reruns with it';
  }
  const mappings = JSON.parse(p.mappings || '[]') as GapMapping[];
  await sendMessage(
    p.conversationId,
    `Yes, I approve the gap design${note ? ` (${note})` : ''}. Add it to ${p.storyNumber} in ServiceNow as a work note: the full proposal, or if it's very long, the summary plus each proposal's one-line headline. Then resync.${mappings.length && p.originStory ? ` The app is sending the ${mappings.length} approved name mapping(s) to ${p.originStory}.` : ''}`,
    { answersApprovalId: approval.id },
  );
  if (mappings.length && p.originStory) {
    const origin = await getFlow(p.originStory);
    if (origin) {
      const merged = [...(origin.data.approvedMappings ?? []).filter((m) => !mappings.some((n) => n.gap === m.gap)), ...mappings];
      const data: FlowData = { ...origin.data, approvedMappings: merged };
      await query('UPDATE dbo.story_flows SET data = ?, updated_at = SYSUTCDATETIME() WHERE story_number = ?', [data, p.originStory]);
      await postAppNote(
        origin.data.conversationId,
        [
          `**Name mappings approved** on the gap design for ${p.storyNumber}. These "gaps" exist under other names:`,
          ...mappings.map((m) => `- \`${m.gap}\` = \`${m.resolvedTo}\`${m.evidence ? ` (${m.evidence})` : ''}`),
          '',
          'The report model builder uses them on the next rebuild: ask here to rebuild.',
        ].join('\n'),
      );
    }
  }
  return `Approved${mappings.length ? `; ${mappings.length} mapping(s) sent to ${p.originStory || 'the report'}` : ''}`;
}

