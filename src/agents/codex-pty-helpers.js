const { calculatePace } = require('../pace-evaluator.js');
const { CYCLE_DURATIONS } = require('../usage-formatters.js');

/**
 * Parse reset time string to seconds and formatted text
 * @param {string} resetStr - Reset time string (e.g., "14:30" or "14:30 on 20 Mar")
 * @returns {Object|null} - { text, seconds } or null if invalid
 */
function parseResetTime(resetStr) {
  if (!resetStr) return null;

  const now = new Date();
  let resetDate;

  // Format: "HH:MM" (today) or "HH:MM on DD Mon"
  const timeOnDateMatch = resetStr.match(/(\d{1,2}):(\d{2})\s*on\s*(\d{1,2})\s*(\w+)/i);
  const timeOnlyMatch = resetStr.match(/^(\d{1,2}):(\d{2})$/);

  if (timeOnDateMatch) {
    const [, hours, minutes, day, month] = timeOnDateMatch;
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthIndex = monthNames.indexOf(month.toLowerCase().substring(0, 3));
    resetDate = new Date(now.getFullYear(), monthIndex, parseInt(day), parseInt(hours), parseInt(minutes));
    // If the date is in the past, it's next year
    if (resetDate < now) {
      resetDate.setFullYear(resetDate.getFullYear() + 1);
    }
  } else if (timeOnlyMatch) {
    const [, hours, minutes] = timeOnlyMatch;
    resetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(hours), parseInt(minutes));
    // If time is in the past, it's tomorrow
    if (resetDate < now) {
      resetDate.setDate(resetDate.getDate() + 1);
    }
  } else {
    return { text: resetStr, seconds: null }; // Return original if can't parse
  }

  const diffMs = resetDate - now;
  if (diffMs <= 0) return { text: 'soon', seconds: 0 };

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSeconds / 60);
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  let text;
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    text = `${days}d ${remainingHours}h`;
  } else if (hours > 0) {
    text = `${hours}h ${mins}m`;
  } else {
    text = `${mins}m`;
  }

  return { text, seconds: diffSeconds };
}

/**
 * Parse a limit entry from PTY output match
 * @param {Array} match - Regex match array [fullMatch, percent, resetTime]
 * @param {string} label - Label for the limit
 * @param {string} cycleType - Cycle type for pace calculation
 * @returns {Object} - Parsed limit entry
 */
function parseLimitEntry(match, label, cycleType) {
  const percentLeft = parseFloat(match[1]);
  const resetsAt = match[2].trim();
  const resetData = parseResetTime(resetsAt);
  const percentUsed = 100 - percentLeft;
  const resetsInSeconds = resetData?.seconds || null;

  const entry = {
    percentLeft,
    resetsAt,
    label,
    percentUsed,
    resetsIn: resetData?.text || null,
    resetsInSeconds,
  };

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
 * Parse version info from output string
 * @param {string} output - Raw or clean output
 * @param {Function} stripAnsi - Function to strip ANSI codes
 * @returns {Object|null} - Version info object or null
 */
function parseVersionInfo(output, stripAnsi) {
  const clean = stripAnsi ? stripAnsi(output) : output;
  const versionInfo = {};

  const updateMatch = clean.match(/([\d.]+)\s*->\s*([\d.]+)/);
  if (updateMatch) {
    versionInfo.current = updateMatch[1];
    versionInfo.latest = updateMatch[2];
    return versionInfo;
  }

  const currentMatch = clean.match(/OpenAI Codex[^(]*\(v?([\d.]+)\)/i);
  if (currentMatch) versionInfo.current = currentMatch[1];

  const patterns = [
    /v?([\d.]+)\s*(?:is\s+)?available/i,
    /new version[:\s]+v?([\d.]+)/i,
    /update to v?([\d.]+)/i,
    /latest[:\s]+v?([\d.]+)/i,
  ];

  for (const p of patterns) {
    const m = clean.match(p);
    if (m && m[1] !== versionInfo.current) {
      versionInfo.latest = m[1];
      break;
    }
  }

  return Object.keys(versionInfo).length > 0 ? versionInfo : null;
}

/**
 * Parse model-specific limit sections from output
 * @param {string} clean - Cleaned output string
 * @returns {Array} - Array of model limit entries
 */
function parseModelLimits(clean) {
  const modelHeaderRegex = /([\w][\w.-]+)\s+limit:\s*[│╮╯]?/gi;
  const limitRegex = /5h limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i;
  const weeklyLimitRegex = /Weekly limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i;

  const modelLimits = [];
  let headerMatch;

  while ((headerMatch = modelHeaderRegex.exec(clean)) !== null) {
    const name = headerMatch[1];
    if (/^(5h|Weekly)$/i.test(name)) continue;

    const sectionStart = headerMatch.index + headerMatch[0].length;
    const remaining = clean.substring(sectionStart);
    const nextHeader = remaining.search(/[\w][\w.-]*-[\w.-]+\s+limit:/i);
    const endBox = remaining.indexOf('╰');
    let sectionEnd = remaining.length;
    if (nextHeader > 0 && (endBox < 0 || nextHeader < endBox)) sectionEnd = nextHeader;
    else if (endBox > 0) sectionEnd = endBox;
    const content = remaining.substring(0, sectionEnd);

    const entry = { name };
    const fh = content.match(limitRegex);
    if (fh) {
      entry.fiveHour = parseLimitEntry(fh, '5h limit', 'fiveHour');
    }
    const wk = content.match(weeklyLimitRegex);
    if (wk) {
      entry.weekly = parseLimitEntry(wk, 'Weekly limit', 'weekly');
    }
    if (entry.fiveHour || entry.weekly) {
      modelLimits.push(entry);
    }
  }

  return modelLimits;
}

/**
 * Extract metadata from /status output
 * @param {string} clean - Cleaned output string
 * @param {Function} stripBoxChars - Function to strip box characters
 * @returns {Object} - Metadata object
 */
function extractMetadataFromOutput(clean, stripBoxChars) {
  const metadata = {};

  // Extract directory/cwd
  const dirMatch = clean.match(/(?:Directory|Working directory|Cwd|Current directory):\s*([^\n│]+)/i);
  if (dirMatch) {
    metadata.directory = stripBoxChars(dirMatch[1]);
  }

  // Extract session ID
  const sessionMatch = clean.match(/Session(?:\s+ID)?:\s*([a-f0-9-]+)/i);
  if (sessionMatch) {
    metadata.sessionId = stripBoxChars(sessionMatch[1]);
  }

  // Extract collaboration mode (solo/team/etc)
  const collabMatch = clean.match(/(?:Collaboration|Mode):\s*(\w+)/i);
  if (collabMatch) {
    metadata.collaborationMode = stripBoxChars(collabMatch[1]);
  }

  // Extract model
  const modelMatch = clean.match(/Model:\s*([\w.-]+)/i);
  if (modelMatch) {
    metadata.model = stripBoxChars(modelMatch[1]);
  }

  // Extract account/email
  const accountMatch = clean.match(/Account:\s*(\S+@\S+)/i);
  if (accountMatch) {
    metadata.email = stripBoxChars(accountMatch[1]);
  }

  return metadata;
}

module.exports = {
  parseResetTime,
  parseLimitEntry,
  parseVersionInfo,
  parseModelLimits,
  extractMetadataFromOutput,
};
