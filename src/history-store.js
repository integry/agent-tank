/**
 * History Store Module
 *
 * Persists usage history in SQLite (Node's built-in `node:sqlite`) as one row
 * per metric per refresh, so a series is a single indexed SELECT with no
 * parsing or provider branching at read time.
 *
 * `node:sqlite` requires Node.js 22.5+. On older runtimes (or when history is
 * disabled) `createHistoryStore` returns a no-op store that reports
 * `store: "none"`, so recording never throws.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const logger = require('./logger.js');
const { extractUsageMetrics } = require('./snapshot-metrics.js');

const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_HISTORY_DB = path.join(os.homedir(), '.agent-tank', 'history.db');
const DAY_MS = 24 * 60 * 60 * 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_metrics (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id       TEXT    NOT NULL,
  provider       TEXT    NOT NULL,
  metric_key     TEXT    NOT NULL,
  metric_label   TEXT    NOT NULL,
  model          TEXT,
  cycle          TEXT,
  percent_used   REAL,
  value          REAL,
  unit           TEXT    NOT NULL,
  recorded_at    TEXT    NOT NULL,
  recorded_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_metrics_agent_time ON usage_metrics (agent_id, recorded_at_ms);
CREATE INDEX IF NOT EXISTS idx_usage_metrics_series ON usage_metrics (agent_id, metric_key, recorded_at_ms);
`;

const SERIES_COLUMNS = 'metric_key, metric_label, model, cycle, unit, percent_used, value, recorded_at';
const SQL = {
  insert: `INSERT INTO usage_metrics
    (agent_id, provider, metric_key, metric_label, model, cycle, percent_used, value, unit, recorded_at, recorded_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  prune: 'DELETE FROM usage_metrics WHERE recorded_at_ms < ?',
  series: `SELECT ${SERIES_COLUMNS} FROM usage_metrics
    WHERE agent_id = ? AND recorded_at_ms >= ? AND recorded_at_ms <= ?
    ORDER BY metric_key, recorded_at_ms, id`,
  seriesByKey: `SELECT ${SERIES_COLUMNS} FROM usage_metrics
    WHERE agent_id = ? AND metric_key = ? AND recorded_at_ms >= ? AND recorded_at_ms <= ?
    ORDER BY recorded_at_ms, id`,
  latest: `SELECT provider, ${SERIES_COLUMNS} FROM usage_metrics
    WHERE agent_id = ? AND recorded_at_ms = (SELECT MAX(recorded_at_ms) FROM usage_metrics WHERE agent_id = ?)
    ORDER BY id`,
  stats: `SELECT agent_id, MAX(provider) AS provider, COUNT(*) AS rows,
      COUNT(DISTINCT recorded_at_ms) AS snapshots, COUNT(DISTINCT metric_key) AS metrics,
      MIN(recorded_at_ms) AS oldest, MAX(recorded_at_ms) AS newest
    FROM usage_metrics GROUP BY agent_id ORDER BY agent_id`,
  clearAll: 'DELETE FROM usage_metrics',
  clearAgent: 'DELETE FROM usage_metrics WHERE agent_id = ?',
};

/** Normalise retention days; non-positive or invalid values fall back to the default. */
function normalizeRetentionDays(value) {
  const days = Number(value);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
}

