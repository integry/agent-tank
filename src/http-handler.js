/**
 * HTTP request handler utilities for AgentTank server.
 */

const { statusPage } = require('./status-page.js');

/**
 * Handle GET / - Status HTML page
 */
function handleStatusPage(res, tank) {
  res.setHeader('Content-Type', 'text/html');
  res.writeHead(200);
  res.end(statusPage(tank.getStatus()));
}

/**
 * Handle GET /status - JSON status for all agents
 */
function handleStatusJson(res, tank) {
  const status = tank.getStatus();
  console.log(`[HTTP] GET /status - returning status for ${Object.keys(status).length} agents`);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify(status, null, 2));
}

/**
 * Handle GET /config - Server configuration
 */
function handleConfig(res, tank) {
  const config = {
    autoRefresh: {
      enabled: tank.autoRefresh.enabled && tank.autoRefresh.interval > 0,
      interval: tank.autoRefresh.interval,
    },
    history: {
      retentionDays: tank.historyRetentionDays,
    },
    lastRefreshedAt: tank.lastRefreshedAt,
  };
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify(config, null, 2));
}

/**
 * Handle GET /history - History statistics
 */
function handleHistoryStats(res, tank) {
  const stats = tank.getHistoryStats();
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify(stats, null, 2));
}

/**
 * Handle GET /history/:agent - Agent-specific history
 */
function handleAgentHistory(res, tank, agentName) {
  const history = tank.getHistory(agentName);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify(history, null, 2));
}

/**
 * Handle GET /status/:agent - Agent-specific status
 */
function handleAgentStatus(res, tank, agentName) {
  const status = tank.getAgentStatus(agentName);
  if (!status) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Agent not found' }));
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify(status, null, 2));
}

/**
 * Handle POST /refresh - Refresh all agents
 */
async function handleRefreshAll(res, tank) {
  await tank.refreshAll();
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify({ success: true, status: tank.getStatus() }));
}

/**
 * Handle POST /refresh/:agent - Refresh specific agent
 */
async function handleRefreshAgent(res, tank, agentName) {
  try {
    await tank.refreshAgent(agentName);
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, status: tank.getAgentStatus(agentName) }));
  } catch (err) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * Handle 404 - Not Found
 */
function handleNotFound(res) {
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
}

/**
 * Route and handle HTTP requests.
 * @param {Object} req - HTTP request
 * @param {Object} res - HTTP response
 * @param {Object} tank - AgentTank instance
 */
async function handleRequest(req, res, tank) {
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

  // Route requests
  if (req.method === 'GET') {
    if (path === '/') {
      handleStatusPage(res, tank);
    } else if (path === '/status') {
      handleStatusJson(res, tank);
    } else if (path === '/config') {
      handleConfig(res, tank);
    } else if (path === '/history') {
      handleHistoryStats(res, tank);
    } else if (path.startsWith('/history/')) {
      handleAgentHistory(res, tank, path.slice(9));
    } else if (path.startsWith('/status/')) {
      handleAgentStatus(res, tank, path.slice(8));
    } else {
      handleNotFound(res);
    }
  } else if (req.method === 'POST') {
    if (path === '/refresh') {
      await handleRefreshAll(res, tank);
    } else if (path.startsWith('/refresh/')) {
      await handleRefreshAgent(res, tank, path.slice(9));
    } else {
      handleNotFound(res);
    }
  } else {
    handleNotFound(res);
  }
}

module.exports = {
  handleRequest,
  handleStatusPage,
  handleStatusJson,
  handleConfig,
  handleHistoryStats,
  handleAgentHistory,
  handleAgentStatus,
  handleRefreshAll,
  handleRefreshAgent,
  handleNotFound
};
