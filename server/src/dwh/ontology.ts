import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { config, DATA_DIR } from '../config.js';
import { getDefinition, listItems } from '../fabric/client.js';

// A read-only local copy of ARCO_Gold_Ontology (Fabric IQ): entities mapped to gold tables, named relationships, and
// descriptions with grain, join quality, traps and sensitivity flags. The report model builder reads it to pick
// tables, joins and derivations. Fetched with getDefinition (read-only) and refreshed when more than a day old.

export const ONTOLOGY_DIR = join(DATA_DIR, 'ontology');
const STAMP = join(ONTOLOGY_DIR, '.fetched');
const MAX_AGE_MS = 24 * 3600_000;

export function ontologyStatus() {
  const asOf = existsSync(STAMP) ? statSync(STAMP).mtime.toISOString() : null;
  const entities = existsSync(join(ONTOLOGY_DIR, 'entities')) ? readdirSync(join(ONTOLOGY_DIR, 'entities')).length : 0;
  return { path: ONTOLOGY_DIR, asOf, entities, item: config.dwh.ontology.name };
}

async function fetchOntology() {
  const { workspaceId, name } = config.dwh.ontology;
  const items = await listItems(workspaceId);
  const item = items.find((i) => i.type === 'Ontology' && i.displayName === name);
  if (!item) throw new Error(`No Ontology item "${name}" in workspace ${workspaceId}`);
  const parts = await getDefinition(workspaceId, item.id);
  const tmp = `${ONTOLOGY_DIR}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  for (const part of parts) {
    const target = resolve(tmp, part.path);
    if (relative(tmp, target).startsWith('..')) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(part.payload, 'base64'));
  }
  writeFileSync(join(tmp, '.fetched'), `${item.id}\n`);
  rmSync(ONTOLOGY_DIR, { recursive: true, force: true });
  // Rename via copy-free move: tmp becomes the live copy.
  const { renameSync } = await import('node:fs');
  renameSync(tmp, ONTOLOGY_DIR);
}

let running: Promise<void> | null = null;

/** Refreshes the copy when it's more than a day old (or with force). Never throws: returns the status and any error. */
export async function ensureOntology(force = false): Promise<ReturnType<typeof ontologyStatus> & { error?: string }> {
  const st = ontologyStatus();
  if (!force && st.asOf && Date.now() - Date.parse(st.asOf) < MAX_AGE_MS) return st;
  try {
    running ??= fetchOntology().finally(() => (running = null));
    await running;
    return ontologyStatus();
  } catch (err) {
    return { ...ontologyStatus(), error: err instanceof Error ? err.message : String(err) };
  }
}
