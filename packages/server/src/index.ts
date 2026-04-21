import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import { DBClient, DB_PATH, DEFAULT_TOKEN_PRICE_PER_MILLION, readGlobalConfig } from '@useragent0/core';
import { MCP_TOOLS } from '@useragent0/core';
import type { KanbanColumn, AgentId, CardAnnotation } from '@useragent0/core';

// ─── Setup ────────────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const db = new DBClient(DB_PATH);

app.use(cors());
app.use(express.json());

// ─── WebSocket broadcast ──────────────────────────────────────────────────────

function broadcast(event: { type: string; payload: unknown }) {
  const msg = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'connected', payload: { message: 'useragent0 server connected' } }));
});

// ─── Cost helpers ─────────────────────────────────────────────────────────────

function getCostForRepo(repoId: string) {
  const cfg = readGlobalConfig();
  const price = cfg.token_price_per_million ?? DEFAULT_TOKEN_PRICE_PER_MILLION;
  const budget = cfg.repo_budgets_usd?.[repoId] ?? null;
  return db.getRepoCostStats(repoId, price, budget);
}

/** Called after a card log is appended — broadcasts a budget warning if we crossed the line. */
function checkBudget(repoId: string) {
  const stats = getCostForRepo(repoId);
  if (stats.over_budget) {
    broadcast({
      type: 'repo:budget_warning',
      payload: {
        repo_id: repoId,
        total_cost_usd: stats.total_cost_usd,
        budget_limit_usd: stats.budget_limit_usd,
        total_tokens: stats.total_tokens,
      },
    });
  }
}

// ─── REST API ─────────────────────────────────────────────────────────────────

// Repos
app.get('/api/repos', (_req, res) => {
  res.json(db.listRepos());
});

app.post('/api/repos', (req, res) => {
  const { name, path: repoPath, git_platform } = req.body;
  if (!name || !repoPath) return res.status(400).json({ error: 'name and path required' });
  const repo = db.registerRepo(name, repoPath, git_platform ?? 'github');
  broadcast({ type: 'repo:registered', payload: repo });
  res.json(repo);
});

// Cards
app.get('/api/repos/:repoId/cards', (req, res) => {
  const { column } = req.query;
  const cards = column
    ? db.listCardsByColumn(req.params.repoId, column as KanbanColumn)
    : db.listCards(req.params.repoId);
  res.json(cards);
});

app.post('/api/repos/:repoId/cards', (req, res) => {
  const { title, description, acceptance_criteria, assigned_agent, file_scope, estimated_complexity } = req.body;
  if (!title || !assigned_agent) return res.status(400).json({ error: 'title and assigned_agent required' });
  const card = db.createCard({
    repo_id: req.params.repoId,
    title,
    description: description ?? '',
    acceptance_criteria: acceptance_criteria ?? [],
    assigned_agent: assigned_agent as AgentId,
    file_scope: file_scope ?? [],
    estimated_complexity: estimated_complexity ?? null,
  });
  broadcast({ type: 'card:created', payload: card });
  res.json(card);
});

