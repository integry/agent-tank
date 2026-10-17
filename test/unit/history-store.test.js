/**
 * Unit tests for the SQLite history store.
 *
 * SQLite-backed tests require Node's built-in `node:sqlite` (Node.js 22.5+)
 * and are skipped when it is unavailable. The no-op store and factory
 * fallback tests run on every runtime.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  createHistoryStore,
  SqliteHistoryStore,
  NullHistoryStore,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_HISTORY_DB,
} = require('../../src/history-store');

function loadSqlite() {
  try {
    return require('node:sqlite');
  } catch {
    return null;
  }
}

const sqlite = loadSqlite();

if (!sqlite) {
  console.log('\n⚠️  SQLite history store tests skipped: node:sqlite is not available (requires Node.js 22.5+)\n');
}

const describeIfSqlite = sqlite ? describe : describe.skip;
const DAY_MS = 24 * 60 * 60 * 1000;

const CODEX_USAGE = {
  fiveHour: { percentUsed: 20 },
  weekly: { percentUsed: 45 },
  modelLimits: [{ name: 'GPT-5.3-Codex-Spark', fiveHour: { percentUsed: 5 } }],
};

describe('NullHistoryStore', () => {
  it('reports store "none" and returns empty results for every method', () => {
    const store = new NullHistoryStore({ retentionDays: 7, reason: 'unavailable' });

    expect(store.store).toBe('none');
    expect(store.enabled).toBe(false);
    expect(store.recordUsage({ agentId: 'claude', provider: 'claude', usage: { session: { percent: 1 } } })).toBe(0);
    expect(store.getSeries('claude')).toEqual([]);
    expect(store.getLatest('claude')).toBeNull();
    expect(store.clear()).toBe(0);
    expect(store.prune()).toBe(0);
    expect(() => store.close()).not.toThrow();
    expect(store.getStats()).toEqual({
      store: 'none',
      enabled: false,
      reason: 'unavailable',
      path: null,
      retentionDays: 7,
      totalRows: 0,
      agents: {},
    });
  });
});

describe('createHistoryStore', () => {
  it('returns a no-op store without warning when history is disabled', () => {
    const warn = jest.fn();
    const store = createHistoryStore({ enabled: false, warn });

    expect(store).toBeInstanceOf(NullHistoryStore);
    expect(store.getStats().reason).toBe('disabled');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to a no-op store with one warning when node:sqlite cannot be loaded', () => {
    const warn = jest.fn();
    const store = createHistoryStore({
      warn,
      loadSqlite: () => { throw new Error('No such built-in module: node:sqlite'); },
    });

    expect(store.store).toBe('none');
    expect(store.getStats()).toMatchObject({ store: 'none', reason: 'unavailable', totalRows: 0, agents: {} });
    expect(() => store.recordUsage({ agentId: 'codex', provider: 'codex', usage: CODEX_USAGE })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/node:sqlite is unavailable/);
  });

  it('defaults to ~/.agent-tank/history.db and 14 days of retention', () => {
    expect(DEFAULT_HISTORY_DB).toBe(path.join(os.homedir(), '.agent-tank', 'history.db'));
    expect(DEFAULT_RETENTION_DAYS).toBe(14);
  });

  it('falls back to the default retention for invalid values', () => {
    expect(new NullHistoryStore({ retentionDays: Number.NaN }).retentionDays).toBe(14);
    expect(new NullHistoryStore({ retentionDays: 0 }).retentionDays).toBe(14);
  });
});

describeIfSqlite('SqliteHistoryStore', () => {
  let testDir;
  let dbPath;
  let store;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-store-test-'));
    dbPath = path.join(testDir, 'nested', 'history.db');
    store = createHistoryStore({ dbPath, retentionDays: 14 });
  });

  afterEach(() => {
    store.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  function rawQuery(sql, ...params) {
    const db = new sqlite.DatabaseSync(dbPath);
    try {
      return db.prepare(sql).all(...params);
    } finally {
      db.close();
    }
  }

  it('is created by the factory and does not touch disk until first use', () => {
    expect(store).toBeInstanceOf(SqliteHistoryStore);
    expect(store.store).toBe('sqlite');
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  describe('recordUsage', () => {
    it('creates the database and inserts one row per metric', () => {
      const recordedAt = new Date().toISOString();
      const recordedAtMs = Date.parse(recordedAt);
      const inserted = store.recordUsage({ agentId: 'work', provider: 'codex', usage: CODEX_USAGE, recordedAt });

      expect(inserted).toBe(3);
      expect(fs.existsSync(dbPath)).toBe(true);
      expect(rawQuery('SELECT agent_id, provider, metric_key, percent_used, unit, recorded_at, recorded_at_ms FROM usage_metrics ORDER BY id')).toEqual([
        { agent_id: 'work', provider: 'codex', metric_key: 'fiveHour', percent_used: 20, unit: 'percent', recorded_at: recordedAt, recorded_at_ms: recordedAtMs },
        { agent_id: 'work', provider: 'codex', metric_key: 'weekly', percent_used: 45, unit: 'percent', recorded_at: recordedAt, recorded_at_ms: recordedAtMs },
        { agent_id: 'work', provider: 'codex', metric_key: 'GPT-5.3-Codex-Spark:fiveHour', percent_used: 5, unit: 'percent', recorded_at: recordedAt, recorded_at_ms: recordedAtMs },
      ].map(row => expect.objectContaining(row)));
    });

    it('produces a plottable series with plain SQL', () => {
      const now = Date.now();
      store.recordUsage({ agentId: 'work', provider: 'codex', usage: { weekly: { percentUsed: 10 } }, recordedAt: now - 2000 });
      store.recordUsage({ agentId: 'work', provider: 'codex', usage: { weekly: { percentUsed: 12 } }, recordedAt: now - 1000 });

      const rows = rawQuery("SELECT recorded_at, percent_used FROM usage_metrics WHERE agent_id='work' AND metric_key='weekly' ORDER BY recorded_at_ms");

      expect(rows.map(r => r.percent_used)).toEqual([10, 12]);
      expect(rows[0].recorded_at).toBe(new Date(now - 2000).toISOString());
    });

    it('stores non-percentage metrics with their value and unit', () => {
      store.recordUsage({
        agentId: 'work',
        provider: 'codex',
        metrics: [{ key: 'credits', label: 'Credits', percentUsed: null, value: 42.5, unit: 'credits' }],
      });

      expect(store.getLatest('work').metrics).toEqual([
        { key: 'credits', label: 'Credits', model: null, cycle: null, percentUsed: null, value: 42.5, unit: 'credits' },
      ]);
    });

    it('records nothing when the usage has no metrics', () => {
      expect(store.recordUsage({ agentId: 'x', provider: 'unknown', usage: { foo: 1 } })).toBe(0);
      expect(fs.existsSync(dbPath)).toBe(false);
    });

    it('validates agentId and provider', () => {
      expect(() => store.recordUsage({ provider: 'codex', usage: CODEX_USAGE })).toThrow('agentId is required');
      expect(() => store.recordUsage({ agentId: 'work', usage: CODEX_USAGE })).toThrow('provider is required');
    });

    it('deletes rows older than the retention period on write', () => {
      const now = Date.now();
      store.recordUsage({ agentId: 'work', provider: 'codex', usage: CODEX_USAGE, recordedAt: now - 15 * DAY_MS });
      store.recordUsage({ agentId: 'work', provider: 'codex', usage: CODEX_USAGE, recordedAt: now - 13 * DAY_MS });

      expect(rawQuery('SELECT COUNT(*) AS n FROM usage_metrics')[0].n).toBe(3);
      store.recordUsage({ agentId: 'work', provider: 'codex', usage: CODEX_USAGE, recordedAt: now });
      expect(store.getStats().agents.work.snapshots).toBe(2);
    });
  });

  describe('getSeries', () => {
    beforeEach(() => {
      const base = Date.parse('2026-10-17T00:00:00.000Z');
      jest.spyOn(Date, 'now').mockReturnValue(base + DAY_MS);
      store.recordUsage({ agentId: 'work', provider: 'codex', usage: { fiveHour: { percentUsed: 1 }, weekly: { percentUsed: 10 } }, recordedAt: base });
      store.recordUsage({ agentId: 'work', provider: 'codex', usage: { fiveHour: { percentUsed: 2 }, weekly: { percentUsed: 11, label: 'Weekly (renamed)' } }, recordedAt: base + 1000 });
      store.recordUsage({ agentId: 'other', provider: 'claude', usage: { session: { percent: 50 } }, recordedAt: base });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns every series for one agent with time-ordered points', () => {
      expect(store.getSeries('work')).toEqual([
        {
          key: 'fiveHour', label: '5h limit', model: null, cycle: 'five_hour', unit: 'percent',
          points: [
            { t: '2026-10-17T00:00:00.000Z', percent: 1, value: null },
            { t: '2026-10-17T00:00:01.000Z', percent: 2, value: null },
          ],
        },
        {
          key: 'weekly', label: 'Weekly (renamed)', model: null, cycle: 'weekly', unit: 'percent',
          points: [
            { t: '2026-10-17T00:00:00.000Z', percent: 10, value: null },
            { t: '2026-10-17T00:00:01.000Z', percent: 11, value: null },
          ],
        },
      ]);
    });

    it('filters by metric key and time range', () => {
      const series = store.getSeries('work', { key: 'weekly', since: '2026-10-17T00:00:00.500Z' });

      expect(series).toHaveLength(1);
      expect(series[0].points).toEqual([{ t: '2026-10-17T00:00:01.000Z', percent: 11, value: null }]);
      expect(store.getSeries('work', { until: Date.parse('2026-10-17T00:00:00.000Z') })[0].points).toHaveLength(1);
    });

    it('returns an empty array for an unknown agent', () => {
      expect(store.getSeries('missing')).toEqual([]);
    });
  });

  describe('getLatest', () => {
    it('returns only the metrics from the most recent refresh', () => {
      store.recordUsage({ agentId: 'work', provider: 'codex', usage: CODEX_USAGE, recordedAt: Date.now() - 1000 });
      store.recordUsage({ agentId: 'work', provider: 'codex', usage: { weekly: { percentUsed: 50 } }, recordedAt: Date.now() });

      const latest = store.getLatest('work');

      expect(latest).toMatchObject({ agentId: 'work', provider: 'codex' });
      expect(latest.metrics.map(m => [m.key, m.percentUsed])).toEqual([['weekly', 50]]);
    });

    it('returns null for an unknown agent', () => {
      expect(store.getLatest('missing')).toBeNull();
    });
  });

  describe('getStats', () => {
    it('summarises rows per agent and reports the sqlite backend', () => {
      const t1 = Date.now() - 1000;
      const t2 = Date.now();
      store.recordUsage({ agentId: 'work', provider: 'codex', usage: CODEX_USAGE, recordedAt: t1 });
      store.recordUsage({ agentId: 'work', provider: 'codex', usage: CODEX_USAGE, recordedAt: t2 });

      expect(store.getStats()).toEqual({
        store: 'sqlite',
        enabled: true,
        path: dbPath,
        retentionDays: 14,
        totalRows: 6,
        agents: {
          work: {
            provider: 'codex',
            rows: 6,
            snapshots: 2,
            metrics: 3,
            oldest: new Date(t1).toISOString(),
            newest: new Date(t2).toISOString(),
          },
        },
      });
    });
  });

  describe('clear and prune', () => {
    it('clears one agent or everything', () => {
      store.recordUsage({ agentId: 'a', provider: 'codex', usage: CODEX_USAGE });
      store.recordUsage({ agentId: 'b', provider: 'codex', usage: CODEX_USAGE });

      expect(store.clear('a')).toBe(3);
      expect(Object.keys(store.getStats().agents)).toEqual(['b']);
      expect(store.clear()).toBe(3);
      expect(store.getStats().totalRows).toBe(0);
    });

    it('prunes relative to the supplied time', () => {
      const now = Date.now();
      store.recordUsage({ agentId: 'a', provider: 'codex', usage: CODEX_USAGE, recordedAt: now });

      expect(store.prune(now + 13 * DAY_MS)).toBe(0);
      expect(store.prune(now + 15 * DAY_MS)).toBe(3);
    });
  });

  describe('close', () => {
    it('can be called repeatedly and reopens on next use', () => {
      store.recordUsage({ agentId: 'a', provider: 'codex', usage: CODEX_USAGE });
      store.close();
      store.close();

      expect(store.getStats().totalRows).toBe(3);
    });
  });

  it('degrades to a no-op with one warning when the database cannot be opened', () => {
    const blocker = path.join(testDir, 'file');
    fs.writeFileSync(blocker, '');
    const warn = jest.fn();
    const broken = createHistoryStore({ dbPath: path.join(blocker, 'history.db'), warn });

    expect(broken.recordUsage({ agentId: 'a', provider: 'codex', usage: CODEX_USAGE })).toBe(0);
    expect(broken.getSeries('a')).toEqual([]);
    expect(broken.store).toBe('none');
    expect(broken.getStats()).toMatchObject({ store: 'none', reason: 'error' });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
