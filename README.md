# agents-kit

> AI developer agents for any repository. Local-first. Zero external dependencies.

## What is this?

`agents-kit` installs AI agents directly into any software repository. Each agent plays a defined role in your development workflow — PM, Frontend Dev, Backend Dev, Tester, PR Reviewer, UI/UX Designer — and reports its activity to a shared Kanban board that runs entirely on your machine.

**No cloud. No database to install. No server to configure.** The only requirement is Node.js.

## Install

```bash
# Install globally
npm install -g agents-kit

# Start the monitoring UI
agents-kit start

# Add to any repo
cd your-project
agents-kit init
```

## Packages

| Package | Description |
|---------|-------------|
| `packages/cli` | The `agents-kit` CLI — `init`, `start`, `config` commands |
| `packages/core` | SQLite schema, DB client, agent base class, card types |
| `packages/server` | Local Express + WebSocket server |
| `packages/ui` | Next.js Kanban monitoring UI |

## Kanban Flow

```
PM Creates → In Progress → Commit → Create PR → Test → QA → Done
```

Each column is owned by an agent. You control when cards move forward.

## Repo

[github.com/dczii/agents-kit](https://github.com/dczii/agents-kit)
