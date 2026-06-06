#!/usr/bin/env node
/* eslint-disable complexity */

const { parseArgs } = require('node:util');
const { spawn } = require('node:child_process');
const {
  filterBackgroundArgs,
  findAgentTankProcesses,
  isTruthyEnv,
} = require('../src/process-utils.js');
const pkg = require('../package.json');

const options = {
  claude: { type: 'boolean', default: false },
  agy: { type: 'boolean', default: false },
  codex: { type: 'boolean', default: false },
  'claude-api': { type: 'boolean', default: false },
  port: { type: 'string', default: '3456' },
  host: { type: 'string' },
  docker: { type: 'boolean', default: true },
  'auth-user': { type: 'string' },
  'auth-pass': { type: 'string' },
  'auth-token': { type: 'string' },
  'fresh-process': { type: 'boolean', default: false },
  config: { type: 'string', short: 'c' },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
  'auto-discover': { type: 'boolean', default: true },
  'auto-refresh': { type: 'boolean', default: true },
  'auto-refresh-interval': { type: 'string', default: '60' },
  'auto-refresh-mode': { type: 'string', default: 'activity' },
  'refresh-cooldown': { type: 'string', default: '30' },
  'activity-debounce': { type: 'string', default: '5000' },
  'history-retention-days': { type: 'string', default: '14' },
  'keepalive': { type: 'boolean', default: true },
  'keepalive-interval': { type: 'string', default: '300' },
  once: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  background: { type: 'boolean', default: false },
};

const { values } = parseArgs({ options, allowPositionals: false, allowNegative: true });

function exitWithCode(code, message, stream = process.stderr) {
  if (message) {
    stream.write(`${message}\n`);
  }
  process.exitCode = code;
}

function writeAndExit(stream, text, exitCode, { cleanup, watcher, jsonMode, originalLog }) {
  stream.write(text, () => {
    cleanup();
    watcher.stop();
    if (jsonMode) {
      console.log = originalLog;
    }
    process.exit(exitCode);
  });
}

