const http = require('node:http');
const { ClaudeAgent } = require('./agents/claude.js');
const { GeminiAgent } = require('./agents/gemini.js');
const { CodexAgent } = require('./agents/codex.js');
const { discoverAgents } = require('./discovery.js');
const { statusPage } = require('./status-page.js');

class LLMWatcher {
  constructor(options = {}) {
    this.port = options.port || 3456;
    this.host = options.host || '127.0.0.1';
    this.autoDiscover = options.autoDiscover !== false;
    this.requestedAgents = options.agents || null;
    this.auth = options.auth || {};
    this.agents = new Map();
    this.server = null;
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
          return;
        }
        console.log(`Found agents: ${agentNames.join(', ')}`);
      } else {
        console.log('No agents specified and auto-discover disabled.');
        return;
      }
    }

    // Create agent instances
    for (const name of agentNames) {
      const agent = this.createAgent(name);
      if (agent) {
        this.agents.set(name, agent);
        console.log(`Created agent: ${name}`);
      }
    }

    // Initial fetch
    console.log('Fetching initial usage data...');
    await this.refreshAll();

    // Start HTTP server
    this.startServer();
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
    const promises = Array.from(this.agents.values()).map(agent =>
      agent.refresh().catch(err => {
        console.error(`Error refreshing ${agent.name}:`, err.message);
      })
    );
    await Promise.all(promises);
    console.log('All agents refresh complete\n');
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
      status[name] = agent.getStatus();
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
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = { LLMWatcher };
