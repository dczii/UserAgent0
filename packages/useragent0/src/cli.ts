#!/usr/bin/env node
import { program } from 'commander';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const teal  = (s: string) => chalk.hex('#00C9A7')(s);
const navy  = (s: string) => chalk.hex('#0D1B2A').bold(s);
const dim   = (s: string) => chalk.dim(s);
const bold  = (s: string) => chalk.bold(s);
const red   = (s: string) => chalk.red(s);
const green = (s: string) => chalk.green(s);

function printBanner() {
  console.log();
  console.log(teal('  useragent0'));
  console.log(dim('  AI developer agents for any repository'));
  console.log();
}

// ─── Program ──────────────────────────────────────────────────────────────────

program
  .name('useragent0')
  .description('Local-first AI developer agents — MCP-powered, zero external dependencies')
  .version('1.0.0');

// ─── useragent0 start ─────────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the local server and open the monitoring UI')
  .option('-p, --port <number>', 'Port to run the server on', '4000')
  .action(async (opts) => {
    printBanner();
    const port = parseInt(opts.port, 10);

    console.log(teal('  Starting useragent0 server...'));
    console.log();

    try {
      const { startServer } = await import('./server');
      startServer(port);

      console.log(green('  ✓') + '  Server running');
      console.log(dim(`     UI  → `) + bold(`http://localhost:${port}`));
      console.log(dim(`     MCP → `) + bold(`http://localhost:${port}/mcp`));
      console.log();
      console.log(dim('  Add to your IDE MCP config:'));
      console.log(dim('  ') + chalk.cyan(`{ "useragent0": { "url": "http://localhost:${port}/mcp" } }`));
      console.log();

      // Open UI in browser
      try {
        const open = (await import('open')).default;
        await open(`http://localhost:${port}`);
      } catch {
        // Not fatal if browser open fails
      }
    } catch (err) {
      console.error(red('  ✗  Failed to start server'));
      console.error(err);
      process.exit(1);
    }
  });

// ─── useragent0 init ──────────────────────────────────────────────────────────

program
  .command('init')
  .description('Register the current repository with useragent0 and install git hooks')
  .action(async () => {
    printBanner();

    const { default: inquirer } = await import('inquirer');
    const { DBClient, DB_PATH } = await import('./core');

    const cwd = process.cwd();
    const repoName = path.basename(cwd);

    // Check git repo
    if (!fs.existsSync(path.join(cwd, '.git'))) {
      console.error(red('  ✗  Not a git repository. Run git init first.'));
      process.exit(1);
    }

    console.log(teal(`  Initialising useragent0 for: ${bold(repoName)}`));
    console.log();

    const answers = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'agents',
        message: 'Which agents to activate?',
        choices: [
          { name: 'PM Agent       — creates and enriches task cards', value: 'pm', checked: true },
          { name: 'Frontend Dev   — UI components, styles, accessibility', value: 'frontend_dev', checked: true },
          { name: 'Backend Dev    — APIs, business logic, DB schemas', value: 'backend_dev', checked: true },
          { name: 'Tester         — generates and runs tests', value: 'tester', checked: true },
          { name: 'PR Reviewer    — reviews diffs, flags issues', value: 'pr_reviewer', checked: true },
          { name: 'UI/UX Designer — visual consistency, accessibility', value: 'ux_designer', checked: false },
        ],
      },
      {
        type: 'list',
        name: 'commit_format',
        message: 'Commit message format?',
        choices: [
          { name: 'Conventional Commits  (feat: add login button)', value: 'conventional' },
          { name: 'Freeform              (Add login button)', value: 'freeform' },
        ],
        default: 'conventional',
      },
      {
        type: 'list',
        name: 'test_framework',
        message: 'Test framework?',
        choices: ['jest', 'vitest', 'pytest', 'rspec'],
        default: 'jest',
      },
    ]);

    // Write .agents/agents.config.json
    const agentsDir = path.join(cwd, '.agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(path.join(agentsDir, 'prompts'), { recursive: true });

    const config = {
      repo: repoName,
      version: '1.0',
      agents: Object.fromEntries(
        ['pm', 'frontend_dev', 'backend_dev', 'tester', 'pr_reviewer', 'ux_designer'].map(id => [
          id, { enabled: answers.agents.includes(id) }
        ])
      ),
      model: {
        provider: 'ide',
        note: 'Uses your IDE AI via MCP — no API key needed in useragent0',
      },
      conventions: {
        commit_format: answers.commit_format,
        branch_prefix: 'agents/',
        test_framework: answers.test_framework,
      },
      human_gates: {
        require_approval_at_commit: true,
        require_approval_at_qa: true,
      },
    };

    fs.writeFileSync(
      path.join(agentsDir, 'agents.config.json'),
      JSON.stringify(config, null, 2),
      'utf-8'
    );

    // Generate CLAUDE.md
    generateClaudeMd(cwd, repoName, answers.agents);

    // Install git hooks
    installGitHooks(cwd);

    // Register in DB
    try {
      const db = new DBClient(DB_PATH);
      const repo = db.registerRepo(repoName, cwd, 'github');
      db.updateRepoAgents(repo.id, answers.agents);
      db.close();
      console.log();
      console.log(green('  ✓') + `  Repo registered  ${dim(`(id: ${repo.id.slice(0, 8)}...)`)}`);
    } catch {
      console.log();
      console.log(dim('  (Start useragent0 server to register repo in DB)'));
    }

    console.log(green('  ✓') + '  .agents/ folder created');
    console.log(green('  ✓') + '  Git hooks installed');
    console.log(green('  ✓') + '  agents.config.json written');
    console.log(green('  ✓') + '  CLAUDE.md generated');
    console.log();
    console.log(dim('  Next: run ') + teal('useragent0 start') + dim(' to open the Kanban UI'));
    console.log();
  });

