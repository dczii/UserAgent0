# agents-kit

> AI developer agents for any repository. MCP-powered, local-first. Zero external dependencies beyond Node.js.

## Install

```bash
npm install -g agents-kit
```

## Quick Start

```bash
# 1. Start the monitoring server + Kanban UI
agents-kit start

# 2. Add to any repo
cd your-project
agents-kit init

# 3. Add to your IDE MCP config
# { "mcpServers": { "agents-kit": { "url": "http://localhost:3000/mcp" } } }
```

## Monorepo Structure

| Package | Description |
|---------|-------------|
| `packages/agents-kit` | **The installable npm package** — standalone, self-contained |
| `packages/core` | TypeScript types, SQLite DB client, MCP tool schemas |
| `packages/server` | Express + WebSocket + MCP server |
| `packages/cli` | CLI commands (init, start, config, status) |
| `packages/ui` | Next.js Kanban monitoring UI |

## The Kanban Flow

```
PM Creates → In Progress → Commit → Create PR → Test → QA → Done
```

Each column is owned by an agent. Your IDE's AI calls agents-kit via MCP.

## MCP Tools

| Tool | Description |
|------|-------------|
| `create_card` | Create task cards from a requirement |
| `list_repos` | List registered repositories |
| `list_cards` | List cards, filtered by column |
| `get_card` | Full card details + agent log |
| `move_card` | Move card to a column |
| `append_log` | Record agent progress |
| `bounce_card` | Return card with failure annotation |

## Repo

[github.com/dczii/agents-kit](https://github.com/dczii/agents-kit)
