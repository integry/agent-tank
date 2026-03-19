const path = require('node:path');
const { ClaudeAgent } = require('./agents/claude.js');
const { GeminiAgent } = require('./agents/gemini.js');
const { CodexAgent } = require('./agents/codex.js');
const { discoverAgents } = require('./discovery.js');
const { fetchPublicStatus } = require('./public-status.js');
const { createServer, displayServerBanner } = require('./server.js');
const logger = require('./logger.js');

// Load package.json for version info
const pkg = require(path.join(__dirname, '..', 'package.json'));

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
    // The logo resembles a container with rounded cap and three level indicator bars
    console.log(`${ANSI.brightCyan}   ╭─────╮${ANSI.reset}`);
    console.log(`${ANSI.brightCyan}  ╭┴─────┴╮${ANSI.reset}    ${ANSI.brightWhite}AGENT ${ANSI.brightCyan}${ANSI.bold}TANK${ANSI.reset}`);
    console.log(`${ANSI.brightCyan}  │ ${ANSI.reset}${ANSI.brightCyan}━━━━━${ANSI.reset} ${ANSI.brightCyan}│${ANSI.reset}`);
    console.log(`${ANSI.brightCyan}  │ ${ANSI.reset}${ANSI.brightCyan}━━━━━${ANSI.reset} ${ANSI.brightCyan}│${ANSI.reset}    ${ANSI.dim}Monitor your AI agent usage${ANSI.reset}`);
    console.log(`${ANSI.brightCyan}  │ ${ANSI.reset}${ANSI.brightCyan}━━━━━${ANSI.reset} ${ANSI.brightCyan}│${ANSI.reset}`);
    console.log(`${ANSI.brightCyan}  ╰───────╯${ANSI.reset}`);
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
    }
  }

  startAutoRefresh() {
    // Stop any existing timers
    this.stopAutoRefresh();

    // Check if auto-refresh should be enabled
    if (!this.autoRefresh.enabled || this.autoRefresh.interval <= 0) {
      logger.info('⏸️  Backend auto-refresh: disabled');
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
        logger.info(`🔄 Backend auto-refresh [${name}]: every ${effective}s`);
        const timer = setInterval(async () => {
          logger.agent(name, '🔄 Auto-refreshing...');
          await agent.refresh().catch(err =>
            logger.error(`Error refreshing ${name}:`, err.message)
          );
          this.lastRefreshedAt = new Date().toISOString();
        }, intervalMs);
        this.agentRefreshTimers.set(name, timer);
      } else {
        globalAgents.push(name);
      }
    }

    if (globalAgents.length > 0) {
      logger.info(`🔄 Backend auto-refresh [${globalAgents.join(', ')}]: every ${globalInterval}s`);
      this.autoRefreshTimer = setInterval(async () => {
        logger.info(`🔄 Auto-refreshing ${globalAgents.join(', ')}...`);
        const promises = globalAgents.map(name => {
          const agent = this.agents.get(name);
          return agent ? agent.refresh().catch(err =>
            logger.error(`Error refreshing ${name}:`, err.message)
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
    logger.success('✅ All agents refresh complete');
  }

  async refreshAgent(name) {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent not found: ${name}`);
    }
    await agent.refresh();
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
    for (const agent of this.agents.values()) {
      agent.killProcess();
    }
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = { AgentTank };
