/**
 * API Response Parser for Claude Agent
 * Handles parsing of direct Anthropic API responses into the unified usage schema
 */

const { calculatePace } = require('../pace-evaluator.js');
const { CYCLE_DURATIONS } = require('../usage-formatters.js');

/**
 * Format duration from seconds to readable text
 * @param {number} diffSeconds - Duration in seconds
 * @returns {string} Formatted duration string
 */
function formatDuration(diffSeconds) {
  const mins = Math.floor(diffSeconds / 60);
  const hours = Math.floor(mins / 60);
  const m = mins % 60;
  if (hours > 24) {
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  }
  return hours > 0 ? `${hours}h ${m}m` : `${m}m`;
}

/**
 * Calculate reset time info from an ISO timestamp
 * @param {string|null} isoTimestamp - ISO format timestamp
 * @param {Date} now - Current date/time
 * @returns {Object} Reset time information
 */
function parseResetTimestamp(isoTimestamp, now) {
  if (!isoTimestamp) {
    return { resetsAt: null, resetsIn: null, resetsInSeconds: null };
  }
  const resetDate = new Date(isoTimestamp);
  const diffMs = resetDate - now;
  if (diffMs <= 0) {
    return { resetsAt: isoTimestamp, resetsIn: 'soon', resetsInSeconds: 0 };
  }
  const diffSeconds = Math.floor(diffMs / 1000);
  return {
    resetsAt: isoTimestamp,
    resetsIn: formatDuration(diffSeconds),
    resetsInSeconds: diffSeconds,
  };
}

/**
 * Add pace data to a usage section
 * @param {Object|null} sectionData - Usage section data
 * @param {string} cycleType - Type of cycle ('session' or 'weekly')
 * @returns {Object|null} Section data with pace info added
 */
function addPaceData(sectionData, cycleType) {
  if (!sectionData || sectionData.resetsInSeconds == null) return sectionData;
  const cycleDuration = CYCLE_DURATIONS[cycleType];
  if (!cycleDuration) return sectionData;
  const paceData = calculatePace({
    usagePercent: sectionData.percent ?? 0,
    resetsInSeconds: sectionData.resetsInSeconds,
    cycleDurationSeconds: cycleDuration,
  });
  if (paceData) sectionData.pace = paceData;
  return sectionData;
}

/**
 * Parse session limit from API response
 * @param {Object} apiResponse - Raw API response
 * @param {Date} now - Current date/time
 * @returns {Object|null} Parsed session data
 */
function parseSessionLimit(apiResponse, now) {
  if (!apiResponse.sessionLimit) return null;

  const sl = apiResponse.sessionLimit;
  const percent = sl.percentUsed ?? (sl.used && sl.limit ? Math.round((sl.used / sl.limit) * 100) : null);

  if (percent === null) return null;

  const resetInfo = parseResetTimestamp(sl.resetsAt, now);
  const session = { label: 'Current session', percent, ...resetInfo };
  return addPaceData(session, 'session');
}

/**
 * Parse weekly all models limit from API response
 * @param {Object} apiResponse - Raw API response
 * @param {Date} now - Current date/time
 * @returns {Object|null} Parsed weekly all models data
 */
function parseWeeklyAllModels(apiResponse, now) {
  const wl = apiResponse.weeklyAllModels || apiResponse.weeklyLimit;
  if (!wl) return null;

  const percent = wl.percentUsed ?? (wl.used && wl.limit ? Math.round((wl.used / wl.limit) * 100) : null);

  if (percent === null) return null;

  const resetInfo = parseResetTimestamp(wl.resetsAt, now);
  const weeklyAll = { label: 'Current week (all models)', percent, ...resetInfo };
  return addPaceData(weeklyAll, 'weekly');
}

/**
 * Parse weekly Sonnet only limit from API response
 * @param {Object} apiResponse - Raw API response
 * @param {Date} now - Current date/time
 * @returns {Object|null} Parsed weekly Sonnet data
 */
function parseWeeklySonnet(apiResponse, now) {
  const ws = apiResponse.weeklySonnet || apiResponse.weeklySonnetOnly;
  if (!ws) return null;

  const percent = ws.percentUsed ?? (ws.used && ws.limit ? Math.round((ws.used / ws.limit) * 100) : null);

  if (percent === null) return null;

  const resetInfo = parseResetTimestamp(ws.resetsAt, now);
  const weeklySonnet = { label: 'Current week (Sonnet only)', percent, ...resetInfo };
  return addPaceData(weeklySonnet, 'weekly');
}

