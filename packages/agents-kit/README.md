# agents-kit

> AI developer agents for any repository. MCP-powered, local-first. Zero external dependencies beyond Node.js.

## Install

```bash
npm install -g agents-kit
```

That's it. No database to install. No server to configure. Everything is bundled.

## Quick Start

**Step 1 — Start the monitoring server**

```bash
agents-kit start
```

This starts the local server on `localhost:3000` and opens the Kanban UI in your browser.

**Step 2 — Add agents to any repo**

```bash
cd your-project
agents-kit init
```

Follow the prompts to choose which agents to activate. Git hooks are installed automatically.

**Step 3 — Connect your IDE**

Add this to your IDE's MCP config file:

```json
{
  "mcpServers": {
    "agents-kit": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

| IDE | MCP Config Location |
|-----|-------------------|
| Cursor | `.cursor/mcp.json` in your repo, or `~/.cursor/mcp.json` globally |
| Claude Code | `claude_mcp_config.json` in your repo |
| Windsurf | `.codeium/windsurf/mcp_config.json` |

**Step 4 — Create your first card**

In your IDE chat, describe a task:

```
Create a card for: add a login button to the navbar that opens a modal
```

The agent creates a structured card on the Kanban board. Move it to **In Progress** in the UI when you're ready to start.

## Commands

| Command | Description |
|---------|-------------|
| `agents-kit start` | Start the local server and open the Kanban UI |
| `agents-kit init` | Register the current repo and install git hooks |
| `agents-kit status` | Show registered repos and card counts |
| `agents-kit config KEY=value` | Set a config value |

## The Kanban Workflow

```
PM Creates → In Progress → Commit → Create PR → Test → QA → Done
```

Each column is owned by an agent. You control when cards move forward. Two columns require your explicit approval before the agent continues: **In Progress** (you start the work) and **QA** (you approve the merge).

## MCP Tools Available to Your IDE

Once connected, your IDE's AI can call these tools:

| Tool | What it does |
|------|-------------|
| `create_card` | Create task cards from a requirement |
| `list_repos` | List all registered repositories |
| `list_cards` | List cards, optionally filtered by column |
| `get_card` | Get full card details including agent log |
| `move_card` | Move a card to a different column |
| `append_log` | Record agent progress on a card |
| `bounce_card` | Return a card to In Progress with failure annotation |

## Requirements

- **Node.js 18+** — the only requirement

## Architecture

agents-kit runs entirely on your machine:

- **SQLite** — stores all cards and agent data at `~/.agents-kit/agents.db`
- **Express server** — serves the UI and MCP endpoint at `localhost:3000`
- **Git hooks** — installed into `.git/hooks/` of each registered repo
- **No cloud** — your code and data never leave your machine

## Repo

[github.com/dczii/agents-kit](https://github.com/dczii/agents-kit)
