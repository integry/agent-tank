/**
 * Snapshot metrics extraction utilities.
 *
 * Extracts key metrics from agent usage data for snapshot storage.
 */

/**
 * Extract Claude metrics from usage data.
 * @param {Object} usage - Claude usage data
 * @returns {Object} Extracted metrics
 */
function extractClaudeMetrics(usage) {
  return {
    session: usage.session?.percent ?? null,
    weeklyAll: usage.weeklyAll?.percent ?? null,
    weeklySonnet: usage.weeklySonnet?.percent ?? null,
    weekly: usage.weekly?.percent ?? null,
    extraUsage: usage.extraUsage?.percent ?? null
  };
}

/**
 * Extract Gemini metrics from usage data.
 * @param {Object} usage - Gemini usage data
 * @returns {Object|null} Extracted metrics or null
 */
function extractGeminiMetrics(usage) {
  if (!usage.models || !Array.isArray(usage.models)) {
    return null;
  }
  const models = {};
  for (const model of usage.models) {
    models[model.model] = model.percentUsed ?? null;
  }
  return { models };
}

/**
 * Extract Codex metrics from usage data.
 * @param {Object} usage - Codex usage data
 * @returns {Object} Extracted metrics
 */
function extractCodexMetrics(usage) {
  return {
    fiveHour: usage.fiveHour?.percentUsed ?? null,
    weekly: usage.weekly?.percentUsed ?? null,
    modelLimits: usage.modelLimits?.map(ml => ({
      name: ml.name,
      fiveHour: ml.fiveHour?.percentUsed ?? null,
      weekly: ml.weekly?.percentUsed ?? null
    })) ?? null
  };
}

/**
 * Extract key metrics from usage data for snapshot storage.
 * @param {string} agentName - Name of the agent
 * @param {Object} usage - Usage data object
 * @returns {Object|null} Extracted metrics for storage
 */
function extractSnapshotMetrics(agentName, usage) {
  switch (agentName) {
    case 'claude':
      return extractClaudeMetrics(usage);
    case 'gemini':
      return extractGeminiMetrics(usage);
    case 'codex':
      return extractCodexMetrics(usage);
    default:
      return usage;
  }
}

module.exports = {
  extractSnapshotMetrics,
  extractClaudeMetrics,
  extractGeminiMetrics,
  extractCodexMetrics
};
