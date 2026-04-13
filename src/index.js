const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { ClaudeAgent } = require('./agents/claude.js');
const { GeminiAgent } = require('./agents/gemini.js');
const { CodexAgent } = require('./agents/codex.js');
const { discoverAgents } = require('./discovery.js');
const { fetchPublicStatus } = require('./public-status.js');
const { createServer, displayServerBanner } = require('./server.js');
const logger = require('./logger.js');
const { HistoryStore, DEFAULT_RETENTION_DAYS } = require('./history-store.js');
const { extractSnapshotMetrics } = require('./snapshot-metrics.js');
const { attachPaceEvaluation } = require('./pace-attachment.js');
const { KeepaliveManager } = require('./keepalive-manager.js');
const { AutoRefreshManager } = require('./auto-refresh-manager.js');

// Load package.json for version info
const pkg = require(path.join(__dirname, '..', 'package.json'));

/**
 * Valid auto-refresh modes:
 * - 'none': No automatic refresh (manual refresh only)
 * - 'interval': Traditional interval-based polling (refreshes at fixed intervals)
 * - 'activity': Activity-based polling (refreshes when log activity is detected)
 */
const AUTO_REFRESH_MODES = ['none', 'interval', 'activity'];
const DOCKER_INTERFACE_PATTERNS = [/^docker\d*$/i, /^br-/i, /^podman\d*$/i];

function describeAgentShutdown(agent) {
  const parts = [];

  if (agent.shell && typeof agent.shell.pid === 'number') {
    parts.push(`pty pid ${agent.shell.pid}`);
  }

  if (agent._rpcClient) {
    parts.push('json-rpc client');
  }

  if (parts.length === 0) {
    parts.push('no active child process');
  }

  return parts.join(', ');
}

function isPrivateIpv4(address) {
  return /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address);
}

function detectDockerHostsFromInterfaces(networkInterfaces = os.networkInterfaces()) {
  const hosts = [];

  for (const [name, addresses] of Object.entries(networkInterfaces)) {
    if (!DOCKER_INTERFACE_PATTERNS.some(pattern => pattern.test(name))) {
      continue;
    }

    for (const info of addresses || []) {
      if (info && info.family === 'IPv4' && !info.internal && isPrivateIpv4(info.address)) {
        if (!hosts.includes(info.address)) {
          hosts.push(info.address);
        }
      }
    }
  }

  return hosts.length > 0 ? hosts : null;
}