// ─── useragent0 test ──────────────────────────────────────────────────────────

program
  .command('test')
  .description('Test the MCP server connection and list available tools')
  .option('-p, --port <number>', 'Port the server is running on', '4000')
  .action(async (opts) => {
    printBanner();
    const port = parseInt(opts.port, 10);
    const base = `http://localhost:${port}`;
    let allPassed = true;

    console.log(teal('  Running MCP connection tests...'));
    console.log();

    // 1. Health check
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) {
        console.log(green('  ✓') + `  Server reachable at ${bold(`${base}`)}`);
      } else {
        console.log(red('  ✗') + `  Server returned ${res.status}`);
        allPassed = false;
      }
    } catch {
      console.log(red('  ✗') + `  Server not running at ${base}`);
      console.log(dim(`       Run: useragent0 start`));
      allPassed = false;
    }

    // 2. MCP endpoint
    try {
      const res = await fetch(`${base}/mcp`);
      const json = await res.json() as { tools?: { name: string }[] };
      const tools: { name: string }[] = json?.tools ?? [];
      if (tools.length > 0) {
        console.log(green('  ✓') + `  MCP endpoint responding — ${bold(String(tools.length))} tools available`);
        tools.forEach(t => console.log(dim(`       • ${t.name}`)));
      } else {
        console.log(red('  ✗') + '  MCP endpoint returned no tools');
        allPassed = false;
      }
    } catch (err) {
      console.log(red('  ✗') + '  MCP endpoint unreachable');
      allPassed = false;
    }

    // 3. DB / repos
    try {
      const { DBClient, DB_PATH } = await import('./core');
      const db = new DBClient(DB_PATH);
      const repos = db.listRepos();
      db.close();
      console.log(green('  ✓') + `  Database OK — ${bold(String(repos.length))} repo(s) registered`);
    } catch {
      console.log(red('  ✗') + '  Could not connect to database');
      allPassed = false;
    }

    console.log();
    if (allPassed) {
      console.log(green('  All tests passed.') + dim(' Your IDE can now use useragent0 via MCP.'));
    } else {
      console.log(red('  Some tests failed.') + dim(' Make sure useragent0 start is running.'));
      process.exit(1);
    }
    console.log();
  });

// ─── useragent0 help ──────────────────────────────────────────────────────────

