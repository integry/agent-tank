/**
 * Unit tests for AgentTank (programmatic usage)
 *
 * Tests AgentTank initialization with various configuration options
 * and verifies property assignment without starting the HTTP server.
 */

// Mock node-pty to avoid native module issues in unit tests
jest.mock('node-pty', () => ({
  spawn: jest.fn()
}), { virtual: true });

const { AgentTank, AUTO_REFRESH_MODES, detectDockerHosts, detectDockerHostsFromInterfaces } = require('../../src/index.js');

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

      it('enables docker bridge binding by default', () => {
        expect(tank.dockerAccess).toBe(true);
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

      it('disables claudeApi by default', () => {
        expect(tank.claudeApi).toBe(false);
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

      it('sets default auto-refresh mode to activity', () => {
        expect(tank.autoRefresh.mode).toBe('activity');
      });

      it('sets default activity debounce to 5000ms', () => {
        expect(tank.autoRefresh.activityDebounce).toBe(5000);
      });

      it('initializes autoRefreshManager as null', () => {
        expect(tank.autoRefreshManager).toBeNull();
      });

      it('initializes lastRefreshedAt as null', () => {
        expect(tank.lastRefreshedAt).toBeNull();
      });

      it('sets default refresh cooldown to 30 seconds', () => {
        expect(tank.refreshCooldown).toBe(30);
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
        expect(tank.explicitHost).toBe(true);
      });

      it('can disable docker bridge binding', () => {
        const tank = new AgentTank({ dockerAccess: false });
        expect(tank.dockerAccess).toBe(false);
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

      it('enables claudeApi when set to true', () => {
        const tank = new AgentTank({ claudeApi: true });
        expect(tank.claudeApi).toBe(true);
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

      it('accepts autoRefreshMode of none', () => {
        const tank = new AgentTank({ autoRefreshMode: 'none' });
        expect(tank.autoRefresh.mode).toBe('none');
        expect(tank.autoRefresh.enabled).toBe(false);
      });

      it('accepts autoRefreshMode of interval', () => {
        const tank = new AgentTank({ autoRefreshMode: 'interval' });
        expect(tank.autoRefresh.mode).toBe('interval');
        expect(tank.autoRefresh.enabled).toBe(true);
      });

      it('accepts autoRefreshMode of activity', () => {
        const tank = new AgentTank({ autoRefreshMode: 'activity' });
        expect(tank.autoRefresh.mode).toBe('activity');
        expect(tank.autoRefresh.enabled).toBe(true);
      });

      it('defaults to activity mode for invalid autoRefreshMode', () => {
        const tank = new AgentTank({ autoRefreshMode: 'invalid' });
        expect(tank.autoRefresh.mode).toBe('activity');
      });

      it('accepts custom activity debounce', () => {
        const tank = new AgentTank({ activityDebounce: 10000 });
        expect(tank.autoRefresh.activityDebounce).toBe(10000);
      });

      it('accepts custom refresh cooldown', () => {
        const tank = new AgentTank({ refreshCooldown: 45 });
        expect(tank.refreshCooldown).toBe(45);
      });

      it('sets mode to none when autoRefreshEnabled is false', () => {
        const tank = new AgentTank({ autoRefreshEnabled: false });
        expect(tank.autoRefresh.mode).toBe('none');
        expect(tank.autoRefresh.enabled).toBe(false);
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

    it('passes claudeApi as useApi to ClaudeAgent', () => {
      const apiTank = new AgentTank({ claudeApi: true });
      const agent = apiTank.createAgent('claude');
      expect(agent.useApi).toBe(true);
    });

    it('defaults useApi to false when claudeApi is not set', () => {
      const agent = tank.createAgent('claude');
      expect(agent.useApi).toBe(false);
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
        auth: null,
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
        auth: null,
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

    it('stops autoRefreshManager if running', () => {
      tank.autoRefreshManager = {
        stop: jest.fn()
      };

      tank.stop();

      expect(tank.autoRefreshManager).toBeNull();
    });

    it('stops keepalive manager if running', () => {
      // Simulate a running keepalive manager
      tank.keepaliveManager = {
        stop: jest.fn()
      };

      tank.stop();

      expect(tank.keepaliveManager).toBeNull();
    });

    it('kills agent processes during shutdown', () => {
      const agentA = { requestStop: jest.fn(), killProcess: jest.fn() };
      const agentB = { requestStop: jest.fn(), killProcess: jest.fn() };
      tank.agents.set('claude', agentA);
      tank.agents.set('gemini', agentB);

      tank.stop();

      expect(agentA.requestStop).toHaveBeenCalled();
      expect(agentB.requestStop).toHaveBeenCalled();
      expect(agentA.killProcess).toHaveBeenCalled();
      expect(agentB.killProcess).toHaveBeenCalled();
    });

    it('marks the tank as stopping during shutdown', () => {
      tank.stop();

      expect(tank.stopping).toBe(true);
    });

    it('closes all listening servers during shutdown', () => {
      const serverA = { close: jest.fn() };
      const serverB = { close: jest.fn() };
      tank.servers = [serverA, serverB];
      tank.server = serverA;

      tank.stop();

      expect(serverA.close).toHaveBeenCalled();
      expect(serverB.close).toHaveBeenCalled();
      expect(tank.server).toBeNull();
      expect(tank.servers).toEqual([]);
    });
  });

  describe('listen host resolution', () => {
    it('binds localhost and docker bridge by default when detected', () => {
      const tank = new AgentTank();

      expect(tank._resolveListenHosts(() => '172.17.0.1')).toEqual(['127.0.0.1', '172.17.0.1']);
    });

    it('binds localhost only when docker bridge binding is disabled', () => {
      const tank = new AgentTank({ dockerAccess: false });

      expect(tank._resolveListenHosts(() => '172.17.0.1')).toEqual(['127.0.0.1']);
    });

    it('uses only the explicit host when provided', () => {
      const tank = new AgentTank({ host: '0.0.0.0' });

      expect(tank._resolveListenHosts(() => '172.17.0.1')).toEqual(['0.0.0.0']);
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

  describe('getActivityMonitorStatus', () => {
    let tank;

    beforeEach(() => {
      tank = new AgentTank();
    });

    it('returns default status when monitor not initialized', () => {
      const status = tank.getActivityMonitorStatus();

      expect(status).toEqual({
        isMonitoring: false,
        debounceInterval: 5000,
        monitoredAgents: [],
        agentCount: 0,
        activityCount: 0,
        lastActivityAt: {},
        hasPendingActivity: false,
        pendingAgents: [],
        isActivityRefreshing: false,
      });
    });

    it('returns custom debounce interval when configured', () => {
      const customTank = new AgentTank({
        activityDebounce: 10000,
      });

      const status = customTank.getActivityMonitorStatus();
      expect(status.debounceInterval).toBe(10000);
    });
  });

  describe('getAutoRefreshConfig', () => {
    let tank;

    beforeEach(() => {
      tank = new AgentTank();
    });

    it('returns correct configuration', () => {
      const config = tank.getAutoRefreshConfig();

      expect(config).toEqual({
        mode: 'activity',
        enabled: true,
        interval: 60,
        activityDebounce: 5000,
        refreshCooldown: 30,
        lastRefreshedAt: null,
      });
    });

    it('returns custom configuration when provided', () => {
      const customTank = new AgentTank({
        autoRefreshMode: 'interval',
        autoRefreshInterval: 120,
        activityDebounce: 10000,
      });

      const config = customTank.getAutoRefreshConfig();

      expect(config.mode).toBe('interval');
      expect(config.interval).toBe(120);
      expect(config.activityDebounce).toBe(10000);
    });
  });

  describe('refresh cooldown', () => {
    let tank;
    let agent;

    beforeEach(() => {
      tank = new AgentTank({ refreshCooldown: 30 });
      agent = tank.createAgent('claude');
      agent.refresh = jest.fn().mockResolvedValue();
      tank.agents.set('claude', agent);
    });

    it('skips repeated agent refreshes within the cooldown window', async () => {
      const nowSpy = jest.spyOn(Date, 'now')
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(15000);

      await tank.refreshAgent('claude');
      await tank.refreshAgent('claude');

      expect(agent.refresh).toHaveBeenCalledTimes(1);
      nowSpy.mockRestore();
    });

    it('allows another refresh after the cooldown window elapses', async () => {
      const nowSpy = jest.spyOn(Date, 'now')
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(32000);

      await tank.refreshAgent('claude');
      await tank.refreshAgent('claude');

      expect(agent.refresh).toHaveBeenCalledTimes(2);
      nowSpy.mockRestore();
    });

    it('reuses the same in-flight refresh promise for overlapping requests', async () => {
      let resolveRefresh;
      const refreshPromise = new Promise(resolve => {
        resolveRefresh = resolve;
      });
      agent.refresh = jest.fn().mockReturnValue(refreshPromise);

      const first = tank.refreshAgent('claude');
      const second = tank.refreshAgent('claude');
      resolveRefresh();
      await Promise.all([first, second]);

      expect(agent.refresh).toHaveBeenCalledTimes(1);
    });

    it('applies the cooldown when refreshing all agents', async () => {
      let now = 1000;
      const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);

      await tank.refreshAll();
      now = 15000;
      await tank.refreshAll();

      expect(agent.refresh).toHaveBeenCalledTimes(1);
      nowSpy.mockRestore();
    });
  });

  describe('AUTO_REFRESH_MODES constant', () => {
    it('contains none mode', () => {
      expect(AUTO_REFRESH_MODES).toContain('none');
    });

    it('contains interval mode', () => {
      expect(AUTO_REFRESH_MODES).toContain('interval');
    });

    it('contains activity mode', () => {
      expect(AUTO_REFRESH_MODES).toContain('activity');
    });

    it('has exactly 3 modes', () => {
      expect(AUTO_REFRESH_MODES).toHaveLength(3);
    });
  });
});

describe('detectDockerHostsFromInterfaces', () => {
  it('returns docker bridge IPv4 addresses when docker interfaces are present', () => {
    const hosts = detectDockerHostsFromInterfaces({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
      'br-123': [{ address: '172.20.0.1', family: 'IPv4', internal: false }],
    });

    expect(hosts).toEqual(['172.17.0.1', '172.20.0.1']);
  });

  it('returns null when no matching docker interface exists', () => {
    const hosts = detectDockerHostsFromInterfaces({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth0: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
    });

    expect(hosts).toBeNull();
  });
});

describe('detectDockerHosts', () => {
  it('prefers Docker bridge gateways from docker network inspect', () => {
    const exec = jest.fn((cmd, args) => {
      if (args[0] === 'network' && args[1] === 'ls') {
        return [
          JSON.stringify({ ID: 'bridge-id', Name: 'bridge', Driver: 'bridge' }),
          JSON.stringify({ ID: 'custom-id', Name: 'app-net', Driver: 'bridge' }),
          JSON.stringify({ ID: 'host-id', Name: 'host', Driver: 'host' }),
        ].join('\n');
      }

      if (args[0] === 'network' && args[1] === 'inspect' && args[2] === 'bridge-id') {
        return JSON.stringify([{ Gateway: '172.17.0.1' }]);
      }

      if (args[0] === 'network' && args[1] === 'inspect' && args[2] === 'custom-id') {
        return JSON.stringify([{ Gateway: '172.20.0.1' }]);
      }

      throw new Error(`Unexpected docker command: ${cmd} ${args.join(' ')}`);
    });

    const hosts = detectDockerHosts({ exec, networkInterfaces: {} });

    expect(hosts).toEqual(['172.17.0.1', '172.20.0.1']);
  });

  it('falls back to interface detection when docker is unavailable', () => {
    const exec = jest.fn(() => {
      throw new Error('docker not installed');
    });

    const hosts = detectDockerHosts({
      exec,
      networkInterfaces: {
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        'br-app': [{ address: '172.21.0.1', family: 'IPv4', internal: false }],
      },
    });

    expect(hosts).toEqual(['172.21.0.1']);
  });
});
