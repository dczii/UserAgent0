'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useAgentsSocket } from '../hooks/useAgentsSocket';

// ─── Types ────────────────────────────────────────────────────────────────────

type KanbanColumn = 'pm_creates'|'in_progress'|'commit'|'create_pr'|'test'|'qa'|'done';

interface Card {
  id: string;
  repo_id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  assigned_agent: string;
  file_scope: string[];
  column: KanbanColumn;
  agent_log: { agent: string; action: string; detail?: string; timestamp: string; tokens?: number }[];
  annotations: { root_cause: string; suggested_fix: string; failed_tests: string[] } | null;
  pr_url: string | null;
  estimated_complexity: string | null;
  bounce_count: number;
  created_at: string;
  updated_at: string;
  total_tokens?: number;
}

interface Repo { id: string; name: string; path: string; }
interface FeedItem { message: string; ts: string; id: number; }
interface CostStats {
  total_tokens: number;
  total_cost_usd: number;
  card_count: number;
  budget_limit_usd: number | null;
  over_budget: boolean;
  by_agent: { agent: string; tokens: number; cost_usd: number }[];
}
interface Dependencies { blocked_by: Card[]; blocks: Card[]; }

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMNS: { id: KanbanColumn; label: string; color: string }[] = [
  { id: 'pm_creates',  label: 'PM Creates',  color: '#00C9A7' },
  { id: 'in_progress', label: 'In Progress', color: '#FFD166' },
  { id: 'commit',      label: 'Commit',      color: '#A78BFA' },
  { id: 'create_pr',   label: 'Create PR',   color: '#38BDF8' },
  { id: 'test',        label: 'Test',        color: '#FB923C' },
  { id: 'qa',          label: 'QA',          color: '#F472B6' },
  { id: 'done',        label: 'Done',        color: '#4ADE80' },
];

const HUMAN_GATE_COLS: KanbanColumn[] = ['in_progress', 'qa'];
const API = 'http://localhost:4000';

const COMPLEXITY_COLORS: Record<string, string> = {
  small:  '#4ADE80',
  medium: '#FFD166',
  large:  '#EF4444',
};

function fmtUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1)    return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        background: `${color}1A`,
        color,
        border: `1px solid ${color}33`,
      }}
    >
      {text}
    </span>
  );
}

// ─── CardItem ─────────────────────────────────────────────────────────────────