program
  .command('help-guide')
  .description('How to use useragent0 — workflow, MCP setup, and IDE connection')
  .action(() => {
    printBanner();

    console.log(teal('  How useragent0 works'));
    console.log();
    console.log(dim('  useragent0 is a Kanban coordination layer for your IDE\'s AI.'));
    console.log(dim('  Your IDE (Claude Code, Cursor, Windsurf) is the agent that does the work.'));
    console.log(dim('  useragent0 gives it structure, task tracking, and a visual board.'));
    console.log();

    console.log(bold('  ─── Workflow ───────────────────────────────────────────────'));
    console.log();
    console.log(`  ${teal('1.')} Start the server`);
    console.log(dim('       useragent0 start'));
    console.log(dim('       Opens the Kanban UI at http://localhost:4000'));
    console.log();
    console.log(`  ${teal('2.')} Register your repo`);
    console.log(dim('       cd your-project && useragent0 init'));
    console.log(dim('       Sets up .agents/agents.config.json and git hooks'));
    console.log();
    console.log(`  ${teal('3.')} Connect your IDE via MCP  ← important`);
    console.log(dim('       Add the MCP config to your IDE (see below)'));
    console.log();
    console.log(`  ${teal('4.')} Create a task in your IDE chat`);
    console.log(dim('       "Create a card for: add a login button to the navbar"'));
    console.log(dim('       Your IDE AI calls the create_card MCP tool'));
    console.log(dim('       → Card appears on the board in PM Creates column'));
    console.log();
    console.log(`  ${teal('5.')} Move the card to In Progress`);
    console.log(dim('       Click it in the UI, or tell your IDE AI to move it'));
    console.log();
    console.log(`  ${teal('6.')} Tell your IDE AI to work on it`);
    console.log(dim('       "Work on card <card_id> — implement the login button"'));
    console.log(dim('       The AI codes, logs progress via append_log, and moves'));
    console.log(dim('       the card through: Commit → Create PR → Test → QA → Done'));
    console.log();

    console.log(bold('  ─── MCP Server Setup ───────────────────────────────────────'));
    console.log();
    console.log(dim('  Add this to your IDE\'s MCP config file:'));
    console.log();
    console.log(chalk.cyan('  {'));
    console.log(chalk.cyan('    "mcpServers": {'));
    console.log(chalk.cyan('      "useragent0": {'));
    console.log(chalk.cyan('        "url": "http://localhost:4000/mcp"'));
    console.log(chalk.cyan('      }'));
    console.log(chalk.cyan('    }'));
    console.log(chalk.cyan('  }'));
    console.log();
    console.log(dim('  IDE config file locations:'));
    console.log();
    console.log(`  ${bold('Cursor')}      .cursor/mcp.json  (repo)  or  ~/.cursor/mcp.json  (global)`);
    console.log(`  ${bold('Claude Code')} .claude/claude_mcp_config.json  (repo)  or  ~/.claude/claude_mcp_config.json  (global)`);
    console.log(`  ${bold('Windsurf')}    .codeium/windsurf/mcp_config.json`);
    console.log();
    console.log(dim('  Make sure useragent0 start is running before your IDE connects.'));
    console.log(dim('  Run useragent0 test to verify the connection.'));
    console.log();

    console.log(bold('  ─── MCP Tools available to your IDE ────────────────────────'));
    console.log();
    console.log(`  ${teal('create_card')}   Create task cards from a requirement`);
    console.log(`  ${teal('list_repos')}    List all registered repositories`);
    console.log(`  ${teal('list_cards')}    List cards, filtered by column`);
    console.log(`  ${teal('get_card')}      Get full card details + agent log`);
    console.log(`  ${teal('move_card')}     Move a card to a different column`);
    console.log(`  ${teal('append_log')}    Record detailed agent progress on a card`);
    console.log(`  ${teal('bounce_card')}   Return a card to In Progress with failure notes`);
    console.log();

    console.log(bold('  ─── Commands ───────────────────────────────────────────────'));
    console.log();
    console.log(`  ${teal('useragent0 start')}         Start the server and open the Kanban UI`);
    console.log(`  ${teal('useragent0 init')}          Register the current repo`);
    console.log(`  ${teal('useragent0 test')}          Test MCP server connection`);
    console.log(`  ${teal('useragent0 status')}        Show registered repos and card counts`);
    console.log(`  ${teal('useragent0 db-clear')}      Delete all data from the database`);
    console.log(`  ${teal('useragent0 config')}        View or set global config`);
    console.log(`  ${teal('useragent0 help-guide')}    Show this guide`);
    console.log();
  });

