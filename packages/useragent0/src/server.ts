import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { DBClient, DB_PATH } from './core';
import { MCP_TOOLS } from './core';
import type { KanbanColumn, AgentId, CardAnnotation } from './core';

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

function broadcastFeed(cardId: string, agent: AgentId | string, message: string) {
  broadcast({ type: 'agent:live_feed', payload: { card_id: cardId, agent, message } });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'connected', payload: { message: 'useragent0 server connected' } }));
});

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
  const card = db.moveCard(req.params.cardId, column as KanbanColumn, moved_by ?? 'human');
  if (!card) return res.status(404).json({ error: 'Card not found' });
  broadcast({ type: 'card:column_changed', payload: card });
  res.json(card);
});

app.post('/api/cards/:cardId/log', (req, res) => {
  const { agent, action, detail } = req.body;
  if (!agent || !action) return res.status(400).json({ error: 'agent and action required' });
  const card = db.appendLog(req.params.cardId, { agent, action, detail });
  if (!card) return res.status(404).json({ error: 'Card not found' });
  broadcast({ type: 'card:log_appended', payload: card });
  res.json(card);
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
  const bounceTarget = db.getColumns(card.repo_id)[1]?.slug ?? db.getColumns(card.repo_id)[0]?.slug ?? 'in_progress';
  card = db.moveCard(req.params.cardId, bounceTarget, 'tester') ?? card;
  broadcast({ type: 'card:bounced', payload: card });
  res.json(card);
});

// Columns
app.get('/api/repos/:repoId/columns', (req, res) => {
  res.json(db.getColumns(req.params.repoId));
});

app.put('/api/repos/:repoId/columns', (req, res) => {
  const cols = req.body as { slug: string; label: string; color?: string; position: number; human_gate?: boolean }[];
  if (!Array.isArray(cols) || !cols.length) return res.status(400).json({ error: 'columns array required' });
  const saved = db.setColumns(req.params.repoId, cols.map((c, i) => ({
    slug: c.slug,
    label: c.label,
    color: c.color ?? '#8FA8C0',
    position: c.position ?? i,
    human_gate: c.human_gate ?? false,
  })));
  broadcast({ type: 'columns:updated', payload: { repo_id: req.params.repoId, columns: saved } });
  res.json(saved);
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
      created.forEach(card => {
        broadcast({ type: 'card:created', payload: card });
        broadcastFeed(card.id, 'pm', `Card created: "${card.title}" → assigned to ${card.assigned_agent}`);
      });
      return { created: created.length, cards: created };
    }

    case 'move_card': {
      const { card_id, column, moved_by } = input as { card_id: string; column: KanbanColumn; moved_by?: string };
      const card = db.moveCard(card_id, column, (moved_by as AgentId) ?? 'human');
      if (!card) throw new Error(`Card ${card_id} not found`);
      broadcast({ type: 'card:column_changed', payload: card });
      broadcastFeed(card_id, (moved_by as AgentId) ?? 'human', `"${card.title}" moved → ${column.replace('_', ' ')}`);
      return card;
    }

    case 'append_log': {
      const { card_id, agent, action, detail, files_changed, commands_run, outcome, next_step, tokens } = input as {
        card_id: string; agent: string; action: string; detail?: string;
        files_changed?: string[]; commands_run?: string[]; outcome?: string; next_step?: string; tokens?: number;
      };
      const card = db.appendLog(card_id, {
        agent: agent as AgentId | 'human', action, detail,
        files_changed, commands_run, outcome, next_step, tokens,
      });
      if (!card) throw new Error(`Card ${card_id} not found`);
      broadcast({ type: 'card:log_appended', payload: card });
      const feedMsg = [
        `[${agent}] ${action}`,
        outcome ? `→ ${outcome}` : '',
        files_changed?.length ? `📄 ${files_changed.join(', ')}` : '',
        tokens ? `🪙 ${tokens} tokens` : '',
      ].filter(Boolean).join('  ');
      broadcastFeed(card_id, agent as AgentId, feedMsg);
      return card;
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
      const bounceTarget = db.getColumns(card.repo_id)[1]?.slug ?? db.getColumns(card.repo_id)[0]?.slug ?? 'in_progress';
      card = db.moveCard(card_id, bounceTarget, 'tester') ?? card;
      broadcast({ type: 'card:bounced', payload: card });
      broadcastFeed(card_id, 'tester', `"${card.title}" bounced back ↩  Root cause: ${root_cause}`);
      return card;
    }

    case 'list_columns': {
      const { repo_id } = input as { repo_id: string };
      return db.getColumns(repo_id);
    }

    case 'set_current_card': {
      const { card_id, repo_id } = input as { card_id: string; repo_id: string };
      const repo = db.getRepo(repo_id);
      if (!repo) throw new Error(`Repo ${repo_id} not found`);
      const card = db.getCard(card_id);
      if (!card) throw new Error(`Card ${card_id} not found`);
      const agentsDir = path.join(repo.path, '.agents');
      if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
      fs.writeFileSync(path.join(agentsDir, '.current-card'), card_id, 'utf-8');
      broadcastFeed(card_id, 'human', `Active card set: "${card.title}"`);
      return { ok: true, card_id, repo_path: repo.path };
    }

    case 'get_next_card': {
      const { repo_id, assigned_agent } = input as { repo_id: string; assigned_agent?: AgentId };
      const card = db.getNextCard(repo_id, assigned_agent);
      if (!card) return { message: 'No pending cards found', card: null };
      return card;
    }

    case 'update_card': {
      const { card_id, pr_url, estimated_complexity } = input as {
        card_id: string; pr_url?: string; estimated_complexity?: 'small' | 'medium' | 'large';
      };
      const card = db.updateCard(card_id, { pr_url, estimated_complexity });
      if (!card) throw new Error(`Card ${card_id} not found`);
      broadcast({ type: 'card:updated', payload: card });
      return card;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Serve UI ─────────────────────────────────────────────────────────────────

const UI_PATH = path.join(__dirname, '..', 'src', 'ui', 'index.html');

app.get('/', (_req, res) => {
  if (fs.existsSync(UI_PATH)) {
    res.sendFile(UI_PATH);
  } else {
    res.send('<h2>useragent0 server running</h2><p>UI not found. Check installation.</p>');
  }
});

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
