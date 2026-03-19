/**
 * Unit tests for KeepaliveManager
 *
 * Tests the keepalive scheduler functionality including agent registration,
 * timer management, and error handling.
 */

const { KeepaliveManager } = require('../../src/keepalive-manager.js');

describe('KeepaliveManager', () => {
  let manager;

  beforeEach(() => {
    jest.useFakeTimers();
    manager = new KeepaliveManager();
  });

  afterEach(() => {
    if (manager) {
      manager.stop();
    }
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('sets default interval to 300 seconds', () => {
      expect(manager.interval).toBe(300);
    });

    it('enables keepalive by default', () => {
      expect(manager.enabled).toBe(true);
    });

    it('initializes agents as empty Map', () => {
      expect(manager.agents).toBeInstanceOf(Map);
      expect(manager.agents.size).toBe(0);
    });

    it('initializes timer as null', () => {
      expect(manager.timer).toBeNull();
    });

    it('initializes lastKeepaliveAt as null', () => {
      expect(manager.lastKeepaliveAt).toBeNull();
    });

    it('initializes isRunning as false', () => {
      expect(manager.isRunning).toBe(false);
    });

    it('accepts custom interval', () => {
      const custom = new KeepaliveManager({ interval: 600 });
      expect(custom.interval).toBe(600);
    });

    it('accepts enabled=false', () => {
      const disabled = new KeepaliveManager({ enabled: false });
      expect(disabled.enabled).toBe(false);
    });

    it('accepts zero interval', () => {
      const zeroInterval = new KeepaliveManager({ interval: 0 });
      expect(zeroInterval.interval).toBe(0);
    });
  });

  describe('register', () => {
    it('registers agent with keepalive method', () => {
      const mockAgent = { keepalive: jest.fn() };
      manager.register('test', mockAgent);
      expect(manager.agents.has('test')).toBe(true);
      expect(manager.agents.get('test')).toBe(mockAgent);
    });

    it('does not register null agent', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      manager.register('null-agent', null);
      expect(manager.agents.has('null-agent')).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot register null agent'));
      consoleSpy.mockRestore();
    });

    it('does not register agent without keepalive method', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const invalidAgent = { name: 'invalid' };
      manager.register('invalid', invalidAgent);
      expect(manager.agents.has('invalid')).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('does not implement keepalive()'));
      consoleSpy.mockRestore();
    });

    it('can register multiple agents', () => {
      const agent1 = { keepalive: jest.fn() };
      const agent2 = { keepalive: jest.fn() };
      manager.register('agent1', agent1);
      manager.register('agent2', agent2);
      expect(manager.agents.size).toBe(2);
    });
  });

  describe('unregister', () => {
    it('removes registered agent', () => {
      const mockAgent = { keepalive: jest.fn() };
      manager.register('test', mockAgent);
      expect(manager.agents.has('test')).toBe(true);
      manager.unregister('test');
      expect(manager.agents.has('test')).toBe(false);
    });

    it('handles unregistering non-existent agent gracefully', () => {
      expect(() => manager.unregister('nonexistent')).not.toThrow();
    });
  });

  describe('start', () => {
    it('does not start if already running', () => {
      const mockAgent = { keepalive: jest.fn() };
      manager.register('test', mockAgent);
      manager.start();
      expect(manager.isRunning).toBe(true);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      manager.start();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Already running'));
      consoleSpy.mockRestore();
    });

    it('does not start if disabled', () => {
      const disabled = new KeepaliveManager({ enabled: false });
      const mockAgent = { keepalive: jest.fn() };
      disabled.register('test', mockAgent);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      disabled.start();
      expect(disabled.isRunning).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('disabled'));
      consoleSpy.mockRestore();
    });

    it('does not start if interval is zero', () => {
      const zeroInterval = new KeepaliveManager({ interval: 0 });
      const mockAgent = { keepalive: jest.fn() };
      zeroInterval.register('test', mockAgent);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      zeroInterval.start();
      expect(zeroInterval.isRunning).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('interval is 0'));
      consoleSpy.mockRestore();
    });

    it('does not start if no agents registered', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      manager.start();
      expect(manager.isRunning).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No agents registered'));
      consoleSpy.mockRestore();
    });

    it('starts timer when conditions are met', () => {
      const mockAgent = { keepalive: jest.fn().mockResolvedValue(true) };
      manager.register('test', mockAgent);
      manager.start();
      expect(manager.isRunning).toBe(true);
      expect(manager.timer).not.toBeNull();
    });

    it('runs keepalive at configured interval', async () => {
      const mockAgent = { keepalive: jest.fn().mockResolvedValue(true) };
      manager.register('test', mockAgent);
      manager.start();

      // Fast-forward by the interval
      jest.advanceTimersByTime(300 * 1000);

      // Allow promises to resolve
      await Promise.resolve();

      expect(mockAgent.keepalive).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('clears timer', () => {
      const mockAgent = { keepalive: jest.fn().mockResolvedValue(true) };
      manager.register('test', mockAgent);
      manager.start();
      expect(manager.timer).not.toBeNull();

      manager.stop();
      expect(manager.timer).toBeNull();
    });

    it('sets isRunning to false', () => {
      const mockAgent = { keepalive: jest.fn().mockResolvedValue(true) };
      manager.register('test', mockAgent);
      manager.start();
      expect(manager.isRunning).toBe(true);

      manager.stop();
      expect(manager.isRunning).toBe(false);
    });

    it('can be called safely when not running', () => {
      expect(() => manager.stop()).not.toThrow();
    });
  });

  describe('_runKeepalive', () => {
    it('returns empty object when no agents registered', async () => {
      const results = await manager._runKeepalive();
      expect(results).toEqual({});
    });

    it('calls keepalive on all registered agents', async () => {
      const agent1 = { keepalive: jest.fn().mockResolvedValue(true) };
      const agent2 = { keepalive: jest.fn().mockResolvedValue(true) };
      manager.register('agent1', agent1);
      manager.register('agent2', agent2);

      await manager._runKeepalive();

      expect(agent1.keepalive).toHaveBeenCalled();
      expect(agent2.keepalive).toHaveBeenCalled();
    });

    it('returns success results for each agent', async () => {
      const agent1 = { keepalive: jest.fn().mockResolvedValue(true) };
      const agent2 = { keepalive: jest.fn().mockResolvedValue(true) };
      manager.register('agent1', agent1);
      manager.register('agent2', agent2);

      const results = await manager._runKeepalive();

      expect(results.agent1).toEqual({ success: true });
      expect(results.agent2).toEqual({ success: true });
    });

    it('handles agent errors gracefully', async () => {
      const successAgent = { keepalive: jest.fn().mockResolvedValue(true) };
      const errorAgent = { keepalive: jest.fn().mockRejectedValue(new Error('Test error')) };
      manager.register('success', successAgent);
      manager.register('error', errorAgent);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const results = await manager._runKeepalive();

      expect(results.success).toEqual({ success: true });
      expect(results.error).toEqual({ success: false, error: 'Test error' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Keepalive failed for error'));
      consoleSpy.mockRestore();
    });

    it('updates lastKeepaliveAt timestamp', async () => {
      const mockAgent = { keepalive: jest.fn().mockResolvedValue(true) };
      manager.register('test', mockAgent);
      expect(manager.lastKeepaliveAt).toBeNull();

      await manager._runKeepalive();

      expect(manager.lastKeepaliveAt).not.toBeNull();
      expect(typeof manager.lastKeepaliveAt).toBe('string');
    });
  });

  describe('runNow', () => {
    it('calls _runKeepalive and returns results', async () => {
      const mockAgent = { keepalive: jest.fn().mockResolvedValue(true) };
      manager.register('test', mockAgent);

      const results = await manager.runNow();

      expect(mockAgent.keepalive).toHaveBeenCalled();
      expect(results.test).toEqual({ success: true });
    });
  });

  describe('getStatus', () => {
    it('returns correct status when not running', () => {
      const status = manager.getStatus();

      expect(status).toEqual({
        enabled: true,
        interval: 300,
        isRunning: false,
        registeredAgents: [],
        lastKeepaliveAt: null,
      });
    });

    it('returns registered agent names', () => {
      const agent1 = { keepalive: jest.fn() };
      const agent2 = { keepalive: jest.fn() };
      manager.register('agent1', agent1);
      manager.register('agent2', agent2);

      const status = manager.getStatus();

      expect(status.registeredAgents).toContain('agent1');
      expect(status.registeredAgents).toContain('agent2');
    });

    it('returns isRunning=true when running', () => {
      const mockAgent = { keepalive: jest.fn().mockResolvedValue(true) };
      manager.register('test', mockAgent);
      manager.start();

      const status = manager.getStatus();

      expect(status.isRunning).toBe(true);
    });

    it('returns lastKeepaliveAt after keepalive runs', async () => {
      const mockAgent = { keepalive: jest.fn().mockResolvedValue(true) };
      manager.register('test', mockAgent);

      await manager._runKeepalive();

      const status = manager.getStatus();
      expect(status.lastKeepaliveAt).not.toBeNull();
    });
  });
});