// ─── useragent0 config ────────────────────────────────────────────────────────

program
  .command('config')
  .description('View or set global configuration')
  .argument('[key=value]', 'Set a config key, e.g. ANTHROPIC_API_KEY=sk-ant-...')
  .action(async (keyValue?: string) => {
    const { readGlobalConfig, setConfigKey } = await import('./core');

    if (!keyValue) {
      const config = readGlobalConfig();
      printBanner();
      console.log(teal('  Global config'));
      console.log(dim(`  Path: ~/.useragent0/config.json`));
      console.log();
      Object.entries(config).forEach(([k, v]) => {
        const display = k.toLowerCase().includes('key') ? '***hidden***' : String(v);
        console.log(`  ${bold(k)}: ${display}`);
      });
      console.log();
      return;
    }

    const eqIdx = keyValue.indexOf('=');
    if (eqIdx === -1) {
      console.error(red('  Usage: useragent0 config KEY=value'));
      process.exit(1);
    }

    const key = keyValue.slice(0, eqIdx).trim();
    const value = keyValue.slice(eqIdx + 1).trim();
    setConfigKey(key, value);
    console.log(green('  ✓') + `  Set ${bold(key)}`);
  });

// ─── useragent0 status ────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show registered repos and card counts')
  .action(async () => {
    printBanner();
    try {
      const { DBClient, DB_PATH } = await import('./core');
      const db = new DBClient(DB_PATH);
      const repos = db.listRepos();

      if (!repos.length) {
        console.log(dim('  No repos registered yet. Run useragent0 init in a repo.'));
        return;
      }

      repos.forEach(r => {
        const cards = db.listCards(r.id);
        const done = cards.filter(c => c.column === 'done').length;
        console.log(teal(`  ${r.name}`));
        console.log(dim(`    path:   ${r.path}`));
        console.log(dim(`    cards:  ${cards.length} total, ${done} done`));
        console.log(dim(`    agents: ${r.active_agents.join(', ') || 'none'}`));
        console.log();
      });
      db.close();
    } catch {
      console.log(dim('  Start useragent0 server first.'));
    }
  });

// ─── useragent0 db-clear ──────────────────────────────────────────────────────

program
  .command('db-clear')
  .description('Delete ALL data from the database (repos, cards, logs)')
  .action(async () => {
    printBanner();
    const { default: inquirer } = await import('inquirer');

    console.log(red('  WARNING: This will permanently delete ALL repos, cards, and logs.'));
    console.log();

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: 'Are you sure you want to delete everything?',
        default: false,
      },
    ]);

    if (!confirmed) {
      console.log(dim('\n  Cancelled. Nothing was deleted.\n'));
      return;
    }

    const { final } = await inquirer.prompt([
      {
        type: 'input',
        name: 'final',
        message: 'Type DELETE to confirm — this cannot be undone:',
      },
    ]);

    if (final.trim() !== 'DELETE') {
      console.log(dim('\n  Cancelled. Nothing was deleted.\n'));
      return;
    }

    try {
      const { DBClient, DB_PATH } = await import('./core');
      const db = new DBClient(DB_PATH);
      db.clearAll();
      db.close();
      console.log();
      console.log(green('  ✓') + '  All data deleted.');
      console.log();
    } catch (err) {
      console.error(red('  ✗  Failed to clear database'));
      console.error(err);
      process.exit(1);
    }
  });

// ─── CLAUDE.md Generator ──────────────────────────────────────────────────────

function generateClaudeMd(repoPath: string, repoName: string, activeAgents: string[]): void {
  const claudeMdPath = path.join(repoPath, 'CLAUDE.md');
  const content = `# useragent0 — AI Agent Instructions

This repository is managed with [useragent0](https://github.com/dczii/UserAgent0).
**You must use useragent0 MCP tools on every task.** Do not work on tasks without creating or updating a card.

## MCP Server

The useragent0 MCP server runs at \`http://localhost:4000/mcp\`.
Make sure it is running before starting work (\`useragent0 start\`).

## Active Agents in this repo

${activeAgents.map(a => `- \`${a}\``).join('\n')}

