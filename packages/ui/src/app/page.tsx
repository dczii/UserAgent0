"use client";
import { useEffect, useState, useCallback } from "react";
import { useAgentsSocket } from "../hooks/useAgentsSocket";

// ─── Types ────────────────────────────────────────────────────────────────────

type KanbanColumn = "pm_creates" | "in_progress" | "commit" | "create_pr" | "test" | "qa" | "done";

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
}

interface Repo {
  id: string;
  name: string;
  path: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMNS: { id: KanbanColumn; label: string; color: string }[] = [
  { id: "pm_creates", label: "PM Creates", color: "#00C9A7" },
  { id: "in_progress", label: "In Progress", color: "#FFD166" },
  { id: "commit", label: "Commit", color: "#7C3AED" },
  { id: "create_pr", label: "Create PR", color: "#00C9A7" },
  { id: "test", label: "Test", color: "#FFD166" },
  { id: "qa", label: "QA", color: "#F06595" },
  { id: "done", label: "Done", color: "#22C55E" },
];

const HUMAN_GATE_COLS: KanbanColumn[] = ["in_progress", "qa"];

const API = "http://localhost:3000";

// ─── Components ───────────────────────────────────────────────────────────────

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span
      className='inline-block px-2 py-0.5 rounded text-xs font-semibold'
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {text}
    </span>
  );
}

function CardItem({ card, onClick }: { card: Card; onClick: () => void }) {
  const col = COLUMNS.find((c) => c.id === card.column)!;
  return (
    <div
      onClick={onClick}
      className='bg-navy-mid rounded-lg p-3 cursor-pointer hover:bg-navy-light transition-colors border border-navy-light group'
      style={{ borderLeft: `3px solid ${col.color}` }}
    >
      <div className='text-sm font-medium text-slate-100 mb-1 group-hover:text-white leading-snug'>
        {card.title}
      </div>
      <div className='flex items-center gap-2 flex-wrap mt-2'>
        <Badge text={card.assigned_agent.replace("_", " ")} color='#8FA8C0' />
        {card.estimated_complexity && (
          <Badge
            text={card.estimated_complexity}
            color={
              card.estimated_complexity === "large"
                ? "#EF4444"
                : card.estimated_complexity === "medium"
                  ? "#FFD166"
                  : "#22C55E"
            }
          />
        )}
        {card.bounce_count > 0 && <Badge text={`↩ ${card.bounce_count}`} color='#EF4444' />}
      </div>
    </div>
  );
}

