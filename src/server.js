/**
 * HTTP Server module for Agent Tank
 * Handles routing and request processing
 */

const http = require('node:http');
const logger = require('./logger.js');
const { statusPage } = require('./status-page.js');
const { toChartSeries } = require('./history-series.js');

function sendJson(res, body) {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify(body, null, 2));
}

/**
 * Build the GET /history/:id body. Supports `since`, `until` (ISO 8601 or
 * epoch ms) and `metric` (a metric key) query parameters. `view=chart`
 * reduces the series to plottable `{ t, percent }` points (see toChartSeries).
 */
function historyResponse(tank, id, params = new URLSearchParams()) {
  const options = {};
  for (const [param, option] of [['since', 'since'], ['until', 'until'], ['metric', 'key']]) {
    const raw = params.get(param);
    if (raw) options[option] = /^\d+$/.test(raw) ? Number(raw) : raw;
  }
  const config = tank.getHistoryConfig();
  const series = tank.getHistory(id, options) || [];
  return {
    agent: id,
    store: config.store,
    retention_days: config.retentionDays,
    series: params.get('view') === 'chart' ? toChartSeries(series) : series,
  };
}

/** Render the dashboard HTML. */
function statusPageResponse(tank) {
  return statusPage(tank.getStatus(), { historyChart: tank.getHistoryConfig().chart });
}

/** Build the GET /config body. */
function configResponse(tank) {
  return {
    autoRefresh: {
      enabled: tank.autoRefresh.enabled && tank.autoRefresh.interval > 0,
      interval: tank.autoRefresh.interval, // in seconds
      refreshCooldown: tank.refreshCooldown,
    },
    history: tank.getHistoryConfig(),
    lastRefreshedAt: tank.lastRefreshedAt,
  };
}

/**
 * Serve GET /history (stats) and GET /history/:id (series).
 * @returns {boolean} Whether the request was a history route
 */
function handleHistoryRoute(res, tank, url) {
  if (url.pathname === '/history') {
    sendJson(res, tank.getHistoryStats());
    return true;
  }
  if (url.pathname.startsWith('/history/')) {
    const id = decodeURIComponent(url.pathname.slice(9));
    sendJson(res, historyResponse(tank, id, url.searchParams));
    return true;
  }
  return false;
}

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
        res.end(statusPageResponse(tank));
        return;
      }

      if (req.method === 'GET' && path === '/status') {
        const status = tank.getNormalizedStatus();
        logger.server(`GET /status - returning status for ${status.providers.length} agents`);
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify(status, null, 2));
        return;
      }

      if (req.method === 'GET' && path === '/config') {
        sendJson(res, configResponse(tank));
        return;
      }

      if (req.method === 'GET' && handleHistoryRoute(res, tank, url)) {
        return;
      }

      if (req.method === 'GET' && path.startsWith('/status/')) {
        const agentName = path.slice(8);
        const status = tank.getNormalizedAgentStatus(agentName);
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
        res.end(JSON.stringify({ success: true, ...tank.getNormalizedStatus() }));
        return;
      }

      if (req.method === 'POST' && path.startsWith('/refresh/')) {
        const agentName = path.slice(9);
        try {
          await tank.refreshAgent(agentName);
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, provider: tank.getNormalizedAgentStatus(agentName) }));
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
  const listenHosts = tank.listenHosts && tank.listenHosts.length > 0 ? tank.listenHosts : [tank.host];
  logger.server(`Listening on: ${listenHosts.map(host => `${host}:${tank.port}`).join(', ')}`);
  for (const host of listenHosts) {
    logger.server(`📄 Status page: http://${host}:${tank.port}`);
    logger.server(`📡 JSON API:    http://${host}:${tank.port}/status`);
  }
  console.log('');
}

module.exports = {
  createRequestHandler,
  historyResponse,
  configResponse,
  statusPageResponse,
  createServer,
  displayServerBanner,
};
