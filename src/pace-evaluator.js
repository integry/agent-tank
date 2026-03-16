/**
 * Pace Evaluator Module
 *
 * Calculates whether usage is out-pacing the time window.
 * Warns users if they are burning through rate limits faster than time is elapsing.
 * Provides extrapolation of ETA until 100% usage is reached.
 */

/**
 * Calculate the pace of usage relative to time elapsed in a cycle.
 *
 * @param {Object} options - The pace calculation options
 * @param {number} options.usagePercent - Current usage percentage (0-100)
 * @param {number} options.resetsInSeconds - Seconds until the cycle resets
 * @param {number} options.cycleDurationSeconds - Total duration of the cycle in seconds
 * @param {number} [options.warningThreshold=1.2] - Pace ratio threshold to trigger warning (default: 20% faster than time)
 * @returns {Object|null} Pace data or null if calculation not possible
 *   - paceRatio: Usage rate vs time rate (>1 means out-pacing)
 *   - elapsedPercent: Percentage of time elapsed in the cycle
 *   - isWarning: Whether usage is significantly out-pacing time
 *   - warningMessage: Human-readable warning message (if warning triggered)
 */
function calculatePace(options) {
  const {
    usagePercent,
    resetsInSeconds,
    cycleDurationSeconds,
    warningThreshold = 1.2
  } = options;

  // Validate inputs
  if (
    typeof usagePercent !== 'number' ||
    typeof resetsInSeconds !== 'number' ||
    typeof cycleDurationSeconds !== 'number' ||
    cycleDurationSeconds <= 0
  ) {
    return null;
  }

  // Calculate elapsed time in the cycle
  const elapsedSeconds = cycleDurationSeconds - resetsInSeconds;

  // Handle edge case: no time elapsed yet
  if (elapsedSeconds <= 0) {
    return {
      paceRatio: usagePercent > 0 ? Infinity : 0,
      elapsedPercent: 0,
      isWarning: usagePercent > 0,
      warningMessage: usagePercent > 0 ? 'Usage started before time window opened' : null
    };
  }

  const elapsedPercent = (elapsedSeconds / cycleDurationSeconds) * 100;

  // Handle edge case: no usage
  if (usagePercent === 0) {
    return {
      paceRatio: 0,
      elapsedPercent,
      isWarning: false,
      warningMessage: null
    };
  }

  // Calculate pace ratio: usage rate vs time rate
  // paceRatio > 1 means using faster than time is passing
  // paceRatio = 2 means using at 2x the sustainable rate
  const paceRatio = usagePercent / elapsedPercent;

  // Determine if warning should be triggered
  const isWarning = paceRatio >= warningThreshold;

  // Generate warning message if applicable
  let warningMessage = null;
  if (isWarning) {
    const paceMultiplier = paceRatio.toFixed(1);
    warningMessage = `Using ${paceMultiplier}x faster than sustainable`;
  }

  return {
    paceRatio: Math.round(paceRatio * 100) / 100, // Round to 2 decimal places
    elapsedPercent: Math.round(elapsedPercent * 100) / 100,
    isWarning,
    warningMessage
  };
}

/**
 * Evaluate usage pace and extrapolate when user will hit 100%.
 *
 * This function calculates the expected linear usage based on elapsed time,
 * determines if the user is burning faster than expected, and if so,
 * extrapolates the ETA in seconds until they hit 100%.
 *
 * @param {Object} options - The evaluation options
 * @param {number} options.usagePercent - Current usage percentage (0-100)
 * @param {number} options.resetsInSeconds - Seconds until the cycle resets
 * @param {number} options.cycleDurationSeconds - Total duration of the cycle in seconds
 * @param {number} [options.warningThreshold=1.2] - Pace ratio threshold to trigger warning
 * @returns {Object|null} Pace evaluation result or null if calculation not possible
 *   - expectedPercent: Expected usage percentage based on linear pace
 *   - isBurningFast: Whether actual usage exceeds expected usage
 *   - etaSeconds: Seconds until 100% usage (only if isBurningFast is true, null otherwise)
 *   - paceRatio: Usage rate vs time rate (>1 means out-pacing)
 *   - elapsedPercent: Percentage of time elapsed in the cycle
 *   - deltaPercent: Difference between actual and expected usage (positive = ahead)
 */