/** Convert a Date, ISO string or epoch ms into epoch ms, or null. */
function toMs(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * No-op history store used when history is disabled or `node:sqlite` is
 * unavailable. Every method is safe to call and returns an empty result.
 */
class NullHistoryStore {
  /**
   * @param {Object} [options]
   * @param {number} [options.retentionDays=14]
   * @param {string} [options.reason='disabled'] - Why history is off ('disabled', 'unavailable', 'error')
   */
  constructor(options = {}) {
    this.store = 'none';
    this.enabled = false;
    this.dbPath = null;
    this.retentionDays = normalizeRetentionDays(options.retentionDays);
    this.reason = options.reason ?? 'disabled';
  }

  recordUsage() { return 0; }
  getSeries() { return []; }
  getLatest() { return null; }
  clear() { return 0; }
  prune() { return 0; }
  close() {}

  getStats() {
    return {
      store: 'none',
      enabled: false,
      reason: this.reason,
      path: null,
      retentionDays: this.retentionDays,
      totalRows: 0,
      agents: {},
    };
  }
}

/**
 * SQLite-backed history store. The database is opened lazily on first use,
 * so constructing the store never touches the file system.
 */
class SqliteHistoryStore {
  /**
   * @param {Object} options
   * @param {Function} options.DatabaseSync - `DatabaseSync` class from `node:sqlite`
   * @param {string} [options.dbPath] - Database file (default: ~/.agent-tank/history.db)
   * @param {number} [options.retentionDays=14] - Rows older than this are pruned on write
   * @param {Function} [options.warn] - Warning logger
   */
  constructor(options) {
    this.store = 'sqlite';
    this.enabled = true;
    this.dbPath = options.dbPath || DEFAULT_HISTORY_DB;
    this.retentionDays = normalizeRetentionDays(options.retentionDays);
    this._DatabaseSync = options.DatabaseSync;
    this._warn = options.warn ?? ((...args) => logger.warn(...args));
    this._db = null;
    this._statements = null;
    this._failed = false;
  }

  /**
   * Open the database and prepare statements. On failure history degrades to
   * a no-op (with one warning) instead of throwing into the refresh path.
   * @private
   * @returns {boolean} Whether the database is usable
   */
  _open() {
    if (this._db) return true;
    if (this._failed) return false;
    try {
      if (this.dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      }
      const db = new this._DatabaseSync(this.dbPath);
      try {
        db.exec('PRAGMA journal_mode = WAL');
        db.exec(SCHEMA);
        this._statements = Object.fromEntries(
          Object.entries(SQL).map(([name, sql]) => [name, db.prepare(sql)])
        );
      } catch (err) {
        db.close();
        throw err;
      }
      this._db = db;
      return true;
    } catch (err) {
      this._failed = true;
      this.store = 'none';
      this.enabled = false;
      this._warn(`History disabled: cannot open ${this.dbPath}: ${err.message}`);
      return false;
    }
  }

  /** Cutoff (epoch ms) below which rows are pruned. @private */
  _cutoffMs(nowMs = Date.now()) {
    return nowMs - this.retentionDays * DAY_MS;
  }

  /**
   * Record one refresh as one row per metric, then prune expired rows.
   *
   * @param {Object} entry
   * @param {string} entry.agentId - Configured agent id (e.g. 'claude', 'work')
   * @param {string} entry.provider - Internal provider key ('claude', 'agy', 'codex')
   * @param {Object} [entry.usage] - Raw usage; flattened with extractUsageMetrics
   * @param {Object[]} [entry.metrics] - Pre-extracted metric rows (overrides `usage`)
   * @param {Date|string|number} [entry.recordedAt=now] - Capture time
   * @returns {number} Number of metric rows inserted
   */
  recordUsage({ agentId, provider, usage, metrics, recordedAt } = {}) {
    if (!agentId || typeof agentId !== 'string') {
      throw new Error('agentId is required and must be a string');
    }
    if (!provider || typeof provider !== 'string') {
      throw new Error('provider is required and must be a string');
    }
    const rows = metrics ?? extractUsageMetrics(provider, usage);
    if (rows.length === 0 || !this._open()) return 0;

    const recordedAtMs = toMs(recordedAt) ?? Date.now();
    const recordedAtIso = new Date(recordedAtMs).toISOString();
    const { insert, prune } = this._statements;
    let inserted = 0;

    this._db.exec('BEGIN');
    try {
      for (const metric of rows) {
        insert.run(
          agentId, provider, metric.key, metric.label || metric.key,
          metric.model ?? null, metric.cycle ?? null,
          finiteOrNull(metric.percentUsed), finiteOrNull(metric.value),
          metric.unit || 'percent', recordedAtIso, recordedAtMs
        );
        inserted++;
      }
      prune.run(this._cutoffMs());
      this._db.exec('COMMIT');
    } catch (err) {
      this._db.exec('ROLLBACK');
      throw err;
    }
    return inserted;
  }

  /**
   * Get every metric series for an agent, filtered and ordered in SQL.
   *
   * @param {string} agentId
   * @param {Object} [options]
   * @param {Date|string|number} [options.since] - Inclusive lower bound
   * @param {Date|string|number} [options.until] - Inclusive upper bound
   * @param {string} [options.key] - Only return this metric key
   * @returns {Array<{key, label, model, cycle, unit, points: Array<{t, percent, value}>}>}
   */
  getSeries(agentId, options = {}) {
    if (!this._open()) return [];
    const since = toMs(options.since) ?? 0;
    const until = toMs(options.until) ?? Number.MAX_SAFE_INTEGER;
    const rows = options.key
      ? this._statements.seriesByKey.all(agentId, options.key, since, until)
      : this._statements.series.all(agentId, since, until);

    const series = [];
    let current = null;
    for (const row of rows) {
      if (!current || current.key !== row.metric_key) {
        current = { key: row.metric_key, label: null, model: null, cycle: null, unit: null, points: [] };
        series.push(current);
      }
      // Rows are time-ordered, so the descriptive fields end up as the latest.
      current.label = row.metric_label;
      current.model = row.model;
      current.cycle = row.cycle;
      current.unit = row.unit;
      current.points.push({ t: row.recorded_at, percent: row.percent_used, value: row.value });
    }
    return series;
  }

  /**
   * Get the metrics recorded by the most recent refresh of an agent.
   * @param {string} agentId
   * @returns {{agentId, provider, recordedAt, metrics: Object[]}|null}
   */
  getLatest(agentId) {
    if (!this._open()) return null;
    const rows = this._statements.latest.all(agentId, agentId);
    if (rows.length === 0) return null;
    return {
      agentId,
      provider: rows[0].provider,
      recordedAt: rows[0].recorded_at,
      metrics: rows.map(row => ({
        key: row.metric_key,
        label: row.metric_label,
        model: row.model,
        cycle: row.cycle,
        percentUsed: row.percent_used,
        value: row.value,
        unit: row.unit,
      })),
    };
  }

  /**
   * Summarise stored history per agent.
   * @returns {Object} `{ store, enabled, path, retentionDays, totalRows, agents }`
   */
  getStats() {
    if (!this._open()) {
      return new NullHistoryStore({ retentionDays: this.retentionDays, reason: 'error' }).getStats();
    }
    const agents = {};
    let totalRows = 0;
    for (const row of this._statements.stats.all()) {
      totalRows += row.rows;
      agents[row.agent_id] = {
        provider: row.provider,
        rows: row.rows,
        snapshots: row.snapshots,
        metrics: row.metrics,
        oldest: new Date(row.oldest).toISOString(),
        newest: new Date(row.newest).toISOString(),
      };
    }
    return {
      store: 'sqlite',
      enabled: true,
      path: this.dbPath,
      retentionDays: this.retentionDays,
      totalRows,
      agents,
    };
  }

  /**
   * Delete stored rows.
   * @param {string} [agentId] - Only clear this agent's rows
   * @returns {number} Rows deleted
   */
  clear(agentId = null) {
    if (!this._open()) return 0;
    const result = agentId
      ? this._statements.clearAgent.run(agentId)
      : this._statements.clearAll.run();
    return Number(result.changes);
  }

  /**
   * Delete rows older than the retention period.
   * @param {Date|string|number} [now=Date.now()]
   * @returns {number} Rows deleted
   */
  prune(now = Date.now()) {
    if (!this._open()) return 0;
    return Number(this._statements.prune.run(this._cutoffMs(toMs(now) ?? Date.now())).changes);
  }

  /** Close the database. Safe to call more than once. */
  close() {
    if (!this._db) return;
    try {
      this._db.close();
    } finally {
      this._db = null;
      this._statements = null;
    }
  }
}

function loadNodeSqlite() {
  return require('node:sqlite');
}

/**
 * Create the history store for the current runtime.
 *
 * @param {Object} [options]
 * @param {boolean} [options.enabled=true] - False returns a no-op store
 * @param {string} [options.dbPath] - Database file (default: ~/.agent-tank/history.db)
 * @param {number} [options.retentionDays=14]
 * @param {Function} [options.loadSqlite] - Loader for `node:sqlite` (injectable for tests)
 * @param {Function} [options.warn] - Warning logger
 * @returns {SqliteHistoryStore|NullHistoryStore}
 */
function createHistoryStore(options = {}) {
  const { enabled = true, dbPath, retentionDays, loadSqlite = loadNodeSqlite } = options;
  const warn = options.warn ?? ((...args) => logger.warn(...args));
  if (!enabled) {
    return new NullHistoryStore({ retentionDays, reason: 'disabled' });
  }
  let sqlite;
  try {
    sqlite = loadSqlite();
  } catch (err) {
    warn(`History disabled: node:sqlite is unavailable on Node.js ${process.version} (requires 22.5+): ${err.message}`);
    return new NullHistoryStore({ retentionDays, reason: 'unavailable' });
  }
  return new SqliteHistoryStore({ DatabaseSync: sqlite.DatabaseSync, dbPath, retentionDays, warn });
}

module.exports = {
  createHistoryStore,
  SqliteHistoryStore,
  NullHistoryStore,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_HISTORY_DB,
};