function CardDetail({
  card,
  onClose,
  onMove,
}: {
  card: Card;
  onClose: () => void;
  onMove: (col: KanbanColumn) => void;
}) {
  const col = COLUMNS.find((c) => c.id === card.column)!;
  const colIndex = COLUMNS.findIndex((c) => c.id === card.column);
  const nextCol = COLUMNS[colIndex + 1];

  return (
    <div
      className='fixed inset-0 bg-black/70 z-50 flex items-start justify-end'
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className='bg-navy-mid w-[480px] h-full overflow-y-auto p-6 flex flex-col gap-4'>
        {/* Header */}
        <div className='flex items-start justify-between gap-3'>
          <div>
            <div className='text-xs font-semibold mb-1' style={{ color: col.color }}>
              {col.label}
            </div>
            <h2 className='text-lg font-bold text-white leading-snug'>{card.title}</h2>
          </div>
          <button
            onClick={onClose}
            className='text-slate-400 hover:text-white text-xl leading-none mt-1'
          >
            ×
          </button>
        </div>

        {/* Description */}
        {card.description && (
          <p className='text-sm text-slate-300 leading-relaxed'>{card.description}</p>
        )}

        {/* Acceptance Criteria */}
        {card.acceptance_criteria.length > 0 && (
          <div>
            <div className='text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2'>
              Acceptance Criteria
            </div>
            <ul className='space-y-1'>
              {card.acceptance_criteria.map((c, i) => (
                <li key={i} className='flex gap-2 text-sm text-slate-300'>
                  <span className='text-teal mt-0.5'>✓</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Annotations (bounce-back) */}
        {card.annotations && (
          <div
            className='rounded-lg p-3 border'
            style={{ borderColor: "#EF444444", background: "#EF444411" }}
          >
            <div className='text-xs font-semibold text-red-400 mb-2'>↩ Bounced Back</div>
            <p className='text-sm text-slate-300 mb-2'>
              <strong>Root cause:</strong> {card.annotations.root_cause}
            </p>
            {card.annotations.suggested_fix && (
              <p className='text-sm text-slate-300'>
                <strong>Suggested fix:</strong> {card.annotations.suggested_fix}
              </p>
            )}
            {card.annotations.failed_tests.length > 0 && (
              <div className='mt-2'>
                <div className='text-xs text-red-400 mb-1'>Failed tests:</div>
                {card.annotations.failed_tests.map((t, i) => (
                  <div key={i} className='text-xs font-mono text-slate-400'>
                    {t}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* File scope */}
        {card.file_scope.length > 0 && (
          <div>
            <div className='text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2'>
              File Scope
            </div>
            <div className='flex flex-wrap gap-1'>
              {card.file_scope.map((f, i) => (
                <span
                  key={i}
                  className='text-xs font-mono bg-navy px-2 py-1 rounded text-slate-300'
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Move card */}
        {nextCol && (
          <button
            onClick={() => onMove(nextCol.id)}
            className='w-full py-2.5 rounded-lg text-sm font-semibold transition-colors'
            style={{ background: nextCol.color, color: "#0D1B2A" }}
          >
            Move to {nextCol.label} →
          </button>
        )}

        {/* Agent Log */}
        <div>
          <div className='text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2'>
            Agent Log
          </div>
          <div className='space-y-2 max-h-64 overflow-y-auto'>
            {[...card.agent_log].reverse().map((entry, i) => (
              <div
                key={i}
                className='text-xs border-l-2 border-navy pl-3 py-1'
                style={{ borderColor: "#243B55" }}
              >
                <div className='flex gap-2 items-center mb-0.5'>
                  <span className='font-semibold' style={{ color: "#00C9A7" }}>
                    {entry.agent}
                  </span>
                  <span className='text-slate-400'>{entry.action}</span>
                  <span className='text-slate-500 ml-auto'>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                {entry.detail && <div className='text-slate-400'>{entry.detail}</div>}
              </div>
            ))}
          </div>
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
  const [liveFeed, setLiveFeed] = useState<{ message: string; ts: string }[]>([]);
  const { connected, messages } = useAgentsSocket();

  // Load repos
  useEffect(() => {
    fetch(`${API}/api/repos`)
      .then((r) => r.json())
      .then((data: Repo[]) => {
        setRepos(data);
        if (data.length > 0) setSelectedRepo(data[0].id);
      })
      .catch(() => {});
  }, []);

  // Load cards when repo changes
  const loadCards = useCallback(() => {
    if (!selectedRepo) return;
    fetch(`${API}/api/repos/${selectedRepo}/cards`)
      .then((r) => r.json())
      .then(setCards)
      .catch(() => {});
  }, [selectedRepo]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  // Handle WS messages
  useEffect(() => {
    if (!messages.length) return;
    const msg = messages[messages.length - 1];

    if (
      [
        "card:created",
        "card:updated",
        "card:column_changed",
        "card:log_appended",
        "card:bounced",
      ].includes(msg.type)
    ) {
      loadCards();
      const updated = msg.payload as Card;
      if (selectedCard?.id === updated.id) setSelectedCard(updated);
    }

    if (msg.type === "agent:live_feed") {
      const p = msg.payload as { message: string };
      setLiveFeed((prev) => [
        ...prev.slice(-49),
        { message: p.message, ts: new Date().toLocaleTimeString() },
      ]);
    }
  }, [messages, loadCards, selectedCard]);

  const moveCard = useCallback(
    async (cardId: string, column: KanbanColumn) => {
      await fetch(`${API}/api/cards/${cardId}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column, moved_by: "human" }),
      });
      loadCards();
    },
    [loadCards],
  );

  const cardsByColumn = (col: KanbanColumn) => cards.filter((c) => c.column === col);
  const currentRepo = repos.find((r) => r.id === selectedRepo);

  return (
    <div className='flex flex-col h-screen overflow-hidden'>
      {/* Top nav */}
      <header
        className='flex items-center gap-4 px-5 py-3 border-b border-navy-light flex-shrink-0'
        style={{ background: "#0D1B2A", borderColor: "#243B55" }}
      >
        <span className='font-bold text-teal text-lg tracking-tight'>agents-kit</span>
        <div className='h-4 w-px bg-navy-light mx-1' />
        {/* Repo selector */}
        <select
          value={selectedRepo ?? ""}
          onChange={(e) => setSelectedRepo(e.target.value)}
          className='bg-navy-mid text-slate-200 text-sm rounded px-2 py-1 border border-navy-light outline-none'
        >
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
          {!repos.length && <option value=''>No repos — run agents-kit init</option>}
        </select>
        <div className='ml-auto flex items-center gap-2'>
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-teal" : "bg-red-400"}`} />
          <span className='text-xs text-slate-400'>{connected ? "Connected" : "Disconnected"}</span>
        </div>
      </header>

      <div className='flex flex-1 overflow-hidden'>
        {/* Kanban board */}
        <main className='flex-1 overflow-x-auto p-4'>
          <div className='flex gap-3 h-full min-w-max'>
            {COLUMNS.map((col) => (
              <div key={col.id} className='flex flex-col w-52 flex-shrink-0'>
                {/* Column header */}
                <div className='flex items-center gap-2 mb-3 px-1'>
                  <div
                    className='w-2 h-2 rounded-full flex-shrink-0'
                    style={{ background: col.color }}
                  />
                  <span className='text-xs font-semibold text-slate-300 uppercase tracking-wide'>
                    {col.label}
                  </span>
                  {HUMAN_GATE_COLS.includes(col.id) && (
                    <span className='ml-auto text-xs text-slate-500' title='Human checkpoint'>
                      👤
                    </span>
                  )}
                  <span className='ml-auto text-xs text-slate-500'>
                    {cardsByColumn(col.id).length}
                  </span>
                </div>

                {/* Cards */}
                <div className='flex flex-col gap-2 flex-1 overflow-y-auto'>
                  {cardsByColumn(col.id).map((card) => (
                    <CardItem key={card.id} card={card} onClick={() => setSelectedCard(card)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </main>

        {/* Live feed sidebar */}
        <aside
          className='w-72 flex-shrink-0 border-l p-4 flex flex-col gap-3 overflow-hidden'
          style={{ background: "#1A2F45", borderColor: "#243B55" }}
        >
          <div className='text-xs font-semibold text-slate-400 uppercase tracking-wider'>
            Live Feed
          </div>
          <div className='flex-1 overflow-y-auto space-y-2'>
            {liveFeed.length === 0 && (
              <p className='text-xs text-slate-500 italic'>Waiting for agent activity…</p>
            )}
            {[...liveFeed].reverse().map((item, i) => (
              <div key={i} className='text-xs text-slate-300 border-l-2 border-teal pl-2 py-0.5'>
                <span className='text-slate-500 block mb-0.5'>{item.ts}</span>
                {item.message}
              </div>
            ))}
          </div>

          {/* MCP connection hint */}
          <div className='rounded-lg p-3 text-xs' style={{ background: "#243B55" }}>
            <div className='font-semibold text-teal mb-1'>IDE MCP Setup</div>
            <div className='text-slate-400 font-mono break-all'>
              {`"agents-kit": {\n  "url": "http://localhost:4000/mcp"\n}`}
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
