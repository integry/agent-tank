/**
 * Best-effort context window detection.
 *
 * Resolution order:
 *   1. `cli`         - the CLI printed the window itself (Codex `/status`, or the
 *                      Codex app-server over JSON-RPC)
 *   2. `override`    - the operator's `contextWindows` config-file table
 *   3. `known-model` - the built-in KNOWN_CONTEXT_WINDOWS table below
 *
 * Returns null when none applies. `source` is always reported so a consumer
 * can tell a measured value from a looked-up one.
 */

/**
 * Known context windows in tokens, verified against vendor documentation
 * (October 2026). Wrong numbers are worse than none, so models whose window
 * could not be verified are deliberately absent; operators can add or correct
 * entries through the `contextWindows` config-file key without a release.
 *
 * Patterns are matched as substrings of the normalised model name (see
 * normaliseModelName), longest pattern first, so `claude-opus-5-5` matches the
 * `claude-opus-5` entry and `claude-haiku-4-5` never falls through to a
 * shorter family entry.
 *
 * - Claude: Anthropic models overview. Fable 5/5.1, Mythos 5/5.1, Opus 4.6+ and
 *   Sonnet 4.6+ are 1M; Haiku 4.5 and the Opus/Sonnet 4.5-and-earlier
 *   generation are 200K (their 1M variants are opt-in betas).
 * - GPT-5 family (Codex): 272K input tokens out of the 400K total (the rest is
 *   reserved for output). Codex itself reports a slightly smaller usable
 *   figure (e.g. 258K), which wins when the CLI reports it.
 * - Gemini 2.5 / 3: 1,048,576 input tokens (Google model cards).
 */
const KNOWN_CONTEXT_WINDOWS = Object.freeze({
  'claude-fable-5': 1000000,
  'claude-mythos-5': 1000000,
  'claude-opus-5': 1000000,
  'claude-sonnet-5': 1000000,
  'claude-opus-4-8': 1000000,
  'claude-opus-4-7': 1000000,
  'claude-opus-4-6': 1000000,
  'claude-sonnet-4-6': 1000000,
  'claude-opus-4-5': 200000,
  'claude-opus-4-1': 200000,
  'claude-sonnet-4-5': 200000,
  'claude-haiku-4-5': 200000,
  'gpt-5': 272000,
  'gemini-3': 1048576,
  'gemini-2-5': 1048576,
});

/**
 * Normalise a model name for matching: lowercase, and collapse runs of
 * whitespace, `.`, `_` and `-` into one `-`, so "Opus 5.5", "opus-5-5" and
 * "claude_opus_5.5" compare equal.
 * @param {string} name
 * @returns {string}
 */
function normaliseModelName(name) {
  return String(name ?? '').toLowerCase().trim().replace(/[\s._-]+/g, '-');
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Build a pattern table from `{ pattern: tokens }`, dropping invalid entries
 * and sorting the most specific (longest) pattern first.
 * @param {Object<string, number>} table
 * @returns {Array<{pattern: string, tokens: number}>}
 */
function compileTable(table) {
  if (!table || typeof table !== 'object' || Array.isArray(table)) return [];
  return Object.entries(table)
    .map(([pattern, tokens]) => ({ pattern: normaliseModelName(pattern), tokens: Number(tokens) }))
    .filter(({ pattern, tokens }) => pattern && isPositiveNumber(tokens))
    .sort((a, b) => b.pattern.length - a.pattern.length);
}

const KNOWN_TABLE = compileTable(KNOWN_CONTEXT_WINDOWS);

/**
 * Claude's /status prints display names such as "Opus 5.5" or "Default Opus 4.5"
 * without the `claude-` prefix the tables use. Add it in front of a bare Claude
 * family name followed by a version, so "opus-5-5" matches `claude-opus-5`.
 * @param {string} normalised - Output of normaliseModelName
 * @returns {string}
 */
function addClaudePrefix(normalised) {
  return normalised.replace(/(?<![a-z0-9])(?<!claude-)(fable|mythos|opus|sonnet|haiku)(?=-\d)/g, 'claude-$1');
}

/**
 * Look a model up in a compiled table.
 * @returns {number|null} Window size in tokens
 */
function lookup(table, model) {
  const normalised = addClaudePrefix(normaliseModelName(model));
  if (!normalised) return null;
  const match = table.find(({ pattern }) => normalised.includes(pattern));
  return match ? match.tokens : null;
}

/**
 * Validate a `contextWindows` config value. Returns a plain
 * `{ pattern: tokens }` object holding only the valid entries.
 * @param {*} value
 * @returns {Object<string, number>}
 */
function normaliseContextWindowOverrides(value) {
  const overrides = {};
  for (const { pattern, tokens } of compileTable(value)) overrides[pattern] = tokens;
  return overrides;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Build the canonical context window object.
 * @returns {Object}
 */
function buildContextWindow({ totalTokens, usedTokens = null, percentLeft = null, model = null, source }) {
  let usedPercent = null;
  if (isPositiveNumber(totalTokens) && typeof usedTokens === 'number' && Number.isFinite(usedTokens)) {
    usedPercent = round2(Math.min(100, Math.max(0, (usedTokens / totalTokens) * 100)));
  } else if (typeof percentLeft === 'number' && Number.isFinite(percentLeft)) {
    usedPercent = round2(Math.min(100, Math.max(0, 100 - percentLeft)));
  }
  return {
    total_tokens: totalTokens,
    used_tokens: typeof usedTokens === 'number' && Number.isFinite(usedTokens) ? usedTokens : null,
    used_percent: usedPercent,
    remaining_percent: usedPercent === null ? null : round2(100 - usedPercent),
    model: model || null,
    source,
  };
}

/**
 * Detect the context window for an agent.
 *
 * @param {Object} params
 * @param {Object|null} [params.reported] - Window the CLI reported, as parsed by
 *   the agent: `{ totalTokens, usedTokens, percentLeft }`
 * @param {string|null} [params.model] - Model name the CLI reported
 * @param {Object<string, number>} [params.overrides] - Config-file `contextWindows`
 * @returns {Object|null} Canonical context window, or null when unknown
 */
function detectContextWindow({ reported = null, model = null, overrides = {} } = {}) {
  if (reported && isPositiveNumber(reported.totalTokens)) {
    return buildContextWindow({
      totalTokens: reported.totalTokens,
      usedTokens: reported.usedTokens ?? null,
      percentLeft: reported.percentLeft ?? null,
      model,
      source: 'cli',
    });
  }
  if (!model) return null;

  const overridden = lookup(compileTable(overrides), model);
  if (overridden !== null) {
    return buildContextWindow({ totalTokens: overridden, model, source: 'override' });
  }
  const known = lookup(KNOWN_TABLE, model);
  if (known !== null) {
    return buildContextWindow({ totalTokens: known, model, source: 'known-model' });
  }
  return null;
}

/**
 * Parse a token count as printed by a CLI: "258K", "1.2M", "198,000", "4500".
 * @param {string|number} value
 * @returns {number|null}
 */
function parseTokenCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const match = String(value ?? '').trim().match(/^([\d,]*\.?\d+)\s*([kmb])?$/i);
  if (!match) return null;
  const number = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;
  const multiplier = { k: 1e3, m: 1e6, b: 1e9 }[(match[2] || '').toLowerCase()] || 1;
  return Math.round(number * multiplier);
}

module.exports = {
  KNOWN_CONTEXT_WINDOWS,
  detectContextWindow,
  normaliseModelName,
  normaliseContextWindowOverrides,
  parseTokenCount,
};
