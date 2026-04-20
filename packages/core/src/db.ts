import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type {
  Card,
  CreateCardInput,
  KanbanColumn,
  CardLogEntry,
  CardAnnotation,
  Repo,
  AgentId,
} from './types';

// ─── Paths ────────────────────────────────────────────────────────────────────

export const USERAGENT0_DIR = path.join(os.homedir(), '.useragent0');
export const DB_PATH = path.join(USERAGENT0_DIR, 'agents.db');

function ensureDir(): void {
  if (!fs.existsSync(USERAGENT0_DIR)) {
    fs.mkdirSync(USERAGENT0_DIR, { recursive: true });
  }
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    git_platform TEXT NOT NULL DEFAULT 'github',
    active_agents TEXT NOT NULL DEFAULT '[]',
    registered_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    acceptance_criteria TEXT NOT NULL DEFAULT '[]',
    assigned_agent TEXT NOT NULL,
    file_scope TEXT NOT NULL DEFAULT '[]',
    column TEXT NOT NULL DEFAULT 'pm_creates',
    agent_log TEXT NOT NULL DEFAULT '[]',
    annotations TEXT DEFAULT NULL,
    pr_url TEXT DEFAULT NULL,
    estimated_complexity TEXT DEFAULT NULL,
    bounce_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (repo_id) REFERENCES repos(id)
  );

  CREATE INDEX IF NOT EXISTS idx_cards_repo_id ON cards(repo_id);
  CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column);
