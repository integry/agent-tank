#!/usr/bin/env node

const { parseArgs } = require('node:util');
const { LLMWatcher } = require('../src/index.js');

const options = {
  claude: { type: 'boolean', default: false },
  gemini: { type: 'boolean', default: false },
  codex: { type: 'boolean', default: false },
  port: { type: 'string', default: '3456' },
  host: { type: 'string' },
  'auth-user': { type: 'string' },
  'auth-pass': { type: 'string' },
  'auth-token': { type: 'string' },
  'fresh-process': { type: 'boolean', default: false },
  config: { type: 'string', short: 'c' },
  help: { type: 'boolean', short: 'h', default: false },
  'auto-discover': { type: 'boolean', default: true },
};

const { values } = parseArgs({ options, allowPositionals: false });

if (values.help) {
  console.log(`
llm-limit-watcher - Monitor LLM CLI usage limits

Usage: llm-limit-watcher [options]

Options:
  --claude              Enable Claude monitoring
  --gemini              Enable Gemini monitoring
  --codex               Enable Codex monitoring
  --port <port>         HTTP server port (default: 3456)
  --host <host>         Bind address (default: 127.0.0.1)
  --auth-user <user>    HTTP Basic Auth username
  --auth-pass <pass>    HTTP Basic Auth password
  --auth-token <token>  API key for Bearer token auth
  --fresh-process       Spawn a new process per refresh (default: false)
  --config, -c          Path to config file (JSON)
  --auto-discover       Auto-discover available agents (default: true)
  --help, -h            Show this help message

Environment variables:
  LLM_WATCHER_USER      Basic auth username (overrides --auth-user)
  LLM_WATCHER_PASS      Basic auth password (overrides --auth-pass)
  LLM_WATCHER_TOKEN     API key (overrides --auth-token)
  LLM_WATCHER_HOST      Bind address (overrides --host)
  LLM_WATCHER_FRESH_PROCESS  Use fresh process per refresh ("1" or "true")

Examples:
  llm-limit-watcher                          # Auto-discover and monitor all available
  llm-limit-watcher --claude --gemini        # Monitor specific agents
  llm-limit-watcher --port 8080              # Use custom port
  llm-limit-watcher --host 0.0.0.0           # Expose on all interfaces
  llm-limit-watcher --auth-user admin --auth-pass secret  # Enable basic auth
  llm-limit-watcher --auth-token mykey       # Enable API key auth
  llm-limit-watcher -c ./config.json         # Use config file

HTTP Endpoints:
  GET /              Status page (HTML)
  GET /status        All agent statuses (JSON)
  GET /status/:agent Status for specific agent (JSON)
  POST /refresh      Trigger refresh for all agents
  POST /refresh/:agent Trigger refresh for specific agent
`);
  process.exit(0);
}

// Load config file if specified
let config = {};
if (values.config) {
  try {
    config = require(require('path').resolve(values.config));
  } catch (err) {
    console.error(`Failed to load config file: ${err.message}`);
    process.exit(1);
  }
}

// Merge CLI options with config (env vars > CLI flags > config file)
const agents = [];
if (values.claude || config.claude) agents.push('claude');
if (values.gemini || config.gemini) agents.push('gemini');
if (values.codex || config.codex) agents.push('codex');

const auth = {
  user: process.env.LLM_WATCHER_USER || values['auth-user'] || config.auth?.user,
  pass: process.env.LLM_WATCHER_PASS || values['auth-pass'] || config.auth?.pass,
  token: process.env.LLM_WATCHER_TOKEN || values['auth-token'] || config.auth?.token,
};

const host = process.env.LLM_WATCHER_HOST || values.host || config.host;

const freshProcessEnv = process.env.LLM_WATCHER_FRESH_PROCESS;
const freshProcess = values['fresh-process'] ||
  config.freshProcess ||
  freshProcessEnv === '1' || freshProcessEnv === 'true';

const watcher = new LLMWatcher({
  agents: agents.length > 0 ? agents : null, // null = auto-discover
  autoDiscover: values['auto-discover'] && agents.length === 0,
  port: parseInt(values.port || config.port || '3456', 10),
  host,
  auth,
  freshProcess,
});

// Graceful shutdown
const shutdown = () => {
  console.log('\nShutting down...');
  watcher.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

watcher.start().catch(err => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
