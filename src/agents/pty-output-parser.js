/**
 * PTY Output Parser for Claude Agent
 * Handles parsing of PTY terminal output from the Claude CLI /usage command
 */

const { calculatePace } = require('../pace-evaluator.js');
const { CYCLE_DURATIONS } = require('../usage-formatters.js');

/**
 * Convert 12-hour time to 24-hour
 * @param {string} hourRaw - Hour value as string
 * @param {string} ampm - 'am' or 'pm'
 * @returns {number} Hour in 24-hour format
 */
function to24Hour(hourRaw, ampm) {
  let hour = parseInt(hourRaw);
  if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
  return hour;
}

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
 * Parse date with time: "Jan 22, 1pm" or date-only: "Apr 1"
 * @param {string} cleanStr - Cleaned date string
 * @param {Date} now - Current date/time
 * @param {string[]} monthNames - Array of month name abbreviations
 * @returns {Date|null} Parsed date or null
 */
function parseDateTimeStr(cleanStr, now, monthNames) {
  const dateTimeMatch = cleanStr.match(/(\w+)\s+(\d{1,2}),?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  const dateOnlyMatch = !dateTimeMatch && cleanStr.match(/(\w+)\s+(\d{1,2})$/i);
  if (!dateTimeMatch && !dateOnlyMatch) return null;

  let resetDate;
  if (dateTimeMatch) {
    const [, month, day, hourRaw, minutes = '0', ampm] = dateTimeMatch;
    const monthIndex = monthNames.indexOf(month.toLowerCase().substring(0, 3));
    if (monthIndex === -1) return null;
    resetDate = new Date(now.getFullYear(), monthIndex, parseInt(day), to24Hour(hourRaw, ampm), parseInt(minutes));
  } else {
    const [, month, day] = dateOnlyMatch;
    const monthIndex = monthNames.indexOf(month.toLowerCase().substring(0, 3));
    if (monthIndex === -1) return null;
    resetDate = new Date(now.getFullYear(), monthIndex, parseInt(day));
  }
  if (resetDate < now) resetDate.setFullYear(resetDate.getFullYear() + 1);
  return resetDate;
}

/**
 * Convert reset timestamp to duration object with string and seconds
 * @param {string} resetStr - Reset time string from PTY output
 * @returns {Object|null} Object with text and seconds, or null
 */
function parseResetTime(resetStr) {
  if (!resetStr) return null;
  const now = new Date();
  const cleanStr = resetStr.replace(/\s*\([^)]+\)\s*$/, '').trim();
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  let resetDate;
  // Try time-only format first: "2:59am" or "12:30pm"
  const timeOnlyMatch = cleanStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (timeOnlyMatch) {
    const [, hourRaw, minutes = '0', ampm] = timeOnlyMatch;
    resetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), to24Hour(hourRaw, ampm), parseInt(minutes));
    if (resetDate <= now) resetDate.setDate(resetDate.getDate() + 1);
  } else {
    resetDate = parseDateTimeStr(cleanStr, now, monthNames);
    if (!resetDate) return { text: resetStr, seconds: null };
  }

  const diffMs = resetDate - now;
  if (diffMs <= 0) return { text: 'soon', seconds: 0 };
  const diffSeconds = Math.floor(diffMs / 1000);
  return { text: formatDuration(diffSeconds), seconds: diffSeconds };
}

/**
 * Extract section between two regex patterns from text
 * @param {string} text - Full text to search
 * @param {string} start - Start pattern
 * @param {string} end - End pattern (optional)
 * @returns {string|null} Extracted section or null
 */
function extractSection(text, start, end) {
  const regex = end ? new RegExp(`${start}([\\s\\S]*?)(?=${end}|$)`, 'i') : new RegExp(`${start}([\\s\\S]*)$`, 'i');
  return text.match(regex)?.[1] || null;
}

/**
 * Extract reset time string from a section (handles PTY corruption)
 * @param {string} section - Section text
 * @returns {string|null} Reset time string or null
 */
function extractResetTime(section) {
  // Look for date+time pattern FIRST (more specific)
  const dateTimeMatch = section.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{1,2}(?::\d{2})?\s*(am|pm))\s*\(([^)]+)\)/i);
  if (dateTimeMatch) return `${dateTimeMatch[1]} (${dateTimeMatch[3]})`;
  // Try clean time-only pattern
  const timeOnlyMatch = section.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*\(([^)]+)\)/i);
  if (timeOnlyMatch) return `${timeOnlyMatch[1]} (${timeOnlyMatch[2]})`;
  // Handle PTY-corrupted time: "1 m" or "2 59 m" (missing a/p)
  const corruptedMatch = section.match(/(\d{1,2})(?:\s*:?\s*(\d{2}))?\s+m\s*\(([^)]+)\)/i);
  if (corruptedMatch) {
    const [, hour, minutes, tz] = corruptedMatch;
    const mins = minutes ? `:${minutes}` : '';
    const am = `${hour}${mins}am (${tz})`;
    const pm = `${hour}${mins}pm (${tz})`;
    const amSec = parseResetTime(am)?.seconds ?? Infinity;
    const pmSec = parseResetTime(pm)?.seconds ?? Infinity;
    return amSec <= pmSec ? am : pm;
  }
  return null;
}

/**
 * Parse a usage section for percent and reset time
 * @param {string|null} section - Section text
 * @returns {Object|null} Parsed section data or null
 */
