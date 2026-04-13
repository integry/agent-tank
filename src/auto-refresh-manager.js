const { ActivityMonitor } = require('./activity-monitor.js');

/**
 * Manages auto-refresh behavior for AgentTank.
 * Supports three modes: 'none', 'interval', and 'activity'.
 */
class AutoRefreshManager {
  /**
   * @param {Object} options
   * @param {Object} options.config - Auto-refresh configuration
   * @param {Map} options.agents - Map of agent instances
   * @param {Function} options.onRefreshAll - Callback to refresh all agents
   * @param {Function} options.onRefreshAgent - Callback to refresh a single agent
   */
  constructor(options) {
    this.config = options.config;
    this.agents = options.agents;
    this.onRefreshAll = options.onRefreshAll;
    this.onRefreshAgent = options.onRefreshAgent;

    this.autoRefreshTimer = null;
    this.agentRefreshTimers = new Map();
    this.lastRefreshedAt = null;

    // Activity monitor for activity-based polling
    this.activityMonitor = null;
    this.activityRefreshTimer = null;
    this.isActivityRefreshing = false;
  }

  /**
   * Start auto-refresh based on configured mode.
   */
  start() {
    this.stop();

    if (!this.config.enabled || this.config.mode === 'none') {
      console.log('Backend auto-refresh: disabled');
      return;
    }

    if (this.config.mode === 'activity') {
      this._startActivityBasedRefresh();
      return;
    }

    this._startIntervalBasedRefresh();
  }

  /**
   * Stop all auto-refresh timers and monitors.
   */
  stop() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
    for (const timer of this.agentRefreshTimers.values()) {
      clearInterval(timer);
    }
    this.agentRefreshTimers.clear();

    if (this.activityRefreshTimer) {
      clearTimeout(this.activityRefreshTimer);
      this.activityRefreshTimer = null;
    }
    if (this.activityMonitor) {
      this.activityMonitor.stop();
      this.activityMonitor = null;
    }
    this.isActivityRefreshing = false;
  }

  /**
   * Get the last refresh timestamp.
   * @returns {string|null}
   */
  getLastRefreshedAt() {
    return this.lastRefreshedAt;
  }

  /**
   * Update the last refresh timestamp.
   * @param {string} timestamp
   */
  setLastRefreshedAt(timestamp) {
    this.lastRefreshedAt = timestamp;
  }

  /**
   * Get activity monitor status.
   * @returns {Object}
   */
  getActivityMonitorStatus() {
    if (this.activityMonitor) {
      return {
        ...this.activityMonitor.getStatus(),
        isActivityRefreshing: this.isActivityRefreshing,
      };
    }
    return {
      isMonitoring: false,
      debounceInterval: this.config.activityDebounce,
      monitoredAgents: [],
      agentCount: 0,
      activityCount: 0,
      lastActivityAt: {},
      hasPendingActivity: false,
      pendingAgents: [],
      isActivityRefreshing: false,
    };
  }

  /**
   * Start activity-based auto-refresh.
   * @private
   */
  _startActivityBasedRefresh() {
    const agentNames = Array.from(this.agents.keys());
    const debounceMs = this.config.activityDebounce;
    const intervalSeconds = this.config.interval;

    console.log(`Backend auto-refresh: activity mode (debounce: ${debounceMs}ms, cycle interval: ${intervalSeconds}s)`);

    this.activityMonitor = new ActivityMonitor({
      debounceInterval: debounceMs,
      agents: agentNames,
      onActivity: (event) => {
        this._handleActivityDetected(event);
      },
    });

    const startResult = this.activityMonitor.start();

    if (startResult.agentCount === 0) {
      console.log('[ActivityMonitor] No log directories found to monitor, falling back to interval mode');
      this._startIntervalBasedRefresh();
      return;
    }

    // Ignore short-lived startup churn immediately after the initial fetch/boot.
    this.activityMonitor.suppressAll(Math.max(this.config.activityDebounce, 5000));

    console.log(`[ActivityMonitor] Monitoring ${startResult.monitoredDirs.length} directories`);
  }

  /**
   * Handle activity detection from the ActivityMonitor.
   * @param {Object} event - Activity event from ActivityMonitor
   * @private
   */
  _handleActivityDetected(event) {
    console.log(`[Activity] Detected for ${event.agent}, starting refresh cycle...`);

    if (this.isActivityRefreshing) {
      console.log('[Activity] Already in refresh cycle, activity will extend it');
      return;
    }

    this.isActivityRefreshing = true;
    this._runActivityRefreshCycle();
  }

  /**
   * Run a single iteration of the activity refresh cycle.
   * @private
   */
  async _runActivityRefreshCycle() {
    try {
      if (this.activityMonitor) {
        // Ignore short-lived filesystem churn caused by our own refresh commands.
        this.activityMonitor.suppressAll(Math.max(this.config.activityDebounce, 5000));
      }
      console.log('[Activity-refresh] Running refresh cycle...');
      await this.onRefreshAll();
      this.lastRefreshedAt = new Date().toISOString();
    } catch (err) {
      console.error('[Activity-refresh] Error during refresh:', err.message);
    }

    const hasPending = this.activityMonitor && this.activityMonitor.hasPendingActivity();

    if (hasPending) {
      const intervalMs = this.config.interval * 1000;
      console.log(`[Activity-refresh] More activity pending, scheduling next cycle in ${this.config.interval}s`);

      this.activityRefreshTimer = setTimeout(() => {
        this._runActivityRefreshCycle();
      }, intervalMs);
    } else {
      console.log('[Activity-refresh] No more pending activity, going idle');
      this.isActivityRefreshing = false;
      this.activityRefreshTimer = null;
    }
  }

  /**
   * Start interval-based auto-refresh (traditional polling).
   * @private
   */
  _startIntervalBasedRefresh() {
    const globalInterval = this.config.interval;

    if (globalInterval <= 0) {
      console.log('Backend auto-refresh: disabled (interval is 0)');
      return;
    }

    const globalAgents = [];
    for (const [name, agent] of this.agents) {
      const effective = agent.refreshInterval
        ?? (agent.minRefreshInterval ? Math.max(globalInterval, agent.minRefreshInterval) : null);
      if (effective && effective > globalInterval) {
        const intervalMs = effective * 1000;
        console.log(`Backend auto-refresh [${name}]: every ${effective}s`);
        const timer = setInterval(async () => {
          console.log(`[Auto-refresh] Refreshing ${name}...`);
          await this.onRefreshAgent(name).catch(err =>
            console.error(`Error refreshing ${name}:`, err.message)
          );
          this.lastRefreshedAt = new Date().toISOString();
        }, intervalMs);
        this.agentRefreshTimers.set(name, timer);
      } else {
        globalAgents.push(name);
      }
    }

    if (globalAgents.length > 0) {
      console.log(`Backend auto-refresh [${globalAgents.join(', ')}]: every ${globalInterval}s (interval mode)`);
      this.autoRefreshTimer = setInterval(async () => {
        console.log(`[Auto-refresh] Refreshing ${globalAgents.join(', ')}...`);
        const promises = globalAgents.map(name =>
          this.onRefreshAgent(name).catch(err =>
            console.error(`Error refreshing ${name}:`, err.message)
          )
        );
        await Promise.all(promises);
        this.lastRefreshedAt = new Date().toISOString();
      }, globalInterval * 1000);
    }
  }
}

module.exports = { AutoRefreshManager };
