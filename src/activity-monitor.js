/**
 * ActivityMonitor - Monitors local log directories for LLM CLI activity
 *
 * Watches known log directories for Claude, Codex, and Gemini using fs.watch.
 * When activity is detected (new log entries), it triggers usage refresh callbacks
 * with configurable debouncing to prevent excessive polling.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * Default log directories for each agent.
 * These are the typical locations where CLI tools store their logs/session data.
 */
const DEFAULT_LOG_DIRECTORIES = {
  claude: [
    path.join(os.homedir(), '.config', 'claude', 'projects'),
    path.join(os.homedir(), '.claude'),
  ],
  codex: [
    path.join(os.homedir(), '.codex', 'sessions'),
    path.join(os.homedir(), '.codex'),
  ],
  gemini: [
    path.join(os.homedir(), '.config', 'gemini'),
    path.join(os.homedir(), '.gemini'),
  ],
};

function normalizeFilename(filename) {
  return String(filename || '').replace(/\\/g, '/');
}

function isIgnoredActivityFile(filename) {
  const normalized = normalizeFilename(filename);
  if (!normalized) return false;

  return normalized.endsWith('.lock') ||
    normalized.includes('/.git/') ||
    normalized.startsWith('.git/') ||
    normalized.startsWith('plugins/marketplaces/') ||
    normalized.includes('/plugins/marketplaces/') ||
    normalized === 'plugins/known_marketplaces.json' ||
    normalized.endsWith('/plugins/known_marketplaces.json');
}

class ActivityMonitor {
  /**
   * Create an ActivityMonitor instance.
   *
   * @param {Object} options - Configuration options
   * @param {number} [options.debounceInterval=5000] - Debounce interval in milliseconds (default: 5 seconds)
   * @param {Function} [options.onActivity] - Callback function when activity is detected
   * @param {Object} [options.logDirectories] - Custom log directories per agent (overrides defaults)
   * @param {string[]} [options.agents] - List of agents to monitor (default: all known agents)
   */
  constructor(options = {}) {
    this.debounceInterval = options.debounceInterval ?? 5000; // Default: 5 seconds
    this.onActivity = options.onActivity || (() => {});
    this.logDirectories = options.logDirectories || DEFAULT_LOG_DIRECTORIES;
    this.agents = options.agents || Object.keys(DEFAULT_LOG_DIRECTORIES);

    this.watchers = new Map(); // Map<agentName, FSWatcher[]>
    this.debounceTimers = new Map(); // Map<agentName, timeoutId>
    this.lastActivityAt = new Map(); // Map<agentName, ISO timestamp>
    this.suppressedUntil = new Map(); // Map<agentName, unix timestamp in ms>
    this.isMonitoring = false;
    this.activityCount = 0; // Total activity events detected
  }

  /**
   * Start monitoring log directories for activity.
   * Sets up fs.watch on each agent's log directories.
   *
   * @returns {Object} Status object with monitoring details
   */
  start() {
    if (this.isMonitoring) {
      console.log('[ActivityMonitor] Already monitoring');
      return this.getStatus();
    }

    const monitoredDirs = [];
    const missingDirs = [];

    for (const agent of this.agents) {
      const dirs = this.logDirectories[agent] || DEFAULT_LOG_DIRECTORIES[agent] || [];
      const agentWatchers = [];

      for (const dir of dirs) {
        if (fs.existsSync(dir)) {
          try {
            const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
              this._handleFileChange(agent, eventType, filename);
            });

            watcher.on('error', (err) => {
              console.error(`[ActivityMonitor] Watcher error for ${agent} (${dir}): ${err.message}`);
            });

            agentWatchers.push(watcher);
            monitoredDirs.push({ agent, dir });
            console.log(`[ActivityMonitor] Watching ${agent}: ${dir}`);
          } catch (err) {
            console.error(`[ActivityMonitor] Failed to watch ${dir}: ${err.message}`);
          }
        } else {
          missingDirs.push({ agent, dir });
        }
      }

