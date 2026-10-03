/**
 * Usage normalization layer.
 *
 * Every agent collects usage in its own vendor-specific shape (Claude nests
 * limits under session/weeklyAll/weeklyFable, Antigravity reports a flat
 * `models` array, Codex reports fiveHour/weekly objects). This module maps each
 * of those raw payloads onto one canonical shape so API consumers never have
 * to special-case a provider:
 *
 *   {
 *     providers: [{
 *       id, provider, plan, status, last_updated, error,
 *       windows: [{ type, label, used_percent, remaining_percent,
 *                   resets_at, resets_in_seconds, pace }],
 *       raw,
 *     }]
 *   }
 *
 * Adding a new provider means registering one normalizer in NORMALIZERS.
 */

/** Canonical window types. */
const WINDOW_TYPES = Object.freeze(['session', 'five_hour', 'weekly']);

/** Canonical provider family names, keyed by internal agent provider. */
const PROVIDER_FAMILIES = Object.freeze({
  claude: 'claude',
  codex: 'codex',
  agy: 'antigravity',
});

/**
 * @typedef {Object} CanonicalPace
 * @property {number} ratio - Usage rate vs elapsed-time rate (>1 means out-pacing)
 * @property {boolean} burning_fast - Whether usage is on track to exhaust the window early
 */

/**
 * @typedef {Object} CanonicalWindow
 * @property {'session'|'five_hour'|'weekly'} type
 * @property {string} label - Human-readable label
 * @property {number} used_percent
 * @property {number} remaining_percent
 * @property {string|null} resets_at - ISO 8601 timestamp, null when unknown
 * @property {number|null} resets_in_seconds - Whole seconds until reset, null when unknown
 * @property {CanonicalPace|null} pace - Null when there is no pace signal
 */

/**
 * @typedef {Object} CanonicalProvider
 * @property {string} id - Configured agent id (stable key used by /status/:id and /refresh/:id)
 * @property {string} provider - Provider family ("claude", "codex", "antigravity")
 * @property {string|null} plan - Plan name where known (e.g. "max", "plus")
 * @property {'ok'|'error'|'refreshing'|'pending'} status - Collection status for this agent
 * @property {string|null} last_updated - ISO 8601 timestamp of the last successful refresh
 * @property {string|null} error - Last refresh error message, if any
 * @property {CanonicalWindow[]} windows
 * @property {Object} raw - Untouched per-agent status payload
 */

const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function toTimestampMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    // Unix epochs below 1e12 are seconds; larger values are milliseconds.
    return number < 1e12 ? number * 1000 : number;
  }
  if (typeof value === 'string' && ISO_DATE_PREFIX.test(value.trim())) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * Resolve a reset instant to ISO 8601.
 *
 * Accepts ISO strings and unix epochs (seconds or milliseconds) directly. Human
 * strings such as "12:20am (Europe/Berlin)" are resolved from the countdown
 * that was computed when the payload was parsed, anchored at `anchorMs`.
 *
 * @param {string|number|null} resetsAt - Raw reset value
 * @param {number|null} resetsInSeconds - Raw countdown, relative to anchorMs
 * @param {number} anchorMs - Time the countdown was measured at
 * @returns {string|null} ISO 8601 timestamp or null when unknown
 */
function resolveResetsAt(resetsAt, resetsInSeconds, anchorMs) {
  const direct = toTimestampMs(resetsAt);
  if (direct !== null) return new Date(direct).toISOString();
  if (isFiniteNumber(resetsInSeconds) && isFiniteNumber(anchorMs)) {
    return new Date(anchorMs + resetsInSeconds * 1000).toISOString();
  }
  return null;
}

/**
 * Map raw pace data (calculatePace and/or evaluatePace output) to the
 * canonical { ratio, burning_fast } shape.
 * @param {Object} entry - Raw usage entry that may carry `pace` and `paceEval`
 * @returns {CanonicalPace|null}
 */
function normalizePace(entry) {
  const { pace, paceEval } = entry;
  const ratio = paceEval?.paceRatio ?? pace?.paceRatio;
  // A non-finite ratio (usage at the very start of a window) cannot be
  // serialized as a JSON number, so treat it as no pace signal.
  if (!isFiniteNumber(ratio)) return null;
  const burningFast = paceEval?.isBurningFast ?? pace?.isWarning ?? false;
  return { ratio, burning_fast: Boolean(burningFast) };
}