function printHelp() {
  process.stdout.write(`
agent-tank - Monitor LLM CLI usage limits

Usage: agent-tank [options]

Options:
  --claude              Enable Claude monitoring
  --agy                 Enable Antigravity monitoring
  --codex               Enable Codex monitoring
  --claude-api          Use direct Anthropic API for Claude usage (faster, 60s refresh)
  --port <port>         HTTP server port (default: 3456)
  --host <host>         Bind address (default: 127.0.0.1 + Docker bridge when available)
  --docker              Enable Docker bridge bind when --host is omitted (default: true)
  --auth-user <user>    HTTP Basic Auth username
  --auth-pass <pass>    HTTP Basic Auth password
  --auth-token <token>  API key for Bearer token auth
  --fresh-process       Spawn a new process per refresh (default: false)
  --config, -c          Path to config file (JSON)
  --version, -v         Show version
  --auto-discover       Auto-discover available agents (default: true)
  --auto-refresh        Enable/disable background auto-refresh (default: true)
  --auto-refresh-mode <mode>         Refresh mode: none, interval, activity (default: activity)
  --auto-refresh-interval <seconds>  Auto-refresh interval in seconds (default: 60, 0 = disabled)
  --refresh-cooldown <seconds>       Minimum time between refreshes per agent (default: 30, 0 = disabled)
  --activity-debounce <ms>           Activity debounce interval in milliseconds (default: 5000)
  --keepalive           Enable/disable session keepalive (default: true)
  --keepalive-interval <seconds>     Session keepalive interval in seconds (default: 300, 0 = disabled)
  --history-retention-days <days>    Days to retain usage history (default: 14)
  --once                Fetch usage once and exit (no HTTP server)
  --json                Output pure JSON (suppress logging, use with --once)
  --background          Start Agent Tank as a detached background process
  --help, -h            Show this help message

Auto-Refresh Modes:
  none      - No automatic refresh (manual refresh only via POST /refresh)
  interval  - Traditional interval-based polling (refreshes at fixed intervals)
  activity  - Activity-based polling (default) - monitors log directories and
              refreshes when CLI activity is detected, saving resources during idle

Environment variables:
  AGENT_TANK_USER       Basic auth username (overrides --auth-user)
  AGENT_TANK_PASS       Basic auth password (overrides --auth-pass)
  AGENT_TANK_TOKEN      API key (overrides --auth-token)
  AGENT_TANK_HOST       Bind address (overrides --host)
  AGENT_TANK_DOCKER     Enable/disable Docker bridge bind ("1"/"true" or "0"/"false")
  AGENT_TANK_FRESH_PROCESS  Use fresh process per refresh ("1" or "true")
  AGENT_TANK_CLAUDE_API Use direct Anthropic API for Claude usage ("1" or "true")
  AGENT_TANK_AUTO_REFRESH   Enable/disable background auto-refresh ("1" or "true" / "0" or "false")
  AGENT_TANK_AUTO_REFRESH_MODE      Refresh mode: none, interval, activity
  AGENT_TANK_AUTO_REFRESH_INTERVAL  Auto-refresh interval in seconds
  AGENT_TANK_REFRESH_COOLDOWN       Minimum time between refreshes per agent in seconds
  AGENT_TANK_ACTIVITY_DEBOUNCE      Activity debounce interval in milliseconds
  AGENT_TANK_KEEPALIVE      Enable/disable session keepalive ("1" or "true" / "0" or "false")
  AGENT_TANK_KEEPALIVE_INTERVAL  Session keepalive interval in seconds
  AGENT_TANK_HISTORY_RETENTION_DAYS  Days to retain usage history
  AGENT_TANK_BACKGROUND  Start as a detached background process ("1" or "true")

Examples:
  agent-tank                          # Auto-discover and monitor all available
  agent-tank --background             # Start in the background and print the PID
  agent-tank --claude --agy           # Monitor specific agents
  agent-tank --port 8080              # Use custom port
  agent-tank --host 0.0.0.0           # Expose on all interfaces
  agent-tank --no-docker              # Bind localhost only when host is omitted
  agent-tank --auth-user admin --auth-pass secret  # Enable basic auth
  agent-tank --auth-token mykey       # Enable API key auth
  agent-tank -c ./config.json         # Use config file
  agent-tank --auto-refresh-mode interval  # Use traditional interval polling
  agent-tank --auto-refresh-mode activity  # Use activity-based polling (default)
  agent-tank --activity-debounce 10000     # Wait 10 seconds after activity before refresh
  agent-tank --auto-refresh-interval 30  # Refresh every 30 seconds
  agent-tank --refresh-cooldown 45     # Limit each agent to one refresh every 45 seconds
  agent-tank --no-auto-refresh        # Disable background auto-refresh
  agent-tank --keepalive-interval 600 # Send keepalive every 10 minutes
  agent-tank --no-keepalive           # Disable session keepalive
  agent-tank --history-retention-days 7  # Keep only 7 days of history
  agent-tank --once                   # Fetch usage once and exit
  agent-tank --once --json            # Output pure JSON for scripting

HTTP Endpoints:
  GET /              Status page (HTML)
  GET /status        All agent statuses (JSON)
  GET /status/:agent Status for specific agent (JSON)
  GET /config        Auto-refresh and history configuration (JSON)
  GET /history       Usage history statistics (JSON)
  GET /history/:agent Usage history for specific agent (JSON)
  POST /refresh      Trigger refresh for all agents
  POST /refresh/:agent Trigger refresh for specific agent
`);
}

function spawnBackgroundProcess() {
  const childArgs = [
    process.argv[1],
    ...filterBackgroundArgs(process.argv.slice(2)),
  ];
  const childEnv = {
    ...process.env,
    AGENT_TANK_BACKGROUND_CHILD: '1',
  };
  delete childEnv.AGENT_TANK_BACKGROUND;

  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: 'ignore',
    env: childEnv,
  });
  child.unref();

  process.stdout.write(`Agent Tank started in the background with PID ${child.pid}\n`);
}

function warnAboutRunningProcesses() {
  const running = findAgentTankProcesses();
  if (running.length === 0) {
    return;
  }

  const pids = running.map(entry => entry.pid).join(', ');
  process.stderr.write(`Warning: other Agent Tank process(es) already running: ${pids}\n`);
  process.stderr.write('Tip: start Agent Tank in the background with agent-tank --background\n');
}

