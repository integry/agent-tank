/**
 * Unit tests for AgentTank (programmatic usage)
 *
 * Tests AgentTank initialization with various configuration options
 * and verifies property assignment without starting the HTTP server.
 */

// Mock node-pty to avoid native module issues in unit tests
jest.mock('node-pty', () => ({
  spawn: jest.fn()
}));

const { AgentTank } = require('../../src/index.js');

describe('AgentTank', () => {
  describe('constructor', () => {
    describe('with default options', () => {
      let tank;

      beforeEach(() => {
        tank = new AgentTank();
      });

      it('sets default port to 3456', () => {
        expect(tank.port).toBe(3456);
      });

      it('sets default host to 127.0.0.1', () => {
        expect(tank.host).toBe('127.0.0.1');
      });

      it('enables auto-discover by default', () => {
        expect(tank.autoDiscover).toBe(true);
      });

      it('sets requestedAgents to null by default', () => {
        expect(tank.requestedAgents).toBeNull();
      });

      it('disables freshProcess by default', () => {
        expect(tank.freshProcess).toBe(false);
      });

      it('initializes auth as empty object', () => {
        expect(tank.auth).toEqual({});
      });

      it('initializes agents as empty Map', () => {
        expect(tank.agents).toBeInstanceOf(Map);
        expect(tank.agents.size).toBe(0);
      });

      it('initializes server as null', () => {
        expect(tank.server).toBeNull();
      });

      it('enables auto-refresh by default', () => {
        expect(tank.autoRefresh.enabled).toBe(true);
      });

      it('sets default auto-refresh interval to 60 seconds', () => {
        expect(tank.autoRefresh.interval).toBe(60);
      });

      it('initializes autoRefreshTimer as null', () => {
        expect(tank.autoRefreshTimer).toBeNull();
      });

      it('initializes agentRefreshTimers as empty Map', () => {
        expect(tank.agentRefreshTimers).toBeInstanceOf(Map);
        expect(tank.agentRefreshTimers.size).toBe(0);
      });

      it('initializes lastRefreshedAt as null', () => {
        expect(tank.lastRefreshedAt).toBeNull();
      });

      it('disables skipServer by default', () => {
        expect(tank.skipServer).toBe(false);
      });

      it('enables keepalive by default', () => {
        expect(tank.keepalive.enabled).toBe(true);
      });

      it('sets default keepalive interval to 300 seconds', () => {
        expect(tank.keepalive.interval).toBe(300);
      });

      it('initializes keepaliveManager as null', () => {
        expect(tank.keepaliveManager).toBeNull();
      });
    });

    describe('with specific options', () => {
      it('accepts custom port', () => {
        const tank = new AgentTank({ port: 8080 });
        expect(tank.port).toBe(8080);
      });

      it('accepts custom host', () => {
        const tank = new AgentTank({ host: '0.0.0.0' });
        expect(tank.host).toBe('0.0.0.0');
      });

      it('accepts specific agents list', () => {
        const agents = ['claude', 'gemini'];
        const tank = new AgentTank({ agents });
        expect(tank.requestedAgents).toEqual(['claude', 'gemini']);
      });

      it('disables auto-discover when set to false', () => {
        const tank = new AgentTank({ autoDiscover: false });
        expect(tank.autoDiscover).toBe(false);
      });

      it('enables freshProcess when set to true', () => {
        const tank = new AgentTank({ freshProcess: true });
        expect(tank.freshProcess).toBe(true);
      });

      it('accepts auth configuration with user and pass', () => {
        const auth = { user: 'admin', pass: 'secret' };
        const tank = new AgentTank({ auth });
        expect(tank.auth).toEqual({ user: 'admin', pass: 'secret' });
      });

      it('accepts auth configuration with token', () => {
        const auth = { token: 'my-api-key' };
        const tank = new AgentTank({ auth });
        expect(tank.auth).toEqual({ token: 'my-api-key' });
      });

      it('disables auto-refresh when autoRefreshEnabled is false', () => {
        const tank = new AgentTank({ autoRefreshEnabled: false });
        expect(tank.autoRefresh.enabled).toBe(false);
      });

      it('accepts custom auto-refresh interval', () => {
        const tank = new AgentTank({ autoRefreshInterval: 120 });
        expect(tank.autoRefresh.interval).toBe(120);
      });

      it('accepts zero auto-refresh interval (disabled)', () => {
        const tank = new AgentTank({ autoRefreshInterval: 0 });
        expect(tank.autoRefresh.interval).toBe(0);
      });

      it('enables skipServer when set to true', () => {
        const tank = new AgentTank({ skipServer: true });
        expect(tank.skipServer).toBe(true);
      });

      it('disables keepalive when keepaliveEnabled is false', () => {
        const tank = new AgentTank({ keepaliveEnabled: false });
        expect(tank.keepalive.enabled).toBe(false);
      });

      it('accepts custom keepalive interval', () => {
        const tank = new AgentTank({ keepaliveInterval: 600 });
        expect(tank.keepalive.interval).toBe(600);
      });

      it('accepts zero keepalive interval (disabled)', () => {
        const tank = new AgentTank({ keepaliveInterval: 0 });
        expect(tank.keepalive.interval).toBe(0);
      });

      it('combines multiple options correctly', () => {
        const tank = new AgentTank({
          port: 9999,
          host: '192.168.1.1',
          agents: ['codex'],
          autoDiscover: false,
          freshProcess: true,
          autoRefreshEnabled: false,
          autoRefreshInterval: 300,
          auth: { token: 'abc123' },
          skipServer: true
        });

        expect(tank.port).toBe(9999);
        expect(tank.host).toBe('192.168.1.1');
        expect(tank.requestedAgents).toEqual(['codex']);
        expect(tank.autoDiscover).toBe(false);
        expect(tank.freshProcess).toBe(true);
        expect(tank.autoRefresh.enabled).toBe(false);
        expect(tank.autoRefresh.interval).toBe(300);
        expect(tank.auth).toEqual({ token: 'abc123' });
        expect(tank.skipServer).toBe(true);
      });
    });
  });

  describe('createAgent', () => {
    let tank;

    beforeEach(() => {
      tank = new AgentTank();
    });

    it('creates ClaudeAgent for "claude"', () => {
      const agent = tank.createAgent('claude');
      expect(agent).not.toBeNull();
      expect(agent.name).toBe('claude');
    });

    it('creates GeminiAgent for "gemini"', () => {
      const agent = tank.createAgent('gemini');
      expect(agent).not.toBeNull();
      expect(agent.name).toBe('gemini');
    });

    it('creates CodexAgent for "codex"', () => {
      const agent = tank.createAgent('codex');
      expect(agent).not.toBeNull();
      expect(agent.name).toBe('codex');
    });

    it('returns null for unknown agent', () => {
      const agent = tank.createAgent('unknown');
      expect(agent).toBeNull();
    });
  });

  describe('agent Map population', () => {
    let tank;

    beforeEach(() => {
      tank = new AgentTank();
    });

    it('agents Map is initially empty', () => {
      expect(tank.agents.size).toBe(0);
    });

    it('can manually add agents to the Map', () => {
      const claudeAgent = tank.createAgent('claude');
      const geminiAgent = tank.createAgent('gemini');

      tank.agents.set('claude', claudeAgent);
      tank.agents.set('gemini', geminiAgent);

      expect(tank.agents.size).toBe(2);
      expect(tank.agents.has('claude')).toBe(true);
      expect(tank.agents.has('gemini')).toBe(true);
    });

    it('agents in Map have correct structure', () => {
      const claudeAgent = tank.createAgent('claude');
      tank.agents.set('claude', claudeAgent);

      const agent = tank.agents.get('claude');
      expect(agent.name).toBe('claude');
      expect(agent.usage).toBeNull();
      expect(agent.metadata).toBeNull();
      expect(agent.lastUpdated).toBeNull();
      expect(agent.error).toBeNull();
      expect(agent.isRefreshing).toBe(false);
    });
  });

  describe('getStatus', () => {
    let tank;

    beforeEach(() => {
      tank = new AgentTank();
    });

    it('returns empty object when no agents are configured', () => {
      const status = tank.getStatus();
      expect(status).toEqual({});
    });

    it('returns status for all configured agents', () => {
      const claudeAgent = tank.createAgent('claude');
      const geminiAgent = tank.createAgent('gemini');

      tank.agents.set('claude', claudeAgent);
      tank.agents.set('gemini', geminiAgent);

      const status = tank.getStatus();

      expect(Object.keys(status)).toHaveLength(2);
      expect(status).toHaveProperty('claude');
      expect(status).toHaveProperty('gemini');
    });

    it('returns correct status structure for each agent', () => {
      const claudeAgent = tank.createAgent('claude');
      tank.agents.set('claude', claudeAgent);

      const status = tank.getStatus();

      expect(status.claude).toEqual({
        name: 'claude',
        usage: null,
        metadata: null,
        lastUpdated: null,
        error: null,
        isRefreshing: false,
        publicStatus: null
      });
    });

    it('reflects agent state changes', () => {
      const claudeAgent = tank.createAgent('claude');
      claudeAgent.usage = { session: { percent: 50 } };
      claudeAgent.lastUpdated = '2024-01-01T00:00:00.000Z';
      claudeAgent.error = 'Test error';

      tank.agents.set('claude', claudeAgent);

      const status = tank.getStatus();

      expect(status.claude.usage).toEqual({ session: { percent: 50 } });
      expect(status.claude.lastUpdated).toBe('2024-01-01T00:00:00.000Z');
      expect(status.claude.error).toBe('Test error');
    });
  });

  describe('getAgentStatus', () => {
    let tank;

    beforeEach(() => {
      tank = new AgentTank();
    });

    it('returns null for non-existent agent', () => {
      const status = tank.getAgentStatus('nonexistent');
      expect(status).toBeNull();
    });

    it('returns status for existing agent', () => {
      const claudeAgent = tank.createAgent('claude');
      tank.agents.set('claude', claudeAgent);

      const status = tank.getAgentStatus('claude');

      expect(status).not.toBeNull();
      expect(status.name).toBe('claude');
    });

    it('returns correct status structure', () => {
      const geminiAgent = tank.createAgent('gemini');
      tank.agents.set('gemini', geminiAgent);

      const status = tank.getAgentStatus('gemini');

      expect(status).toEqual({
        name: 'gemini',
        usage: null,
        metadata: null,
        lastUpdated: null,
        error: null,
        isRefreshing: false
      });
    });

    it('returns different status for different agents', () => {
      const claudeAgent = tank.createAgent('claude');
      const geminiAgent = tank.createAgent('gemini');

      claudeAgent.usage = { session: { percent: 30 } };
      geminiAgent.usage = { dailyQueries: { count: 100 } };

      tank.agents.set('claude', claudeAgent);
      tank.agents.set('gemini', geminiAgent);

      const claudeStatus = tank.getAgentStatus('claude');
      const geminiStatus = tank.getAgentStatus('gemini');

      expect(claudeStatus.usage).toEqual({ session: { percent: 30 } });
      expect(geminiStatus.usage).toEqual({ dailyQueries: { count: 100 } });
    });
  });

  describe('authentication configuration', () => {
    it('can configure basic auth', () => {
      const tank = new AgentTank({
        auth: { user: 'testuser', pass: 'testpass' }
      });

      expect(tank.auth.user).toBe('testuser');
      expect(tank.auth.pass).toBe('testpass');
    });

    it('can configure token auth', () => {
      const tank = new AgentTank({
        auth: { token: 'bearer-token-123' }
      });

      expect(tank.auth.token).toBe('bearer-token-123');
    });

    it('can configure both basic and token auth', () => {
      const tank = new AgentTank({
        auth: { user: 'admin', pass: 'secret', token: 'api-key' }
      });

      expect(tank.auth.user).toBe('admin');
      expect(tank.auth.pass).toBe('secret');
      expect(tank.auth.token).toBe('api-key');
    });
  });

  describe('stop', () => {
    let tank;

    beforeEach(() => {
      tank = new AgentTank();
    });

    it('can be called safely when no agents or server exist', () => {
      expect(() => tank.stop()).not.toThrow();
    });

    it('clears autoRefreshTimer if set', () => {
      tank.autoRefreshTimer = setInterval(() => {}, 1000);

      tank.stop();

      expect(tank.autoRefreshTimer).toBeNull();
    });

    it('clears all agent refresh timers', () => {
      tank.agentRefreshTimers.set('claude', setInterval(() => {}, 1000));
      tank.agentRefreshTimers.set('gemini', setInterval(() => {}, 1000));

      tank.stop();

      expect(tank.agentRefreshTimers.size).toBe(0);
    });

    it('stops keepalive manager if running', () => {
      // Simulate a running keepalive manager
      tank.keepaliveManager = {
        stop: jest.fn()
      };

      tank.stop();

      expect(tank.keepaliveManager).toBeNull();
    });
  });

  describe('getKeepaliveStatus', () => {
    let tank;

    beforeEach(() => {
      tank = new AgentTank();
    });

    it('returns default status when manager not initialized', () => {
      const status = tank.getKeepaliveStatus();

      expect(status).toEqual({
        enabled: true,
        interval: 300,
        isRunning: false,
        registeredAgents: [],
        lastKeepaliveAt: null,
      });
    });

    it('returns custom config values when manager not initialized', () => {
      const customTank = new AgentTank({
        keepaliveEnabled: false,
        keepaliveInterval: 600,
      });

      const status = customTank.getKeepaliveStatus();

      expect(status.enabled).toBe(false);
      expect(status.interval).toBe(600);
    });
  });
});