/**
 * Build a canonical window from already-extracted values.
 * @returns {CanonicalWindow|null} Null when no usage percentage is available
 */
function buildWindow({ type, label, usedPercent, remainingPercent, resetsAt, resetsInSeconds, entry }, context) {
  let used = isFiniteNumber(usedPercent) ? usedPercent : null;
  let remaining = isFiniteNumber(remainingPercent) ? remainingPercent : null;
  if (used === null && remaining === null) return null;
  if (used === null) used = 100 - remaining;
  if (remaining === null) remaining = 100 - used;

  const resetsAtIso = resolveResetsAt(resetsAt, resetsInSeconds, context.anchorMs);
  const resetsInSecondsOut = resetsAtIso === null
    ? null
    : Math.max(0, Math.floor((Date.parse(resetsAtIso) - context.nowMs) / 1000));

  return {
    type,
    label,
    used_percent: roundPercent(used),
    remaining_percent: roundPercent(remaining),
    resets_at: resetsAtIso,
    resets_in_seconds: resetsInSecondsOut,
    pace: normalizePace(entry),
  };
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

// Session, weekly all-models and weekly Fable are distinct limits, so each
// becomes its own window. `weekly` is the legacy single weekly row emitted by
// older Claude builds. Extra usage is a spend budget, not a rate-limit window,
// so it stays in `raw` only.
const CLAUDE_SECTIONS = [
  { key: 'session', type: 'session', label: 'Current session' },
  { key: 'weeklyAll', type: 'weekly', label: 'Current week (all models)' },
  { key: 'weeklyFable', type: 'weekly', label: 'Current week (Fable)' },
  { key: 'weekly', type: 'weekly', label: 'Current week' },
];

/**
 * @param {Object} usage - Raw Claude usage
 * @param {Object} context - Normalization context
 * @returns {CanonicalWindow[]}
 */
function normalizeClaudeWindows(usage, context) {
  const windows = [];
  for (const { key, type, label } of CLAUDE_SECTIONS) {
    const entry = usage[key];
    if (!entry) continue;
    const window = buildWindow({
      type,
      label: entry.label || label,
      usedPercent: entry.percent,
      resetsAt: entry.resetsAt,
      resetsInSeconds: entry.resetsInSeconds,
      entry,
    }, context);
    if (window) windows.push(window);
  }
  return windows;
}

function claudePlan(agentStatus) {
  const explicit = agentStatus.metadata?.plan;
  if (explicit) return String(explicit).toLowerCase();
  // Claude only renders the weekly Fable allowance for Max subscriptions.
  return agentStatus.usage?.weeklyFable ? 'max' : null;
}

// ---------------------------------------------------------------------------
// Antigravity
// ---------------------------------------------------------------------------

const AGY_CYCLE_TYPES = {
  weekly: 'weekly',
  fiveHour: 'five_hour',
  sessionAgy: 'session',
};

/**
 * Flatten the Antigravity `models` array into windows.
 *
 * Entries without a reset countdown (Antigravity shows "Quota available"
 * instead, e.g. the "Claude and GPT" group limits) are KEPT with their
 * reported percentages and `resets_at`/`resets_in_seconds` set to null: they
 * are real limits whose window simply has not started counting down, and
 * dropping them would hide a limit (and any usage already recorded on it).
 *
 * @param {Object} usage - Raw Antigravity usage
 * @param {Object} context - Normalization context
 * @returns {CanonicalWindow[]}
 */
function normalizeAgyWindows(usage, context) {
  if (!Array.isArray(usage.models)) return [];
  const windows = [];
  for (const entry of usage.models) {
    if (!entry) continue;
    const window = buildWindow({
      type: AGY_CYCLE_TYPES[entry.cycle] || 'session',
      label: entry.model || 'Model quota',
      usedPercent: entry.percentUsed,
      remainingPercent: entry.usageLeft,
      resetsAt: entry.resetsAt,
      resetsInSeconds: entry.resetsInSeconds,
      entry,
    }, context);
    if (window) windows.push(window);
  }
  return windows;
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

const CODEX_SECTIONS = [
  { key: 'fiveHour', type: 'five_hour', label: '5h limit' },
  { key: 'weekly', type: 'weekly', label: 'Weekly limit' },
];

function codexWindowsFor(source, labelPrefix, context) {
  const windows = [];
  for (const { key, type, label } of CODEX_SECTIONS) {
    const entry = source[key];
    // fiveHour is null on accounts that only expose a weekly window.
    if (!entry) continue;
    const window = buildWindow({
      type,
      label: labelPrefix ? `${labelPrefix} ${entry.label || label}` : (entry.label || label),
      usedPercent: entry.percentUsed,
      remainingPercent: entry.percentLeft,
      resetsAt: entry.resetsAt,
      resetsInSeconds: entry.resetsInSeconds,
      entry,
    }, context);
    if (window) windows.push(window);
  }
  return windows;
}

/**
 * @param {Object} usage - Raw Codex usage
 * @param {Object} context - Normalization context
 * @returns {CanonicalWindow[]}
 */
function normalizeCodexWindows(usage, context) {
  const windows = codexWindowsFor(usage, null, context);
  // Per-model limits (e.g. "GPT-5.3-Codex-Spark") are separate windows.
  if (Array.isArray(usage.modelLimits)) {
    for (const modelLimit of usage.modelLimits) {
      if (!modelLimit) continue;
      windows.push(...codexWindowsFor(modelLimit, modelLimit.name || 'Model', context));
    }
  }
  return windows;
}

function codexPlan(agentStatus) {
  const plan = agentStatus.metadata?.planType ?? agentStatus.metadata?.plan;
  return plan ? String(plan).toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * One normalizer per internal provider key.
 * `windows(usage, context)` maps raw usage to canonical windows;
 * `plan(agentStatus)` extracts the plan name where known.
 */
const NORMALIZERS = {
  claude: { windows: normalizeClaudeWindows, plan: claudePlan },
  agy: { windows: normalizeAgyWindows, plan: () => null },
  codex: { windows: normalizeCodexWindows, plan: codexPlan },
};

function deriveStatus(agentStatus) {
  if (agentStatus.error) return 'error';
  if (agentStatus.isRefreshing) return 'refreshing';
  if (!agentStatus.usage) return 'pending';
  return 'ok';
}

/**
 * Normalize a single agent status (as returned by AgentTank#getAgentStatus).
 * @param {Object} agentStatus - Raw per-agent status
 * @param {Object} [options]
 * @param {number} [options.now=Date.now()] - Current time in ms
 * @returns {CanonicalProvider|null}
 */
function normalizeAgentStatus(agentStatus, options = {}) {
  if (!agentStatus) return null;
  const nowMs = options.now ?? Date.now();
  const providerKey = agentStatus.provider || agentStatus.name;
  const normalizer = NORMALIZERS[providerKey];
  const lastUpdatedMs = toTimestampMs(agentStatus.lastUpdated);
  const context = { nowMs, anchorMs: lastUpdatedMs ?? nowMs };

  const windows = normalizer && agentStatus.usage
    ? normalizer.windows(agentStatus.usage, context)
    : [];

  return {
    id: agentStatus.id || agentStatus.name,
    provider: PROVIDER_FAMILIES[providerKey] || providerKey || null,
    plan: normalizer ? normalizer.plan(agentStatus) : null,
    status: deriveStatus(agentStatus),
    last_updated: lastUpdatedMs === null ? null : new Date(lastUpdatedMs).toISOString(),
    error: agentStatus.error || null,
    windows,
    raw: agentStatus,
  };
}

/**
 * Normalize the full status map (as returned by AgentTank#getStatus).
 * @param {Object<string, Object>} statusMap - Raw status keyed by agent id
 * @param {Object} [options] - See normalizeAgentStatus
 * @returns {{providers: CanonicalProvider[]}}
 */
function normalizeStatus(statusMap, options = {}) {
  const now = options.now ?? Date.now();
  const providers = Object.entries(statusMap || {}).map(([id, agentStatus]) =>
    normalizeAgentStatus({ id, ...agentStatus }, { ...options, now })
  );
  return { providers };
}

module.exports = {
  WINDOW_TYPES,
  PROVIDER_FAMILIES,
  NORMALIZERS,
  normalizeStatus,
  normalizeAgentStatus,
  normalizeClaudeWindows,
  normalizeAgyWindows,
  normalizeCodexWindows,
  normalizePace,
  resolveResetsAt,
};
