/**
 * KeepaliveManager - Manages periodic session keepalive for registered agents
 *
 * Prevents session expiration by scheduling lightweight ping/keepalive operations
 * on registered agents at a configurable interval.
 */

class KeepaliveManager {
  /**
   * Create a KeepaliveManager instance.
   *
   * @param {Object} options - Configuration options
   * @param {number} [options.interval=300] - Keepalive interval in seconds (default: 5 minutes)
   * @param {boolean} [options.enabled=true] - Whether keepalive is enabled
   */
  constructor(options = {}) {
    this.interval = options.interval ?? 300; // Default: 5 minutes
    this.enabled = options.enabled !== false; // Default: true
    this.agents = new Map();
    this.timer = null;
    this.lastKeepaliveAt = null;
    this.isRunning = false;
  }

  /**
   * Register an agent with the keepalive manager.
   *
   * @param {string} name - Agent name
   * @param {Object} agent - Agent instance (must have a keepalive() method)
   */
  register(name, agent) {
    if (!agent) {
      console.warn(`[KeepaliveManager] Cannot register null agent: ${name}`);
      return;
    }

    if (typeof agent.keepalive !== 'function') {
      console.warn(`[KeepaliveManager] Agent ${name} does not implement keepalive() method`);
      return;
    }

    this.agents.set(name, agent);
    console.log(`[KeepaliveManager] Registered agent: ${name}`);
  }

  /**
   * Unregister an agent from the keepalive manager.
   *
   * @param {string} name - Agent name to unregister
   */
  unregister(name) {
    if (this.agents.has(name)) {
      this.agents.delete(name);
      console.log(`[KeepaliveManager] Unregistered agent: ${name}`);
    }
  }

  /**
   * Start the keepalive scheduler.
   * Runs keepalive immediately on start, then at the configured interval.
   */
  start() {
    if (this.isRunning) {
      console.log('[KeepaliveManager] Already running');
      return;
    }

    if (!this.enabled) {
      console.log('[KeepaliveManager] Keepalive disabled');
      return;
    }

    if (this.interval <= 0) {
      console.log('[KeepaliveManager] Keepalive interval is 0, disabled');
      return;
    }

    if (this.agents.size === 0) {
      console.log('[KeepaliveManager] No agents registered, not starting');
      return;
    }

    this.isRunning = true;
    const intervalMs = this.interval * 1000;

    console.log(`[KeepaliveManager] Starting with ${this.interval}s interval for ${this.agents.size} agent(s)`);

    // Start the periodic timer
    this.timer = setInterval(() => {
      this._runKeepalive();
    }, intervalMs);
  }

  /**
   * Stop the keepalive scheduler.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('[KeepaliveManager] Stopped');
  }

  /**
   * Run keepalive on all registered agents.
   * Errors in individual agents do not affect others.
   *
   * @returns {Promise<Object>} Results keyed by agent name
   */
  async _runKeepalive() {
    if (this.agents.size === 0) {
      return {};
    }

    console.log(`[KeepaliveManager] Running keepalive for ${this.agents.size} agent(s)...`);
    const results = {};

    const promises = Array.from(this.agents.entries()).map(async ([name, agent]) => {
      try {
        await agent.keepalive();
        results[name] = { success: true };
        console.log(`[KeepaliveManager] Keepalive successful: ${name}`);
      } catch (err) {
        // Log error but don't crash - keepalive errors should not affect the server
        results[name] = { success: false, error: err.message };
        console.error(`[KeepaliveManager] Keepalive failed for ${name}: ${err.message}`);
      }
    });

    await Promise.all(promises);
    this.lastKeepaliveAt = new Date().toISOString();

    return results;
  }

  /**
   * Manually trigger a keepalive run.
   *
   * @returns {Promise<Object>} Results keyed by agent name
   */
  async runNow() {
    return this._runKeepalive();
  }

  /**
   * Get the current status of the keepalive manager.
   *
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      enabled: this.enabled,
      interval: this.interval,
      isRunning: this.isRunning,
      registeredAgents: Array.from(this.agents.keys()),
      lastKeepaliveAt: this.lastKeepaliveAt,
    };
  }
}

module.exports = { KeepaliveManager };
