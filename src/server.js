/**
 * HTTP Server module for Agent Tank
 * Handles routing and request processing
 */

const http = require('node:http');
const logger = require('./logger.js');
const { statusPage } = require('./status-page.js');

function createRequestHandler(tank) {
  return async (req, res) => {
    const url = new URL(req.url, `http://localhost:${tank.port}`);
    const path = url.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!tank.authenticate(req, url)) {
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
        res.end(statusPage(tank.getStatus()));
        return;
      }

      if (req.method === 'GET' && path === '/status') {
        const status = tank.getStatus();
        logger.server(`GET /status - returning status for ${Object.keys(status).length} agents`);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(status, null, 2));
        return;
      }

      if (req.method === 'GET' && path === '/config') {
        const config = {
          autoRefresh: {
            enabled: tank.autoRefresh.enabled && tank.autoRefresh.interval > 0,
            interval: tank.autoRefresh.interval, // in seconds
          },
          lastRefreshedAt: tank.lastRefreshedAt,
        };
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(config, null, 2));
        return;
      }

      if (req.method === 'GET' && path.startsWith('/status/')) {
        const agentName = path.slice(8);
        const status = tank.getAgentStatus(agentName);
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
        await tank.refreshAll();
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, status: tank.getStatus() }));
        return;
      }

      if (req.method === 'POST' && path.startsWith('/refresh/')) {
        const agentName = path.slice(9);
        try {
          await tank.refreshAgent(agentName);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, status: tank.getAgentStatus(agentName) }));
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
      logger.error('Server error:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  };
}

/**
 * Create and configure the HTTP server
 * @param {Object} tank - AgentTank instance
 * @returns {http.Server}
 */
function createServer(tank) {
  return http.createServer(createRequestHandler(tank));
}

/**
 * Display server startup banner
 * @param {Object} tank - AgentTank instance
 */
function displayServerBanner(tank) {
  const ANSI = logger.ANSI;
  console.log('');
  console.log(`${ANSI.cyan}${ANSI.bold}╔════════════════════════════════════════════╗${ANSI.reset}`);
  console.log(`${ANSI.cyan}${ANSI.bold}║${ANSI.reset}  ${ANSI.brightCyan}🚀 Agent Tank Server${ANSI.reset}                      ${ANSI.cyan}${ANSI.bold}║${ANSI.reset}`);
  console.log(`${ANSI.cyan}${ANSI.bold}╚════════════════════════════════════════════╝${ANSI.reset}`);
  console.log('');
  if (tank.auth.user && tank.auth.pass) {
    logger.info(`🔐 Authentication: basic auth (user: ${tank.auth.user})`);
  }
  if (tank.auth.token) {
    logger.info('🔑 Authentication: API key');
  }
  logger.server(`Listening on: ${tank.host}:${tank.port}`);
  logger.server(`📄 Status page: http://${tank.host}:${tank.port}/`);
  logger.server(`📡 JSON API:    http://${tank.host}:${tank.port}/status`);
  console.log('');
}

module.exports = { createRequestHandler, createServer, displayServerBanner };
