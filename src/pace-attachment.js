/**
 * Pace evaluation attachment utilities.
 *
 * Attaches pace evaluation data to agent usage metrics.
 */

const { evaluatePace } = require('./pace-evaluator.js');
const { CYCLE_DURATIONS } = require('./usage-formatters.js');

/**
 * Attach pace evaluation to a usage data object if it has required fields.
 * @param {Object} data - Usage data object with percentUsed and resetsInSeconds
 * @param {string} percentField - Field name for percent value
 * @param {string} cycle - Cycle type for duration lookup
 */
function attachPaceToData(data, percentField, cycle) {
  if (!data) return;
  const percent = data[percentField];
  if (typeof percent !== 'number' || typeof data.resetsInSeconds !== 'number') return;

  const paceEval = evaluatePace({
    usagePercent: percent,
    resetsInSeconds: data.resetsInSeconds,
    cycleDurationSeconds: CYCLE_DURATIONS[cycle]
  });
  if (paceEval) {
    data.paceEval = paceEval;
  }
}

/**
 * Attach pace evaluation to Claude usage metrics.
 * @param {Object} usage - Claude usage data
 */
function attachClaudePace(usage) {
  const sections = [
    { data: usage.session, cycle: 'session' },
    { data: usage.weeklyAll, cycle: 'weekly' },
    { data: usage.weeklySonnet, cycle: 'weekly' },
    { data: usage.weekly, cycle: 'weekly' },
    { data: usage.extraUsage, cycle: 'weekly' }
  ];

  for (const { data, cycle } of sections) {
    attachPaceToData(data, 'percent', cycle);
  }
}

/**
 * Attach pace evaluation to Gemini usage metrics.
 * @param {Object} usage - Gemini usage data
 */
function attachGeminiPace(usage) {
  if (!usage.models || !Array.isArray(usage.models)) return;

  for (const model of usage.models) {
    attachPaceToData(model, 'percentUsed', 'sessionGemini');
  }
}

/**
 * Attach pace evaluation to Codex usage metrics.
 * @param {Object} usage - Codex usage data
 */
function attachCodexPace(usage) {
  // Main limits
  attachPaceToData(usage.fiveHour, 'percentUsed', 'fiveHour');
  attachPaceToData(usage.weekly, 'percentUsed', 'weekly');

  // Per-model limits
  if (usage.modelLimits && Array.isArray(usage.modelLimits)) {
    for (const ml of usage.modelLimits) {
      attachPaceToData(ml.fiveHour, 'percentUsed', 'fiveHour');
      attachPaceToData(ml.weekly, 'percentUsed', 'weekly');
    }
  }
}

/**
 * Attach pace evaluation data to usage metrics based on agent type.
 * @param {string} agentName - Name of the agent
 * @param {Object} usage - Usage data object
 */
function attachPaceEvaluation(agentName, usage) {
  switch (agentName) {
    case 'claude':
      attachClaudePace(usage);
      break;
    case 'gemini':
      attachGeminiPace(usage);
      break;
    case 'codex':
      attachCodexPace(usage);
      break;
  }
}

module.exports = {
  attachPaceEvaluation,
  attachClaudePace,
  attachGeminiPace,
  attachCodexPace,
  attachPaceToData
};
