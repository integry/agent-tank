/**
 * History Store Module
 *
 * Stores historical usage snapshots to a local JSON file for trend analysis
 * and pace evaluation. Automatically prunes records older than the configured
 * retention period.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Default configuration
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_HISTORY_DIR = path.join(os.homedir(), '.agent-tank');
const DEFAULT_HISTORY_FILE = 'history.json';

/**
 * HistoryStore manages persistent storage of usage snapshots.
 *
 * Usage snapshots are stored with timestamps and automatically pruned
 * based on the configured retention period.
 */
class HistoryStore {
  /**
   * Create a HistoryStore instance.
   *
   * @param {Object} options - Configuration options
   * @param {number} [options.retentionDays=14] - Number of days to retain history
   * @param {string} [options.historyDir] - Directory for history file (default: ~/.agent-tank)
   * @param {string} [options.historyFile] - History filename (default: history.json)
   */
  constructor(options = {}) {
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.historyDir = options.historyDir ?? DEFAULT_HISTORY_DIR;
    this.historyFile = options.historyFile ?? DEFAULT_HISTORY_FILE;
    this.historyPath = path.join(this.historyDir, this.historyFile);

    // In-memory cache of history data
    this._history = null;
    this._initialized = false;
  }

  /**
   * Ensure the history directory exists.
   * @private
   */
  _ensureDirectory() {
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
  }

  /**
   * Load history from disk into memory.
   * @private
   */
  _loadHistory() {
    if (this._initialized) {
      return this._history;
    }

    try {
      this._ensureDirectory();

      if (fs.existsSync(this.historyPath)) {
        const data = fs.readFileSync(this.historyPath, 'utf8');
        this._history = JSON.parse(data);

        // Validate structure
        if (!Array.isArray(this._history)) {
          console.warn('[HistoryStore] Invalid history format, resetting to empty array');
          this._history = [];
        }
      } else {
        this._history = [];
      }
    } catch (err) {
      console.error('[HistoryStore] Error loading history:', err.message);
      this._history = [];
    }

    this._initialized = true;
    return this._history;
  }

  /**
   * Save history from memory to disk.
   * @private
   */
  _saveHistory() {
    try {
      this._ensureDirectory();
      fs.writeFileSync(this.historyPath, JSON.stringify(this._history, null, 2));
    } catch (err) {
      console.error('[HistoryStore] Error saving history:', err.message);
    }
  }

  /**
   * Calculate the cutoff timestamp for pruning.
   * @private
   * @returns {number} Unix timestamp in milliseconds
   */
  _getCutoffTimestamp() {
    const now = Date.now();
    const retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;
    return now - retentionMs;
  }

  /**
   * Prune records older than the retention period.
   * @private
   */
  _pruneOldRecords() {
    const cutoff = this._getCutoffTimestamp();
    const originalLength = this._history.length;

    this._history = this._history.filter(record => {
      const recordTime = new Date(record.timestamp).getTime();
      return recordTime >= cutoff;
    });

    const prunedCount = originalLength - this._history.length;
    if (prunedCount > 0) {
      console.log(`[HistoryStore] Pruned ${prunedCount} old records (>${this.retentionDays} days)`);
    }
  }

  /**
   * Add a usage snapshot to history.
   *
   * @param {string} agentName - Name of the agent (e.g., 'claude', 'gemini', 'codex')
   * @param {Object} usageData - The usage data to store
   * @param {string} [timestamp] - ISO timestamp (defaults to current time)
   * @returns {Object} The stored record
   */
  addSnapshot(agentName, usageData, timestamp = null) {
    if (!agentName || typeof agentName !== 'string') {
      throw new Error('agentName is required and must be a string');
    }

    if (!usageData || typeof usageData !== 'object') {
      throw new Error('usageData is required and must be an object');
    }

    this._loadHistory();

    const record = {
      timestamp: timestamp || new Date().toISOString(),
      agent: agentName,
      usage: usageData
    };

    this._history.push(record);
    this._pruneOldRecords();
    this._saveHistory();

    return record;
  }

  /**
   * Get all history records, optionally filtered by agent.
   *
   * @param {string} [agentName] - Filter by agent name (optional)
   * @returns {Array} Array of history records
   */
  getHistory(agentName = null) {
    this._loadHistory();
    this._pruneOldRecords();

    if (agentName) {
      return this._history.filter(record => record.agent === agentName);
    }

    return [...this._history];
  }

  /**
   * Get the most recent snapshot for an agent.
   *
   * @param {string} agentName - Name of the agent
   * @returns {Object|null} The most recent record or null
   */
  getLatestSnapshot(agentName) {
    const agentHistory = this.getHistory(agentName);

    if (agentHistory.length === 0) {
      return null;
    }

    // Sort by timestamp descending and return the first
    return agentHistory.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )[0];
  }

  /**
   * Get snapshots within a specific time window.
   *
   * @param {string} agentName - Name of the agent
   * @param {number} windowSeconds - Time window in seconds from now
   * @returns {Array} Array of records within the window
   */
  getSnapshotsInWindow(agentName, windowSeconds) {
    const agentHistory = this.getHistory(agentName);
    const cutoff = Date.now() - (windowSeconds * 1000);

    return agentHistory.filter(record =>
      new Date(record.timestamp).getTime() >= cutoff
    ).sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  /**
   * Clear all history records.
   *
   * @param {string} [agentName] - Clear only records for this agent (optional)
   */
  clearHistory(agentName = null) {
    this._loadHistory();

    if (agentName) {
      this._history = this._history.filter(record => record.agent !== agentName);
    } else {
      this._history = [];
    }

    this._saveHistory();
  }

  /**
   * Get statistics about stored history.
   *
   * @returns {Object} Statistics object
   */
  getStats() {
    this._loadHistory();

    const stats = {
      totalRecords: this._history.length,
      retentionDays: this.retentionDays,
      historyPath: this.historyPath,
      agents: {}
    };

    for (const record of this._history) {
      if (!stats.agents[record.agent]) {
        stats.agents[record.agent] = {
          count: 0,
          oldest: null,
          newest: null
        };
      }

      const agentStats = stats.agents[record.agent];
      agentStats.count++;

      const recordTime = new Date(record.timestamp).getTime();
      if (!agentStats.oldest || recordTime < new Date(agentStats.oldest).getTime()) {
        agentStats.oldest = record.timestamp;
      }
      if (!agentStats.newest || recordTime > new Date(agentStats.newest).getTime()) {
        agentStats.newest = record.timestamp;
      }
    }

    return stats;
  }
}

module.exports = { HistoryStore, DEFAULT_RETENTION_DAYS };
