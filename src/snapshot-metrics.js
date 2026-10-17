/**
 * Usage metric extraction.
 *
 * Flattens each provider's raw usage payload into a list of metric rows, one
 * per limit, so the history store can persist them in a normalised table and
 * consumers can read a series without branching on the provider.
 *
 * Every row has the same shape:
 *
 *   { key, label, model, cycle, percentUsed, value, unit }
 *
 * - `key` is the stable series identity (e.g. `weeklyAll`, `fiveHour`,
 *   `model:Gemini · Weekly Limit`, `GPT-5.3-Codex-Spark:fiveHour`). It must
 *   not change between refreshes for the same limit.
 * - `label` is the human-readable name; a CLI rename changes the label but
 *   not the key, so the series is not forked.
 * - `percentUsed` is always "percent used", including for Antigravity, which
 *   natively reports the remaining quota.
 * - `value` + `unit` carry non-percentage metrics (credit balances, token
 *   counts). Percentage rows use `unit: 'percent'` and `value: null`.
 */

/** Antigravity cycle names mapped onto canonical window types. */
const AGY_CYCLES = Object.freeze({
  weekly: 'weekly',
  fiveHour: 'five_hour',
  sessionAgy: 'session',
});

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Build a percentage metric row, or null when no finite percentage exists.
 * @returns {Object|null}
 */
function percentMetric({ key, label, model = null, cycle = null, percentUsed }) {
  if (!isFiniteNumber(percentUsed)) return null;
  return { key, label, model, cycle, percentUsed, value: null, unit: 'percent' };
}

// Claude reports distinct limits under fixed keys. `weekly` is the legacy
// single weekly row from older Claude builds; `extraUsage` is a spend budget
// rather than a rate-limit window, so it carries no cycle.
const CLAUDE_SECTIONS = [
  { key: 'session', label: 'Current session', model: null, cycle: 'session' },
  { key: 'weeklyAll', label: 'Current week (all models)', model: null, cycle: 'weekly' },
  { key: 'weeklyFable', label: 'Current week (Fable)', model: 'Fable', cycle: 'weekly' },
  { key: 'weekly', label: 'Current week', model: null, cycle: 'weekly' },
  { key: 'extraUsage', label: 'Extra usage', model: null, cycle: null },
];

/**
 * Extract Claude metric rows.
 * @param {Object} usage - Raw Claude usage
 * @returns {Object[]} Metric rows
 */
function extractClaudeMetrics(usage) {
  const metrics = [];
  for (const { key, label, model, cycle } of CLAUDE_SECTIONS) {
    const entry = usage[key];
    if (!entry) continue;
    const metric = percentMetric({ key, label: entry.label || label, model, cycle, percentUsed: entry.percent });
    if (metric) metrics.push(metric);
  }
  return metrics;
}

/**
 * Extract Antigravity metric rows.
 *
 * Antigravity reports remaining quota (`usageLeft`); `percentUsed` is derived
 * from it and rounded, so `usageLeft` wins when present.
 *
 * @param {Object} usage - Raw Antigravity usage
 * @returns {Object[]} Metric rows
 */
function extractAgyMetrics(usage) {
  if (!Array.isArray(usage.models)) return [];
  const metrics = [];
  for (const entry of usage.models) {
    if (!entry || !entry.model) continue;
    const percentUsed = isFiniteNumber(entry.usageLeft) ? 100 - entry.usageLeft : entry.percentUsed;
    const metric = percentMetric({
      key: `model:${entry.model}`,
      label: entry.model,
      model: entry.group || entry.model,
      cycle: entry.cycle == null ? 'session' : (AGY_CYCLES[entry.cycle] ?? 'session'),
      percentUsed: isFiniteNumber(percentUsed) ? Math.round(percentUsed * 100) / 100 : null,
    });
    if (metric) metrics.push(metric);
  }
  return metrics;
}

const CODEX_SECTIONS = [
  { key: 'fiveHour', label: '5h limit', cycle: 'five_hour' },
  { key: 'weekly', label: 'Weekly limit', cycle: 'weekly' },
];

function codexMetricsFor(source, model) {
  const metrics = [];
  for (const { key, label, cycle } of CODEX_SECTIONS) {
    const entry = source[key];
    if (!entry) continue;
    const percentUsed = isFiniteNumber(entry.percentUsed)
      ? entry.percentUsed
      : (isFiniteNumber(entry.percentLeft) ? 100 - entry.percentLeft : null);
    const entryLabel = entry.label || label;
    const metric = percentMetric({
      key: model ? `${model}:${key}` : key,
      label: model ? `${model} ${entryLabel}` : entryLabel,
      model,
      cycle,
      percentUsed,
    });
    if (metric) metrics.push(metric);
  }
  return metrics;
}

/**
 * Extract Codex metric rows, including per-model limits.
 * @param {Object} usage - Raw Codex usage
 * @returns {Object[]} Metric rows
 */
function extractCodexMetrics(usage) {
  const metrics = codexMetricsFor(usage, null);
  if (Array.isArray(usage.modelLimits)) {
    for (const modelLimit of usage.modelLimits) {
      if (!modelLimit) continue;
      metrics.push(...codexMetricsFor(modelLimit, modelLimit.name || 'Model'));
    }
  }
  return metrics;
}

const EXTRACTORS = {
  claude: extractClaudeMetrics,
  agy: extractAgyMetrics,
  codex: extractCodexMetrics,
};

/**
 * Flatten raw provider usage into metric rows.
 * @param {string} provider - Internal provider key ('claude', 'agy', 'codex')
 * @param {Object} usage - Raw usage payload
 * @returns {Object[]} Metric rows; empty for unknown providers or empty usage
 */
function extractUsageMetrics(provider, usage) {
  const extractor = EXTRACTORS[provider];
  if (!extractor || !usage || typeof usage !== 'object') return [];
  return extractor(usage);
}

module.exports = {
  extractUsageMetrics,
  extractClaudeMetrics,
  extractAgyMetrics,
  extractCodexMetrics,
};
