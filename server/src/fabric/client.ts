import { execFile } from 'node:child_process';

// Fabric REST API with Matt's own `az login` (no service principal, no stored secrets). Tokens come from the
// az CLI on demand and are cached in memory until shortly before they expire.
const FABRIC = 'https://api.fabric.microsoft.com/v1';
export const RESOURCE = { fabric: 'https://api.fabric.microsoft.com', devops: '499b84ac-1321-427f-aa17-267ca6975798' } as const;

const tokens = new Map<string, { token: string; expires: number }>();

export function azToken(resource: string): Promise<string> {
  const hit = tokens.get(resource);
  if (hit && hit.expires - Date.now() > 5 * 60_000) return Promise.resolve(hit.token);
  return new Promise((resolveToken, reject) => {
    // az is az.cmd on Windows, so it needs a shell; the arguments are constants.
    execFile('az', ['account', 'get-access-token', '--resource', resource, '-o', 'json'], { shell: true, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`az couldn't get a token (run "az login"): ${(stderr || err.message).trim().slice(0, 300)}`));
      const t = JSON.parse(stdout) as { accessToken: string; expires_on?: number; expiresOn?: string };
      const expires = t.expires_on ? t.expires_on * 1000 : Date.parse(t.expiresOn ?? '') || Date.now() + 30 * 60_000;
      tokens.set(resource, { token: t.accessToken, expires });
      resolveToken(t.accessToken);
    });
  });
}

export class FabricError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One Fabric call. Long-running operations (202 + Location) are polled; their result is returned if they have one. */
async function fabric<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers = { Authorization: `Bearer ${await azToken(RESOURCE.fabric)}`, 'Content-Type': 'application/json' };
  const res = await fetch(path.startsWith('http') ? path : `${FABRIC}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 202 && res.headers.get('location')) return pollOperation<T>(res.headers.get('location')!, headers, Number(res.headers.get('retry-after') ?? 2));
  const text = await res.text();
  if (!res.ok) throw new FabricError(`Fabric ${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 500)}`, res.status);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function pollOperation<T>(location: string, headers: Record<string, string>, retryAfter: number): Promise<T> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await sleep(Math.min(Math.max(retryAfter, 1), 10) * 1000);
    const op = (await (await fetch(location, { headers })).json()) as { status: string; error?: { errorCode?: string; message?: string } };
    if (op.status === 'Succeeded') {
      const result = await fetch(`${location}/result`, { headers });
      return (result.ok ? await result.json().catch(() => undefined) : undefined) as T;
    }
    if (op.status === 'Failed' || op.status === 'Cancelled') {
      throw new FabricError(`Fabric operation ${op.status.toLowerCase()}: ${op.error?.errorCode ?? ''} ${op.error?.message ?? ''}`.trim(), 500);
    }
  }
  throw new FabricError('Fabric operation timed out after 10 minutes', 504);
}

async function listAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = path;
  while (url) {
    const page: { value: T[]; continuationUri?: string } = await fabric(url);
    out.push(...page.value);
    url = page.continuationUri;
  }
  return out;
}

export interface Workspace {
  id: string;
  displayName: string;
  type: string;
}
export interface Item {
  id: string;
  displayName: string;
  type: string;
  workspaceId: string;
}
export interface DefinitionPart {
  path: string;
  payload: string; // base64
  payloadType: 'InlineBase64';
}

export const listWorkspaces = () => listAll<Workspace>('/workspaces');
export const listItems = (workspaceId: string, type?: string) =>
  listAll<Item>(`/workspaces/${workspaceId}/items${type ? `?type=${encodeURIComponent(type)}` : ''}`);

export async function getDefinition(workspaceId: string, itemId: string, format?: string): Promise<DefinitionPart[]> {
  const res = await fabric<{ definition: { parts: DefinitionPart[] } }>(
    `/workspaces/${workspaceId}/items/${itemId}/getDefinition${format ? `?format=${format}` : ''}`,
    { method: 'POST' },
  );
  return res.definition.parts;
}

export function createItem(workspaceId: string, p: { displayName: string; type: 'Report' | 'SemanticModel'; parts: DefinitionPart[]; format?: string }) {
  return fabric<Item>(`/workspaces/${workspaceId}/items`, {
    method: 'POST',
    body: { displayName: p.displayName, type: p.type, definition: { ...(p.format ? { format: p.format } : {}), parts: p.parts } },
  });
}

export function renameItem(workspaceId: string, itemId: string, displayName: string) {
  return fabric<Item>(`/workspaces/${workspaceId}/items/${itemId}`, { method: 'PATCH', body: { displayName } });
}

export async function updateDefinition(workspaceId: string, itemId: string, parts: DefinitionPart[], format?: string): Promise<void> {
  await fabric(`/workspaces/${workspaceId}/items/${itemId}/updateDefinition`, {
    method: 'POST',
    body: { definition: { ...(format ? { format } : {}), parts } },
  });
}
