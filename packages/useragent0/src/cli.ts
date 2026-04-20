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
    console.log();
    console.log(dim('  Next: run ') + teal('useragent0 start') + dim(' to open the Kanban UI'));
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

// ─── Git Hooks ────────────────────────────────────────────────────────────────

function installGitHooks(repoPath: string) {
  const hooksDir = path.join(repoPath, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) return;

  const postCommit = `#!/bin/sh
# useragent0: notify commit agent
CARD_ID=$(cat .agents/.current-card 2>/dev/null)
if [ -n "$CARD_ID" ]; then
  curl -s -X PATCH http://localhost:3000/api/cards/$CARD_ID/move \\
    -H "Content-Type: application/json" \\
    -d '{"column":"commit","moved_by":"dev_agent"}' > /dev/null 2>&1 || true
fi
`;

  const prePush = `#!/bin/sh
# useragent0: notify PR agent
CARD_ID=$(cat .agents/.current-card 2>/dev/null)
if [ -n "$CARD_ID" ]; then
  curl -s -X PATCH http://localhost:3000/api/cards/$CARD_ID/move \\
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
