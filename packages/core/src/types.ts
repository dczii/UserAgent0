// ─── Kanban Column Types ──────────────────────────────────────────────────────

export type KanbanColumn =
  | 'pm_creates'
  | 'in_progress'
  | 'commit'
  | 'create_pr'
  | 'test'
  | 'qa'
  | 'done';

export const KANBAN_COLUMNS: KanbanColumn[] = [
  'pm_creates',
  'in_progress',
  'commit',
  'create_pr',
  'test',
  'qa',
  'done',
];

export const COLUMN_LABELS: Record<KanbanColumn, string> = {
  pm_creates: 'PM Creates',
  in_progress: 'In Progress',
  commit: 'Commit',
  create_pr: 'Create PR',
  test: 'Test',
  qa: 'QA',
  done: 'Done',
};

// ─── Agent Types ──────────────────────────────────────────────────────────────

export type AgentId =
  | 'pm'
  | 'frontend_dev'
  | 'backend_dev'
  | 'tester'
  | 'pr_reviewer'
  | 'ux_designer';

export const AGENT_LABELS: Record<AgentId, string> = {
  pm: 'PM Agent',
  frontend_dev: 'Frontend Dev',
  backend_dev: 'Backend Dev',
  tester: 'Tester',
  pr_reviewer: 'PR Reviewer',
  ux_designer: 'UI/UX Designer',
};

// ─── Card ─────────────────────────────────────────────────────────────────────

export interface CardAnnotation {
  failed_tests: string[];
  failed_criteria: string[];
  root_cause: string;
  suggested_fix: string;
  bounce_count: number;
  annotated_at: string;
  annotated_by: AgentId;
}

export interface CardLogEntry {
  agent: AgentId | 'human';
  action: string;
  detail?: string;
  timestamp: string;
}

export interface Card {
  id: string;
  repo_id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  assigned_agent: AgentId;
  file_scope: string[];
  column: KanbanColumn;
  agent_log: CardLogEntry[];
  annotations: CardAnnotation | null;
  pr_url: string | null;
  estimated_complexity: 'small' | 'medium' | 'large' | null;
  bounce_count: number;
  created_at: string;
  updated_at: string;
}

export type CreateCardInput = Pick<
  Card,
  | 'repo_id'
  | 'title'
  | 'description'
  | 'acceptance_criteria'
  | 'assigned_agent'
  | 'file_scope'
> & {
  estimated_complexity?: Card['estimated_complexity'];
};

// ─── Repository ───────────────────────────────────────────────────────────────

export interface Repo {
  id: string;
  name: string;
  path: string;
  git_platform: 'github' | 'gitlab';
  active_agents: AgentId[];
  registered_at: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface GlobalConfig {
  anthropic_api_key?: string;
  openai_api_key?: string;
  default_model: string;
  default_provider: 'anthropic' | 'openai';
  server_port: number;
}

export interface RepoConfig {
  repo: string;
  version: string;
  agents: Partial<Record<AgentId, { enabled: boolean }>>;
  model: {
    provider: 'anthropic' | 'openai';
    model: string;
    max_tokens: number;
  };
  conventions: {
    commit_format: 'conventional' | 'freeform';
    branch_prefix: string;
    test_framework: 'jest' | 'vitest' | 'pytest' | 'rspec';
    style_guide?: string;
  };
  human_gates: {
    require_approval_at_commit: boolean;
    require_approval_at_qa: boolean;
  };
}

// ─── WebSocket Events ─────────────────────────────────────────────────────────

export type WSEventType =
  | 'card:created'
  | 'card:updated'
  | 'card:column_changed'
  | 'card:log_appended'
  | 'agent:started'
  | 'agent:finished'
  | 'agent:live_feed';

export interface WSEvent {
  type: WSEventType;
  payload: unknown;
  timestamp: string;
}

export interface AgentLiveFeedEvent extends WSEvent {
  type: 'agent:live_feed';
  payload: {
    card_id: string;
    agent: AgentId;
    message: string;
  };
}