`;

// ─── DB Client ────────────────────────────────────────────────────────────────

export class DBClient {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    ensureDir();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ─── Repos ──────────────────────────────────────────────────────────────────

  registerRepo(name: string, repoPath: string, platform: 'github' | 'gitlab' = 'github'): Repo {
    const existing = this.db
      .prepare('SELECT * FROM repos WHERE path = ?')
      .get(repoPath) as RepoRow | undefined;

    if (existing) return deserializeRepo(existing);

    const repo: Repo = {
      id: uuidv4(),
      name,
      path: repoPath,
      git_platform: platform,
      active_agents: [],
      registered_at: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO repos (id, name, path, git_platform, active_agents, registered_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(repo.id, repo.name, repo.path, repo.git_platform, JSON.stringify(repo.active_agents), repo.registered_at);

    return repo;
  }

  getRepo(id: string): Repo | null {
    const row = this.db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as RepoRow | undefined;
    return row ? deserializeRepo(row) : null;
  }

  getRepoByPath(repoPath: string): Repo | null {
    const row = this.db.prepare('SELECT * FROM repos WHERE path = ?').get(repoPath) as RepoRow | undefined;
    return row ? deserializeRepo(row) : null;
  }

  listRepos(): Repo[] {
    const rows = this.db.prepare('SELECT * FROM repos ORDER BY registered_at DESC').all() as RepoRow[];
    return rows.map(deserializeRepo);
  }

  updateRepoAgents(repoId: string, agents: AgentId[]): void {
    this.db.prepare('UPDATE repos SET active_agents = ? WHERE id = ?')
      .run(JSON.stringify(agents), repoId);
  }

  // ─── Cards ──────────────────────────────────────────────────────────────────

  createCard(input: CreateCardInput): Card {
    const now = new Date().toISOString();
    const card: Card = {
      id: uuidv4(),
      repo_id: input.repo_id,
      title: input.title,
      description: input.description,
      acceptance_criteria: input.acceptance_criteria,
      assigned_agent: input.assigned_agent,
      file_scope: input.file_scope,
      column: 'pm_creates',
      agent_log: [{
        agent: 'pm',
        action: 'card_created',
        detail: `Card created: ${input.title}`,
        timestamp: now,
      }],
      annotations: null,
      pr_url: null,
      estimated_complexity: input.estimated_complexity ?? null,
      bounce_count: 0,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO cards (
        id, repo_id, title, description, acceptance_criteria,
        assigned_agent, file_scope, column, agent_log, annotations,
        pr_url, estimated_complexity, bounce_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      card.id, card.repo_id, card.title, card.description,
      JSON.stringify(card.acceptance_criteria), card.assigned_agent,
      JSON.stringify(card.file_scope), card.column,
      JSON.stringify(card.agent_log), null, null,
      card.estimated_complexity, 0, card.created_at, card.updated_at,
    );

    return card;
  }

  getCard(id: string): Card | null {
    const row = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined;
    return row ? deserializeCard(row) : null;
  }

  listCards(repoId: string): Card[] {
    const rows = this.db.prepare(
      'SELECT * FROM cards WHERE repo_id = ? ORDER BY created_at ASC'
    ).all(repoId) as CardRow[];
    return rows.map(deserializeCard);
  }

  listCardsByColumn(repoId: string, column: KanbanColumn): Card[] {
    const rows = this.db.prepare(
      'SELECT * FROM cards WHERE repo_id = ? AND column = ? ORDER BY created_at ASC'
    ).all(repoId, column) as CardRow[];
    return rows.map(deserializeCard);
  }

  moveCard(cardId: string, column: KanbanColumn, movedBy: AgentId | 'human' = 'human'): Card | null {
    const card = this.getCard(cardId);
    if (!card) return null;

    const now = new Date().toISOString();
    const logEntry: CardLogEntry = {
      agent: movedBy,
      action: 'column_changed',
      detail: `Moved from ${card.column} to ${column}`,
      timestamp: now,
    };

    const updatedLog = [...card.agent_log, logEntry];

    this.db.prepare(`
      UPDATE cards SET column = ?, agent_log = ?, updated_at = ? WHERE id = ?
    `).run(column, JSON.stringify(updatedLog), now, cardId);

    return this.getCard(cardId);
  }

  appendLog(cardId: string, entry: Omit<CardLogEntry, 'timestamp'>): Card | null {
    const card = this.getCard(cardId);
    if (!card) return null;

    const now = new Date().toISOString();
    const logEntry: CardLogEntry = { ...entry, timestamp: now };
    const updatedLog = [...card.agent_log, logEntry];

    this.db.prepare(`
      UPDATE cards SET agent_log = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(updatedLog), now, cardId);

    return this.getCard(cardId);
  }

  setAnnotations(cardId: string, annotations: CardAnnotation): Card | null {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE cards SET annotations = ?, bounce_count = bounce_count + 1, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(annotations), now, cardId);
    return this.getCard(cardId);
  }

  updateCard(cardId: string, updates: Partial<Pick<Card, 'pr_url' | 'estimated_complexity'>>): Card | null {
    const now = new Date().toISOString();
    const parts: string[] = [];
    const values: unknown[] = [];

    if (updates.pr_url !== undefined) { parts.push('pr_url = ?'); values.push(updates.pr_url); }
    if (updates.estimated_complexity !== undefined) { parts.push('estimated_complexity = ?'); values.push(updates.estimated_complexity); }

    if (parts.length === 0) return this.getCard(cardId);

    parts.push('updated_at = ?');
    values.push(now);
    values.push(cardId);

    this.db.prepare(`UPDATE cards SET ${parts.join(', ')} WHERE id = ?`).run(...values);
    return this.getCard(cardId);
  }

  deleteCard(cardId: string): void {
    this.db.prepare('DELETE FROM cards WHERE id = ?').run(cardId);
  }
}

// ─── Row types (SQLite returns flat strings) ──────────────────────────────────

interface RepoRow {
  id: string;
  name: string;
  path: string;
  git_platform: string;
  active_agents: string;
  registered_at: string;
}

interface CardRow {
  id: string;
  repo_id: string;
  title: string;
  description: string;
  acceptance_criteria: string;
  assigned_agent: string;
  file_scope: string;
  column: string;
  agent_log: string;
  annotations: string | null;
  pr_url: string | null;
  estimated_complexity: string | null;
  bounce_count: number;
  created_at: string;
  updated_at: string;
}

function deserializeRepo(row: RepoRow): Repo {
  return {
    ...row,
    git_platform: row.git_platform as Repo['git_platform'],
    active_agents: JSON.parse(row.active_agents),
  };
}

function deserializeCard(row: CardRow): Card {
  return {
    ...row,
    column: row.column as KanbanColumn,
    assigned_agent: row.assigned_agent as AgentId,
    acceptance_criteria: JSON.parse(row.acceptance_criteria),
    file_scope: JSON.parse(row.file_scope),
    agent_log: JSON.parse(row.agent_log),
    annotations: row.annotations ? JSON.parse(row.annotations) : null,
    estimated_complexity: row.estimated_complexity as Card['estimated_complexity'],
  };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _client: DBClient | null = null;

export function getDB(): DBClient {
  if (!_client) _client = new DBClient();
  return _client;
}