function CardItem({ card, highlighted, blockedCount, onClick }: {
  card: Card;
  highlighted: boolean;
  blockedCount: number;
  onClick: () => void;
}) {
  const col = COLUMNS.find(c => c.id === card.column)!;
  const cardTokens = card.agent_log.reduce((s, e) => s + (e.tokens ?? 0), 0);
  return (
    <div
      onClick={onClick}
      className={`relative rounded-xl p-3.5 cursor-pointer border transition-all duration-200 hover:-translate-y-0.5 group ${highlighted ? 'animate-card-moved' : ''}`}
      style={{
        background: highlighted
          ? `linear-gradient(135deg, ${col.color}12 0%, var(--bg-panel) 100%)`
          : 'var(--bg-card)',
        borderColor: highlighted ? `${col.color}55` : 'var(--border)',
        borderLeft: `3px solid ${col.color}`,
        boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
      }}
    >
      <div
        className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${col.color}18, transparent 70%)`,
          transform: 'translate(25%, -25%)',
        }}
      />

      <p className="text-sm font-medium leading-snug mb-2.5 pr-2" style={{ color: 'var(--text)' }}>
        {card.title}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <Badge text={card.assigned_agent.replace(/_/g, ' ')} color="var(--text-muted)" />
        {card.estimated_complexity && (
          <Badge
            text={card.estimated_complexity}
            color={COMPLEXITY_COLORS[card.estimated_complexity] ?? '#94A3B8'}
          />
        )}
        {card.bounce_count > 0 && (
          <Badge text={`↩ ${card.bounce_count}`} color="#EF4444" />
        )}
        {blockedCount > 0 && (
          <Badge text={`⛔ ${blockedCount}`} color="#EF4444" />
        )}
      </div>

      {cardTokens > 0 && (
        <div className="mt-2 text-[10px] font-mono" style={{ color: 'var(--text-faint)' }}>
          {fmtTokens(cardTokens)} tok
        </div>
      )}
    </div>
  );
}

// ─── CardDetail ───────────────────────────────────────────────────────────────

function CardDetail({ card, deps, allCards, onClose, onMove, onAddDep, onRemoveDep }: {
  card: Card;
  deps: Dependencies;
  allCards: Card[];
  onClose: () => void;
  onMove: (col: KanbanColumn) => void;
  onAddDep: (blockedById: string) => void;
  onRemoveDep: (blockedById: string) => void;
}) {
  const col = COLUMNS.find(c => c.id === card.column)!;
  const colIndex = COLUMNS.findIndex(c => c.id === card.column);
  const nextCol = COLUMNS[colIndex + 1];
  const [showAddDep, setShowAddDep] = useState(false);
  const openBlockers = deps.blocked_by.filter(b => b.column !== 'done');
  const isBlocked = openBlockers.length > 0;

  const addable = allCards.filter(c =>
    c.id !== card.id &&
    !deps.blocked_by.some(b => b.id === c.id)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end"
      style={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(3px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-[500px] h-full overflow-y-auto flex flex-col animate-panel-in"
        style={{
          background: 'var(--bg-detail)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-12px 0 48px rgba(0,0,0,0.3)',
        }}
      >
        <div
          className="h-1 flex-shrink-0"
          style={{ background: `linear-gradient(90deg, ${col.color}, ${col.color}33, transparent)` }}
        />

        <div className="flex-1 p-6 flex flex-col gap-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <span
                className="inline-block text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full mb-2.5"
                style={{
                  background: `${col.color}15`,
                  color: col.color,
                  border: `1px solid ${col.color}30`,
                }}
              >
                {col.label}
              </span>
              <h2 className="text-base font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>{card.title}</h2>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 transition-all text-lg mt-1"
              style={{ color: 'var(--text-muted)' }}
            >
              ×
            </button>
          </div>

          {card.description && (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-dim)' }}>{card.description}</p>
          )}

          {card.acceptance_criteria.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-faint)' }}>
                Acceptance Criteria
              </h3>
              <ul className="space-y-1.5">
                {card.acceptance_criteria.map((c, i) => (
                  <li key={i} className="flex gap-2.5 text-sm" style={{ color: 'var(--text-dim)' }}>
                    <span className="mt-0.5 flex-shrink-0 text-xs" style={{ color: '#00C9A7' }}>✓</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Dependencies */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                Dependencies
              </h3>
              <button
                onClick={() => setShowAddDep(v => !v)}
                className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
                style={{
                  color: '#00C9A7',
                  borderColor: '#00C9A740',
                  background: '#00C9A70D',
                }}
              >
                {showAddDep ? 'Cancel' : '+ Add blocker'}
              </button>
            </div>

            {showAddDep && (
              <div
                className="rounded-lg p-2 mb-2 max-h-40 overflow-y-auto"
                style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
              >
                {addable.length === 0 ? (
                  <div className="text-xs italic p-1.5" style={{ color: 'var(--text-quiet)' }}>No other cards available.</div>
                ) : addable.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { onAddDep(c.id); setShowAddDep(false); }}
                    className="w-full text-left text-xs px-2 py-1.5 rounded hover:opacity-80 transition-opacity"
                    style={{ color: 'var(--text-dim)' }}
                  >
                    <span className="font-medium">{c.title}</span>
                    <span className="ml-2 text-[10px]" style={{ color: 'var(--text-quiet)' }}>{c.column}</span>
                  </button>
                ))}
              </div>
            )}

            {deps.blocked_by.length === 0 && deps.blocks.length === 0 && !showAddDep && (
              <div className="text-xs italic" style={{ color: 'var(--text-quiet)' }}>No dependencies.</div>
            )}

            {deps.blocked_by.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Blocked by
                </div>
                <div className="space-y-1">
                  {deps.blocked_by.map(b => (
                    <div
                      key={b.id}
                      className="flex items-center gap-2 text-xs rounded-lg px-2.5 py-1.5"
                      style={{
                        background: b.column === 'done' ? '#4ADE800A' : '#EF44440A',
                        border: `1px solid ${b.column === 'done' ? '#4ADE8030' : '#EF444430'}`,
                      }}
                    >
                      <span style={{ color: b.column === 'done' ? '#4ADE80' : '#EF4444' }}>
                        {b.column === 'done' ? '✓' : '⛔'}
                      </span>
                      <span className="flex-1 truncate" style={{ color: 'var(--text-dim)' }}>{b.title}</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-quiet)' }}>{b.column}</span>
                      <button
                        onClick={() => onRemoveDep(b.id)}
                        className="text-[11px] opacity-60 hover:opacity-100"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {deps.blocks.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Blocks
                </div>
                <div className="space-y-1">
                  {deps.blocks.map(b => (
                    <div
                      key={b.id}
                      className="text-xs rounded-lg px-2.5 py-1.5"
                      style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}
                    >
                      {b.title}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {card.annotations && (
            <div
              className="rounded-xl p-4 border"
              style={{ borderColor: '#EF444430', background: '#EF44440C' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider">Bounced Back</span>
                {card.bounce_count > 0 && (
                  <span className="text-xs bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full border border-red-500/25">
                    {card.bounce_count}×
                  </span>
                )}
              </div>
              <p className="text-sm mb-2" style={{ color: 'var(--text-dim)' }}>
                <strong className="font-medium" style={{ color: 'var(--text)' }}>Root cause: </strong>
                {card.annotations.root_cause}
              </p>
              {card.annotations.suggested_fix && (
                <p className="text-sm mb-2" style={{ color: 'var(--text-dim)' }}>
                  <strong className="font-medium" style={{ color: 'var(--text)' }}>Suggested fix: </strong>
                  {card.annotations.suggested_fix}
                </p>
              )}
              {card.annotations.failed_tests.length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="text-[11px] font-medium text-red-400 mb-1.5">Failed tests</div>
                  {card.annotations.failed_tests.map((t, i) => (
                    <div key={i} className="text-xs font-mono rounded-lg px-3 py-1.5"
                      style={{ background: 'rgba(0,0,0,0.12)', color: 'var(--text-muted)' }}>
                      {t}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {card.file_scope.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-faint)' }}>File Scope</h3>
              <div className="flex flex-wrap gap-1.5">
                {card.file_scope.map((f, i) => (
                  <span
                    key={i}
                    className="text-xs font-mono px-2.5 py-1 rounded-lg"
                    style={{ background: 'var(--bg-chip)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}
                  >
                    {f}
                  </span>
                ))}
              </div>
            </section>
          )}

          {card.pr_url && (
            <a
              href={card.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm font-medium transition-colors"
              style={{ color: '#38BDF8' }}
            >
              View Pull Request
              <span className="text-xs opacity-70">↗</span>
            </a>
          )}

          {nextCol && (
            <button
              onClick={() => onMove(nextCol.id)}
              disabled={nextCol.id === 'in_progress' && isBlocked}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: `linear-gradient(135deg, ${nextCol.color}, ${nextCol.color}BB)`,
                color: '#0B1624',
                boxShadow: `0 4px 20px ${nextCol.color}33`,
              }}
            >
              {nextCol.id === 'in_progress' && isBlocked
                ? `Blocked by ${openBlockers.length} card${openBlockers.length === 1 ? '' : 's'}`
                : `Move to ${nextCol.label} →`}
            </button>
          )}

          <div className="h-px" style={{ background: 'var(--border)' }} />

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-faint)' }}>Agent Log</h3>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {[...card.agent_log].reverse().map((entry, i) => (
                <div
                  key={i}
                  className="text-xs pl-3 py-2 rounded-r-lg border-l-2"
                  style={{
                    borderColor: i === 0 ? '#00C9A7' : 'var(--border)',
                    background: i === 0 ? '#00C9A708' : 'transparent',
                  }}
                >
                  <div className="flex gap-2 items-center mb-0.5 flex-wrap">
                    <span className="font-semibold" style={{ color: '#00C9A7' }}>{entry.agent}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{entry.action}</span>
                    {entry.tokens != null && entry.tokens > 0 && (
                      <span className="font-mono text-[10px]" style={{ color: 'var(--text-faint)' }}>
                        {fmtTokens(entry.tokens)} tok
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--text-quiet)' }}>
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  {entry.detail && (
                    <div className="leading-relaxed mt-0.5" style={{ color: 'var(--text-muted)' }}>{entry.detail}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Theme toggle ─────────────────────────────────────────────────────────────

function useTheme(): [boolean, () => void] {
  const [light, setLight] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.classList.contains('theme-light');
  });

  useEffect(() => {
    setLight(document.documentElement.classList.contains('theme-light'));
  }, []);

  const toggle = useCallback(() => {
    setLight(prev => {
      const next = !prev;
      document.documentElement.classList.toggle('theme-light', next);
      try { localStorage.setItem('ua0-theme', next ? 'light' : 'dark'); } catch {}
      return next;
    });
  }, []);

  return [light, toggle];
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BoardPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [deps, setDeps] = useState<Dependencies>({ blocked_by: [], blocks: [] });
  const [depsByCard, setDepsByCard] = useState<Record<string, number>>({});
  const [cost, setCost] = useState<CostStats | null>(null);
  const [budgetAlert, setBudgetAlert] = useState<string | null>(null);
  const [liveFeed, setLiveFeed] = useState<FeedItem[]>([]);
  const [highlightedCardIds, setHighlightedCardIds] = useState<Set<string>>(new Set());
  const feedCounter = useRef(0);
  const { connected, messages } = useAgentsSocket();
  const [light, toggleTheme] = useTheme();

  // Load repos
  useEffect(() => {
    fetch(`${API}/api/repos`)
      .then(r => r.json())
      .then((data: Repo[]) => {
        setRepos(data);
        if (data.length > 0) setSelectedRepo(data[0].id);
      })
      .catch(() => {});
  }, []);

  // Load cards
  const loadCards = useCallback(() => {
    if (!selectedRepo) return;
    fetch(`${API}/api/repos/${selectedRepo}/cards`)
      .then(r => r.json())
      .then(setCards)
      .catch(() => {});
  }, [selectedRepo]);

  // Load cost
  const loadCost = useCallback(() => {
    if (!selectedRepo) return;
    fetch(`${API}/api/repos/${selectedRepo}/cost`)
      .then(r => r.json())
      .then(setCost)
      .catch(() => {});
  }, [selectedRepo]);

  const loadDepsForCard = useCallback((cardId: string) => {
    fetch(`${API}/api/cards/${cardId}/dependencies`)
      .then(r => r.json())
      .then(setDeps)
      .catch(() => {});
  }, []);

  // Fetch blocker counts for all cards (one-shot on card list change)
  useEffect(() => {
    if (cards.length === 0) return;
    let cancelled = false;
    Promise.all(
      cards.map(c =>
        fetch(`${API}/api/cards/${c.id}/dependencies`)
          .then(r => r.json())
          .then((d: Dependencies) => [c.id, d.blocked_by.filter(b => b.column !== 'done').length] as const)
          .catch(() => [c.id, 0] as const)
      )
    ).then(results => {
      if (cancelled) return;
      setDepsByCard(Object.fromEntries(results));
    });
    return () => { cancelled = true; };
  }, [cards]);

  useEffect(() => { loadCards(); loadCost(); }, [loadCards, loadCost]);

  useEffect(() => {
    if (selectedCard) loadDepsForCard(selectedCard.id);
    else setDeps({ blocked_by: [], blocks: [] });
  }, [selectedCard, loadDepsForCard]);

  // Handle WS messages
  useEffect(() => {
    if (!messages.length) return;
    const msg = messages[messages.length - 1];

    const cardEvents = ['card:created', 'card:updated', 'card:column_changed', 'card:log_appended', 'card:bounced'];
    if (cardEvents.includes(msg.type)) {
      loadCards();
      const updated = msg.payload as Card;
      if (selectedCard?.id === updated.id) setSelectedCard(updated);
      if (msg.type === 'card:log_appended') loadCost();

      if (msg.type === 'card:column_changed' || msg.type === 'card:created') {
        setHighlightedCardIds(prev => new Set(Array.from(prev).concat(updated.id)));
        setTimeout(() => {
          setHighlightedCardIds(prev => {
            const next = new Set(prev);
            next.delete(updated.id);
            return next;
          });
        }, 1100);
      }
    }

    if (msg.type === 'card:dependency_added' || msg.type === 'card:dependency_removed') {
      loadCards();
      if (selectedCard) loadDepsForCard(selectedCard.id);
    }

    if (msg.type === 'repo:budget_warning') {
      const p = msg.payload as { repo_id: string; total_cost_usd: number; budget_limit_usd: number };
      if (p.repo_id === selectedRepo) {
        setBudgetAlert(
          `Budget exceeded: ${fmtUsd(p.total_cost_usd)} of ${fmtUsd(p.budget_limit_usd)} limit`
        );
        setTimeout(() => setBudgetAlert(null), 8000);
      }
    }

    if (msg.type === 'agent:live_feed') {
      const p = msg.payload as { message: string };
      setLiveFeed(prev => [
        ...prev.slice(-49),
        { message: p.message, ts: new Date().toLocaleTimeString(), id: feedCounter.current++ },
      ]);
    }
  }, [messages, loadCards, loadCost, loadDepsForCard, selectedCard, selectedRepo]);

  const moveCard = useCallback(async (cardId: string, column: KanbanColumn) => {
    const res = await fetch(`${API}/api/cards/${cardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column, moved_by: 'human' }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Move failed' }));
      setBudgetAlert(body.error || 'Move failed');
      setTimeout(() => setBudgetAlert(null), 6000);
      return;
    }
    loadCards();
  }, [loadCards]);

  const addDep = useCallback(async (cardId: string, blockedById: string) => {
    const res = await fetch(`${API}/api/cards/${cardId}/dependencies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocked_by_id: blockedById }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Failed to add dependency' }));
      setBudgetAlert(body.error);
      setTimeout(() => setBudgetAlert(null), 6000);
      return;
    }
    loadDepsForCard(cardId);
  }, [loadDepsForCard]);

  const removeDep = useCallback(async (cardId: string, blockedById: string) => {
    await fetch(`${API}/api/cards/${cardId}/dependencies/${blockedById}`, { method: 'DELETE' });
    loadDepsForCard(cardId);
  }, [loadDepsForCard]);

  const cardsByColumn = (col: KanbanColumn) => cards.filter(c => c.column === col);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header
        className="flex items-center gap-4 px-5 py-3 flex-shrink-0"
        style={{
          background: 'var(--bg-header)',
          borderBottom: '1px solid var(--border-strong)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div
            className="relative flex items-center justify-center px-2.5 h-8 rounded-lg flex-shrink-0 overflow-hidden font-mono font-bold text-sm"
            style={{
              background: 'linear-gradient(135deg, #061218 0%, #0C2030 100%)',
              border: '1px solid #00C9A755',
              boxShadow: '0 0 0 1px #00C9A715, 0 0 18px #00C9A728, inset 0 1px 0 #00C9A725',
              letterSpacing: '0.08em',
            }}
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,201,167,0.04) 2px, rgba(0,201,167,0.04) 4px)',
              }}
            />
            <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 border-t border-l pointer-events-none" style={{ borderColor: '#00C9A770' }} />
            <div className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 border-b border-r pointer-events-none" style={{ borderColor: '#00C9A770' }} />
            <span className="relative" style={{ color: '#e2e8f0' }}>U</span>
            <span className="relative" style={{ color: '#00C9A7', textShadow: '0 0 8px #00C9A7CC, 0 0 20px #00C9A755' }}>0</span>
          </div>
          <span className="font-semibold text-sm tracking-tight" style={{ color: '#00C9A7' }}>
            agents-kit
          </span>
        </div>

        <div className="w-px h-4 opacity-40" style={{ background: 'var(--border-soft)' }} />

        <select
          value={selectedRepo ?? ''}
          onChange={e => setSelectedRepo(e.target.value)}
          className="text-sm rounded-lg px-3 py-1.5 outline-none border transition-all cursor-pointer"
          style={{
            background: 'var(--bg-panel)',
            color: 'var(--text-dim)',
            borderColor: 'var(--border)',
          }}
        >
          {repos.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          {!repos.length && <option value="">No repos — run agents-kit init</option>}
        </select>

        {/* Cost widget */}
        {cost && cost.total_tokens > 0 && (
          <div
            className="flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs"
            style={{
              background: cost.over_budget ? '#EF44441A' : 'var(--bg-panel)',
              border: `1px solid ${cost.over_budget ? '#EF444455' : 'var(--border)'}`,
              color: cost.over_budget ? '#EF4444' : 'var(--text-dim)',
            }}
          >
            <span className="font-mono">{fmtTokens(cost.total_tokens)} tok</span>
            <span className="font-mono font-semibold">{fmtUsd(cost.total_cost_usd)}</span>
            {cost.budget_limit_usd != null && (
              <span className="font-mono opacity-70">
                / {fmtUsd(cost.budget_limit_usd)}
              </span>
            )}
            {cost.over_budget && <span className="font-bold">⚠</span>}
          </div>
        )}

        <div className="flex items-center gap-3 ml-auto">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors text-sm"
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              color: 'var(--text-dim)',
            }}
            title={light ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {light ? '☾' : '☀'}
          </button>

          <div className="flex items-center gap-2">
            <div className="relative flex items-center justify-center w-3 h-3">
              {connected && (
                <span
                  className="absolute w-3 h-3 rounded-full animate-ping opacity-50"
                  style={{ background: '#00C9A7' }}
                />
              )}
              <span
                className="relative w-2 h-2 rounded-full"
                style={{ background: connected ? '#00C9A7' : '#EF4444' }}
              />
            </div>
            <span className="text-xs" style={{ color: connected ? '#00C9A7' : '#EF4444' }}>
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Budget / move alert toast */}
      {budgetAlert && (
        <div
          className="fixed top-16 right-5 z-40 rounded-lg px-4 py-2.5 text-sm animate-slide-in"
          style={{
            background: '#EF44441A',
            border: '1px solid #EF444455',
            color: '#EF4444',
            maxWidth: 380,
          }}
        >
          {budgetAlert}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-3 h-full min-w-max">
            {COLUMNS.map(col => {
              const colCards = cardsByColumn(col.id);
              const isHumanGate = HUMAN_GATE_COLS.includes(col.id);
              return (
                <div key={col.id} className="flex flex-col w-56 flex-shrink-0">
                  <div className="mb-3 px-0.5">
                    <div
                      className="h-0.5 rounded-full mb-2.5"
                      style={{ background: `linear-gradient(90deg, ${col.color}AA, transparent)` }}
                    />
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-semibold uppercase tracking-wider truncate"
                        style={{ color: col.color }}
                      >
                        {col.label}
                      </span>
                      {isHumanGate && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
                          style={{
                            background: '#FFD16612',
                            color: '#FFD166',
                            border: '1px solid #FFD16628',
                          }}
                        >
                          gate
                        </span>
                      )}
                      <span
                        className="ml-auto flex-shrink-0 text-xs font-semibold w-5 h-5 rounded-full flex items-center justify-center"
                        style={{
                          background: colCards.length > 0 ? `${col.color}20` : 'var(--bg-panel-2)',
                          color: colCards.length > 0 ? col.color : 'var(--text-quiet)',
                          border: colCards.length > 0 ? `1px solid ${col.color}30` : '1px solid var(--border)',
                        }}
                      >
                        {colCards.length}
                      </span>
                    </div>
                  </div>

                  <div
                    className="flex flex-col gap-2 flex-1 overflow-y-auto rounded-xl p-1.5 pt-0"
                    style={{
                      background: isHumanGate ? `${col.color}06` : 'transparent',
                    }}
                  >
                    {colCards.length === 0 && (
                      <div
                        className="rounded-xl border border-dashed h-16 flex items-center justify-center"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <span className="text-xs" style={{ color: 'var(--text-ghost)' }}>empty</span>
                      </div>
                    )}
                    {colCards.map(card => (
                      <CardItem
                        key={card.id}
                        card={card}
                        blockedCount={depsByCard[card.id] ?? 0}
                        highlighted={highlightedCardIds.has(card.id)}
                        onClick={() => setSelectedCard(card)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </main>

        <aside
          className="w-72 flex-shrink-0 flex flex-col overflow-hidden"
          style={{ background: 'var(--bg-sidebar)', borderLeft: '1px solid var(--border-strong)' }}
        >
          <div
            className="px-4 py-3 flex-shrink-0 flex items-center gap-2"
            style={{ borderBottom: '1px solid var(--border-strong)' }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: connected ? '#00C9A7' : 'var(--text-quiet)' }}
            />
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Live Feed
            </span>
            {liveFeed.length > 0 && (
              <span
                className="ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold"
                style={{
                  background: '#00C9A712',
                  color: '#00C9A7',
                  border: '1px solid #00C9A725',
                }}
              >
                {liveFeed.length}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {liveFeed.length === 0 && (
              <p className="text-xs italic pt-1" style={{ color: 'var(--text-ghost)' }}>Waiting for agent activity…</p>
            )}
            {[...liveFeed].reverse().map((item, i) => (
              <div
                key={item.id}
                className={`text-xs rounded-lg p-2.5 border-l-2 ${i === 0 ? 'animate-slide-in' : ''}`}
                style={{
                  background: i === 0 ? '#00C9A70A' : 'var(--bg-panel)',
                  borderLeftColor: i === 0 ? '#00C9A7' : 'var(--border)',
                  border: `1px solid ${i === 0 ? '#00C9A725' : 'var(--border-strong)'}`,
                  borderLeft: `2px solid ${i === 0 ? '#00C9A7' : 'var(--border)'}`,
                }}
              >
                <span className="block mb-1 font-mono text-[10px]" style={{ color: 'var(--text-quiet)' }}>
                  {item.ts}
                </span>
                <span className="leading-relaxed" style={{ color: 'var(--text-dim)' }}>{item.message}</span>
              </div>
            ))}
          </div>

          {/* Cost breakdown */}
          {cost && cost.total_tokens > 0 && (
            <div
              className="mx-3 mb-3 rounded-xl p-3 flex-shrink-0"
              style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold" style={{ color: '#00C9A7' }}>Cost by Agent</span>
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--text-dim)' }}>
                  {fmtUsd(cost.total_cost_usd)}
                </span>
              </div>
              <div className="space-y-1">
                {cost.by_agent.slice(0, 5).map(a => (
                  <div key={a.agent} className="flex justify-between text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                    <span>{a.agent}</span>
                    <span>{fmtTokens(a.tokens)} / {fmtUsd(a.cost_usd)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            className="mx-3 mb-3 rounded-xl p-3 flex-shrink-0"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
          >
            <div className="text-[11px] font-semibold mb-1.5" style={{ color: '#00C9A7' }}>
              IDE MCP Setup
            </div>
            <div className="font-mono text-[10px] leading-relaxed break-all" style={{ color: 'var(--text-muted)' }}>
              {`"useragent0": {\n  "url": "http://localhost:4000/mcp"\n}`}
            </div>
          </div>
        </aside>
      </div>

      {selectedCard && (
        <CardDetail
          card={selectedCard}
          deps={deps}
          allCards={cards}
          onClose={() => setSelectedCard(null)}
          onMove={(col) => {
            moveCard(selectedCard.id, col);
            setSelectedCard(null);
          }}
          onAddDep={(blockedById) => addDep(selectedCard.id, blockedById)}
          onRemoveDep={(blockedById) => removeDep(selectedCard.id, blockedById)}
        />
      )}
    </div>
  );
}
