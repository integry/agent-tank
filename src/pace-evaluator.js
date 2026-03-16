/**
 * Pace Evaluator Module
 *
 * Calculates whether usage is out-pacing the time window.
 * Warns users if they are burning through rate limits faster than time is elapsing.
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
  formatPaceWarning
};
