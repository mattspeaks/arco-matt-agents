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
    /** The team's group (ABS Data and Analytics); stories are created in it and never moved out. */
    assignmentGroup: string;
    /** Matt's name as ServiceNow shows it in assigned_to (the board's "Me" filter). */
    myName: string;
    storyTable: string;
    timesheetPortalUrl: string;
    routingTags: Record<string, string[]>;
    lanes: { ready: string; agentInProgress: string; agentReview: string };
    agentAllowedTargetStates: string[];
    agentAllowedStateValues: string[];
    /** Lanes a newly created story may start in (Backlog, Draft, Ready). */
    agentCreateStateValues: string[];
    laneOrder: string[];
  };
  claude: { bin: string; syncModel: string; orchestratorModel: string; defaultWorkerModel: string };
  projectRoots: string[];
  /** Matt's default close-out list for a story; auto: 'pr' items tick themselves when the story's PR completes. */
  closeoutChecklist: { label: string; auto?: 'pr' }[];
  powerbi: {
    repoPath: string;
    /** Per-story git worktrees of the PowerBI repo (agent branches). */
    worktreeRoot: string;
    /** PR target; null = the remote's default branch. */
    baseBranch: string | null;
    /** Workspace name → repo folder, where the default (name minus "Acceptance Region") isn't right. */
    workspaceFolders: Record<string, string>;
    /** The house linter (arco-dwh-powerbi skill): run by the app on each build, branch vs starting point. */
    lint: { enabled: boolean; python: string; script: string };
    /** Regexes (case-sensitive): workspaces matching none of these count as production (extra confirmation on the card). */
    nonProductionWorkspacePatterns: string[];
    /** Regexes (case-sensitive) for workspaces agents never publish to. */
    blockedWorkspacePatterns: string[];
  };
  workers: Record<string, WorkerConfig>;
}

export const config: AppConfig = JSON.parse(readFileSync(resolve(REPO_ROOT, 'config/app.config.json'), 'utf8'));

export const DB_CONNECTION =
  process.env.ARCO_DB_CONNECTION ??
  'Driver={ODBC Driver 18 for SQL Server};Server=(localdb)\\MSSQLLocalDB;Database=ArcoAgents;Trusted_Connection=yes;TrustServerCertificate=yes;';

export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? config.claude.bin;

export const API_BASE = `http://127.0.0.1:${config.server.port}`;