function parseUsageSection(section) {
  if (!section) return null;
  const percentMatch = section.match(/(\d+)\s*%\s*used/i);
  if (!percentMatch) return null;
  const resetsAt = extractResetTime(section);
  const resetData = resetsAt ? parseResetTime(resetsAt) : null;
  return {
    percent: parseFloat(percentMatch[1]),
    resetsAt,
    resetsIn: resetData?.text || null,
    resetsInSeconds: resetData?.seconds || null,
  };
}

/**
 * Parse extra usage section with budget info
 * @param {string} extraSection - Extra usage section text
 * @returns {Object|null} Parsed extra usage data or null
 */
function parseExtraUsage(extraSection) {
  const percentMatch = extraSection.match(/(\d+)\s*%\s*used/i);
  const spentMatch = extraSection.match(/\$([0-9.]+)\s*\/\s*\$([0-9.]+)\s*spent/i);
  if (!percentMatch && !spentMatch) return null;
  const dateMatch = extraSection.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*(?:\d{1,2}(?::\d{2})?\s*(?:am|pm))?)\s*\(([^)]+)\)/i);
  const resetsAt = dateMatch ? `${dateMatch[1].trim()} (${dateMatch[2]})` : null;
  const resetData = resetsAt ? parseResetTime(resetsAt) : null;
  return {
    label: 'Extra usage',
    percent: percentMatch ? parseFloat(percentMatch[1]) : null,
    spent: spentMatch ? parseFloat(spentMatch[1]) : null,
    budget: spentMatch ? parseFloat(spentMatch[2]) : null,
    resetsAt,
    resetsIn: resetData?.text || null,
    resetsInSeconds: resetData?.seconds || null,
  };
}

/**
 * Parse legacy weekly format (single "Current week" without model qualifiers)
 * @param {string} clean - Cleaned output text
 * @returns {Object|null} Parsed legacy weekly data or null
 */
function parseLegacyWeekly(clean) {
  const weeklyMatch = clean.match(/Current\s+week[\s\S]*?(\d+)\s*%\s*used[\s\S]*?Resets\s+([\s\S]*?)(?=esc\s+to\s+cancel|current\s+week|$)/i);
  if (weeklyMatch) {
    const resetSection = weeklyMatch[2];
    const tzMatch = resetSection.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*\([^)]+\)|\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*\([^)]+\))/i);
    const resetsAt = tzMatch ? tzMatch[1].trim() : resetSection.trim().split(/\s{2,}/)[0];
    const resetData = parseResetTime(resetsAt);
    return {
      percent: parseFloat(weeklyMatch[1]),
      label: 'Current week',
      resetsAt,
      resetsIn: resetData?.text || null,
      resetsInSeconds: resetData?.seconds || null,
    };
  }
  const percentMatch = clean.match(/Current\s+week[^%]*?(\d+)\s*%\s*used/i);
  if (percentMatch) {
    return {
      percent: parseFloat(percentMatch[1]),
      label: 'Current week',
      resetsAt: null,
      resetsIn: null,
      resetsInSeconds: null,
    };
  }
  return null;
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
 * Parse PTY output from /usage command into unified usage schema
 * @param {string} clean - Cleaned (ANSI-stripped) output text
 * @returns {Object} Parsed usage object
 */
function parsePtyOutput(clean) {
  const usage = { session: null, weeklyAll: null, weeklySonnet: null };

  // Parse session
  const sessionData = parseUsageSection(extractSection(clean, 'Current\\s+session', 'Current\\s+week'));
  if (sessionData) {
    usage.session = { label: 'Current session', ...sessionData };
    addPaceData(usage.session, 'session');
  }

  // Parse weekly (all models)
  const weeklyAllData = parseUsageSection(extractSection(clean, 'Current\\s+week\\s*\\(?\\s*all\\s+models\\s*\\)?', 'Current\\s+week\\s*\\(?\\s*Sonnet'));
  if (weeklyAllData) {
    usage.weeklyAll = { label: 'Current week (all models)', ...weeklyAllData };
    addPaceData(usage.weeklyAll, 'weekly');
  }

  // Parse weekly (Sonnet only)
  const weeklySonnetData = parseUsageSection(extractSection(clean, 'Current\\s+week\\s*\\(?\\s*Sonnet\\s+only\\s*\\)?', 'Extra\\s+usage|esc\\s+to\\s+cancel|Current\\s+week\\s*\\('));
  if (weeklySonnetData) {
    usage.weeklySonnet = { label: 'Current week (Sonnet only)', ...weeklySonnetData };
    addPaceData(usage.weeklySonnet, 'weekly');
  }

  // Parse extra usage section
  const extraSection = extractSection(clean, 'Extra\\s+usage', 'esc\\s+to\\s+cancel');
  if (extraSection) {
    const extraData = parseExtraUsage(extraSection);
    if (extraData) {
      usage.extraUsage = extraData;
      addPaceData(usage.extraUsage, 'weekly');
    }
  }

  // Legacy format fallback
  if (!usage.weeklyAll && !usage.weeklySonnet) {
    const legacyWeekly = parseLegacyWeekly(clean);
    if (legacyWeekly) {
      usage.weekly = legacyWeekly;
      addPaceData(usage.weekly, 'weekly');
    }
  }

  return usage;
}

module.exports = {
  parsePtyOutput,
  parseResetTime,
  formatDuration,
  to24Hour,
  extractSection,
  extractResetTime,
  parseUsageSection,
  parseExtraUsage,
  parseLegacyWeekly,
  addPaceData,
};