/**
 * Parse extra usage from API response
 * @param {Object} apiResponse - Raw API response
 * @param {Date} now - Current date/time
 * @returns {Object|null} Parsed extra usage data
 */
function parseExtraUsage(apiResponse, now) {
  if (!apiResponse.extraUsage) return null;

  const eu = apiResponse.extraUsage;
  const percent = eu.percentUsed ?? (eu.spent && eu.budget ? Math.round((eu.spent / eu.budget) * 100) : null);
  const resetInfo = parseResetTimestamp(eu.resetsAt, now);

  const extraUsage = {
    label: 'Extra usage',
    percent,
    spent: eu.spent ?? null,
    budget: eu.budget ?? null,
    ...resetInfo,
  };
  return addPaceData(extraUsage, 'weekly');
}

/**
 * Parse flat percentage fields from API response
 * @param {Object} apiResponse - Raw API response
 * @param {Object} usage - Current usage object to augment
 * @param {Date} now - Current date/time
 * @returns {Object} Updated usage object
 */
function parseFlatPercentageFields(apiResponse, usage, now) {
  if (!usage.session && apiResponse.sessionPercent !== undefined) {
    const session = {
      label: 'Current session',
      percent: apiResponse.sessionPercent,
      ...parseResetTimestamp(apiResponse.sessionResetsAt, now),
    };
    usage.session = addPaceData(session, 'session');
  }

  if (!usage.weeklyAll && apiResponse.weeklyPercent !== undefined) {
    const weeklyAll = {
      label: 'Current week (all models)',
      percent: apiResponse.weeklyPercent,
      ...parseResetTimestamp(apiResponse.weeklyResetsAt, now),
    };
    usage.weeklyAll = addPaceData(weeklyAll, 'weekly');
  }

  return usage;
}

/**
 * Normalize the OAuth usage API response to the parser's expected schema.
 * The API returns: five_hour, seven_day, seven_day_sonnet, extra_usage
 * The parser expects: sessionLimit, weeklyAllModels, weeklySonnet, extraUsage
 * @param {Object} raw - Raw API response
 * @returns {Object} Normalized response
 */
function normalizeOAuthResponse(raw) {
  if (!raw.five_hour && !raw.seven_day) return raw; // already normalized or unknown
  const norm = {};
  if (raw.five_hour) {
    norm.sessionLimit = {
      percentUsed: Math.round(raw.five_hour.utilization),
      resetsAt: raw.five_hour.resets_at,
    };
  }
  if (raw.seven_day) {
    norm.weeklyAllModels = {
      percentUsed: Math.round(raw.seven_day.utilization),
      resetsAt: raw.seven_day.resets_at,
    };
  }
  if (raw.seven_day_sonnet) {
    norm.weeklySonnet = {
      percentUsed: Math.round(raw.seven_day_sonnet.utilization),
      resetsAt: raw.seven_day_sonnet.resets_at,
    };
  }
  if (raw.extra_usage?.is_enabled) {
    norm.extraUsage = {
      percentUsed: Math.round(raw.extra_usage.utilization),
      spent: raw.extra_usage.used_credits != null
        ? Math.round(raw.extra_usage.used_credits) / 100 : null,
      budget: raw.extra_usage.monthly_limit != null
        ? Math.round(raw.extra_usage.monthly_limit) / 100 : null,
      resetsAt: raw.seven_day?.resets_at || null,
    };
  }
  return norm;
}

/**
 * Parse the direct API response into the unified usage schema
 * @param {Object} apiResponse - The raw API response from Anthropic
 * @returns {Object} The parsed usage object matching the PTY format
 */
function parseApiResponse(apiResponse) {
  const usage = { session: null, weeklyAll: null, weeklySonnet: null };

  if (!apiResponse) return usage;

  // Handle nested usage object format
  if (apiResponse.usage) {
    return parseApiResponse(apiResponse.usage);
  }

  // Normalize OAuth API response format to parser schema
  const normalized = normalizeOAuthResponse(apiResponse);

  const now = new Date();

  // Parse each section
  usage.session = parseSessionLimit(normalized, now);
  usage.weeklyAll = parseWeeklyAllModels(normalized, now);
  usage.weeklySonnet = parseWeeklySonnet(normalized, now);

  const extraUsage = parseExtraUsage(normalized, now);
  if (extraUsage) {
    usage.extraUsage = extraUsage;
  }

  // Handle flat percentage fields as fallback
  return parseFlatPercentageFields(normalized, usage, now);
}

module.exports = {
  parseApiResponse,
  formatDuration,
  parseResetTimestamp,
  addPaceData,
};
