import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = resolve(REPO_ROOT, 'data');

dotenv.config({ path: resolve(REPO_ROOT, '.env') });

export interface WorkerConfig {
  domain: string;
  requiresApproval: boolean;
  readOnly: boolean;
  allowedTools: string[];
  disallowedTools?: string[];
  model?: string;
}

export interface AppConfig {
  server: { port: number };
  servicenow: {
    instanceUrl: string;
    boardSysId: string;
    storyTable: string;
    routingTags: Record<string, string[]>;
    lanes: { ready: string; agentInProgress: string; agentReview: string };
    agentAllowedTargetStates: string[];
    laneOrder: string[];
  };
  claude: { bin: string; syncModel: string; orchestratorModel: string; defaultWorkerModel: string };
  projectRoots: string[];
  workers: Record<string, WorkerConfig>;
}

export const config: AppConfig = JSON.parse(readFileSync(resolve(REPO_ROOT, 'config/app.config.json'), 'utf8'));

export const DB_CONNECTION =
  process.env.ARCO_DB_CONNECTION ??
  'Driver={ODBC Driver 18 for SQL Server};Server=(localdb)\\MSSQLLocalDB;Database=ArcoAgents;Trusted_Connection=yes;TrustServerCertificate=yes;';

export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? config.claude.bin;

export const API_BASE = `http://127.0.0.1:${config.server.port}`;
