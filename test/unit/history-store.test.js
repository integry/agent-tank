/**
 * Unit tests for the History Store module
 *
 * Tests the HistoryStore class that manages persistent storage of
 * usage snapshots with automatic pruning based on retention period.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { HistoryStore, DEFAULT_RETENTION_DAYS } = require('../../src/history-store');

describe('HistoryStore', () => {
  let testDir;
  let store;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = path.join(os.tmpdir(), `history-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });

    store = new HistoryStore({
      historyDir: testDir,
      historyFile: 'test-history.json',
      retentionDays: 14
    });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('uses default retention days when not specified', () => {
      const defaultStore = new HistoryStore({ historyDir: testDir });
      expect(defaultStore.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    });

    it('accepts custom retention days', () => {
      const customStore = new HistoryStore({
        historyDir: testDir,
        retentionDays: 7
      });
      expect(customStore.retentionDays).toBe(7);
    });

    it('builds correct history path', () => {
      expect(store.historyPath).toBe(path.join(testDir, 'test-history.json'));
    });
  });

  describe('addSnapshot', () => {
    it('adds a snapshot with current timestamp', () => {
      const before = Date.now();
      const record = store.addSnapshot('claude', { session: 50 });
      const after = Date.now();

      expect(record.agent).toBe('claude');
      expect(record.usage).toEqual({ session: 50 });

      const recordTime = new Date(record.timestamp).getTime();
      expect(recordTime).toBeGreaterThanOrEqual(before);
      expect(recordTime).toBeLessThanOrEqual(after);
    });

    it('adds a snapshot with custom timestamp', () => {
      const customTimestamp = '2025-01-15T10:30:00.000Z';
      const record = store.addSnapshot('gemini', { models: {} }, customTimestamp);

      expect(record.timestamp).toBe(customTimestamp);
    });

    it('throws error for missing agentName', () => {
      expect(() => store.addSnapshot(null, { session: 50 }))
        .toThrow('agentName is required and must be a string');
    });

    it('throws error for non-string agentName', () => {
      expect(() => store.addSnapshot(123, { session: 50 }))
        .toThrow('agentName is required and must be a string');
    });

    it('throws error for missing usageData', () => {
      expect(() => store.addSnapshot('claude', null))
        .toThrow('usageData is required and must be an object');
    });

    it('throws error for non-object usageData', () => {
      expect(() => store.addSnapshot('claude', 'not an object'))
        .toThrow('usageData is required and must be an object');
    });

    it('persists snapshot to disk', () => {
      store.addSnapshot('claude', { session: 50 });

      // Read directly from file
      const fileContent = fs.readFileSync(store.historyPath, 'utf8');
      const data = JSON.parse(fileContent);

      expect(data).toHaveLength(1);
      expect(data[0].agent).toBe('claude');
    });

    it('appends multiple snapshots', () => {
      store.addSnapshot('claude', { session: 10 });
      store.addSnapshot('claude', { session: 20 });
      store.addSnapshot('gemini', { models: { 'gemini-2.5-flash': 5 } });

      const history = store.getHistory();
      expect(history).toHaveLength(3);
    });
  });

  describe('getHistory', () => {
    beforeEach(() => {
      store.addSnapshot('claude', { session: 10 });
      store.addSnapshot('claude', { session: 20 });
      store.addSnapshot('gemini', { models: {} });
      store.addSnapshot('codex', { fiveHour: 5 });
    });

    it('returns all records when no filter specified', () => {
      const history = store.getHistory();
      expect(history).toHaveLength(4);
    });

    it('filters by agent name', () => {
      const claudeHistory = store.getHistory('claude');
      expect(claudeHistory).toHaveLength(2);
      expect(claudeHistory.every(r => r.agent === 'claude')).toBe(true);
    });

    it('returns empty array for unknown agent', () => {
      const unknownHistory = store.getHistory('unknown');
      expect(unknownHistory).toHaveLength(0);
    });

    it('returns a copy, not the internal array', () => {
      const history = store.getHistory();
      history.push({ agent: 'test', usage: {}, timestamp: '' });

      // Original should be unchanged
      expect(store.getHistory()).toHaveLength(4);
    });
  });

  describe('getLatestSnapshot', () => {
    it('returns the most recent snapshot for an agent', () => {
      // Use recent timestamps to avoid pruning
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      store.addSnapshot('claude', { session: 10 }, twoHoursAgo.toISOString());
      store.addSnapshot('claude', { session: 30 }, now.toISOString());
      store.addSnapshot('claude', { session: 20 }, oneHourAgo.toISOString());

      const latest = store.getLatestSnapshot('claude');
      expect(latest.usage.session).toBe(30);
    });

    it('returns null for unknown agent', () => {
      const latest = store.getLatestSnapshot('unknown');
      expect(latest).toBeNull();
    });
  });

  describe('getSnapshotsInWindow', () => {
    it('returns snapshots within time window', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

      store.addSnapshot('claude', { session: 10 }, threeHoursAgo.toISOString());
      store.addSnapshot('claude', { session: 20 }, twoHoursAgo.toISOString());
      store.addSnapshot('claude', { session: 30 }, oneHourAgo.toISOString());
      store.addSnapshot('claude', { session: 40 }, now.toISOString());

      // Get snapshots from last 2.5 hours
      const windowSeconds = 2.5 * 60 * 60;
      const snapshots = store.getSnapshotsInWindow('claude', windowSeconds);

      expect(snapshots).toHaveLength(3);
      expect(snapshots[0].usage.session).toBe(20);
      expect(snapshots[1].usage.session).toBe(30);
      expect(snapshots[2].usage.session).toBe(40);
    });

    it('returns snapshots sorted by timestamp ascending', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Add in reverse order
      store.addSnapshot('claude', { session: 40 }, now.toISOString());
      store.addSnapshot('claude', { session: 30 }, oneHourAgo.toISOString());

      const snapshots = store.getSnapshotsInWindow('claude', 2 * 60 * 60);

      expect(snapshots[0].usage.session).toBe(30);
      expect(snapshots[1].usage.session).toBe(40);
    });
  });

  describe('clearHistory', () => {
    beforeEach(() => {
      store.addSnapshot('claude', { session: 10 });
      store.addSnapshot('gemini', { models: {} });
      store.addSnapshot('codex', { fiveHour: 5 });
    });

    it('clears all history when no agent specified', () => {
      store.clearHistory();
      expect(store.getHistory()).toHaveLength(0);
    });

    it('clears only specified agent history', () => {
      store.clearHistory('claude');

      const history = store.getHistory();
      expect(history).toHaveLength(2);
      expect(history.find(r => r.agent === 'claude')).toBeUndefined();
    });

    it('persists cleared state to disk', () => {
      store.clearHistory();

      const fileContent = fs.readFileSync(store.historyPath, 'utf8');
      const data = JSON.parse(fileContent);
      expect(data).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      // Use recent timestamps to avoid pruning
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      store.addSnapshot('claude', { session: 10 }, twoHoursAgo.toISOString());
      store.addSnapshot('claude', { session: 20 }, now.toISOString());
      store.addSnapshot('gemini', { models: {} }, oneHourAgo.toISOString());

      const stats = store.getStats();

      expect(stats.totalRecords).toBe(3);
      expect(stats.retentionDays).toBe(14);
      expect(stats.historyPath).toBe(store.historyPath);

      expect(stats.agents.claude.count).toBe(2);
      expect(stats.agents.claude.oldest).toBe(twoHoursAgo.toISOString());
      expect(stats.agents.claude.newest).toBe(now.toISOString());

      expect(stats.agents.gemini.count).toBe(1);
    });

    it('returns empty stats for empty history', () => {
      const stats = store.getStats();

      expect(stats.totalRecords).toBe(0);
      expect(stats.agents).toEqual({});
    });
  });

  describe('automatic pruning', () => {
    it('removes records older than retention period', () => {
      // Create a store with 1 day retention
      const shortRetentionStore = new HistoryStore({
        historyDir: testDir,
        historyFile: 'short-retention.json',
        retentionDays: 1
      });

      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      shortRetentionStore.addSnapshot('claude', { session: 10 }, twoDaysAgo.toISOString());
      shortRetentionStore.addSnapshot('claude', { session: 20 }, oneHourAgo.toISOString());
      shortRetentionStore.addSnapshot('claude', { session: 30 }, now.toISOString());

      // Force pruning by calling getHistory
      const history = shortRetentionStore.getHistory();

      // Only the recent records should remain
      expect(history).toHaveLength(2);
      expect(history.find(r => r.usage.session === 10)).toBeUndefined();
    });

    it('prunes on addSnapshot', () => {
      const shortRetentionStore = new HistoryStore({
        historyDir: testDir,
        historyFile: 'prune-on-add.json',
        retentionDays: 1
      });

      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      // Manually write old data to file
      fs.writeFileSync(
        shortRetentionStore.historyPath,
        JSON.stringify([
          { timestamp: twoDaysAgo.toISOString(), agent: 'claude', usage: { session: 10 } }
        ])
      );

      // Reset internal state to force reload
      shortRetentionStore._initialized = false;
      shortRetentionStore._history = null;

      // Add new snapshot - should trigger pruning
      shortRetentionStore.addSnapshot('claude', { session: 50 });

      const history = shortRetentionStore.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].usage.session).toBe(50);
    });
  });

  describe('error handling', () => {
    it('handles corrupted JSON file gracefully', () => {
      // Write corrupted JSON
      fs.writeFileSync(store.historyPath, 'not valid json');

      // Reset internal state
      store._initialized = false;
      store._history = null;

      // Should not throw, returns empty array
      const history = store.getHistory();
      expect(history).toEqual([]);
    });

    it('handles non-array JSON file gracefully', () => {
      // Write valid JSON but wrong structure
      fs.writeFileSync(store.historyPath, '{"not": "an array"}');

      // Reset internal state
      store._initialized = false;
      store._history = null;

      // Should reset to empty array
      const history = store.getHistory();
      expect(history).toEqual([]);
    });

    it('creates directory if it does not exist', () => {
      const nestedDir = path.join(testDir, 'nested', 'path');
      const nestedStore = new HistoryStore({
        historyDir: nestedDir,
        historyFile: 'nested-history.json'
      });

      // Should not throw
      nestedStore.addSnapshot('claude', { session: 50 });

      expect(fs.existsSync(nestedDir)).toBe(true);
    });
  });
});