      if (agentWatchers.length > 0) {
        this.watchers.set(agent, agentWatchers);
      }
    }

    this.isMonitoring = true;

    if (missingDirs.length > 0) {
      console.log(`[ActivityMonitor] Some directories not found: ${missingDirs.map(d => d.dir).join(', ')}`);
    }

    console.log(`[ActivityMonitor] Started monitoring ${monitoredDirs.length} directories for ${this.watchers.size} agent(s)`);

    return {
      isMonitoring: this.isMonitoring,
      monitoredDirs,
      missingDirs,
      agentCount: this.watchers.size,
    };
  }

  /**
   * Stop monitoring all directories.
   */
  stop() {
    for (const [agent, agentWatchers] of this.watchers) {
      for (const watcher of agentWatchers) {
        try {
          watcher.close();
        } catch (err) {
          console.error(`[ActivityMonitor] Error closing watcher for ${agent}: ${err.message}`);
        }
      }
    }
    this.watchers.clear();

    // Clear any pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.isMonitoring = false;
    console.log('[ActivityMonitor] Stopped');
  }

  /**
   * Handle a file change event from fs.watch.
   * Debounces activity detection per agent.
   *
   * @param {string} agent - Agent name
   * @param {string} eventType - Event type ('rename' or 'change')
   * @param {string} filename - Changed filename
   * @private
   */
  _handleFileChange(agent, eventType, filename) {
    if (isIgnoredActivityFile(filename) || this._isSuppressed(agent)) {
      return;
    }

    // Clear existing debounce timer for this agent
    if (this.debounceTimers.has(agent)) {
      clearTimeout(this.debounceTimers.get(agent));
    }

    // Set up new debounce timer
    const timer = setTimeout(() => {
      this._triggerActivity(agent, eventType, filename);
      this.debounceTimers.delete(agent);
    }, this.debounceInterval);

    this.debounceTimers.set(agent, timer);
  }

  _isSuppressed(agent) {
    const suppressedUntil = this.suppressedUntil.get(agent);
    if (!suppressedUntil) {
      return false;
    }

    if (Date.now() >= suppressedUntil) {
      this.suppressedUntil.delete(agent);
      return false;
    }

    return true;
  }

  suppressAgent(agent, durationMs) {
    this.suppressedUntil.set(agent, Date.now() + durationMs);
  }

  suppressAll(durationMs) {
    for (const agent of this.agents) {
      this.suppressAgent(agent, durationMs);
    }
  }

  /**
   * Trigger the activity callback after debounce period.
   *
   * @param {string} agent - Agent name
   * @param {string} eventType - Event type that triggered this
   * @param {string} filename - Changed filename
   * @private
   */
  _triggerActivity(agent, eventType, filename) {
    const now = new Date().toISOString();
    this.lastActivityAt.set(agent, now);
    this.activityCount++;

    console.log(`[ActivityMonitor] Activity detected for ${agent}: ${eventType} ${filename || '(unknown file)'}`);

    try {
      this.onActivity({
        agent,
        eventType,
        filename,
        timestamp: now,
        activityCount: this.activityCount,
      });
    } catch (err) {
      console.error(`[ActivityMonitor] Error in onActivity callback: ${err.message}`);
    }
  }

  /**
   * Check if there is pending activity (debounce timer active).
   *
   * @param {string} [agent] - Optional agent name to check (checks all if not specified)
   * @returns {boolean} True if there is pending activity
   */
  hasPendingActivity(agent = null) {
    if (agent) {
      return this.debounceTimers.has(agent);
    }
    return this.debounceTimers.size > 0;
  }

  /**
   * Get the time since last activity for an agent.
   *
   * @param {string} agent - Agent name
   * @returns {number|null} Milliseconds since last activity, or null if never active
   */
  getTimeSinceActivity(agent) {
    const lastActivity = this.lastActivityAt.get(agent);
    if (!lastActivity) {
      return null;
    }
    return Date.now() - new Date(lastActivity).getTime();
  }

  /**
   * Set the debounce interval dynamically.
   *
   * @param {number} interval - Debounce interval in milliseconds
   */
  setDebounceInterval(interval) {
    this.debounceInterval = interval;
    console.log(`[ActivityMonitor] Debounce interval set to ${interval}ms`);
  }

  /**
   * Get the current status of the activity monitor.
   *
   * @returns {Object} Status information
   */
  getStatus() {
    const monitoredAgents = Array.from(this.watchers.keys());
    const lastActivityByAgent = {};
    for (const [agent, timestamp] of this.lastActivityAt) {
      lastActivityByAgent[agent] = timestamp;
    }

    return {
      isMonitoring: this.isMonitoring,
      debounceInterval: this.debounceInterval,
      monitoredAgents,
      agentCount: monitoredAgents.length,
      activityCount: this.activityCount,
      lastActivityAt: lastActivityByAgent,
      hasPendingActivity: this.hasPendingActivity(),
      pendingAgents: Array.from(this.debounceTimers.keys()),
    };
  }

  /**
   * Manually trigger an activity check for an agent.
   * Useful for testing or forcing a refresh.
   *
   * @param {string} agent - Agent name
   */
  triggerManual(agent) {
    this._triggerActivity(agent, 'manual', 'manual-trigger');
  }
}

module.exports = { ActivityMonitor, DEFAULT_LOG_DIRECTORIES };
