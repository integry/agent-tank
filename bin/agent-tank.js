#!/usr/bin/env node

const { parseArgs } = require('node:util');
const { AgentTank } = require('../src/index.js');

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
  'auto-refresh': { type: 'boolean', default: true },
  'auto-refresh-interval': { type: 'string', default: '60' },
  once: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
};

const { values } = parseArgs({ options, allowPositionals: false, allowNegative: true });

if (values.help) {
  console.log(`
agent-tank - Monitor LLM CLI usage limits

Usage: agent-tank [options]

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
  --auto-refresh        Enable/disable background auto-refresh (default: true)
  --auto-refresh-interval <seconds>  Auto-refresh interval in seconds (default: 60, 0 = disabled)
  --once                Fetch usage once and exit (no HTTP server)
  --json                Output pure JSON (suppress logging, use with --once)
  --help, -h            Show this help message

Environment variables:
  AGENT_TANK_USER       Basic auth username (overrides --auth-user)
  AGENT_TANK_PASS       Basic auth password (overrides --auth-pass)
  AGENT_TANK_TOKEN      API key (overrides --auth-token)
  AGENT_TANK_HOST       Bind address (overrides --host)
  AGENT_TANK_FRESH_PROCESS  Use fresh process per refresh ("1" or "true")
  AGENT_TANK_AUTO_REFRESH   Enable/disable background auto-refresh ("1" or "true" / "0" or "false")
  AGENT_TANK_AUTO_REFRESH_INTERVAL  Auto-refresh interval in seconds

Examples:
  agent-tank                          # Auto-discover and monitor all available
  agent-tank --claude --gemini        # Monitor specific agents
  agent-tank --port 8080              # Use custom port
  agent-tank --host 0.0.0.0           # Expose on all interfaces
  agent-tank --auth-user admin --auth-pass secret  # Enable basic auth
  agent-tank --auth-token mykey       # Enable API key auth
  agent-tank -c ./config.json         # Use config file
  agent-tank --auto-refresh-interval 30  # Refresh every 30 seconds
  agent-tank --no-auto-refresh        # Disable background auto-refresh
  agent-tank --once                   # Fetch usage once and exit
  agent-tank --once --json            # Output pure JSON for scripting

HTTP Endpoints:
  GET /              Status page (HTML)
  GET /status        All agent statuses (JSON)
  GET /status/:agent Status for specific agent (JSON)
  GET /config        Auto-refresh configuration (JSON)
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
  user: process.env.AGENT_TANK_USER || values['auth-user'] || config.auth?.user,
  pass: process.env.AGENT_TANK_PASS || values['auth-pass'] || config.auth?.pass,
  token: process.env.AGENT_TANK_TOKEN || values['auth-token'] || config.auth?.token,
};

const host = process.env.AGENT_TANK_HOST || values.host || config.host;

const freshProcessEnv = process.env.AGENT_TANK_FRESH_PROCESS;
const freshProcess = values['fresh-process'] ||
  config.freshProcess ||
  freshProcessEnv === '1' || freshProcessEnv === 'true';

// Auto-refresh configuration (env > CLI > config file)
const autoRefreshEnv = process.env.AGENT_TANK_AUTO_REFRESH;
let autoRefreshEnabled = values['auto-refresh'];
if (autoRefreshEnv !== undefined) {
  autoRefreshEnabled = autoRefreshEnv === '1' || autoRefreshEnv === 'true';
} else if (config.autoRefresh?.enabled !== undefined) {
  autoRefreshEnabled = config.autoRefresh.enabled;
}

const autoRefreshIntervalEnv = process.env.AGENT_TANK_AUTO_REFRESH_INTERVAL;
let autoRefreshInterval = parseInt(values['auto-refresh-interval'], 10);
if (autoRefreshIntervalEnv !== undefined) {
  autoRefreshInterval = parseInt(autoRefreshIntervalEnv, 10);
} else if (config.autoRefresh?.interval !== undefined) {
  autoRefreshInterval = config.autoRefresh.interval;
}

// One-shot and JSON mode flags
const onceMode = values.once;
const jsonMode = values.json;

// Suppress console output in JSON mode
const originalLog = console.log;
const originalError = console.error;
if (jsonMode) {
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
}

const watcher = new AgentTank({
  agents: agents.length > 0 ? agents : null, // null = auto-discover
  autoDiscover: values['auto-discover'] && agents.length === 0,
  port: parseInt(values.port || config.port || '3456', 10),
  host,
  auth,
  freshProcess,
  autoRefreshEnabled: onceMode ? false : autoRefreshEnabled, // Disable auto-refresh in one-shot mode
  autoRefreshInterval,
  skipServer: onceMode, // Don't start HTTP server in one-shot mode
});

// Graceful shutdown
const shutdown = () => {
  if (!jsonMode) {
    originalLog('\nShutting down...');
  }
  watcher.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (onceMode) {
  // One-shot mode: fetch data once and exit
  watcher.start().then(() => {
    const status = watcher.getStatus();
    if (jsonMode) {
      // Restore console.log for JSON output
      console.log = originalLog;
      console.log(JSON.stringify(status, null, 2));
      // Suppress console.log again before stopping to avoid "Killing persistent process" messages
      console.log = () => {};
    } else {
      // Output human-readable summary
      for (const [name, agentStatus] of Object.entries(status)) {
        originalLog(`\n=== ${name.toUpperCase()} ===`);
        originalLog(JSON.stringify(agentStatus, null, 2));
      }
    }
    watcher.stop();
    process.exit(0);
  }).catch(err => {
    if (jsonMode) {
      console.log = originalLog;
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      originalError('Failed to start:', err.message);
    }
    process.exit(1);
  });
} else {
  // Normal mode: start server and keep running
  watcher.start().catch(err => {
    if (jsonMode) {
      console.log = originalLog;
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      originalError('Failed to start:', err.message);
    }
    process.exit(1);
  });
}
