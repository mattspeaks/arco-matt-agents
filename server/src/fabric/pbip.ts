import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { DefinitionPart } from './client.js';

// Converts between Fabric item definitions (base64 parts) and PBIP folders on disk (X.Report / X.SemanticModel).

/** Local-only files that are never uploaded or overwritten: the repo's .platform and Desktop's own cache/settings. */
const LOCAL_ONLY = (rel: string) => rel === '.platform' || /^\.pbi\/(localSettings\.json|cache\.abf)$/i.test(rel) || /\.abf$/i.test(rel);

export interface ModelRef {
  workspaceName?: string;
  modelName?: string;
  modelId?: string;
}

/** The semantic model a report's definition.pbir points at (byConnection), if any. */
export function parseModelRef(pbir: string): ModelRef {
  const cs: string | undefined = JSON.parse(pbir)?.datasetReference?.byConnection?.connectionString;
  if (!cs) return {};
  return {
    workspaceName: /myorg\/([^;]+)/i.exec(cs)?.[1]?.trim(),
    modelName: /initial catalog="?([^";]+)"?/i.exec(cs)?.[1],
    modelId: /semanticmodelid=([0-9a-f-]{36})/i.exec(cs)?.[1],
  };
}

export function pbirByPath(original: string, modelPath: string): string {
  const json = JSON.parse(original);
  json.datasetReference = { byPath: { path: modelPath } };
  return JSON.stringify(json, null, 2) + '\n';
}

export function pbirByConnection(original: string, workspaceName: string, modelName: string, modelId: string): string {
  const json = JSON.parse(original);
  json.datasetReference = {
    byConnection: {
      connectionString: `Data Source=powerbi://api.powerbi.com/v1.0/myorg/${workspaceName};initial catalog="${modelName}";integrated security=ClaimsToken;semanticmodelid=${modelId}`,
    },
  };
  return JSON.stringify(json, null, 2) + '\n';
}

export const partText = (parts: DefinitionPart[], path: string) => {
  const p = parts.find((x) => x.path === path);
  return p ? Buffer.from(p.payload, 'base64').toString('utf8') : undefined;
};

export const textPart = (path: string, text: string): DefinitionPart => ({ path, payload: Buffer.from(text, 'utf8').toString('base64'), payloadType: 'InlineBase64' });

/** Replaces an item folder's contents with the service's definition, keeping local-only files (.pbi/, .platform). */
export function writeParts(dir: string, parts: DefinitionPart[]): void {
  mkdirSync(dir, { recursive: true });
  for (const rel of walk(dir)) if (!LOCAL_ONLY(rel)) rmSync(join(dir, rel), { force: true });
  pruneEmptyDirs(dir);
  for (const part of parts) {
    if (part.path === '.platform' && existsSync(join(dir, '.platform'))) continue; // keep the repo's logicalId
    const target = resolve(dir, part.path);
    if (relative(dir, target).startsWith('..')) throw new Error(`Unsafe part path: ${part.path}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(part.payload, 'base64'));
  }
}

/** An item folder as definition parts for upload (local-only files excluded). */
export function readParts(dir: string): DefinitionPart[] {
  return walk(dir)
    .filter((rel) => !LOCAL_ONLY(rel))
    .map((rel) => ({ path: rel, payload: readFileSync(join(dir, rel)).toString('base64'), payloadType: 'InlineBase64' as const }));
}

/** Relative file paths (forward slashes) under dir. */
export function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const visit = (sub: string) => {
    for (const name of readdirSync(join(dir, sub))) {
      const rel = sub ? `${sub}/${name}` : name;
      if (statSync(join(dir, rel)).isDirectory()) visit(rel);
      else out.push(rel);
    }
  };
  visit('');
  return out;
}

function pruneEmptyDirs(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) continue;
    pruneEmptyDirs(p);
    if (!readdirSync(p).length) rmSync(p, { recursive: true });
  }
}

/** Finds an existing X.Report / X.SemanticModel folder under root whose .platform displayName matches. */
export function findItemFolder(root: string, type: 'Report' | 'SemanticModel', displayName: string, depth = 3): string | undefined {
  if (!existsSync(root)) return undefined;
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (name.startsWith('.') || !statSync(p).isDirectory()) continue;
    if (name.endsWith(`.${type}`)) {
      try {
        const meta = JSON.parse(readFileSync(join(p, '.platform'), 'utf8'));
        if (meta?.metadata?.displayName === displayName) return p;
      } catch {
        if (name === `${displayName}.${type}`) return p;
      }
      continue;
    }
    if (depth > 1) {
      const hit = findItemFolder(p, type, displayName, depth - 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function writePbip(path: string, reportFolderName: string): void {
  if (existsSync(path)) return;
  const pbip = {
    $schema: 'https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json',
    version: '1.0',
    artifacts: [{ report: { path: reportFolderName } }],
    settings: { enableAutoRecovery: true },
  };
  writeFileSync(path, JSON.stringify(pbip, null, 2) + '\n');
}