async function main() {
  if (values.help) {
    printHelp();
    process.exitCode = 0;
    return;
  }

  if (values.version) {
    process.stdout.write(`${pkg.version}\n`);
    process.exitCode = 0;
    return;
  }

  const backgroundRequested = values.background || isTruthyEnv(process.env.AGENT_TANK_BACKGROUND);
  const backgroundChild = process.env.AGENT_TANK_BACKGROUND_CHILD === '1';

  if (backgroundRequested && !backgroundChild && values.once) {
    exitWithCode(1, 'Error: --background cannot be combined with --once');
    return;
  }

  if (backgroundRequested && !backgroundChild && values.json) {
    exitWithCode(1, 'Error: --background cannot be combined with --json');
    return;
  }

  if (backgroundRequested && !backgroundChild) {
    spawnBackgroundProcess();
    process.exitCode = 0;
    return;
  }

  const { AgentTank } = require('../src/index.js');
  const { installShutdownHandlers } = require('../src/shutdown-handler.js');

  // Load config file if specified
  let config = {};
  if (values.config) {
    try {
      config = require(require('path').resolve(values.config));
    } catch (err) {
      exitWithCode(1, `Failed to load config file: ${err.message}`);
      return;
    }
  }

  // Merge CLI options with config (env vars > CLI flags > config file)
  const agents = [];
  if (values.claude || config.claude) agents.push('claude');
  if (values.agy || config.agy) agents.push('agy');
  if (values.codex || config.codex) agents.push('codex');

  const auth = {
    user: process.env.AGENT_TANK_USER || values['auth-user'] || config.auth?.user,
    pass: process.env.AGENT_TANK_PASS || values['auth-pass'] || config.auth?.pass,
    token: process.env.AGENT_TANK_TOKEN || values['auth-token'] || config.auth?.token,
  };

  const host = process.env.AGENT_TANK_HOST || values.host || config.host;
  const dockerEnv = process.env.AGENT_TANK_DOCKER;
  let dockerAccess = values.docker;
  if (dockerEnv !== undefined) {
    dockerAccess = dockerEnv === '1' || dockerEnv === 'true';
  } else if (config.dockerAccess !== undefined) {
    dockerAccess = config.dockerAccess;
  }

  const freshProcessEnv = process.env.AGENT_TANK_FRESH_PROCESS;
  const freshProcess = values['fresh-process'] ||
    config.freshProcess ||
    freshProcessEnv === '1' || freshProcessEnv === 'true';

  // Claude API configuration (env > CLI > config file)
  const claudeApiEnv = process.env.AGENT_TANK_CLAUDE_API;
  const claudeApi = values['claude-api'] ||
    config.claudeApi ||
    claudeApiEnv === '1' || claudeApiEnv === 'true';

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

  // Auto-refresh mode configuration (env > CLI > config file)
  const autoRefreshModeEnv = process.env.AGENT_TANK_AUTO_REFRESH_MODE;
  let autoRefreshMode = values['auto-refresh-mode'];
  if (autoRefreshModeEnv !== undefined) {
    autoRefreshMode = autoRefreshModeEnv;
  } else if (config.autoRefresh?.mode !== undefined) {
    autoRefreshMode = config.autoRefresh.mode;
  }

  const refreshCooldownEnv = process.env.AGENT_TANK_REFRESH_COOLDOWN;
  let refreshCooldown = parseInt(values['refresh-cooldown'], 10);
  if (refreshCooldownEnv !== undefined) {
    refreshCooldown = parseInt(refreshCooldownEnv, 10);
  } else if (config.refreshCooldown !== undefined) {
    refreshCooldown = config.refreshCooldown;
  } else if (config.autoRefresh?.refreshCooldown !== undefined) {
    refreshCooldown = config.autoRefresh.refreshCooldown;
  }

  // Activity debounce configuration (env > CLI > config file)
  const activityDebounceEnv = process.env.AGENT_TANK_ACTIVITY_DEBOUNCE;
  let activityDebounce = parseInt(values['activity-debounce'], 10);
  if (activityDebounceEnv !== undefined) {
    activityDebounce = parseInt(activityDebounceEnv, 10);
  } else if (config.autoRefresh?.activityDebounce !== undefined) {
    activityDebounce = config.autoRefresh.activityDebounce;
  }

  // History retention configuration (env > CLI > config file > default)
  const historyRetentionEnv = process.env.AGENT_TANK_HISTORY_RETENTION_DAYS;
  let historyRetentionDays = parseInt(values['history-retention-days'], 10);
  if (historyRetentionEnv !== undefined) {
    historyRetentionDays = parseInt(historyRetentionEnv, 10);
  } else if (config.history?.retentionDays !== undefined) {
    historyRetentionDays = config.history.retentionDays;
  }

  // Keepalive configuration (env > CLI > config file)
  const keepaliveEnv = process.env.AGENT_TANK_KEEPALIVE;
  let keepaliveEnabled = values['keepalive'];
  if (keepaliveEnv !== undefined) {
    keepaliveEnabled = keepaliveEnv === '1' || keepaliveEnv === 'true';
  } else if (config.keepalive?.enabled !== undefined) {
    keepaliveEnabled = config.keepalive.enabled;
  }

  const keepaliveIntervalEnv = process.env.AGENT_TANK_KEEPALIVE_INTERVAL;
  let keepaliveInterval = parseInt(values['keepalive-interval'], 10);
  if (keepaliveIntervalEnv !== undefined) {
    keepaliveInterval = parseInt(keepaliveIntervalEnv, 10);
  } else if (config.keepalive?.interval !== undefined) {
    keepaliveInterval = config.keepalive.interval;
  }

  // One-shot and JSON mode flags
  const onceMode = values.once;
  const jsonMode = values.json;

  // Suppress console output in JSON mode
  const originalLog = console.log;
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
    dockerAccess,
    auth,
    freshProcess,
    claudeApi,
    autoRefreshEnabled: onceMode ? false : autoRefreshEnabled, // Disable auto-refresh in one-shot mode
    autoRefreshInterval,
    autoRefreshMode: onceMode ? 'none' : autoRefreshMode, // Disable auto-refresh in one-shot mode
    refreshCooldown,
    activityDebounce,
    keepaliveEnabled: onceMode ? false : keepaliveEnabled, // Disable keepalive in one-shot mode
    keepaliveInterval,
    historyRetentionDays,
    skipServer: onceMode, // Don't start HTTP server in one-shot mode
  });

  // Graceful shutdown
  let shuttingDown = false;
  let cleanupShutdownHandlers = () => {};
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    cleanupShutdownHandlers();
    if (!jsonMode) {
      originalLog(`\nShutting down${signal ? ` (${signal})` : ''}...`);
    }
    watcher.stop();
    process.exit(0);
  };
  cleanupShutdownHandlers = installShutdownHandlers({ shutdown });

  try {
    if (onceMode) {
      await watcher.start();
      const status = watcher.getStatus();
      if (jsonMode) {
        const output = `${JSON.stringify(status, null, 2)}\n`;
        writeAndExit(process.stdout, output, 0, {
          cleanup: cleanupShutdownHandlers,
          watcher,
          jsonMode,
          originalLog,
        });
        return;
      } else {
        let output = '';
        for (const [name, agentStatus] of Object.entries(status)) {
          output += `\n=== ${name.toUpperCase()} ===\n`;
          output += `${JSON.stringify(agentStatus, null, 2)}\n`;
        }
        writeAndExit(process.stdout, output, 0, {
          cleanup: cleanupShutdownHandlers,
          watcher,
          jsonMode,
          originalLog,
        });
        return;
      }
    }

    if (!jsonMode && !backgroundChild) {
      warnAboutRunningProcesses();
    }

    await watcher.start();
  } catch (err) {
    cleanupShutdownHandlers();
    if (jsonMode) {
      console.log = originalLog;
      console.log(JSON.stringify({ error: err.message }, null, 2));
    } else {
      exitWithCode(1, `Failed to start: ${err.message}`);
    }
    process.exitCode = 1;
  }
}

main();
