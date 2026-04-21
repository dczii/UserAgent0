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
  agent_log: { agent: string; action: string; detail?: string; timestamp: string }[];
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

function CardItem({ card, highlighted, onClick }: {
  card: Card;
  highlighted: boolean;
  onClick: () => void;
}) {
  const col = COLUMNS.find(c => c.id === card.column)!;
  return (
    <div
      onClick={onClick}
      className={`relative rounded-xl p-3.5 cursor-pointer border transition-all duration-200 hover:-translate-y-0.5 group ${highlighted ? 'animate-card-moved' : ''}`}
      style={{
        background: highlighted
          ? `linear-gradient(135deg, ${col.color}12 0%, #162840 100%)`
          : 'linear-gradient(135deg, #1A2F45 0%, #142236 100%)',
        borderColor: highlighted ? `${col.color}55` : '#1E3A52',
        borderLeft: `3px solid ${col.color}`,
        boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
      }}
    >
      {/* Corner glow on hover */}
      <div
        className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${col.color}18, transparent 70%)`,
          transform: 'translate(25%, -25%)',
        }}
      />

      <p className="text-sm font-medium text-slate-200 group-hover:text-white leading-snug mb-2.5 pr-2">
        {card.title}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <Badge text={card.assigned_agent.replace(/_/g, ' ')} color="#94A3B8" />
        {card.estimated_complexity && (
          <Badge
            text={card.estimated_complexity}
            color={COMPLEXITY_COLORS[card.estimated_complexity] ?? '#94A3B8'}
          />
        )}
        {card.bounce_count > 0 && (
          <Badge text={`↩ ${card.bounce_count}`} color="#EF4444" />
        )}
      </div>

      {card.total_tokens != null && card.total_tokens > 0 && (
        <div className="mt-2 text-[10px] text-slate-500 font-mono">
          {(card.total_tokens / 1000).toFixed(1)}k tok
        </div>
      )}
    </div>
  );
}

// ─── CardDetail ───────────────────────────────────────────────────────────────

function CardDetail({ card, onClose, onMove }: {
  card: Card;
  onClose: () => void;
  onMove: (col: KanbanColumn) => void;
}) {
  const col = COLUMNS.find(c => c.id === card.column)!;
  const colIndex = COLUMNS.findIndex(c => c.id === card.column);
  const nextCol = COLUMNS[colIndex + 1];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end"
      style={{ background: 'rgba(5,13,24,0.75)', backdropFilter: 'blur(3px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-navy-mid w-[500px] h-full overflow-y-auto flex flex-col animate-panel-in"
        style={{
          background: 'linear-gradient(180deg, #0F2035 0%, #0D1B2A 100%)',
          borderLeft: '1px solid #1E3A52',
          boxShadow: '-12px 0 48px rgba(0,0,0,0.5)',
        }}
      >
        {/* Colored top bar */}
        <div
          className="h-1 flex-shrink-0"
          style={{ background: `linear-gradient(90deg, ${col.color}, ${col.color}33, transparent)` }}
        />

        <div className="flex-1 p-6 flex flex-col gap-5">
          {/* Header */}
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
              <h2 className="text-base font-bold text-white leading-snug">{card.title}</h2>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all text-lg mt-1"
            >
              ×
            </button>
          </div>

          {/* Description */}
          {card.description && (
            <p className="text-sm text-slate-300 leading-relaxed">{card.description}</p>
          )}

          {/* Acceptance Criteria */}
          {card.acceptance_criteria.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
                Acceptance Criteria
              </h3>
              <ul className="space-y-1.5">
                {card.acceptance_criteria.map((c, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-slate-300">
                    <span className="mt-0.5 flex-shrink-0 text-xs" style={{ color: '#00C9A7' }}>✓</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Bounce-back annotations */}
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
              <p className="text-sm text-slate-300 mb-2">
                <strong className="text-slate-200 font-medium">Root cause: </strong>
                {card.annotations.root_cause}
              </p>
              {card.annotations.suggested_fix && (
                <p className="text-sm text-slate-300 mb-2">
                  <strong className="text-slate-200 font-medium">Suggested fix: </strong>
                  {card.annotations.suggested_fix}
                </p>
              )}
              {card.annotations.failed_tests.length > 0 && (
                <div className="mt-3 space-y-1">
                  <div className="text-[11px] font-medium text-red-400 mb-1.5">Failed tests</div>
                  {card.annotations.failed_tests.map((t, i) => (
                    <div key={i} className="text-xs font-mono bg-black/20 rounded-lg px-3 py-1.5 text-slate-400">
                      {t}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* File scope */}
          {card.file_scope.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2.5">File Scope</h3>
              <div className="flex flex-wrap gap-1.5">
                {card.file_scope.map((f, i) => (
                  <span
                    key={i}
                    className="text-xs font-mono px-2.5 py-1 rounded-lg text-slate-300"
                    style={{ background: '#0D1B2A', border: '1px solid #1E3A52' }}
                  >
                    {f}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* PR link */}
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

          {/* Move button */}
          {nextCol && (
            <button
              onClick={() => onMove(nextCol.id)}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-[0.98]"
              style={{
                background: `linear-gradient(135deg, ${nextCol.color}, ${nextCol.color}BB)`,
                color: '#0B1624',
                boxShadow: `0 4px 20px ${nextCol.color}33`,
              }}
            >
              Move to {nextCol.label} →
            </button>
          )}

          {/* Divider */}
          <div className="h-px" style={{ background: '#1E3A52' }} />

          {/* Agent Log */}
          <section>
            <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Agent Log</h3>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {[...card.agent_log].reverse().map((entry, i) => (
                <div
                  key={i}
                  className="text-xs pl-3 py-2 rounded-r-lg border-l-2"
                  style={{
                    borderColor: i === 0 ? '#00C9A7' : '#1E3A52',
                    background: i === 0 ? '#00C9A708' : 'transparent',
                  }}
                >
                  <div className="flex gap-2 items-center mb-0.5 flex-wrap">
                    <span className="font-semibold" style={{ color: '#00C9A7' }}>{entry.agent}</span>
                    <span className="text-slate-400">{entry.action}</span>
                    <span className="text-slate-500 ml-auto font-mono text-[10px]">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  {entry.detail && (
                    <div className="text-slate-400 leading-relaxed mt-0.5">{entry.detail}</div>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BoardPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [liveFeed, setLiveFeed] = useState<FeedItem[]>([]);
  const [highlightedCardIds, setHighlightedCardIds] = useState<Set<string>>(new Set());
  const feedCounter = useRef(0);
  const { connected, messages } = useAgentsSocket();

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

  useEffect(() => { loadCards(); }, [loadCards]);

  // Handle WS messages
  useEffect(() => {
    if (!messages.length) return;
    const msg = messages[messages.length - 1];

    const cardEvents = ['card:created', 'card:updated', 'card:column_changed', 'card:log_appended', 'card:bounced'];
    if (cardEvents.includes(msg.type)) {
      loadCards();
      const updated = msg.payload as Card;
      if (selectedCard?.id === updated.id) setSelectedCard(updated);

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

    if (msg.type === 'agent:live_feed') {
      const p = msg.payload as { message: string };
      setLiveFeed(prev => [
        ...prev.slice(-49),
        { message: p.message, ts: new Date().toLocaleTimeString(), id: feedCounter.current++ },
      ]);
    }
  }, [messages, loadCards, selectedCard]);

  const moveCard = useCallback(async (cardId: string, column: KanbanColumn) => {
    await fetch(`${API}/api/cards/${cardId}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column, moved_by: 'human' }),
    });
    loadCards();
  }, [loadCards]);

  const cardsByColumn = (col: KanbanColumn) => cards.filter(c => c.column === col);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header
        className="flex items-center gap-4 px-5 py-3 flex-shrink-0"
        style={{
          background: 'linear-gradient(180deg, #0D1B2A 0%, #0A1825 100%)',
          borderBottom: '1px solid #1A3348',
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
            {/* Scan-line overlay */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,201,167,0.04) 2px, rgba(0,201,167,0.04) 4px)',
              }}
            />
            {/* Corner tick marks */}
            <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 border-t border-l pointer-events-none" style={{ borderColor: '#00C9A770' }} />
            <div className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 border-b border-r pointer-events-none" style={{ borderColor: '#00C9A770' }} />
            <span className="relative" style={{ color: '#e2e8f0' }}>U</span>
            <span className="relative" style={{ color: '#00C9A7', textShadow: '0 0 8px #00C9A7CC, 0 0 20px #00C9A755' }}>0</span>
          </div>
          <span className="font-semibold text-sm tracking-tight" style={{ color: '#00C9A7' }}>
            agents-kit
          </span>
        </div>

        <div className="w-px h-4 opacity-40" style={{ background: '#3D5A73' }} />

        {/* Repo selector */}
        <select
          value={selectedRepo ?? ''}
          onChange={e => setSelectedRepo(e.target.value)}
          className="text-sm rounded-lg px-3 py-1.5 outline-none border transition-all cursor-pointer"
          style={{
            background: '#142236',
            color: '#CBD5E1',
            borderColor: '#1E3A52',
          }}
        >
          {repos.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          {!repos.length && <option value="">No repos — run agents-kit init</option>}
        </select>

        {/* Connection status */}
        <div className="flex items-center gap-2 ml-auto">
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
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Kanban board */}
        <main className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-3 h-full min-w-max">
            {COLUMNS.map(col => {
              const colCards = cardsByColumn(col.id);
              const isHumanGate = HUMAN_GATE_COLS.includes(col.id);
              return (
                <div key={col.id} className="flex flex-col w-56 flex-shrink-0">
                  {/* Column header */}
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
                          background: colCards.length > 0 ? `${col.color}20` : '#1A2F45',
                          color: colCards.length > 0 ? col.color : '#3D5A73',
                          border: colCards.length > 0 ? `1px solid ${col.color}30` : '1px solid #1E3A52',
                        }}
                      >
                        {colCards.length}
                      </span>
                    </div>
                  </div>

                  {/* Cards */}
                  <div
                    className="flex flex-col gap-2 flex-1 overflow-y-auto rounded-xl p-1.5 pt-0"
                    style={{
                      background: isHumanGate ? `${col.color}06` : 'transparent',
                    }}
                  >
                    {colCards.length === 0 && (
                      <div
                        className="rounded-xl border border-dashed h-16 flex items-center justify-center"
                        style={{ borderColor: '#1E3A52' }}
                      >
                        <span className="text-xs" style={{ color: '#2D4F6E' }}>empty</span>
                      </div>
                    )}
                    {colCards.map(card => (
                      <CardItem
                        key={card.id}
                        card={card}
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

        {/* Live feed sidebar */}
        <aside
          className="w-72 flex-shrink-0 flex flex-col overflow-hidden"
          style={{ background: '#0A1825', borderLeft: '1px solid #1A3348' }}
        >
          {/* Sidebar header */}
          <div
            className="px-4 py-3 flex-shrink-0 flex items-center gap-2"
            style={{ borderBottom: '1px solid #1A3348' }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: connected ? '#00C9A7' : '#3D5A73' }}
            />
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
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

          {/* Feed items */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {liveFeed.length === 0 && (
              <p className="text-xs text-slate-600 italic pt-1">Waiting for agent activity…</p>
            )}
            {[...liveFeed].reverse().map((item, i) => (
              <div
                key={item.id}
                className={`text-xs rounded-lg p-2.5 border-l-2 ${i === 0 ? 'animate-slide-in' : ''}`}
                style={{
                  background: i === 0 ? '#00C9A70A' : '#142236',
                  borderLeftColor: i === 0 ? '#00C9A7' : '#1E3A52',
                  border: `1px solid ${i === 0 ? '#00C9A725' : '#1A3348'}`,
                  borderLeft: `2px solid ${i === 0 ? '#00C9A7' : '#1E3A52'}`,
                }}
              >
                <span className="block mb-1 font-mono text-[10px]" style={{ color: '#3D5A73' }}>
                  {item.ts}
                </span>
                <span className="text-slate-300 leading-relaxed">{item.message}</span>
              </div>
            ))}
          </div>

          {/* MCP setup hint */}
          <div
            className="mx-3 mb-3 rounded-xl p-3 flex-shrink-0"
            style={{ background: '#142236', border: '1px solid #1E3A52' }}
          >
            <div className="text-[11px] font-semibold mb-1.5" style={{ color: '#00C9A7' }}>
              IDE MCP Setup
            </div>
            <div className="text-slate-500 font-mono text-[10px] leading-relaxed break-all">
              {`"useragent0": {\n  "url": "http://localhost:4000/mcp"\n}`}
            </div>
          </div>
        </aside>
      </div>

      {/* Card detail panel */}
      {selectedCard && (
        <CardDetail
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onMove={(col) => {
            moveCard(selectedCard.id, col);
            setSelectedCard(null);
          }}
        />
      )}
    </div>
  );
}
