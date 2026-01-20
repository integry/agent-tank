const http = require('node:http');
const { ClaudeAgent } = require('./agents/claude.js');
const { GeminiAgent } = require('./agents/gemini.js');
const { CodexAgent } = require('./agents/codex.js');
const { discoverAgents } = require('./discovery.js');
const { statusPage } = require('./status-page.js');

class LLMWatcher {
  constructor(options = {}) {
    this.port = options.port || 3456;
    this.autoDiscover = options.autoDiscover !== false;
    this.requestedAgents = options.agents || null;
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
          console.log('No LLM agents found. Install claude, gemini, or codex CLI tools.');
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
    const promises = Array.from(this.agents.values()).map(agent =>
      agent.refresh().catch(err => {
        console.error(`Error refreshing ${agent.name}:`, err.message);
      })
    );
    await Promise.all(promises);
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

      try {
        // Routes
        if (req.method === 'GET' && path === '/') {
          res.setHeader('Content-Type', 'text/html');
          res.writeHead(200);
          res.end(statusPage(this.getStatus()));
          return;
        }

        if (req.method === 'GET' && path === '/status') {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify(this.getStatus(), null, 2));
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

    this.server.listen(this.port, () => {
      console.log(`LLM Limit Watcher running at http://localhost:${this.port}`);
      console.log(`  Status page: http://localhost:${this.port}/`);
      console.log(`  JSON API:    http://localhost:${this.port}/status`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = { LLMWatcher };
