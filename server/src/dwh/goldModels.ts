import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { config, DATA_DIR } from '../config.js';
import { getDefinition, listItems } from '../fabric/client.js';

// A read-only local copy of the shared Gold semantic models (Gold Financials, Gold Shared Dimensions, Gold Job Cost…)
// as TMDL: which gold tables and columns each exposes, relationships and existing measures. The report model builder
// and the gap designer read it so "is it in the model?" has an answer. Fetched with getDefinition (read-only), one
// folder per model, refreshed when more than a day old. Nothing here ever writes to these models.

export const GOLD_MODELS_DIR = join(DATA_DIR, 'gold-models');
const STAMP = join(GOLD_MODELS_DIR, '.fetched');
const MAX_AGE_MS = 24 * 3600_000;

export function goldModelsStatus() {
  const asOf = existsSync(STAMP) ? statSync(STAMP).mtime.toISOString() : null;
  const models = existsSync(GOLD_MODELS_DIR) ? readdirSync(GOLD_MODELS_DIR).filter((f) => !f.startsWith('.')) : [];
  return { path: GOLD_MODELS_DIR, asOf, models };
}

const safeName = (s: string) => s.replace(/[<>:"/\\|?*]/g, '_').trim();

async function fetchGoldModels() {
  const { workspaceId, namePattern } = config.dwh.goldModels;
  const re = new RegExp(namePattern);
  const items = (await listItems(workspaceId)).filter((i) => i.type === 'SemanticModel' && re.test(i.displayName));
  if (!items.length) throw new Error(`No semantic models matching /${namePattern}/ in workspace ${workspaceId}`);
  const tmp = `${GOLD_MODELS_DIR}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const failed: string[] = [];
  // A few at a time: each getDefinition is a long-running operation.
  for (let i = 0; i < items.length; i += 4) {
    await Promise.all(
      items.slice(i, i + 4).map(async (item) => {
        try {
          const root = join(tmp, safeName(item.displayName));
          for (const part of await getDefinition(workspaceId, item.id, 'TMDL')) {
            const target = resolve(root, part.path);
            if (relative(root, target).startsWith('..')) continue;
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, Buffer.from(part.payload, 'base64'));
          }
        } catch {
          failed.push(item.displayName);
        }
      }),
    );
  }
  writeFileSync(join(tmp, '.fetched'), failed.length ? `failed: ${failed.join(', ')}\n` : 'ok\n');
  rmSync(GOLD_MODELS_DIR, { recursive: true, force: true });
  renameSync(tmp, GOLD_MODELS_DIR);
}

let running: Promise<void> | null = null;

/** Refreshes the copy when it's more than a day old (or with force). Never throws: returns the status and any error. */
export async function ensureGoldModels(force = false): Promise<ReturnType<typeof goldModelsStatus> & { error?: string }> {
  const st = goldModelsStatus();
  if (!force && st.asOf && Date.now() - Date.parse(st.asOf) < MAX_AGE_MS) return st;
  try {
    running ??= fetchGoldModels().finally(() => (running = null));
    await running;
    return goldModelsStatus();
  } catch (err) {
    return { ...goldModelsStatus(), error: err instanceof Error ? err.message : String(err) };
  }
}

/** One line for a worker brief. */
export function goldModelsLine(st: Awaited<ReturnType<typeof ensureGoldModels>>): string {
  return st.asOf
    ? `- Shared Gold semantic models, read-only TMDL copy (${st.models.join(', ')}; as of ${st.asOf.slice(0, 10)}): ${st.path}. One folder per model; \`definition/tables/*.tmdl\` lists each table's columns, measures and its source (partition), \`definition/relationships.tmdl\` the joins. Never change them.`
    : `- Shared Gold semantic models: not available (${st.error ?? 'unknown'}). Say "not checked against the Gold models" where it matters.`;
}
