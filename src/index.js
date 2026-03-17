const http = require('node:http');
const { ClaudeAgent } = require('./agents/claude.js');
const { GeminiAgent } = require('./agents/gemini.js');
const { CodexAgent } = require('./agents/codex.js');
const { discoverAgents } = require('./discovery.js');
const { fetchPublicStatus } = require('./public-status.js');
const { HistoryStore, DEFAULT_RETENTION_DAYS } = require('./history-store.js');
const { extractSnapshotMetrics } = require('./snapshot-metrics.js');
const { attachPaceEvaluation } = require('./pace-attachment.js');
const { handleRequest } = require('./http-handler.js');
const { KeepaliveManager } = require('./keepalive-manager.js');
const { AutoRefreshManager } = require('./auto-refresh-manager.js');

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

  async start() {
    // Initialize agents
    let agentNames = this.requestedAgents;

    if (!agentNames || agentNames.length === 0) {
      if (this.autoDiscover) {
        console.log('Auto-discovering available LLM agents...');
        agentNames = await discoverAgents();
        if (agentNames.length === 0) {
          console.log('No compatible LLM agents found.');
          console.log('Requirements:');
          console.log('  - Claude Code 2.0+ (for /usage command support)');
          console.log('  - Gemini CLI 0.24.5+ (for /stats command support)');
          console.log('  - Codex CLI');
          console.log('\nInstall/update with:');
          console.log('  npm install -g @anthropic-ai/claude-code@latest');
          console.log('  npm install -g gemini@latest');
          throw new Error('No agents found');
        }
        console.log(`Found agents: ${agentNames.join(', ')}`);
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
        console.log(`Created agent: ${name}${this.freshProcess ? ' (fresh process mode)' : ''}`);
      }
    }

    // Start HTTP server immediately so it's available during agent loading (unless skipped)
    if (!this.skipServer) {
      this.startServer();
    }

    // Pre-spawn persistent processes in parallel before sending commands
    if (!this.freshProcess) {
      console.log('Spawning agent processes...');
      await Promise.all(
        Array.from(this.agents.values()).map(agent =>
          agent.spawnProcess().catch(err =>
            console.error(`Error spawning ${agent.name}:`, err.message)
          )
        )
      );
    }

    // Initial fetch
    console.log('Fetching initial usage data...');
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
        console.warn(`Unknown agent: ${name}`);
        return null;
    }
  }

  async refreshAll() {
    console.log('\nRefreshing all agents...');
    const agentNames = Array.from(this.agents.keys());

    // Fetch PTY agent data and public status concurrently
    const [, publicStatusResult] = await Promise.all([
      // Agent PTY refreshes
      Promise.all(
        Array.from(this.agents.values()).map(agent =>
          agent.refresh().catch(err => {
            console.error(`Error refreshing ${agent.name}:`, err.message);
          })
        )
      ),
      // Public API status polling
      fetchPublicStatus(agentNames).catch(err => {
        console.error('Error fetching public status:', err.message);
        return {};
      }),
    ]);

    this.publicStatus = publicStatusResult;

    // Record usage snapshots and attach pace evaluations
    for (const [name, agent] of this.agents) {
      if (agent.usage) {
        this._recordSnapshot(name, agent.usage);
        attachPaceEvaluation(name, agent.usage);
      }
    }

    console.log('All agents refresh complete\n');
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
    this.server = http.createServer(async (req, res) => {
      try {
        await handleRequest(req, res, this);
      } catch (err) {
        console.error('Server error:', err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });

    this.server.listen(this.port, this.host, () => {
      if (this.auth.user && this.auth.pass) {
        console.log(`Authentication: basic auth (user: ${this.auth.user})`);
      }
      if (this.auth.token) {
        console.log('Authentication: API key');
      }
      console.log(`Listening on: ${this.host}:${this.port}`);
      console.log(`  Status page: http://${this.host}:${this.port}/`);
      console.log(`  JSON API:    http://${this.host}:${this.port}/status`);
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
