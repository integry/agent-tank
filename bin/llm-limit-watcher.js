#!/usr/bin/env node

const { parseArgs } = require('node:util');
const { LLMWatcher } = require('../src/index.js');

const options = {
  claude: { type: 'boolean', default: false },
  gemini: { type: 'boolean', default: false },
  codex: { type: 'boolean', default: false },
  port: { type: 'string', default: '3456' },
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
  --claude          Enable Claude monitoring
  --gemini          Enable Gemini monitoring
  --codex           Enable Codex monitoring
  --port <port>     HTTP server port (default: 3456)
  --config, -c      Path to config file (JSON)
  --auto-discover   Auto-discover available agents (default: true)
  --help, -h        Show this help message

Examples:
  llm-limit-watcher                          # Auto-discover and monitor all available
  llm-limit-watcher --claude --gemini        # Monitor specific agents
  llm-limit-watcher --port 8080              # Use custom port
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

// Merge CLI options with config
const agents = [];
if (values.claude || config.claude) agents.push('claude');
if (values.gemini || config.gemini) agents.push('gemini');
if (values.codex || config.codex) agents.push('codex');

const watcher = new LLMWatcher({
  agents: agents.length > 0 ? agents : null, // null = auto-discover
  autoDiscover: values['auto-discover'] && agents.length === 0,
  port: parseInt(values.port || config.port || '3456', 10),
});

watcher.start().catch(err => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
