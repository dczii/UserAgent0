// ─── Kanban Column Types ──────────────────────────────────────────────────────

/** Column slug stored in cards.column — now a free string, validated against repo_columns */
export type KanbanColumn = string;

export interface ColumnConfig {
  id: string;
  repo_id: string;
  slug: string;
  label: string;
  color: string;
  position: number;
  human_gate: boolean;
}

// ─── Column Templates ─────────────────────────────────────────────────────────

export type ColumnTemplate = 'simple' | 'dev_workflow' | 'custom';

export const COLUMN_TEMPLATES: Record<'simple' | 'dev_workflow', Omit<ColumnConfig, 'id' | 'repo_id'>[]> = {
  simple: [
    { slug: 'todo',        label: 'TODO',        color: '#00C9A7', position: 0, human_gate: false },
    { slug: 'in_progress', label: 'IN PROGRESS', color: '#FFD166', position: 1, human_gate: false },
    { slug: 'done',        label: 'DONE',         color: '#22C55E', position: 2, human_gate: false },
  ],
  dev_workflow: [
    { slug: 'todo',        label: 'TODO',        color: '#00C9A7', position: 0, human_gate: false },
    { slug: 'in_progress', label: 'IN PROGRESS', color: '#FFD166', position: 1, human_gate: false },
    { slug: 'test',        label: 'TEST',         color: '#7C3AED', position: 2, human_gate: false },
    { slug: 'qa',          label: 'QA',           color: '#F06595', position: 3, human_gate: true  },
    { slug: 'done',        label: 'DONE',         color: '#22C55E', position: 4, human_gate: false },
  ],
};

/** All available columns a user can pick from when choosing "Custom" */
export const CUSTOM_COLUMN_CHOICES: Omit<ColumnConfig, 'id' | 'repo_id' | 'position'>[] = [
  { slug: 'todo',        label: 'TODO',        color: '#00C9A7', human_gate: false },
  { slug: 'in_progress', label: 'IN PROGRESS', color: '#FFD166', human_gate: false },
  { slug: 'test',        label: 'TEST',         color: '#7C3AED', human_gate: false },
  { slug: 'qa',          label: 'QA',           color: '#F06595', human_gate: true  },
  { slug: 'commit',      label: 'COMMIT',       color: '#00C9A7', human_gate: false },
  { slug: 'create_pr',   label: 'CREATE PR',    color: '#F06595', human_gate: false },
  { slug: 'done',        label: 'DONE',         color: '#22C55E', human_gate: false },
];

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
  files_changed?: string[];
  commands_run?: string[];
  outcome?: string;
  next_step?: string;
  tokens?: number;
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
  tokens_used: number;
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
  initial_column?: string;
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
