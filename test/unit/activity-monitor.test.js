/**
 * Unit tests for ActivityMonitor
 *
 * Tests the activity monitoring functionality including file watching,
 * debouncing, and callback handling.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ActivityMonitor, DEFAULT_LOG_DIRECTORIES } = require('../../src/activity-monitor.js');

// Mock fs.watch
jest.mock('node:fs', () => {
  const actualFs = jest.requireActual('node:fs');
  return {
    ...actualFs,
    watch: jest.fn(),
    existsSync: jest.fn(),
  };
});

describe('ActivityMonitor', () => {
  let monitor;
  let mockWatcher;

  beforeEach(() => {
    jest.useFakeTimers();

    // Create mock watcher
    mockWatcher = {
      on: jest.fn(),
      close: jest.fn(),
    };

    // Default: directories don't exist
    fs.existsSync.mockReturnValue(false);
    fs.watch.mockReturnValue(mockWatcher);

    monitor = new ActivityMonitor();
  });

  afterEach(() => {
    if (monitor) {
      monitor.stop();
    }
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('sets default debounce interval to 5000ms', () => {
      expect(monitor.debounceInterval).toBe(5000);
    });

    it('initializes with empty state', () => {
      expect(monitor.watchers.size).toBe(0);
      expect(monitor.debounceTimers.size).toBe(0);
      expect(monitor.lastActivityAt.size).toBe(0);
      expect(monitor.isMonitoring).toBe(false);
      expect(monitor.activityCount).toBe(0);
    });

    it('accepts custom debounce interval', () => {
      const custom = new ActivityMonitor({ debounceInterval: 10000 });
      expect(custom.debounceInterval).toBe(10000);
    });

    it('accepts custom onActivity callback', () => {
      const callback = jest.fn();
      const custom = new ActivityMonitor({ onActivity: callback });
      expect(custom.onActivity).toBe(callback);
    });

    it('accepts custom agents list', () => {
      const custom = new ActivityMonitor({ agents: ['claude', 'codex'] });
      expect(custom.agents).toEqual(['claude', 'codex']);
    });

    it('accepts custom log directories', () => {
      const customDirs = { claude: ['/custom/path'] };
      const custom = new ActivityMonitor({ logDirectories: customDirs });
      expect(custom.logDirectories).toBe(customDirs);
    });

    it('defaults to all known agents', () => {
      expect(monitor.agents).toEqual(['claude', 'codex', 'gemini']);
    });
  });

  describe('DEFAULT_LOG_DIRECTORIES', () => {
    it('contains claude directories', () => {
      expect(DEFAULT_LOG_DIRECTORIES.claude).toBeDefined();
      expect(DEFAULT_LOG_DIRECTORIES.claude.length).toBeGreaterThan(0);
    });

    it('contains codex directories', () => {
      expect(DEFAULT_LOG_DIRECTORIES.codex).toBeDefined();
      expect(DEFAULT_LOG_DIRECTORIES.codex.length).toBeGreaterThan(0);
    });

    it('contains gemini directories', () => {
      expect(DEFAULT_LOG_DIRECTORIES.gemini).toBeDefined();
      expect(DEFAULT_LOG_DIRECTORIES.gemini.length).toBeGreaterThan(0);
    });

    it('uses home directory for paths', () => {
      const homedir = os.homedir();
      for (const agent of Object.keys(DEFAULT_LOG_DIRECTORIES)) {
        for (const dir of DEFAULT_LOG_DIRECTORIES[agent]) {
          expect(dir.startsWith(homedir)).toBe(true);
        }
      }
    });
  });

  describe('start', () => {
    it('does not start if already monitoring', () => {
      fs.existsSync.mockReturnValue(true);
      monitor.start();
      expect(monitor.isMonitoring).toBe(true);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      monitor.start();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Already monitoring'));
      consoleSpy.mockRestore();
    });

    it('sets isMonitoring to true', () => {
      monitor.start();
      expect(monitor.isMonitoring).toBe(true);
    });

    it('sets up watchers for existing directories', () => {
      fs.existsSync.mockReturnValue(true);
      monitor.start();
      expect(fs.watch).toHaveBeenCalled();
    });

    it('does not set up watchers for non-existing directories', () => {
      fs.existsSync.mockReturnValue(false);
      monitor.start();
      expect(fs.watch).not.toHaveBeenCalled();
    });

    it('returns status with monitored directories', () => {
      fs.existsSync.mockReturnValue(true);
      const result = monitor.start();
      expect(result.isMonitoring).toBe(true);
      expect(result.monitoredDirs).toBeDefined();
      expect(Array.isArray(result.monitoredDirs)).toBe(true);
    });

    it('returns status with missing directories', () => {
      fs.existsSync.mockReturnValue(false);
      const result = monitor.start();
      expect(result.missingDirs).toBeDefined();
      expect(Array.isArray(result.missingDirs)).toBe(true);
    });

    it('sets up error handler on watcher', () => {
      fs.existsSync.mockReturnValue(true);
      monitor.start();
      expect(mockWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('stop', () => {
    it('closes all watchers', () => {
      fs.existsSync.mockReturnValue(true);
      monitor.start();
      monitor.stop();
      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('clears watchers map', () => {
      fs.existsSync.mockReturnValue(true);
      monitor.start();
      monitor.stop();
      expect(monitor.watchers.size).toBe(0);
    });

    it('clears debounce timers', () => {
      monitor.debounceTimers.set('test', setTimeout(() => {}, 1000));
      monitor.stop();
      expect(monitor.debounceTimers.size).toBe(0);
    });

    it('sets isMonitoring to false', () => {
      fs.existsSync.mockReturnValue(true);
      monitor.start();
      expect(monitor.isMonitoring).toBe(true);
      monitor.stop();
      expect(monitor.isMonitoring).toBe(false);
    });

    it('can be called safely when not monitoring', () => {
      expect(() => monitor.stop()).not.toThrow();
    });
  });

  describe('_handleFileChange', () => {
    it('sets up debounce timer', () => {
      monitor._handleFileChange('claude', 'change', 'test.txt');
      expect(monitor.debounceTimers.has('claude')).toBe(true);
    });

    it('clears existing timer before setting new one', () => {
      monitor._handleFileChange('claude', 'change', 'test.txt');
      monitor._handleFileChange('claude', 'change', 'test2.txt');
      // Only one timer should exist for the agent
      expect(monitor.debounceTimers.size).toBe(1);
    });

    it('triggers activity callback after debounce', () => {
      const callback = jest.fn();
      monitor.onActivity = callback;

      monitor._handleFileChange('claude', 'change', 'test.txt');
      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(5000);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('passes event details to callback', () => {
      const callback = jest.fn();
      monitor.onActivity = callback;

      monitor._handleFileChange('claude', 'change', 'test.txt');
      jest.advanceTimersByTime(5000);

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        agent: 'claude',
        eventType: 'change',
        filename: 'test.txt',
      }));
    });

    it('respects custom debounce interval', () => {
      const callback = jest.fn();
      const custom = new ActivityMonitor({
        debounceInterval: 10000,
        onActivity: callback,
      });

      custom._handleFileChange('claude', 'change', 'test.txt');
      jest.advanceTimersByTime(5000);
      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(5000);
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('_triggerActivity', () => {
    it('updates lastActivityAt for the agent', () => {
      monitor._triggerActivity('claude', 'change', 'test.txt');
      expect(monitor.lastActivityAt.has('claude')).toBe(true);
    });

    it('increments activityCount', () => {
      expect(monitor.activityCount).toBe(0);
      monitor._triggerActivity('claude', 'change', 'test.txt');
      expect(monitor.activityCount).toBe(1);
      monitor._triggerActivity('claude', 'change', 'test2.txt');
      expect(monitor.activityCount).toBe(2);
    });

    it('calls onActivity callback', () => {
      const callback = jest.fn();
      monitor.onActivity = callback;
      monitor._triggerActivity('claude', 'change', 'test.txt');
      expect(callback).toHaveBeenCalled();
    });

    it('handles callback errors gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      monitor.onActivity = () => { throw new Error('Test error'); };
      expect(() => monitor._triggerActivity('claude', 'change', 'test.txt')).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error in onActivity callback'));
      consoleSpy.mockRestore();
    });
  });

  describe('hasPendingActivity', () => {
    it('returns false when no pending activity', () => {
      expect(monitor.hasPendingActivity()).toBe(false);
    });

    it('returns true when debounce timer is active', () => {
      monitor._handleFileChange('claude', 'change', 'test.txt');
      expect(monitor.hasPendingActivity()).toBe(true);
    });

    it('returns false after debounce completes', () => {
      monitor._handleFileChange('claude', 'change', 'test.txt');
      expect(monitor.hasPendingActivity()).toBe(true);
      jest.advanceTimersByTime(5000);
      expect(monitor.hasPendingActivity()).toBe(false);
    });

    it('checks specific agent when provided', () => {
      monitor._handleFileChange('claude', 'change', 'test.txt');
      expect(monitor.hasPendingActivity('claude')).toBe(true);
      expect(monitor.hasPendingActivity('codex')).toBe(false);
    });
  });

  describe('getTimeSinceActivity', () => {
    it('returns null when agent has no activity', () => {
      expect(monitor.getTimeSinceActivity('claude')).toBeNull();
    });

    it('returns milliseconds since last activity', () => {
      monitor._triggerActivity('claude', 'change', 'test.txt');
      jest.advanceTimersByTime(1000);
      const timeSince = monitor.getTimeSinceActivity('claude');
      expect(timeSince).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('setDebounceInterval', () => {
    it('updates the debounce interval', () => {
      monitor.setDebounceInterval(10000);
      expect(monitor.debounceInterval).toBe(10000);
    });
  });

  describe('getStatus', () => {
    it('returns correct status when not monitoring', () => {
      const status = monitor.getStatus();
      expect(status).toEqual({
        isMonitoring: false,
        debounceInterval: 5000,
        monitoredAgents: [],
        agentCount: 0,
        activityCount: 0,
        lastActivityAt: {},
        hasPendingActivity: false,
        pendingAgents: [],
      });
    });

    it('returns monitored agents when monitoring', () => {
      fs.existsSync.mockReturnValue(true);
      monitor.start();
      const status = monitor.getStatus();
      expect(status.isMonitoring).toBe(true);
      expect(status.monitoredAgents.length).toBeGreaterThan(0);
    });

    it('includes lastActivityAt timestamps', () => {
      monitor._triggerActivity('claude', 'change', 'test.txt');
      const status = monitor.getStatus();
      expect(status.lastActivityAt.claude).toBeDefined();
    });

    it('includes pending agents', () => {
      monitor._handleFileChange('claude', 'change', 'test.txt');
      const status = monitor.getStatus();
      expect(status.hasPendingActivity).toBe(true);
      expect(status.pendingAgents).toContain('claude');
    });
  });

  describe('triggerManual', () => {
    it('triggers activity callback', () => {
      const callback = jest.fn();
      monitor.onActivity = callback;
      monitor.triggerManual('claude');
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        agent: 'claude',
        eventType: 'manual',
        filename: 'manual-trigger',
      }));
    });

    it('increments activityCount', () => {
      expect(monitor.activityCount).toBe(0);
      monitor.triggerManual('claude');
      expect(monitor.activityCount).toBe(1);
    });
  });

  describe('debouncing behavior', () => {
    it('coalesces multiple rapid file changes', () => {
      const callback = jest.fn();
      monitor.onActivity = callback;

      // Simulate rapid file changes
      monitor._handleFileChange('claude', 'change', 'file1.txt');
      jest.advanceTimersByTime(1000);
      monitor._handleFileChange('claude', 'change', 'file2.txt');
      jest.advanceTimersByTime(1000);
      monitor._handleFileChange('claude', 'change', 'file3.txt');

      // Should not have called yet
      expect(callback).not.toHaveBeenCalled();

      // Advance to after debounce
      jest.advanceTimersByTime(5000);

      // Should only have called once
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('handles multiple agents independently', () => {
      const callback = jest.fn();
      monitor.onActivity = callback;

      monitor._handleFileChange('claude', 'change', 'file.txt');
      monitor._handleFileChange('codex', 'change', 'file.txt');

      jest.advanceTimersByTime(5000);

      // Both should trigger
      expect(callback).toHaveBeenCalledTimes(2);
    });
  });
});
