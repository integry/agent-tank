const path = require('node:path');
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
const { handleRequest } = require('./http-handler.js');
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

class AgentTank {
  constructor(options = {}) {
    this.port = options.port || 3456;
    this.host = options.host || '127.0.0.1';
    this.autoDiscover = options.autoDiscover !== false;
    this.requestedAgents = options.agents || null;
    this.freshProcess = options.freshProcess || false;
    this.auth = options.auth || {};
    this.agents = new Map();
    this.server = null;
    this.publicStatus = {}; // Public API status from upstream providers
    this.skipServer = options.skipServer || false; // Skip HTTP server in one-shot mode

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
      this.startServer();
    }

    // Pre-spawn persistent processes in parallel before sending commands
    if (!this.freshProcess) {
      logger.info('🚀 Spawning agent processes...');
      await Promise.all(
        Array.from(this.agents.values()).map(agent =>
          agent.spawnProcess().catch(err =>
            logger.error(`Error spawning ${agent.name}:`, err.message)
          )
        )
      );
    }

    // Initial fetch
    logger.info('📊 Fetching initial usage data...');
    await this.refreshAll();

    // Start backend auto-refresh if enabled (skip in one-shot mode)
    if (!this.skipServer) {
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
    }
  }

  createAgent(name) {
    switch (name) {
      case 'claude':
        return new ClaudeAgent();
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
    logger.info('🔄 Refreshing all agents...');
    const agentNames = Array.from(this.agents.keys());

    // Fetch PTY agent data and public status concurrently
    const [, publicStatusResult] = await Promise.all([
      // Agent PTY refreshes
      Promise.all(
        Array.from(this.agents.values()).map(agent =>
          agent.refresh().catch(err => {
            logger.error(`Error refreshing ${agent.name}:`, err.message);
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
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent not found: ${name}`);
    }
    await agent.refresh();

    // Record snapshot and attach pace evaluation for single agent refresh
    if (agent.usage) {
      this._recordSnapshot(name, agent.usage);
      attachPaceEvaluation(name, agent.usage);
    }
  }

  /**
   * Get usage history statistics.
   *
   * @returns {Object} History statistics
   */
  getHistoryStats() {
    return this.historyStore.getStats();
  }

  /**
   * Get usage history for an agent.
   *
   * @param {string} [agentName] - Optional agent name to filter
   * @returns {Array} History records
   */
  getHistory(agentName = null) {
    return this.historyStore.getHistory(agentName);
  }

  getStatus() {
    const status = {};
    for (const [name, agent] of this.agents) {
      status[name] = {
        ...agent.getStatus(),
        publicStatus: this.publicStatus[name] || null,
      };
    }
    return status;
  }

  getAgentStatus(name) {
    const agent = this.agents.get(name);
    if (!agent) {
      return null;
    }
    return agent.getStatus();
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
    this.server = createServer(this);
    this.server.listen(this.port, this.host, () => {
      displayServerBanner(this);
    });
  }

  stop() {
    this.stopAutoRefresh();
    this.stopKeepalive();
    for (const agent of this.agents.values()) {
      agent.killProcess();
    }
    if (this.server) {
      this.server.close();
    }
  }

  /** Get keepalive status. @returns {Object|null} Keepalive manager status or null if not initialized */
  getKeepaliveStatus() {
    if (this.keepaliveManager) return this.keepaliveManager.getStatus();
    return { enabled: this.keepalive.enabled, interval: this.keepalive.interval, isRunning: false, registeredAgents: [], lastKeepaliveAt: null };
  }

  /**
   * Get activity monitor status.
   * @returns {Object} Activity monitor status
   */
  getActivityMonitorStatus() {
    if (this.autoRefreshManager) {
      return this.autoRefreshManager.getActivityMonitorStatus();
    }
    return {
      isMonitoring: false,
      debounceInterval: this.autoRefresh.activityDebounce,
      monitoredAgents: [],
      agentCount: 0,
      activityCount: 0,
      lastActivityAt: {},
      hasPendingActivity: false,
      pendingAgents: [],
      isActivityRefreshing: false,
    };
  }

  /**
   * Get the auto-refresh configuration.
   * @returns {Object} Auto-refresh configuration
   */
  getAutoRefreshConfig() {
    return {
      mode: this.autoRefresh.mode,
      enabled: this.autoRefresh.enabled,
      interval: this.autoRefresh.interval,
      activityDebounce: this.autoRefresh.activityDebounce,
      lastRefreshedAt: this.autoRefreshManager ? this.autoRefreshManager.getLastRefreshedAt() : null,
    };
  }
}

module.exports = { AgentTank, AUTO_REFRESH_MODES };
