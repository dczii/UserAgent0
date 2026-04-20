# useragent0

> AI developer agents for any repository. MCP-powered, local-first. Zero external dependencies beyond Node.js.

## Install

```bash
npm install -g useragent0
```

## Quick Start

```bash
# 1. Start the monitoring server + Kanban UI
useragent0 start

# 2. Add to any repo
cd your-project
useragent0 init
```

## ⚠️ Important: Add useragent0 to your IDE's MCP config

After installing, you **must** connect your IDE to the useragent0 MCP server so your AI can create and manage task cards.

Add the following to your IDE's MCP config file:

```json
{
  "mcpServers": {
    "useragent0": {
      "url": "http://localhost:4000/mcp"
    }
  }
}
```

| IDE | MCP Config Location |
|-----|-------------------|
| Cursor | `.cursor/mcp.json` in your repo, or `~/.cursor/mcp.json` globally |
| Claude Code | `claude_mcp_config.json` in your repo |
| Windsurf | `.codeium/windsurf/mcp_config.json` |

> Make sure `useragent0 start` is running before your IDE connects.

## Monorepo Structure

| Package | Description |
|---------|-------------|
| `packages/useragent0` | **The installable npm package** — standalone, self-contained |
| `packages/core` | TypeScript types, SQLite DB client, MCP tool schemas |
| `packages/server` | Express + WebSocket + MCP server |
| `packages/cli` | CLI commands (init, start, config, status) |
| `packages/ui` | Next.js Kanban monitoring UI |

## The Kanban Flow

```
PM Creates → In Progress → Commit → Create PR → Test → QA → Done
```

Each column is owned by an agent. Your IDE's AI calls useragent0 via MCP.

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

[github.com/dczii/useragent0](https://github.com/dczii/useragent0)