function evaluatePace(options) {
  const {
    usagePercent,
    resetsInSeconds,
    cycleDurationSeconds,
    warningThreshold = 1.2
  } = options;

  // Validate inputs
  if (
    typeof usagePercent !== 'number' ||
    typeof resetsInSeconds !== 'number' ||
    typeof cycleDurationSeconds !== 'number' ||
    cycleDurationSeconds <= 0
  ) {
    return null;
  }

  // Calculate elapsed time in the cycle
  const elapsedSeconds = cycleDurationSeconds - resetsInSeconds;

  // Handle edge case: no time elapsed yet
  if (elapsedSeconds <= 0) {
    return {
      expectedPercent: 0,
      isBurningFast: usagePercent > 0,
      etaSeconds: usagePercent > 0 ? 0 : null, // Already burning if any usage at start
      paceRatio: usagePercent > 0 ? Infinity : 0,
      elapsedPercent: 0,
      deltaPercent: usagePercent
    };
  }

  // Calculate expected usage based on linear pace
  // If 50% of time has elapsed, expected usage should be 50%
  const elapsedPercent = (elapsedSeconds / cycleDurationSeconds) * 100;
  const expectedPercent = elapsedPercent;

  // Calculate delta (positive = ahead of pace, negative = behind)
  const deltaPercent = usagePercent - expectedPercent;

  // Determine if burning fast (usage exceeds expected by threshold)
  // Using threshold ratio: if usage/expected >= threshold, burning fast
  const paceRatio = usagePercent > 0 && elapsedPercent > 0
    ? usagePercent / elapsedPercent
    : (usagePercent > 0 ? Infinity : 0);

  const isBurningFast = paceRatio >= warningThreshold;

  // Calculate ETA to 100% if burning fast
  let etaSeconds = null;
  if (isBurningFast && usagePercent < 100 && usagePercent > 0) {
    // Current burn rate: usagePercent per elapsedSeconds
    const burnRatePerSecond = usagePercent / elapsedSeconds;

    // Remaining usage to reach 100%
    const remainingPercent = 100 - usagePercent;

    // Time to reach 100% at current burn rate
    etaSeconds = Math.round(remainingPercent / burnRatePerSecond);
  } else if (usagePercent >= 100) {
    etaSeconds = 0; // Already at or past 100%
  }

  return {
    expectedPercent: Math.round(expectedPercent * 100) / 100,
    isBurningFast,
    etaSeconds,
    paceRatio: paceRatio === Infinity ? Infinity : Math.round(paceRatio * 100) / 100,
    elapsedPercent: Math.round(elapsedPercent * 100) / 100,
    deltaPercent: Math.round(deltaPercent * 100) / 100
  };
}

/**
 * Format a pace warning as HTML for display in the UI.
 *
 * @param {Object|null} paceData - Result from calculatePace()
 * @returns {string} HTML string for the pace warning (empty string if no warning)
 */
function formatPaceWarning(paceData) {
  if (!paceData || !paceData.isWarning) {
    return '';
  }

  const paceDisplay = paceData.paceRatio.toFixed(1);
  // Add critical class for 2x or higher pace
  const criticalClass = paceData.paceRatio >= 2 ? ' pace-critical' : '';

  return `<div class="pace-warning${criticalClass}" title="${paceData.warningMessage}">
    <span class="pace-icon">&#9888;</span>
    <span class="pace-text">${paceDisplay}x pace</span>
  </div>`;
}

module.exports = {
  calculatePace,
  formatPaceWarning,
  evaluatePace
};