function detectDockerHosts({
  exec = execFileSync,
  networkInterfaces = os.networkInterfaces(),
} = {}) {
  try {
    const listOutput = exec('docker', ['network', 'ls', '--format', '{{json .}}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const networks = listOutput
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(network => network && network.Driver === 'bridge');

    const hosts = [];
    for (const network of networks) {
      const inspectOutput = exec('docker', ['network', 'inspect', network.ID, '--format', '{{json .IPAM.Config}}'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      const ipamConfigs = inspectOutput ? JSON.parse(inspectOutput) : [];
      for (const config of ipamConfigs || []) {
        if (config && config.Gateway && isPrivateIpv4(config.Gateway) && !hosts.includes(config.Gateway)) {
          hosts.push(config.Gateway);
        }
      }
    }

    if (hosts.length > 0) {
      return hosts;
    }
  } catch (_err) {
    // Fall back to interface detection when Docker is unavailable.
  }

  return detectDockerHostsFromInterfaces(networkInterfaces);
}

class AgentTank {
  constructor(options = {}) {
    this.port = options.port || 3456;
    this.host = options.host || '127.0.0.1';
    this.explicitHost = !!options.host;
    this.dockerAccess = options.dockerAccess !== false;
    this.autoDiscover = options.autoDiscover !== false;
    this.requestedAgents = options.agents || null;
    this.freshProcess = options.freshProcess || false;
    this.claudeApi = options.claudeApi || false; // Use direct Anthropic API for Claude
    this.auth = options.auth || {};
    this.agents = new Map();
    this.server = null;
    this.servers = [];
    this.listenHosts = [];
    this.publicStatus = {}; // Public API status from upstream providers
    this.skipServer = options.skipServer || false; // Skip HTTP server in one-shot mode
    this.lastRefreshedAt = null;
    this.refreshCooldown = Math.max(0, options.refreshCooldown ?? 30);
    this._agentRefreshStartedAt = new Map();
    this._agentRefreshPromises = new Map();
    this.stopping = false;

    // Auto-refresh configuration (backend periodic refresh)
    // Determine the mode: 'none', 'interval', or 'activity' (default: 'activity')
    const rawMode = options.autoRefreshMode ?? 'activity';
    const autoRefreshMode = AUTO_REFRESH_MODES.includes(rawMode) ? rawMode : 'activity';

    // Handle backwards compatibility: if autoRefreshEnabled is explicitly false, use 'none' mode
    if (options.autoRefreshEnabled === false) {
      this.autoRefresh = {
        mode: 'none',
        enabled: false,
        interval: options.autoRefreshInterval ?? 60,
        activityDebounce: options.activityDebounce ?? 5000, // Default: 5 seconds in ms
      };
    } else {
      this.autoRefresh = {
        mode: autoRefreshMode,
        enabled: autoRefreshMode !== 'none',
        interval: options.autoRefreshInterval ?? 60,   // Default: 60 seconds
        activityDebounce: options.activityDebounce ?? 5000, // Default: 5 seconds in ms
      };
    }

    // Auto-refresh manager (initialized in start())
    this.autoRefreshManager = null;

    // History store for usage snapshots
    this.historyRetentionDays = options.historyRetentionDays ?? DEFAULT_RETENTION_DAYS;
    this.historyStore = new HistoryStore({
      retentionDays: this.historyRetentionDays
    });

    // Keepalive manager for session maintenance
    this.keepalive = {
      enabled: options.keepaliveEnabled !== false, // Default: true
      interval: options.keepaliveInterval ?? 300,  // Default: 5 minutes (300 seconds)
    };
    this.keepaliveManager = null;
  }

  /**
   * Display startup banner with website URL, version, author copyright,
   * and agent refresh logic description
   */
  displayStartupBanner() {
    const ANSI = logger.ANSI;
    const version = pkg.version || '1.0.0';
    const homepage = pkg.homepage || 'https://github.com/integry/agent-tank';
    const author = pkg.author || 'Rinalds Uzkalns';
    const year = new Date().getFullYear();

    console.log('');
    // ASCII art logo matching the brand: tank/container icon with fluid level lines
    // Using box-drawing characters with rounded corners and battery emoji for visual appeal
    // ASCII art text for "AGENT TANK" using block letters - properly aligned
    console.log(`${ANSI.brightCyan}    ╭───╮${ANSI.reset}`);
    console.log(`${ANSI.brightCyan}  ╭─┴───┴─╮${ANSI.reset}  ${ANSI.brightWhite}█████╗  ██████╗ ███████╗███╗   ██╗████████╗${ANSI.reset} ${ANSI.brightCyan}${ANSI.bold}████████╗ █████╗ ███╗   ██╗██╗  ██╗${ANSI.reset}`);
    console.log(`${ANSI.brightCyan}  │ ━━━━━ │${ANSI.reset}  ${ANSI.brightWhite}██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝${ANSI.reset} ${ANSI.brightCyan}${ANSI.bold}╚══██╔══╝██╔══██╗████╗  ██║██║ ██╔╝${ANSI.reset}`);
    console.log(`${ANSI.brightCyan}  │ ━━━━━ │${ANSI.reset}  ${ANSI.brightWhite}███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ${ANSI.reset} ${ANSI.brightCyan}${ANSI.bold}   ██║   ███████║██╔██╗ ██║█████╔╝ ${ANSI.reset}`);
    console.log(`${ANSI.brightCyan}  │ ━━━━━ │${ANSI.reset}  ${ANSI.brightWhite}██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ${ANSI.reset} ${ANSI.brightCyan}${ANSI.bold}   ██║   ██╔══██║██║╚██╗██║██╔═██╗ ${ANSI.reset}`);
    console.log(`${ANSI.brightCyan}  │ ━━━━━ │${ANSI.reset}  ${ANSI.brightWhite}██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ${ANSI.reset} ${ANSI.brightCyan}${ANSI.bold}   ██║   ██║  ██║██║ ╚████║██║  ██╗${ANSI.reset}`);
    console.log(`${ANSI.brightCyan}  ╰───────╯${ANSI.reset}  ${ANSI.brightWhite}╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ${ANSI.reset} ${ANSI.brightCyan}${ANSI.bold}   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝${ANSI.reset}`);
    console.log('');
    console.log(`${ANSI.dim}               Monitor your AI agent usage${ANSI.reset}`);
    console.log('');
    console.log(`${ANSI.dim}Version ${version}${ANSI.reset}`);
    console.log(`${ANSI.brightWhite}${ANSI.underline}${homepage}${ANSI.reset}`);
    console.log(`${ANSI.dim}© ${year} ${author}${ANSI.reset}`);
    console.log('');

    // Display agent refresh logic description
    console.log(`${ANSI.cyan}${ANSI.bold}Agent Refresh Logic:${ANSI.reset}`);
    if (!this.autoRefresh.enabled || this.autoRefresh.interval <= 0) {
      console.log(`${ANSI.dim}  • Auto-refresh: disabled${ANSI.reset}`);
    } else {
      console.log(`${ANSI.dim}  • Auto-refresh: enabled (default interval: ${this.autoRefresh.interval}s)${ANSI.reset}`);
      console.log(`${ANSI.dim}  • Agents are polled periodically via PTY sessions to fetch usage data${ANSI.reset}`);
      console.log(`${ANSI.dim}  • Agents with higher minimum intervals use their own refresh timers${ANSI.reset}`);
    }
    console.log(`${ANSI.dim}  • Manual refresh available via POST /refresh or POST /refresh/:agent${ANSI.reset}`);
    console.log('');
  }

  async start() {
    if (this.stopping) {
      return;
    }

    // Display startup banner with website URL, version, and copyright
    this.displayStartupBanner();

    // Initialize agents
    let agentNames = this.requestedAgents;

    if (!agentNames || agentNames.length === 0) {
      if (this.autoDiscover) {
        logger.info('🔍 Auto-discovering available LLM agents...');
        agentNames = await discoverAgents();
        if (agentNames.length === 0) {
          logger.warn('No compatible LLM agents found.');
          logger.info('Requirements:');
          logger.info('  - Claude Code 2.0+ (for /usage command support)');
          logger.info('  - Gemini CLI 0.24.5+ (for /stats command support)');
          logger.info('  - Codex CLI');
          logger.info('\nInstall/update with:');
          logger.info('  npm install -g @anthropic-ai/claude-code@latest');
          logger.info('  npm install -g gemini@latest');
          throw new Error('No agents found');
        }
        logger.success(`✅ Found agents: ${agentNames.join(', ')}`);
      } else {
        throw new Error('No agents specified and auto-discover disabled.');
      }
    }

    // Create agent instances
    for (const name of agentNames) {
      const agent = this.createAgent(name);
      if (agent) {
        agent.freshProcess = this.freshProcess;
        this.agents.set(name, agent);
        logger.agent(name, `Created agent${this.freshProcess ? ' (fresh process mode)' : ''}`);
      }
    }

    // Start HTTP server immediately so it's available during agent loading (unless skipped)
    if (!this.skipServer) {
      await this.startServer();
    }

    // Pre-spawn persistent processes in parallel before sending commands
    if (!this.freshProcess) {
      logger.info('🚀 Spawning agent processes...');
      await Promise.all(
        Array.from(this.agents.values()).map(agent =>
          agent.spawnProcess().catch(err =>
            this.stopping || err.message === 'Agent stopping'
              ? null
              : logger.error(`Error spawning ${agent.name}:`, err.message)
          )
        )
      );
    }

    if (this.stopping) {
      return;
    }

    // Initial fetch
    logger.info('📊 Fetching initial usage data...');
    await this.refreshAll();

    // Start backend auto-refresh if enabled (skip in one-shot mode)
    if (!this.skipServer && !this.stopping) {
      this.startAutoRefresh();
      this.startKeepalive();
    }
  }

  /** Start the keepalive manager to maintain agent sessions. */
  startKeepalive() {
    this.stopKeepalive();
    if (!this.keepalive.enabled || this.keepalive.interval <= 0) { console.log('Session keepalive: disabled'); return; }
    if (this.freshProcess) { console.log('Session keepalive: disabled (fresh process mode)'); return; }
    this.keepaliveManager = new KeepaliveManager({ enabled: this.keepalive.enabled, interval: this.keepalive.interval });
    for (const [name, agent] of this.agents) { this.keepaliveManager.register(name, agent); }
    this.keepaliveManager.start(); console.log(`Session keepalive: every ${this.keepalive.interval}s`);
  }

  /** Stop the keepalive manager. */
  stopKeepalive() { if (this.keepaliveManager) { this.keepaliveManager.stop(); this.keepaliveManager = null; } }

  startAutoRefresh() {
    this.autoRefreshManager = new AutoRefreshManager({
      config: this.autoRefresh,
      agents: this.agents,
      onRefreshAll: () => this.refreshAll(),
      onRefreshAgent: (name) => this.refreshAgent(name),
    });
    this.autoRefreshManager.start();
  }

  stopAutoRefresh() {
    if (this.autoRefreshManager) {
      this.autoRefreshManager.stop();
      this.autoRefreshManager = null;
    }
  }

  createAgent(name) {
    switch (name) {
      case 'claude':
        return new ClaudeAgent({ useApi: this.claudeApi });
      case 'gemini':
        return new GeminiAgent();
      case 'codex':
        return new CodexAgent();
      default:
        logger.warn(`Unknown agent: ${name}`);
        return null;
    }
  }

  async refreshAll() {
    if (this.stopping) {
      return;
    }

    logger.info('🔄 Refreshing all agents...');
    const agentNames = Array.from(this.agents.keys());

    // Fetch PTY agent data and public status concurrently
    const [, publicStatusResult] = await Promise.all([
      // Agent PTY refreshes
      Promise.all(
        Array.from(this.agents.keys()).map(name =>
          this._refreshAgentWithCooldown(name).catch(err => {
            if (!this.stopping && err.message !== 'Agent stopping') {
              logger.error(`Error refreshing ${name}:`, err.message);
            }
          })
        )
      ),
      // Public API status polling
      fetchPublicStatus(agentNames).catch(err => {
        logger.error('Error fetching public status:', err.message);
        return {};
      }),
    ]);

    this.publicStatus = publicStatusResult;
    this.lastRefreshedAt = new Date().toISOString();

    // Record usage snapshots and attach pace evaluations
    for (const [name, agent] of this.agents) {
      if (agent.usage) {
        this._recordSnapshot(name, agent.usage);
        attachPaceEvaluation(name, agent.usage);
      }
    }

    logger.success('✅ All agents refresh complete');
  }

  /** Record a usage snapshot to the history store. @private */
  _recordSnapshot(agentName, usage) {
    try {
      const snapshot = extractSnapshotMetrics(agentName, usage);
      if (snapshot) this.historyStore.addSnapshot(agentName, snapshot);
    } catch (err) {
      console.error(`[${agentName}] Error recording snapshot:`, err.message);
    }
  }

  async refreshAgent(name) {
    if (this.stopping) {
      return;
    }

    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent not found: ${name}`);
    }
    await this._refreshAgentWithCooldown(name);

    // Record snapshot and attach pace evaluation for single agent refresh
    if (agent.usage) {
      this._recordSnapshot(name, agent.usage);
      attachPaceEvaluation(name, agent.usage);
    }
  }

  _getRefreshCooldownRemainingMs(name, now = Date.now()) {
    if (this.refreshCooldown <= 0) {
      return 0;
    }

    const lastStartedAt = this._agentRefreshStartedAt.get(name);
    if (!lastStartedAt) {
      return 0;
    }

    return Math.max(0, (this.refreshCooldown * 1000) - (now - lastStartedAt));
  }

  async _refreshAgentWithCooldown(name) {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent not found: ${name}`);
    }

    const activeRefresh = this._agentRefreshPromises.get(name);
    if (activeRefresh) {
      logger.agent(name, 'Refresh already in progress, reusing existing refresh');
      return activeRefresh;
    }

    const remainingMs = this._getRefreshCooldownRemainingMs(name);
    if (remainingMs > 0) {
      logger.agent(name, `Refresh cooldown active, skipping (${Math.ceil(remainingMs / 1000)}s remaining)`);
      return;
    }

    this._agentRefreshStartedAt.set(name, Date.now());
    const refreshPromise = agent.refresh().finally(() => {
      if (this._agentRefreshPromises.get(name) === refreshPromise) {
        this._agentRefreshPromises.delete(name);
      }
    });
    this._agentRefreshPromises.set(name, refreshPromise);
    return refreshPromise;
  }

  /** Get usage history statistics. @returns {Object} */
  getHistoryStats() { return this.historyStore.getStats(); }

  /** Get usage history for an agent. @param {string} [agentName] @returns {Array} */
  getHistory(agentName = null) { return this.historyStore.getHistory(agentName); }

  getStatus() {
    const status = {};
    for (const [name, agent] of this.agents) {
      status[name] = { ...agent.getStatus(), publicStatus: this.publicStatus[name] || null };
    }
    return status;
  }

  getAgentStatus(name) {
    const agent = this.agents.get(name);
    return agent ? agent.getStatus() : null;
  }

  authenticate(req, url) {
    const hasBasicAuth = this.auth.user && this.auth.pass;
    const hasTokenAuth = !!this.auth.token;

    // No auth configured — allow all
    if (!hasBasicAuth && !hasTokenAuth) return true;

    const authHeader = req.headers['authorization'] || '';

    // Check Bearer token
    if (hasTokenAuth && authHeader.startsWith('Bearer ')) {
      if (authHeader.slice(7) === this.auth.token) return true;
    }

    // Check query param token
    if (hasTokenAuth && url.searchParams.get('token') === this.auth.token) {
      return true;
    }

    // Check Basic auth
    if (hasBasicAuth && authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const [user, pass] = decoded.split(':');
      if (user === this.auth.user && pass === this.auth.pass) return true;
    }

    return false;
  }

  startServer() {
    const hosts = this._resolveListenHosts();

    return Promise.all(hosts.map(async (host, index) => {
      const server = createServer(this);
      try {
        await new Promise((resolve, reject) => {
          const onError = (err) => {
            server.off('listening', onListening);
            reject(err);
          };
          const onListening = () => {
            server.off('error', onError);
            resolve();
          };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(this.port, host);
        });
        this.servers.push(server);
        this.listenHosts.push(host);
      } catch (err) {
        try {
          server.close();
        } catch (_closeErr) {
          // Ignore cleanup errors for failed listeners
        }

        if (index === 0) {
          throw err;
        }

        logger.warn(`Could not bind optional host ${host}:${this.port} (${err.message})`);
      }
    })).then(() => {
      this.server = this.servers[0] || null;
      if (this.listenHosts.length > 0) {
        this.host = this.listenHosts[0];
      }
      displayServerBanner(this);
    });
  }

  _resolveListenHosts(detectHost = detectDockerHosts) {
    if (this.explicitHost) {
      return [this.host];
    }

    const hosts = ['127.0.0.1'];
    if (this.dockerAccess) {
      const dockerHosts = detectHost();
      if (dockerHosts) {
        // Handle both single IP (legacy) and array of IPs
        const hostList = Array.isArray(dockerHosts) ? dockerHosts : [dockerHosts];
        for (const h of hostList) {
          if (h && h !== '127.0.0.1' && !hosts.includes(h)) {
            hosts.push(h);
          }
        }
      }
    }

    return hosts;
  }

  stop() {
    this.stopping = true;
    console.log('[Shutdown] Stopping Agent Tank...');
    this.stopAutoRefresh();
    this.stopKeepalive();
    for (const [name, agent] of this.agents) {
      console.log(`[Shutdown] ${name}: ${describeAgentShutdown(agent)}`);
      if (typeof agent.requestStop === 'function') {
        agent.requestStop();
      }
      agent.killProcess();
    }
    if (this.servers.length > 0) {
      console.log('[Shutdown] Closing HTTP server');
      for (const server of this.servers) {
        server.close();
      }
    }
    this.server = null;
    this.servers = [];
    this.listenHosts = [];
  }

  /** Get keepalive status. @returns {Object|null} Keepalive manager status or null if not initialized */
  getKeepaliveStatus() {
    if (this.keepaliveManager) return this.keepaliveManager.getStatus();
    return { enabled: this.keepalive.enabled, interval: this.keepalive.interval, isRunning: false, registeredAgents: [], lastKeepaliveAt: null };
  }

  /** Get activity monitor status. @returns {Object} */
  getActivityMonitorStatus() {
    if (this.autoRefreshManager) return this.autoRefreshManager.getActivityMonitorStatus();
    return { isMonitoring: false, debounceInterval: this.autoRefresh.activityDebounce, monitoredAgents: [], agentCount: 0, activityCount: 0, lastActivityAt: {}, hasPendingActivity: false, pendingAgents: [], isActivityRefreshing: false };
  }

  /** Get the auto-refresh configuration. @returns {Object} */
  getAutoRefreshConfig() {
    return {
      mode: this.autoRefresh.mode,
      enabled: this.autoRefresh.enabled,
      interval: this.autoRefresh.interval,
      activityDebounce: this.autoRefresh.activityDebounce,
      refreshCooldown: this.refreshCooldown,
      lastRefreshedAt: this.autoRefreshManager ? this.autoRefreshManager.getLastRefreshedAt() : null
    };
  }
}

module.exports = { AgentTank, AUTO_REFRESH_MODES, detectDockerHosts, detectDockerHostsFromInterfaces };