app.get('/api/cards/:cardId', (req, res) => {
  const card = db.getCard(req.params.cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  res.json(card);
});

app.patch('/api/cards/:cardId/move', (req, res) => {
  const { column, moved_by } = req.body;
  if (!column) return res.status(400).json({ error: 'column required' });
  try {
    const card = db.moveCard(req.params.cardId, column as KanbanColumn, moved_by ?? 'human');
    if (!card) return res.status(404).json({ error: 'Card not found' });
    broadcast({ type: 'card:column_changed', payload: card });
    res.json(card);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(409).json({ error: message });
  }
});

app.post('/api/cards/:cardId/log', (req, res) => {
  const { agent, action, detail, tokens } = req.body;
  if (!agent || !action) return res.status(400).json({ error: 'agent and action required' });
  const card = db.appendLog(req.params.cardId, { agent, action, detail, tokens });
  if (!card) return res.status(404).json({ error: 'Card not found' });
  broadcast({ type: 'card:log_appended', payload: card });
  if (tokens) checkBudget(card.repo_id);
  res.json(card);
});

// Dependencies
app.get('/api/cards/:cardId/dependencies', (req, res) => {
  const card = db.getCard(req.params.cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  res.json({
    blocked_by: db.getBlockedBy(req.params.cardId),
    blocks: db.getBlocks(req.params.cardId),
  });
});

app.post('/api/cards/:cardId/dependencies', (req, res) => {
  const { blocked_by_id } = req.body;
  if (!blocked_by_id) return res.status(400).json({ error: 'blocked_by_id required' });
  try {
    const dep = db.addDependency(req.params.cardId, blocked_by_id);
    broadcast({ type: 'card:dependency_added', payload: dep });
    res.json(dep);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/cards/:cardId/dependencies/:blockedById', (req, res) => {
  db.removeDependency(req.params.cardId, req.params.blockedById);
  broadcast({
    type: 'card:dependency_removed',
    payload: { card_id: req.params.cardId, blocked_by_id: req.params.blockedById },
  });
  res.json({ ok: true });
});

// Cost
app.get('/api/repos/:repoId/cost', (req, res) => {
  res.json(getCostForRepo(req.params.repoId));
});

app.post('/api/cards/:cardId/bounce', (req, res) => {
  const { failed_tests, failed_criteria, root_cause, suggested_fix } = req.body;
  if (!root_cause) return res.status(400).json({ error: 'root_cause required' });

  const annotation: CardAnnotation = {
    failed_tests: failed_tests ?? [],
    failed_criteria: failed_criteria ?? [],
    root_cause,
    suggested_fix: suggested_fix ?? '',
    bounce_count: 0,
    annotated_at: new Date().toISOString(),
    annotated_by: 'tester',
  };

  let card = db.setAnnotations(req.params.cardId, annotation);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  card = db.moveCard(req.params.cardId, 'in_progress', 'tester') ?? card;
  broadcast({ type: 'card:bounced', payload: card });
  res.json(card);
});

// Live feed (agent pushes status messages)
app.post('/api/cards/:cardId/feed', (req, res) => {
  const { agent, message } = req.body;
  broadcast({ type: 'agent:live_feed', payload: { card_id: req.params.cardId, agent, message } });
  res.json({ ok: true });
});

// ─── MCP Endpoint ─────────────────────────────────────────────────────────────
// Implements the MCP protocol so IDEs (Cursor, Claude Code, Windsurf)
// can connect and call useragent0 tools directly.

// MCP: list tools
app.get('/mcp', (_req, res) => {
  res.json({
    name: 'useragent0',
    version: '1.0.0',
    description: 'AI developer agents Kanban workflow for any repository',
    tools: MCP_TOOLS,
  });
});

// MCP: call tool
app.post('/mcp', async (req, res) => {
  const { name, input } = req.body as { name: string; input: Record<string, unknown> };

  try {
    const result = await handleMCPTool(name, input);
    res.json({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

async function handleMCPTool(name: string, input: Record<string, unknown>) {
  switch (name) {
    case 'list_repos':
      return db.listRepos();

    case 'list_cards': {
      const { repo_id, column } = input as { repo_id: string; column?: KanbanColumn };
      return column
        ? db.listCardsByColumn(repo_id, column)
        : db.listCards(repo_id);
    }

    case 'get_card': {
      const { card_id } = input as { card_id: string };
      const card = db.getCard(card_id);
      if (!card) throw new Error(`Card ${card_id} not found`);
      return card;
    }

    case 'create_card': {
      const { repo_id, cards } = input as {
        repo_id: string;
        cards: Array<{
          title: string;
          description?: string;
          acceptance_criteria?: string[];
          assigned_agent: AgentId;
          file_scope?: string[];
          estimated_complexity?: 'small' | 'medium' | 'large';
        }>;
      };
      const created = cards.map(c =>
        db.createCard({
          repo_id,
          title: c.title,
          description: c.description ?? '',
          acceptance_criteria: c.acceptance_criteria ?? [],
          assigned_agent: c.assigned_agent,
          file_scope: c.file_scope ?? [],
          estimated_complexity: c.estimated_complexity ?? null,
        })
      );
      created.forEach(card => broadcast({ type: 'card:created', payload: card }));
      return { created: created.length, cards: created };
    }

    case 'move_card': {
      const { card_id, column, moved_by } = input as { card_id: string; column: KanbanColumn; moved_by?: string };
      const card = db.moveCard(card_id, column, (moved_by as AgentId) ?? 'human');
      if (!card) throw new Error(`Card ${card_id} not found`);
      broadcast({ type: 'card:column_changed', payload: card });
      return card;
    }

    case 'append_log': {
      const { card_id, agent, action, detail, tokens } = input as { card_id: string; agent: string; action: string; detail?: string; tokens?: number };
      const card = db.appendLog(card_id, { agent: agent as AgentId | 'human', action, detail, tokens });
      if (!card) throw new Error(`Card ${card_id} not found`);
      broadcast({ type: 'card:log_appended', payload: card });
      if (tokens) checkBudget(card.repo_id);
      return card;
    }

    case 'add_dependency': {
      const { card_id, blocked_by_id } = input as { card_id: string; blocked_by_id: string };
      const dep = db.addDependency(card_id, blocked_by_id);
      broadcast({ type: 'card:dependency_added', payload: dep });
      return dep;
    }

    case 'remove_dependency': {
      const { card_id, blocked_by_id } = input as { card_id: string; blocked_by_id: string };
      db.removeDependency(card_id, blocked_by_id);
      broadcast({ type: 'card:dependency_removed', payload: { card_id, blocked_by_id } });
      return { ok: true };
    }

    case 'get_dependencies': {
      const { card_id } = input as { card_id: string };
      return {
        blocked_by: db.getBlockedBy(card_id),
        blocks: db.getBlocks(card_id),
      };
    }

    case 'get_repo_cost': {
      const { repo_id } = input as { repo_id: string };
      return getCostForRepo(repo_id);
    }

    case 'bounce_card': {
      const { card_id, failed_tests, failed_criteria, root_cause, suggested_fix } = input as {
        card_id: string;
        failed_tests?: string[];
        failed_criteria?: string[];
        root_cause: string;
        suggested_fix?: string;
      };
      const annotation: CardAnnotation = {
        failed_tests: failed_tests ?? [],
        failed_criteria: failed_criteria ?? [],
        root_cause,
        suggested_fix: suggested_fix ?? '',
        bounce_count: 0,
        annotated_at: new Date().toISOString(),
        annotated_by: 'tester',
      };
      let card = db.setAnnotations(card_id, annotation);
      if (!card) throw new Error(`Card ${card_id} not found`);
      card = db.moveCard(card_id, 'in_progress', 'tester') ?? card;
      broadcast({ type: 'card:bounced', payload: card });
      return card;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok', db: DB_PATH }));

// ─── Start ────────────────────────────────────────────────────────────────────

export function startServer(port = 4000) {
  server.listen(port, () => {
    console.log(`\n  useragent0 server running`);
    console.log(`  UI  →  http://localhost:${port}`);
    console.log(`  MCP →  http://localhost:${port}/mcp`);
    console.log(`  DB  →  ${DB_PATH}\n`);
  });
  return server;
}
