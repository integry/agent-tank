/**
 * Parsing helpers for Antigravity's `/usage` screen ("Model Quota" on older
 * builds, the grouped "Models & Quota" screen on newer ones).
 */

// Matches both the older "Model Quota" screen and the newer grouped
// "Models & Quota" screen reported by recent Antigravity CLI builds.
const QUOTA_HEADER = /Models?\s*&?\s*Quota/i;

// Antigravity words its countdown line differently across builds: older
// screens say "Resets in 3h 15m", the grouped "Models & Quota" screen says
// "Refreshes in 160h 12m". A fully replenished limit renders "Quota
// available" instead, which carries no countdown and yields a null reset.
const RESET_LINE = /^(?:resets?|refresh(?:es)?|renew(?:s|als)?)\s*(?:in|at)?\s*([0-9dhm\s]+)?/i;

const KNOWN_MARKERS = new Set([
  'Model Quota',
  'Models & Quota',
  'Quota available',
  '? for shortcuts',
]);

// The long-standing group header form: "GEMINI MODELS", "CLAUDE AND GPT MODELS".
const MODELS_GROUP_HEADER = /^([A-Z][A-Z0-9 &/-]*?)\s+MODELS$/;
// An ALL-CAPS line without punctuation, e.g. "GEMINI 4 ARGON".
const BARE_GROUP_HEADER = /^[A-Z][A-Z0-9 ]*$/;
const PERCENT = /(\d+(?:\.\d+)?)\s*%/;
// Real Antigravity labels are at most five words ("Gemini 4 Argon Weekly Limit").
const MAX_LABEL_WORDS = 8;

const GROUP_ACRONYMS = new Set(['GPT', 'GPU', 'AI', 'CLI', 'API', 'OSS']);
const GROUP_CONNECTIVES = new Set(['and', 'or', 'of', 'the', 'for', 'with']);

/**
 * Convert an ALL-CAPS Antigravity group header (e.g. "CLAUDE AND GPT") into a
 * readable label ("Claude and GPT"), preserving known acronyms and lowercasing
 * connective words.
 * @param {string} raw
 * @returns {string}
 */
function formatGroupName(raw) {
  return raw
    .split(/\s+/)
    .map((word, idx) => {
      const upper = word.toUpperCase();
      if (GROUP_ACRONYMS.has(upper)) return upper;
      const lower = word.toLowerCase();
      if (idx > 0 && GROUP_CONNECTIVES.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Map an Antigravity limit label to the cycle its countdown belongs to, so
 * pace math compares usage against the right window. A weekly limit reports
 * "Refreshes in 160h 12m", which is nonsense against a 24h cycle.
 * @param {string} label
 * @returns {'weekly'|'fiveHour'|'sessionAgy'}
 */
function cycleTypeFor(label) {
  if (/\bweek(?:ly)?\b/i.test(label)) return 'weekly';
  if (/\b(?:five|5)[\s-]?hour\b/i.test(label)) return 'fiveHour';
  return 'sessionAgy';
}

/**
 * Return the raw group name when `line` is a group header, else null.
 *
 * A header is ALL-CAPS and either ends in "MODELS" or is followed by a line
 * without a percentage. A model or limit label is always followed by its
 * percentage bar, which keeps "GPT-OSS 120B" + "[bar] 80%" a model on the
 * older screen while "GEMINI 4 ARGON" + its description becomes a header.
 * @param {string} line
 * @param {string} [nextLine] - Next non-empty line
 * @returns {string|null}
 */
function groupHeaderName(line, nextLine) {
  const modelsMatch = line.match(MODELS_GROUP_HEADER);
  if (modelsMatch) return modelsMatch[1].trim();
  if (BARE_GROUP_HEADER.test(line) && !PERCENT.test(nextLine || '')) return line;
  return null;
}

/**
 * Descriptive prose ("For paid Pro plans, Argon quota is separate. …",
 * "Disabled: You have hit your weekly limit, …") is never a model label.
 * @param {string} line
 * @returns {boolean}
 */
function isProseLine(line) {
  return /[.!?]$/.test(line) || line.split(/\s+/).length > MAX_LABEL_WORDS;
}

/**
 * Lines that can never be a model label: screen chrome, descriptive lines,
 * percentage bars, countdowns and prose.
 * @param {string} line
 * @returns {boolean}
 */
function isNonLabelLine(line) {
  if (KNOWN_MARKERS.has(line) || /^(?:[>└│]|[-─↑/↓]|esc\s+to\s+cancel)/i.test(line)) return true;
  // Descriptive lines such as "Account: ..." or "Models within this group: ...".
  if (/^(?:Account|Models within this group)\s*:/i.test(line)) return true;
  if (!/[A-Za-z]/.test(line) || /\d+\s*%/.test(line)) return true;
  // A countdown line ("Refreshes in 58m") belongs to the entry above it.
  if (RESET_LINE.test(line)) return true;
  return isProseLine(line);
}

// Qualify shared limit labels with their group so entries from different
// groups stay distinct; per-model labels are already unique on their own.
function qualifiedModelName(label, group) {
  const isSharedLimit = /^(?:weekly|five[\s-]?hour|5[\s-]?hour|daily|hourly)\b/i.test(label);
  return (group && isSharedLimit) ? `${group} · ${label}` : label;
}

/**
 * Parse the quota screen into `usage.models`.
 *
 * @param {string} clean - ANSI-stripped CLI output
 * @param {Object} usage - Usage object to fill (`usage.models`)
 * @param {Object} agent - AgyAgent providing `_parseResetLine` and `_addPaceData`
 */
function parseAgyUsage(clean, usage, agent) {
  if (!QUOTA_HEADER.test(clean)) return;

  const lines = clean.split('\n').map(line => line.trim()).filter(Boolean);

  // Newer Antigravity builds group quotas under section headers such as
  // "GEMINI MODELS" / "CLAUDE AND GPT MODELS" / "GEMINI 4 ARGON", with each
  // group reporting its own limits. Track the active group so generic labels
  // can be qualified and not collapsed into a single entry.
  let currentGroup = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const header = groupHeaderName(line, lines[i + 1]);
    if (header) {
      currentGroup = formatGroupName(header);
      continue;
    }
    if (isNonLabelLine(line)) continue;

    const percentMatch = (lines[i + 1] || '').match(PERCENT);
    if (!percentMatch) continue;

    const modelName = qualifiedModelName(line, currentGroup);
    if (usage.models.some(m => m.model === modelName)) continue;

    const usageLeft = parseFloat(percentMatch[1]);
    const percentUsed = Number((100 - usageLeft).toFixed(1));
    const reset = agent._parseResetLine(lines[i + 2]);
    const cycle = cycleTypeFor(line);
    const modelEntry = { model: modelName, usageLeft, percentUsed, ...reset, cycle };
    if (currentGroup) modelEntry.group = currentGroup;
    agent._addPaceData(modelEntry, reset.resetsInSeconds, cycle);
    usage.models.push(modelEntry);
  }
}

module.exports = {
  QUOTA_HEADER,
  RESET_LINE,
  formatGroupName,
  cycleTypeFor,
  groupHeaderName,
  isProseLine,
  parseAgyUsage,
};