## Workflow — follow this on every task

### 1. Start of session
\`\`\`
list_repos → find repo_id for "${repoName}"
get_next_card(repo_id) → find the next card to work on
\`\`\`

### 2. Before starting work on a card
\`\`\`
set_current_card(card_id, repo_id) → writes .agents/.current-card for git hooks
move_card(card_id, "in_progress", moved_by: <your_agent_id>) → move card to In Progress
append_log(card_id, action: "agent_started", detail: "Full plan for this task...") → log your plan
\`\`\`

### 3. After every meaningful action
\`\`\`
append_log(card_id, {
  agent: "<your_agent_id>",
  action: "<what you did>",
  detail: "<full description>",
  files_changed: ["src/..."],
  commands_run: ["npm test"],
  outcome: "<pass/fail + details>",
  next_step: "<what comes next>",
  tokens: <tokens used in this action>
})
\`\`\`

### 4. When work is complete and committed
\`\`\`
move_card(card_id, "create_pr") → advance to Create PR
update_card(card_id, pr_url: "https://github.com/...") → record the PR URL
\`\`\`

### 5. If tests fail or QA rejects
\`\`\`
bounce_card(card_id, root_cause: "...", failed_tests: [...], suggested_fix: "...")
\`\`\`

## Rules

- **Never skip logging.** Call \`append_log\` after every file edit, test run, or decision.
- **Always include token count** in \`append_log\` so the card tracks total usage.
- **Always call \`set_current_card\`** before committing — git hooks depend on it.
- **Never work on a task without a card.** Create one with \`create_card\` if it doesn't exist.
- **Check \`get_next_card\`** at the start of every session before asking the user what to do.

## MCP Tools Reference

| Tool | When to use |
|------|------------|
| \`list_repos\` | Start of session — find your repo_id |
| \`get_next_card\` | Start of session — find what to work on |
| \`create_card\` | When a task has no card yet |
| \`set_current_card\` | Before starting work on a card |
| \`move_card\` | When column changes (in_progress, commit, create_pr, test, qa, done) |
| \`append_log\` | After every action — be detailed, include tokens |
| \`update_card\` | After creating a PR — record pr_url |
| \`bounce_card\` | When tests fail or QA rejects |
| \`get_card\` | To check current state and history of a card |
| \`list_cards\` | To see all cards in a column |
`;

  fs.writeFileSync(claudeMdPath, content, 'utf-8');
}

// ─── Git Hooks ────────────────────────────────────────────────────────────────

function installGitHooks(repoPath: string) {
  const hooksDir = path.join(repoPath, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) return;

  const postCommit = `#!/bin/sh
# useragent0: notify commit agent
CARD_ID=$(cat .agents/.current-card 2>/dev/null)
if [ -n "$CARD_ID" ]; then
  curl -s -X PATCH http://localhost:4000/api/cards/$CARD_ID/move \\
    -H "Content-Type: application/json" \\
    -d '{"column":"commit","moved_by":"dev_agent"}' > /dev/null 2>&1 || true
fi
`;

  const prePush = `#!/bin/sh
# useragent0: run MCP test then notify PR agent
echo "  useragent0: checking MCP connection..."
if command -v useragent0 >/dev/null 2>&1; then
  useragent0 test --port 4000
  if [ $? -ne 0 ]; then
    echo "  useragent0: MCP test failed. Start the server with: useragent0 start"
    exit 1
  fi
fi

CARD_ID=$(cat .agents/.current-card 2>/dev/null)
if [ -n "$CARD_ID" ]; then
  curl -s -X PATCH http://localhost:4000/api/cards/$CARD_ID/move \\
    -H "Content-Type: application/json" \\
    -d '{"column":"create_pr","moved_by":"dev_agent"}' > /dev/null 2>&1 || true
fi
`;

  const hooks: Record<string, string> = {
    'post-commit': postCommit,
    'pre-push': prePush,
  };

  Object.entries(hooks).forEach(([name, content]) => {
    const hookPath = path.join(hooksDir, name);
    fs.writeFileSync(hookPath, content, { mode: 0o755 });
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────────

program.parse(process.argv);
