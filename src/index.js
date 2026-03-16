const http = require('node:http');
const { ClaudeAgent } = require('./agents/claude.js');
const { GeminiAgent } = require('./agents/gemini.js');
const { CodexAgent } = require('./agents/codex.js');
const { discoverAgents } = require('./discovery.js');
const { statusPage } = require('./status-page.js');
const { fetchPublicStatus } = require('./public-status.js');
const { HistoryStore, DEFAULT_RETENTION_DAYS } = require('./history-store.js');
const { evaluatePace } = require('./pace-evaluator.js');
const { CYCLE_DURATIONS } = require('./usage-formatters.js');

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
    this.autoRefresh = {
      enabled: options.autoRefreshEnabled !== false, // Default: true
      interval: options.autoRefreshInterval ?? 60,   // Default: 60 seconds, 0 = disabled
    };
    this.autoRefreshTimer = null;
    this.agentRefreshTimers = new Map(); // Per-agent timers for custom intervals
    this.lastRefreshedAt = null;

    // History store for usage snapshots
    this.historyRetentionDays = options.historyRetentionDays ?? DEFAULT_RETENTION_DAYS;
    this.historyStore = new HistoryStore({
      retentionDays: this.historyRetentionDays
    });
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
    }
  }

  startAutoRefresh() {
    // Stop any existing timers
    this.stopAutoRefresh();

    // Check if auto-refresh should be enabled
    if (!this.autoRefresh.enabled || this.autoRefresh.interval <= 0) {
      console.log('Backend auto-refresh: disabled');
      return;
    }

    const globalInterval = this.autoRefresh.interval;

    // Separate agents into those using the global interval and those needing a slower cadence
    const globalAgents = [];
    for (const [name, agent] of this.agents) {
      // Effective interval: explicit override, or global clamped to agent's minimum
      const effective = agent.refreshInterval
        ?? (agent.minRefreshInterval ? Math.max(globalInterval, agent.minRefreshInterval) : null);
      if (effective && effective > globalInterval) {
        // Agent needs a longer interval — give it its own timer
        const intervalMs = effective * 1000;
        console.log(`Backend auto-refresh [${name}]: every ${effective}s`);
        const timer = setInterval(async () => {
          console.log(`[Auto-refresh] Refreshing ${name}...`);
          await agent.refresh().catch(err =>
            console.error(`Error refreshing ${name}:`, err.message)
          );
          this.lastRefreshedAt = new Date().toISOString();
        }, intervalMs);
        this.agentRefreshTimers.set(name, timer);
      } else {
        globalAgents.push(name);
      }
    }

    if (globalAgents.length > 0) {
      console.log(`Backend auto-refresh [${globalAgents.join(', ')}]: every ${globalInterval}s`);
      this.autoRefreshTimer = setInterval(async () => {
        console.log(`[Auto-refresh] Refreshing ${globalAgents.join(', ')}...`);
        const promises = globalAgents.map(name => {
          const agent = this.agents.get(name);
          return agent ? agent.refresh().catch(err =>
            console.error(`Error refreshing ${name}:`, err.message)
          ) : Promise.resolve();
        });
        await Promise.all(promises);
        this.lastRefreshedAt = new Date().toISOString();
      }, globalInterval * 1000);
    }
  }

  stopAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
    for (const timer of this.agentRefreshTimers.values()) {
      clearInterval(timer);
    }
    this.agentRefreshTimers.clear();
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
    this.lastRefreshedAt = new Date().toISOString();

    // Record usage snapshots and attach pace evaluations
    for (const [name, agent] of this.agents) {
      if (agent.usage) {
        this._recordSnapshot(name, agent.usage);
        this._attachPaceEvaluation(name, agent.usage);
      }
    }

    console.log('All agents refresh complete\n');
  }

  /**
   * Record a usage snapshot to the history store.
   * @private
   */
  _recordSnapshot(agentName, usage) {
    try {
      // Extract key metrics for snapshot storage (keep it lightweight)
      const snapshot = this._extractSnapshotMetrics(agentName, usage);
      if (snapshot) {
        this.historyStore.addSnapshot(agentName, snapshot);
      }
    } catch (err) {
      console.error(`[${agentName}] Error recording snapshot:`, err.message);
    }
  }

  /**
   * Extract key metrics from usage data for snapshot storage.
   * @private
   */
  _extractSnapshotMetrics(agentName, usage) {
    switch (agentName) {
      case 'claude':
        return {
          session: usage.session?.percent ?? null,
          weeklyAll: usage.weeklyAll?.percent ?? null,
          weeklySonnet: usage.weeklySonnet?.percent ?? null,
          weekly: usage.weekly?.percent ?? null,
          extraUsage: usage.extraUsage?.percent ?? null
        };
      case 'gemini':
        if (usage.models && Array.isArray(usage.models)) {
          const models = {};
          for (const model of usage.models) {
            models[model.model] = model.percentUsed ?? null;
          }
          return { models };
        }
        return null;
      case 'codex':
        return {
          fiveHour: usage.fiveHour?.percentUsed ?? null,
          weekly: usage.weekly?.percentUsed ?? null,
          modelLimits: usage.modelLimits?.map(ml => ({
            name: ml.name,
            fiveHour: ml.fiveHour?.percentUsed ?? null,
            weekly: ml.weekly?.percentUsed ?? null
          })) ?? null
        };
      default:
        return usage;
    }
  }

  /**
   * Attach pace evaluation data to usage metrics.
   * @private
   */
  _attachPaceEvaluation(agentName, usage) {
    switch (agentName) {
      case 'claude':
        this._attachClaudePace(usage);
        break;
      case 'gemini':
        this._attachGeminiPace(usage);
        break;
      case 'codex':
        this._attachCodexPace(usage);
        break;
    }
  }

  /**
   * Attach pace evaluation to Claude usage metrics.
   * @private
   */
  _attachClaudePace(usage) {
    const sections = [
      { data: usage.session, cycle: 'session' },
      { data: usage.weeklyAll, cycle: 'weekly' },
      { data: usage.weeklySonnet, cycle: 'weekly' },
      { data: usage.weekly, cycle: 'weekly' },
      { data: usage.extraUsage, cycle: 'weekly' }
    ];

    for (const { data, cycle } of sections) {
      if (data && typeof data.percent === 'number' && typeof data.resetsInSeconds === 'number') {
        const paceEval = evaluatePace({
          usagePercent: data.percent,
          resetsInSeconds: data.resetsInSeconds,
          cycleDurationSeconds: CYCLE_DURATIONS[cycle]
        });
        if (paceEval) {
          data.paceEval = paceEval;
        }
      }
    }
  }

  /**
   * Attach pace evaluation to Gemini usage metrics.
   * @private
   */
  _attachGeminiPace(usage) {
    if (usage.models && Array.isArray(usage.models)) {
      for (const model of usage.models) {
        if (typeof model.percentUsed === 'number' && typeof model.resetsInSeconds === 'number') {
          const paceEval = evaluatePace({
            usagePercent: model.percentUsed,
            resetsInSeconds: model.resetsInSeconds,
            cycleDurationSeconds: CYCLE_DURATIONS.sessionGemini
          });
          if (paceEval) {
            model.paceEval = paceEval;
          }
        }
      }
    }
  }

  /**
   * Attach pace evaluation to Codex usage metrics.
   * @private
   */
  _attachCodexPace(usage) {
    // Main limits
    if (usage.fiveHour && typeof usage.fiveHour.percentUsed === 'number' && typeof usage.fiveHour.resetsInSeconds === 'number') {
      const paceEval = evaluatePace({
        usagePercent: usage.fiveHour.percentUsed,
        resetsInSeconds: usage.fiveHour.resetsInSeconds,
        cycleDurationSeconds: CYCLE_DURATIONS.fiveHour
      });
      if (paceEval) {
        usage.fiveHour.paceEval = paceEval;
      }
    }

    if (usage.weekly && typeof usage.weekly.percentUsed === 'number' && typeof usage.weekly.resetsInSeconds === 'number') {
      const paceEval = evaluatePace({
        usagePercent: usage.weekly.percentUsed,
        resetsInSeconds: usage.weekly.resetsInSeconds,
        cycleDurationSeconds: CYCLE_DURATIONS.weekly
      });
      if (paceEval) {
        usage.weekly.paceEval = paceEval;
      }
    }

    // Per-model limits
    if (usage.modelLimits && Array.isArray(usage.modelLimits)) {
      for (const ml of usage.modelLimits) {
        if (ml.fiveHour && typeof ml.fiveHour.percentUsed === 'number' && typeof ml.fiveHour.resetsInSeconds === 'number') {
          const paceEval = evaluatePace({
            usagePercent: ml.fiveHour.percentUsed,
            resetsInSeconds: ml.fiveHour.resetsInSeconds,
            cycleDurationSeconds: CYCLE_DURATIONS.fiveHour
          });
          if (paceEval) {
            ml.fiveHour.paceEval = paceEval;
          }
        }

        if (ml.weekly && typeof ml.weekly.percentUsed === 'number' && typeof ml.weekly.resetsInSeconds === 'number') {
          const paceEval = evaluatePace({
            usagePercent: ml.weekly.percentUsed,
            resetsInSeconds: ml.weekly.resetsInSeconds,
            cycleDurationSeconds: CYCLE_DURATIONS.weekly
          });
          if (paceEval) {
            ml.weekly.paceEval = paceEval;
          }
        }
      }
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
      this._attachPaceEvaluation(name, agent.usage);
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
      const url = new URL(req.url, `http://localhost:${this.port}`);
      const path = url.pathname;

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (!this.authenticate(req, url)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="LLM Limit Watcher"');
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      try {
        // Routes
        if (req.method === 'GET' && path === '/') {
          res.setHeader('Content-Type', 'text/html');
          res.writeHead(200);
          res.end(statusPage(this.getStatus()));
          return;
        }

        if (req.method === 'GET' && path === '/status') {
          const status = this.getStatus();
          console.log(`[HTTP] GET /status - returning status for ${Object.keys(status).length} agents`);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(status, null, 2));
          return;
        }

        if (req.method === 'GET' && path === '/config') {
          const config = {
            autoRefresh: {
              enabled: this.autoRefresh.enabled && this.autoRefresh.interval > 0,
              interval: this.autoRefresh.interval, // in seconds
            },
            history: {
              retentionDays: this.historyRetentionDays,
            },
            lastRefreshedAt: this.lastRefreshedAt,
          };
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(config, null, 2));
          return;
        }

        if (req.method === 'GET' && path === '/history') {
          const stats = this.getHistoryStats();
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(stats, null, 2));
          return;
        }

        if (req.method === 'GET' && path.startsWith('/history/')) {
          const agentName = path.slice(9);
          const history = this.getHistory(agentName);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(history, null, 2));
          return;
        }

        if (req.method === 'GET' && path.startsWith('/status/')) {
          const agentName = path.slice(8);
          const status = this.getAgentStatus(agentName);
          if (!status) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Agent not found' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(status, null, 2));
          return;
        }

        if (req.method === 'POST' && path === '/refresh') {
          await this.refreshAll();
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, status: this.getStatus() }));
          return;
        }

        if (req.method === 'POST' && path.startsWith('/refresh/')) {
          const agentName = path.slice(9);
          try {
            await this.refreshAgent(agentName);
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, status: this.getAgentStatus(agentName) }));
          } catch (err) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        // 404
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));

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
    for (const agent of this.agents.values()) {
      agent.killProcess();
    }
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = { AgentTank };
