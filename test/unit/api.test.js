/**
 * Unit tests for AgentTank HTTP API endpoints
 *
 * Tests HTTP endpoints (/status, /config) and authentication
 * (Bearer token and Basic auth) using supertest.
 */

console.log('\n⚠️  API socket tests skipped: this environment does not allow binding HTTP listeners from Jest\n');

describe.skip('AgentTank HTTP API', () => {
// Mock node-pty to avoid native module issues in unit tests
jest.mock('node-pty', () => ({
  spawn: jest.fn()
}));

const request = require('supertest');
const { AgentTank } = require('../../src/index.js');
const { createRequestHandler } = require('../../src/server.js');
  let tank;
  let server;

  afterEach(async () => {
    if (tank) {
      tank.stop();
      tank = null;
      server = null;
    }
  });

  /**
   * Helper to create an AgentTank instance with a running server
   * Returns the underlying http.Server for supertest
   */
  function createTankWithServer(options = {}) {
    tank = new AgentTank({
      autoDiscover: false,
      autoRefreshEnabled: false,
      ...options
    });

    // Manually add mock agents for testing
    if (options.withAgents !== false) {
      const claudeAgent = tank.createAgent('claude');
      const geminiAgent = tank.createAgent('gemini');
      tank.agents.set('claude', claudeAgent);
      tank.agents.set('gemini', geminiAgent);
    }

    // Use the bare request handler so supertest doesn't need to bind a real socket.
    server = createRequestHandler(tank);

    return server;
  }

  describe('GET /status', () => {
    it('returns 200 OK with JSON payload', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/status')
        .expect('Content-Type', /application\/json/)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(typeof response.body).toBe('object');
    });

    it('returns status for all configured agents', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/status')
        .expect(200);

      expect(response.body).toHaveProperty('claude');
      expect(response.body).toHaveProperty('gemini');
      expect(Object.keys(response.body)).toHaveLength(2);
    });

    it('returns correct schema for each agent', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/status')
        .expect(200);

      const claudeStatus = response.body.claude;
      expect(claudeStatus).toHaveProperty('name', 'claude');
      expect(claudeStatus).toHaveProperty('usage');
      expect(claudeStatus).toHaveProperty('metadata');
      expect(claudeStatus).toHaveProperty('lastUpdated');
      expect(claudeStatus).toHaveProperty('error');
      expect(claudeStatus).toHaveProperty('isRefreshing');
    });

    it('returns empty object when no agents are configured', async () => {
      const srv = createTankWithServer({ withAgents: false });

      const response = await request(srv)
        .get('/status')
        .expect(200);

      expect(response.body).toEqual({});
    });

    it('reflects agent state changes in response', async () => {
      const srv = createTankWithServer();

      // Modify agent state
      const claudeAgent = tank.agents.get('claude');
      claudeAgent.usage = { session: { percent: 75 } };
      claudeAgent.lastUpdated = '2024-01-15T10:30:00.000Z';

      const response = await request(srv)
        .get('/status')
        .expect(200);

      expect(response.body.claude.usage).toEqual({ session: { percent: 75 } });
      expect(response.body.claude.lastUpdated).toBe('2024-01-15T10:30:00.000Z');
    });
  });

  describe('GET /status/:agent', () => {
    it('returns 200 OK with JSON payload for existing agent', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/status/claude')
        .expect('Content-Type', /application\/json/)
        .expect(200);

      expect(response.body).toHaveProperty('name', 'claude');
    });

    it('returns 404 for non-existent agent', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/status/nonexistent')
        .expect(404);

      const body = JSON.parse(response.text);
      expect(body).toHaveProperty('error', 'Agent not found');
    });

    it('returns correct schema for specific agent', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/status/gemini')
        .expect(200);

      expect(response.body).toEqual({
        name: 'gemini',
        usage: null,
        metadata: null,
        lastUpdated: null,
        error: null,
        isRefreshing: false
      });
    });
  });

  describe('GET /config', () => {
    it('returns 200 OK with JSON payload', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/config')
        .expect('Content-Type', /application\/json/)
        .expect(200);

      expect(response.body).toBeDefined();
      expect(typeof response.body).toBe('object');
    });

    it('returns autoRefresh configuration', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/config')
        .expect(200);

      expect(response.body).toHaveProperty('autoRefresh');
      expect(response.body.autoRefresh).toHaveProperty('enabled');
      expect(response.body.autoRefresh).toHaveProperty('interval');
    });

    it('returns lastRefreshedAt field', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/config')
        .expect(200);

      expect(response.body).toHaveProperty('lastRefreshedAt');
    });

    it('reflects auto-refresh disabled state', async () => {
      const srv = createTankWithServer({
        autoRefreshEnabled: false,
        autoRefreshInterval: 0
      });

      const response = await request(srv)
        .get('/config')
        .expect(200);

      expect(response.body.autoRefresh.enabled).toBe(false);
    });

    it('reflects custom auto-refresh interval', async () => {
      const srv = createTankWithServer({
        autoRefreshEnabled: true,
        autoRefreshInterval: 120
      });

      const response = await request(srv)
        .get('/config')
        .expect(200);

      expect(response.body.autoRefresh.interval).toBe(120);
    });

    it('returns correct lastRefreshedAt after refresh', async () => {
      const srv = createTankWithServer();

      // Set lastRefreshedAt manually
      tank.lastRefreshedAt = '2024-01-15T12:00:00.000Z';

      const response = await request(srv)
        .get('/config')
        .expect(200);

      expect(response.body.lastRefreshedAt).toBe('2024-01-15T12:00:00.000Z');
    });
  });

  describe('Bearer Token Authentication', () => {
    const validToken = 'test-api-key-12345';

    it('returns 401 Unauthorized when token is missing', async () => {
      const srv = createTankWithServer({
        auth: { token: validToken }
      });

      const response = await request(srv)
        .get('/status')
        .expect(401);

      const body = JSON.parse(response.text);
      expect(body).toHaveProperty('error', 'Unauthorized');
    });

    it('returns 401 Unauthorized when token is invalid', async () => {
      const srv = createTankWithServer({
        auth: { token: validToken }
      });

      const response = await request(srv)
        .get('/status')
        .set('Authorization', 'Bearer wrong-token')
        .expect(401);

      const body = JSON.parse(response.text);
      expect(body).toHaveProperty('error', 'Unauthorized');
    });

    it('returns 200 OK with valid Bearer token in header', async () => {
      const srv = createTankWithServer({
        auth: { token: validToken }
      });

      const response = await request(srv)
        .get('/status')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('claude');
    });

    it('returns 200 OK with valid token in query parameter', async () => {
      const srv = createTankWithServer({
        auth: { token: validToken }
      });

      const response = await request(srv)
        .get(`/status?token=${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('claude');
    });

    it('sets WWW-Authenticate header on 401 response', async () => {
      const srv = createTankWithServer({
        auth: { token: validToken }
      });

      const response = await request(srv)
        .get('/status')
        .expect(401);

      expect(response.headers['www-authenticate']).toBe('Basic realm="LLM Limit Watcher"');
    });

    it('protects /config endpoint with Bearer token', async () => {
      const srv = createTankWithServer({
        auth: { token: validToken }
      });

      // Without token
      await request(srv)
        .get('/config')
        .expect(401);

      // With valid token
      await request(srv)
        .get('/config')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);
    });

    it('protects /status/:agent endpoint with Bearer token', async () => {
      const srv = createTankWithServer({
        auth: { token: validToken }
      });

      // Without token
      await request(srv)
        .get('/status/claude')
        .expect(401);

      // With valid token
      await request(srv)
        .get('/status/claude')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);
    });
  });

  describe('Basic Authentication', () => {
    const username = 'admin';
    const password = 'secret123';

    function basicAuthHeader(user, pass) {
      return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    }

    it('returns 401 Unauthorized when credentials are missing', async () => {
      const srv = createTankWithServer({
        auth: { user: username, pass: password }
      });

      const response = await request(srv)
        .get('/status')
        .expect(401);

      const body = JSON.parse(response.text);
      expect(body).toHaveProperty('error', 'Unauthorized');
    });

    it('returns 401 Unauthorized when username is wrong', async () => {
      const srv = createTankWithServer({
        auth: { user: username, pass: password }
      });

      const response = await request(srv)
        .get('/status')
        .set('Authorization', basicAuthHeader('wronguser', password))
        .expect(401);

      const body = JSON.parse(response.text);
      expect(body).toHaveProperty('error', 'Unauthorized');
    });

    it('returns 401 Unauthorized when password is wrong', async () => {
      const srv = createTankWithServer({
        auth: { user: username, pass: password }
      });

      const response = await request(srv)
        .get('/status')
        .set('Authorization', basicAuthHeader(username, 'wrongpass'))
        .expect(401);

      const body = JSON.parse(response.text);
      expect(body).toHaveProperty('error', 'Unauthorized');
    });

    it('returns 200 OK with valid Basic auth credentials', async () => {
      const srv = createTankWithServer({
        auth: { user: username, pass: password }
      });

      const response = await request(srv)
        .get('/status')
        .set('Authorization', basicAuthHeader(username, password))
        .expect(200);

      expect(response.body).toHaveProperty('claude');
    });

    it('sets WWW-Authenticate header on 401 response', async () => {
      const srv = createTankWithServer({
        auth: { user: username, pass: password }
      });

      const response = await request(srv)
        .get('/status')
        .expect(401);

      expect(response.headers['www-authenticate']).toBe('Basic realm="LLM Limit Watcher"');
    });

    it('protects /config endpoint with Basic auth', async () => {
      const srv = createTankWithServer({
        auth: { user: username, pass: password }
      });

      // Without credentials
      await request(srv)
        .get('/config')
        .expect(401);

      // With valid credentials
      await request(srv)
        .get('/config')
        .set('Authorization', basicAuthHeader(username, password))
        .expect(200);
    });

    it('protects /status/:agent endpoint with Basic auth', async () => {
      const srv = createTankWithServer({
        auth: { user: username, pass: password }
      });

      // Without credentials
      await request(srv)
        .get('/status/claude')
        .expect(401);

      // With valid credentials
      await request(srv)
        .get('/status/claude')
        .set('Authorization', basicAuthHeader(username, password))
        .expect(200);
    });
  });

  describe('Combined Authentication (Bearer + Basic)', () => {
    const token = 'api-key-xyz';
    const username = 'testuser';
    const password = 'testpass';

    function basicAuthHeader(user, pass) {
      return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    }

    it('accepts Bearer token when both auth methods are configured', async () => {
      const srv = createTankWithServer({
        auth: { token, user: username, pass: password }
      });

      const response = await request(srv)
        .get('/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveProperty('claude');
    });

    it('accepts Basic auth when both auth methods are configured', async () => {
      const srv = createTankWithServer({
        auth: { token, user: username, pass: password }
      });

      const response = await request(srv)
        .get('/status')
        .set('Authorization', basicAuthHeader(username, password))
        .expect(200);

      expect(response.body).toHaveProperty('claude');
    });

    it('returns 401 when neither auth method is satisfied', async () => {
      const srv = createTankWithServer({
        auth: { token, user: username, pass: password }
      });

      await request(srv)
        .get('/status')
        .expect(401);
    });
  });

  describe('No Authentication', () => {
    it('allows requests without auth when no auth is configured', async () => {
      const srv = createTankWithServer({
        auth: {} // No auth configured
      });

      const response = await request(srv)
        .get('/status')
        .expect(200);

      expect(response.body).toHaveProperty('claude');
    });

    it('allows access to /config without auth when no auth is configured', async () => {
      const srv = createTankWithServer({
        auth: {}
      });

      await request(srv)
        .get('/config')
        .expect(200);
    });
  });

  describe('CORS Headers', () => {
    it('sets Access-Control-Allow-Origin to *', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/status')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    it('sets Access-Control-Allow-Methods header', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/status')
        .expect(200);

      expect(response.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
    });

    it('responds to OPTIONS preflight request with 204', async () => {
      const srv = createTankWithServer();

      await request(srv)
        .options('/status')
        .expect(204);
    });
  });

  describe('Error Handling', () => {
    it('returns 404 for unknown endpoints', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/unknown-endpoint')
        .expect(404);

      const body = JSON.parse(response.text);
      expect(body).toHaveProperty('error', 'Not found');
    });

    it('returns 404 for unknown agent status', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .get('/status/unknown-agent')
        .expect(404);

      const body = JSON.parse(response.text);
      expect(body).toHaveProperty('error', 'Agent not found');
    });
  });

  describe('POST /refresh', () => {
    it('requires authentication when configured', async () => {
      const srv = createTankWithServer({
        auth: { token: 'secret' }
      });

      // Mock the refresh method on agents to avoid PTY spawning
      for (const agent of tank.agents.values()) {
        agent.refresh = jest.fn().mockResolvedValue();
      }

      await request(srv)
        .post('/refresh')
        .expect(401);

      await request(srv)
        .post('/refresh')
        .set('Authorization', 'Bearer secret')
        .expect(200);
    });
  });

  describe('POST /refresh/:agent', () => {
    it('requires authentication when configured', async () => {
      const srv = createTankWithServer({
        auth: { token: 'secret' }
      });

      await request(srv)
        .post('/refresh/claude')
        .expect(401);
    });

    it('returns 404 for non-existent agent', async () => {
      const srv = createTankWithServer();

      const response = await request(srv)
        .post('/refresh/nonexistent')
        .expect(404);

      const body = JSON.parse(response.text);
      expect(body).toHaveProperty('error');
    });
  });
});
