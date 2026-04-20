import type { Card, AgentId, KanbanColumn } from './types';
import type { DBClient } from './db';

export interface AgentContext {
  card: Card;
  db: DBClient;
  onLiveFeed?: (message: string) => void;
}

export interface AgentResult {
  success: boolean;
  next_column?: KanbanColumn;
  output?: string;
  error?: string;
}

export interface AgentModule {
  id: AgentId;
  name: string;
  triggerColumn: KanbanColumn;
  run(context: AgentContext): Promise<AgentResult>;
}

export interface PMCardDraft {
  title: string;
  description: string;
  acceptance_criteria: string[];
  assigned_agent: 'frontend_dev' | 'backend_dev';
  file_scope: string[];
  estimated_complexity: 'small' | 'medium' | 'large';
}

export function parsePMResponse(raw: string): PMCardDraft[] {
  const cleaned = raw
    .replace(/^```json\s*/m, '')
    .replace(/^```\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();

  let parsed: { cards?: PMCardDraft[] } | PMCardDraft[];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Could not parse PM response as JSON: ${cleaned.slice(0, 200)}`);
  }

  const cards = Array.isArray(parsed)
    ? parsed
    : (parsed as { cards?: PMCardDraft[] }).cards ?? [];

  if (!cards.length) throw new Error('No cards returned from PM agent');

  return cards.map((c, i) => {
    if (!c.title) throw new Error(`Card ${i} missing title`);
    if (!c.assigned_agent) throw new Error(`Card ${i} missing assigned_agent`);
    return {
      title: c.title.slice(0, 80),
      description: c.description ?? '',
      acceptance_criteria: Array.isArray(c.acceptance_criteria) ? c.acceptance_criteria : [],
      assigned_agent: c.assigned_agent,
      file_scope: Array.isArray(c.file_scope) ? c.file_scope : [],
      estimated_complexity: c.estimated_complexity ?? 'medium',
    };
  });
}

export const MCP_TOOLS = [
  {
    name: 'create_card',
    description: 'Create one or more task cards on the Kanban board from a requirement. Returns created card IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_id: { type: 'string' },
        cards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              acceptance_criteria: { type: 'array', items: { type: 'string' } },
              assigned_agent: { type: 'string', enum: ['frontend_dev', 'backend_dev'] },
              file_scope: { type: 'array', items: { type: 'string' } },
              estimated_complexity: { type: 'string', enum: ['small', 'medium', 'large'] },
            },
            required: ['title', 'assigned_agent'],
          },
        },
      },
      required: ['repo_id', 'cards'],
    },
  },
  {
    name: 'list_repos',
    description: 'List all repositories registered with useragent0.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_cards',
    description: 'List all cards for a repository, optionally filtered by column.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_id: { type: 'string' },
        column: { type: 'string', enum: ['pm_creates','in_progress','commit','create_pr','test','qa','done'] },
      },
      required: ['repo_id'],
    },
  },
  {
    name: 'get_card',
    description: 'Get full details of a card including agent log and annotations.',
    inputSchema: {
      type: 'object',
      properties: { card_id: { type: 'string' } },
      required: ['card_id'],
    },
  },
  {
    name: 'move_card',
    description: 'Move a card to a different Kanban column.',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: { type: 'string' },
        column: { type: 'string', enum: ['pm_creates','in_progress','commit','create_pr','test','qa','done'] },
        moved_by: { type: 'string' },
      },
      required: ['card_id', 'column'],
    },
  },
  {
    name: 'append_log',
    description: 'Append a log entry to a card. Use this to record agent progress, files changed, or actions taken.',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: { type: 'string' },
        agent: { type: 'string' },
        action: { type: 'string' },
        detail: { type: 'string' },
      },
      required: ['card_id', 'agent', 'action'],
    },
  },
  {
    name: 'bounce_card',
    description: 'Bounce a card back to In Progress with a failure annotation when tests fail or QA finds issues.',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: { type: 'string' },
        failed_tests: { type: 'array', items: { type: 'string' } },
        failed_criteria: { type: 'array', items: { type: 'string' } },
        root_cause: { type: 'string' },
        suggested_fix: { type: 'string' },
      },
      required: ['card_id', 'root_cause'],
    },
  },
] as const;

export type MCPToolName = typeof MCP_TOOLS[number]['name'];
