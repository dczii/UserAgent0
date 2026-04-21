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
        column: { type: 'string', description: 'Column slug to filter by. Call list_columns(repo_id) to get valid slugs.' },
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
        column: { type: 'string', description: 'Column slug to move to. Call list_columns(repo_id) to get valid slugs for this repo.' },
        moved_by: { type: 'string' },
      },
      required: ['card_id', 'column'],
    },
  },
  {
    name: 'append_log',
    description: 'Append a detailed log entry to a card. Call this after every meaningful action. Be specific: describe exactly what was done, which files were changed, what commands were run, what the outcome was, and what the next step is. Vague entries like "worked on task" are not acceptable — include file paths, function names, error messages, test results, and concrete next actions.',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: { type: 'string', description: 'The card ID to log against' },
        agent: { type: 'string', description: 'The agent performing the action (e.g. frontend_dev, tester)' },
        action: { type: 'string', description: 'Short label for the action (e.g. "implemented login button", "fixed failing test", "refactored auth middleware")' },
        detail: { type: 'string', description: 'Full description of what was done, why, and any relevant context or decisions made' },
        files_changed: { type: 'array', items: { type: 'string' }, description: 'List of file paths that were created or modified (e.g. ["src/components/LoginButton.tsx", "src/styles/auth.css"])' },
        commands_run: { type: 'array', items: { type: 'string' }, description: 'CLI commands executed (e.g. ["npm test", "npx tsc --noEmit"])' },
        outcome: { type: 'string', description: 'Result of the action — did it succeed, fail, or partially work? Include test results or error messages.' },
        next_step: { type: 'string', description: 'What will be done next on this card' },
        tokens: { type: 'number', description: 'Number of tokens consumed by the model in this action. Always include this so the card tracks total token usage.' },
      },
      required: ['card_id', 'agent', 'action', 'detail'],
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
  {
    name: 'list_columns',
    description: 'List the Kanban columns configured for a repo. Call this to get valid column slugs before calling move_card or list_cards.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_id: { type: 'string' },
      },
      required: ['repo_id'],
    },
  },
  {
    name: 'set_current_card',
    description: 'Set the active card being worked on. Writes the card ID to .agents/.current-card in the repo so git hooks can auto-advance the card on commit and push. Call this when you start working on a card.',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: { type: 'string', description: 'The card ID to set as active' },
        repo_id: { type: 'string', description: 'The repo ID — used to resolve the repo path' },
      },
      required: ['card_id', 'repo_id'],
    },
  },
  {
    name: 'get_next_card',
    description: 'Get the next unstarted or in-progress card for a repo. Optionally filter by agent type. Use this at the start of a session to find what to work on.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_id: { type: 'string', description: 'The repo ID to query' },
        assigned_agent: { type: 'string', enum: ['pm', 'frontend_dev', 'backend_dev', 'tester', 'pr_reviewer', 'ux_designer'], description: 'Filter by agent type' },
      },
      required: ['repo_id'],
    },
  },
  {
    name: 'update_card',
    description: 'Update card metadata — set the PR URL after creating a pull request, or update the estimated complexity.',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: { type: 'string' },
        pr_url: { type: 'string', description: 'The GitHub/GitLab PR URL after the PR is created' },
        estimated_complexity: { type: 'string', enum: ['small', 'medium', 'large'] },
      },
      required: ['card_id'],
    },
  },
] as const;

export type MCPToolName = typeof MCP_TOOLS[number]['name'];
