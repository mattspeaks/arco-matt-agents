export interface Story {
  sys_id: string;
  number: string;
  short_description: string | null;
  description: string | null;
  acceptance_criteria: string | null;
  state_value: string | null;
  state_label: string | null;
  priority: string | null;
  assigned_to: string | null;
  sprint: string | null;
  story_points: string | null;
  tags: string | null;
  domain: string | null;
  synced_at: string;
}

export interface Lane {
  value: string | null;
  label: string;
  sequence: number;
}

export interface Board {
  stories: Story[];
  lanes: Lane[];
  syncedAt: string | null;
  laneMapping: { ready: string; agentInProgress: string; agentReview: string };
  instanceUrl: string;
  /** Matt's name as it appears in assigned_to. */
  me?: string;
  /** Close-out progress per story number. */
  closeouts?: Record<string, CloseoutProgress>;
  /** Matt's story points this sprint. */
  score?: SprintScore;
}

export interface SprintScore {
  sprint: { name: string; start: string | null; end: string | null; daysLeft: number | null } | null;
  done: { count: number; points: number };
  inFlight: { count: number; points: number };
  notStarted: { count: number; points: number };
  totalPoints: number;
}

export interface TimeCard {
  sys_id: string;
  task_number: string | null;
  task_class: string | null;
  task_short_description: string | null;
  top_task_number: string | null;
  category: string | null;
  sunday: number;
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  total: number;
  state: string | null;
}

export interface Timesheet {
  sheet: { sys_id: string; week_starts_on: string; week_ends_on: string; state: string; total_hours: number; synced_at: string } | null;
  cards: TimeCard[];
  /** The week shown (its Sunday, YYYY-MM-DD), and every week the app has a copy of. */
  week?: string | null;
  weeks?: string[];
  /** Matt's ServiceNow timesheet page, for the "Open in ServiceNow" link. */
  portalUrl?: string;
}

export type RunStatus = 'queued' | 'awaiting_approval' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Run {
  id: string;
  kind: 'sync' | 'orchestrator' | 'worker' | 'sn_write';
  worker: string | null;
  story_number: string | null;
  title: string | null;
  status: RunStatus;
  parent_run_id: string | null;
  conversation_id: string | null;
  error: string | null;
  meta: string | null;
  cost_usd: number | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  prompt?: string | null;
  result?: string | null;
}

export interface RunEvent {
  run_id: string;
  ts: string;
  type: string;
  summary: string | null;
  data?: unknown;
}

export interface Approval {
  id: string;
  kind: 'start_worker' | 'sn_write' | 'timesheet_write' | 'sn_confirm' | 'lesson' | 'pbi_start' | 'pbi_review' | 'pbi_revise' | 'pbi_publish' | 'pbi_gaps' | 'pbi_proceed' | 'time_entry' | 'story_close' | 'gap_design';
  title: string;
  payload: string;
  status: 'pending' | 'approved' | 'rejected' | 'superseded';
  outcome: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  session_id: string | null;
  story_number: string | null; // a story chat; null = main chat
  archived_at?: string | null;
  updated_at: string;
  busy_run_id?: string;
  closeout?: CloseoutProgress;
}

export interface CloseoutProgress {
  done: number;
  total: number;
  closed: boolean;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  doneAt?: string;
  doneBy?: 'matt' | 'app';
  note?: string;
  auto?: 'pr';
}

export interface Checklist {
  story_number: string;
  items: ChecklistItem[];
  created_at: string;
  closed_at: string | null;
}

export interface ChatMessage {
  id: number;
  conversation_id: string;
  role: 'user' | 'assistant' | 'error' | 'approval' | 'app' | 'checklist'; // approval: content is an approval id, shown as a card; app: a note from the app; checklist: content is a story number (its close-out card)
  content: string;
  run_id: string | null;
  created_at: string;
}

export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
