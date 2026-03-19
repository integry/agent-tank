const { calculatePace } = require('../pace-evaluator.js');
const { CYCLE_DURATIONS } = require('../usage-formatters.js');

/**
 * Format RPC response as if it were PTY output for parseOutput compatibility
 * Or directly parse and store the usage data
 * @param {Object} rateLimits - The rate limits from RPC
 * @returns {string} - Formatted string for parseOutput
 * @throws {Error} - If the response structure is unexpected
 */
function formatRpcResponseAsOutput(rateLimits) {
  if (!rateLimits) {
    throw new Error('Empty rate limits response');
  }

  // Check if we got a structured response we can use directly
  if (rateLimits.fiveHour || rateLimits.weekly || rateLimits.limits) {
    return { marker: '__RPC_RESPONSE__', data: rateLimits };
  }

  // Handle different response formats
  if (rateLimits.rateLimits) {
    return { marker: '__RPC_RESPONSE__', data: rateLimits.rateLimits };
  }

  // If structure is unknown, throw to fall back to PTY
  throw new Error('Unexpected rate limits response structure');
}

/**
 * Parse usage data from JSON-RPC response
 * @param {Object} rateLimits - Rate limits from RPC
 * @param {Object} context - Context object with metadata and version info
 * @returns {Object} - Parsed usage object
 */
function parseRpcRateLimits(rateLimits, context = {}) {
  const usage = {
    fiveHour: null,
    weekly: null,
    version: context.versionInfo || null,
  };

  // Parse five hour limit
  if (rateLimits.fiveHour) {
    usage.fiveHour = parseRpcLimitEntry(rateLimits.fiveHour, '5h limit', 'fiveHour', context);
  }

  // Parse weekly limit
  if (rateLimits.weekly) {
    usage.weekly = parseRpcLimitEntry(rateLimits.weekly, 'Weekly limit', 'weekly', context);
  }

  // Parse model-specific limits if present
  if (rateLimits.modelLimits && Array.isArray(rateLimits.modelLimits)) {
    usage.modelLimits = rateLimits.modelLimits.map(ml => ({
      name: ml.name || ml.model,
      fiveHour: ml.fiveHour ? parseRpcLimitEntry(ml.fiveHour, '5h limit', 'fiveHour', context) : null,
      weekly: ml.weekly ? parseRpcLimitEntry(ml.weekly, 'Weekly limit', 'weekly', context) : null,
    })).filter(ml => ml.fiveHour || ml.weekly);

    if (usage.modelLimits.length === 0) {
      delete usage.modelLimits;
    }
  }

  // Extract model and account
  if (rateLimits.model) {
    usage.model = rateLimits.model;
  }
  if (rateLimits.account || rateLimits.email) {
    usage.account = rateLimits.account || rateLimits.email;
  }

  // Build metadata updates
  const metadataUpdates = {};
  if (rateLimits.model) {
    metadataUpdates.model = rateLimits.model;
  }
  if (rateLimits.account || rateLimits.email) {
    metadataUpdates.email = rateLimits.account || rateLimits.email;
  }
  if (rateLimits.sessionId) {
    metadataUpdates.sessionId = rateLimits.sessionId;
  }

  return { usage, metadataUpdates };
}

/**
 * Parse a single limit entry from RPC response
 * @param {Object} limit - Limit data from RPC
 * @param {string} label - Label for the limit
 * @param {string} cycleType - Cycle type for pace calculation
 * @param {Object} context - Context with parseResetTime function
 * @returns {Object} - Parsed limit entry
 */
function parseRpcLimitEntry(limit, label, cycleType, context = {}) {
  // Handle different possible structures
  const percentLeft = limit.percentLeft ?? limit.remaining ?? limit.percent ?? 100;
  const percentUsed = 100 - percentLeft;

  // Handle reset time
  let resetsAt = limit.resetsAt || limit.resetAt || limit.reset || null;
  let resetsInSeconds = limit.resetsInSeconds || limit.secondsUntilReset || null;
  let resetsIn = null;

  // If we have seconds, calculate text
  if (resetsInSeconds !== null) {
    resetsIn = formatDuration(resetsInSeconds);
  } else if (resetsAt && context.parseResetTime) {
    // Try to parse the reset time
    const resetData = context.parseResetTime(resetsAt);
    if (resetData) {
      resetsIn = resetData.text;
      resetsInSeconds = resetData.seconds;
    }
  }

  const entry = {
    percentLeft,
    resetsAt,
    label,
    percentUsed,
    resetsIn,
    resetsInSeconds,
  };

  // Calculate pace if we have the necessary data
  const cycleDuration = CYCLE_DURATIONS[cycleType];
  if (cycleDuration && resetsInSeconds != null) {
    const paceData = calculatePace({
      usagePercent: percentUsed,
      resetsInSeconds,
      cycleDurationSeconds: cycleDuration,
    });
    if (paceData) entry.pace = paceData;
  }

  return entry;
}

/**
 * Format seconds as duration string
 * @param {number} seconds - Seconds to format
 * @returns {string} - Formatted duration
 */
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  } else if (hours > 0) {
    return `${hours}h ${mins}m`;
  } else {
    return `${mins}m`;
  }
}

module.exports = {
  formatRpcResponseAsOutput,
  parseRpcRateLimits,
  parseRpcLimitEntry,
  formatDuration,
};
