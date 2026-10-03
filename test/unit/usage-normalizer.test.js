/**
 * Unit tests for the canonical usage normalization layer.
 */

const {
  WINDOW_TYPES,
  NORMALIZERS,
  normalizeStatus,
  normalizeAgentStatus,
  normalizePace,
  resolveResetsAt,
} = require('../../src/usage-normalizer.js');

const NOW = Date.parse('2026-10-03T20:00:00.000Z');
// Raw payloads were captured 60 seconds before "now".
const LAST_UPDATED = '2026-10-03T19:59:00.000Z';
const LAST_UPDATED_MS = Date.parse(LAST_UPDATED);

// Nested Claude payload (PTY /usage) with human reset strings.
const claudeStatus = {
  name: 'claude',
  id: 'claude',
  alias: null,
  provider: 'claude',
  usage: {
    session: {
      label: 'Current session',
      percent: 42,
      resetsAt: '12:20am (Europe/Berlin)',
      resetsIn: '1h 20m',
      resetsInSeconds: 4800,
      pace: { paceRatio: 0.8, isWarning: false, message: null },
    },
    weeklyAll: {
      label: 'Current week (all models)',
      percent: 31,
      resetsAt: 'Oct 8, 3am (Europe/Berlin)',
      resetsIn: '4d 5h',
      resetsInSeconds: 364364,
      pace: { paceRatio: 1.1, isWarning: false },
      paceEval: { paceRatio: 1.1, isBurningFast: true, etaSeconds: 1000 },
    },
    weeklyFable: {
      label: 'Current week (Fable)',
      percent: 82,
      resetsAt: 'Oct 8, 3am (Europe/Berlin)',
      resetsIn: '4d 5h',
      resetsInSeconds: 364364,
      pace: { paceRatio: 2.91, isWarning: true },
    },
    extraUsage: { label: 'Extra usage', percent: 5, spent: 1, budget: 20, resetsAt: null, resetsInSeconds: null },
  },
  metadata: { email: 'user@example.com', version: '2.1.71' },
  lastUpdated: LAST_UPDATED,
  error: null,
  isRefreshing: false,
};

// Flat Antigravity models array, including "Quota available" null-reset groups.
const agyStatus = {
  name: 'agy',
  id: 'agy',
  provider: 'agy',
  usage: {
    models: [
      {
        model: 'Gemini · Weekly Limit', usageLeft: 100, percentUsed: 0,
        resetsIn: null, resetsInSeconds: null, resetsAt: null, cycle: 'weekly', group: 'Gemini',
      },
      {
        model: 'Gemini · Five Hour Limit', usageLeft: 80, percentUsed: 20,
        resetsIn: '3h 15m', resetsInSeconds: 11700, resetsAt: '2026-10-03T23:14:00.000Z',
        cycle: 'fiveHour', group: 'Gemini',
        pace: { paceRatio: 0.57, isWarning: false },
        paceEval: { paceRatio: 0.57, isBurningFast: false, etaSeconds: null },
      },
      {
        model: 'Claude and GPT · Weekly Limit', usageLeft: 60, percentUsed: 40,
        resetsIn: null, resetsInSeconds: null, resetsAt: null, cycle: 'weekly', group: 'Claude and GPT',
      },
      {
        model: 'Claude and GPT · Five Hour Limit', usageLeft: 100, percentUsed: 0,
        resetsIn: null, resetsInSeconds: null, resetsAt: null, cycle: 'fiveHour', group: 'Claude and GPT',
      },
      // Real Antigravity output: usageLeft is parsed verbatim while percentUsed
      // is 100 - usageLeft rounded to one decimal, so the pair sums to 100.01.
      {
        model: 'Gemini 3 Pro', usageLeft: 90.31, percentUsed: 9.7,
        resetsIn: '20h', resetsInSeconds: 72000, resetsAt: '2026-10-04T15:59:00.000Z', cycle: 'sessionAgy',
      },
    ],
  },
  metadata: { cli: 'agy' },
  lastUpdated: LAST_UPDATED,
  error: null,
  isRefreshing: false,
};

// Codex JSON-RPC payload: unix-epoch resets and a null fiveHour window.
const codexWeeklyResetEpoch = Math.floor(LAST_UPDATED_MS / 1000) + 604000;
const codexStatus = {
  name: 'codex',
  id: 'codex',
  provider: 'codex',
  usage: {
    fiveHour: null,
    weekly: {
      percentUsed: 12, percentLeft: 88, resetsAt: codexWeeklyResetEpoch,
      label: 'Weekly limit', resetsIn: '6d 23h', resetsInSeconds: 604000,
      windowDurationMins: 10080,
      pace: { paceRatio: 1.5e1, isWarning: true },
    },
    modelLimits: [{
      name: 'GPT-5.3-Codex-Spark',
      fiveHour: {
        percentUsed: 3, percentLeft: 97, resetsAt: Math.floor(LAST_UPDATED_MS / 1000) + 3600,
        label: '5h limit', resetsIn: '1h 0m', resetsInSeconds: 3600,
      },
      weekly: null,
    }],
  },
  metadata: { planType: 'plus', email: 'user@example.com' },
  lastUpdated: LAST_UPDATED,
  error: null,
  isRefreshing: false,
};

describe('usage-normalizer', () => {
  describe('Claude normalizer', () => {
    const result = normalizeAgentStatus(claudeStatus, { now: NOW });

    it('emits session, weekly all-models and weekly Fable as three distinct windows', () => {
      expect(result.windows.map(w => [w.type, w.label])).toEqual([
        ['session', 'Current session'],
        ['weekly', 'Current week (all models)'],
        ['weekly', 'Current week (Fable)'],
      ]);
    });

    it('maps percent to used/remaining percentages', () => {
      expect(result.windows[2].used_percent).toBe(82);
      expect(result.windows[2].remaining_percent).toBe(18);
    });

    it('converts human reset strings to ISO anchored at lastUpdated', () => {
      const session = result.windows[0];
      expect(session.resets_at).toBe(new Date(LAST_UPDATED_MS + 4800 * 1000).toISOString());
      // Countdown is re-measured from "now": 60s have elapsed since the refresh.
      expect(session.resets_in_seconds).toBe(4740);
    });

    it('maps pace, preferring paceEval.isBurningFast over pace.isWarning', () => {
      expect(result.windows[0].pace).toEqual({ ratio: 0.8, burning_fast: false });
      expect(result.windows[1].pace).toEqual({ ratio: 1.1, burning_fast: true });
      expect(result.windows[2].pace).toEqual({ ratio: 2.91, burning_fast: true });
    });

    it('fills provider-level fields and keeps the raw payload', () => {
      expect(result).toMatchObject({
        id: 'claude',
        provider: 'claude',
        plan: 'max',
        status: 'ok',
        last_updated: LAST_UPDATED,
        error: null,
      });
      expect(result.raw).toBe(claudeStatus);
    });

    it('passes ISO resets from Claude API mode straight through', () => {
      const apiStatus = {
        ...claudeStatus,
        usage: { session: { percent: 10, resetsAt: '2026-10-03T22:00:00Z', resetsInSeconds: 7260 } },
      };
      const [session] = normalizeAgentStatus(apiStatus, { now: NOW }).windows;
      expect(session.resets_at).toBe('2026-10-03T22:00:00.000Z');
      expect(session.resets_in_seconds).toBe(7200);
      expect(session.pace).toBeNull();
    });

    it('maps the legacy single weekly row and reports an unknown plan without Fable', () => {
      const legacy = normalizeAgentStatus({
        ...claudeStatus,
        usage: { session: null, weeklyAll: null, weeklyFable: null, weekly: { label: 'Current week', percent: 50, resetsAt: null, resetsInSeconds: null } },
      }, { now: NOW });
      expect(legacy.plan).toBeNull();
      expect(legacy.windows).toEqual([{
        type: 'weekly', label: 'Current week', used_percent: 50, remaining_percent: 50,
        resets_at: null, resets_in_seconds: null, pace: null,
      }]);
    });
  });

  describe('Antigravity normalizer', () => {
    const result = normalizeAgentStatus(agyStatus, { now: NOW });

    it('flattens the models array into one window per entry', () => {
      expect(result.provider).toBe('antigravity');
      expect(result.plan).toBeNull();
      expect(result.windows.map(w => [w.type, w.label])).toEqual([
        ['weekly', 'Gemini · Weekly Limit'],
        ['five_hour', 'Gemini · Five Hour Limit'],
        ['weekly', 'Claude and GPT · Weekly Limit'],
        ['five_hour', 'Claude and GPT · Five Hour Limit'],
        ['session', 'Gemini 3 Pro'],
      ]);
    });

    it('maps percentUsed/usageLeft and passes ISO resets through', () => {
      expect(result.windows[1]).toEqual({
        type: 'five_hour',
        label: 'Gemini · Five Hour Limit',
        used_percent: 20,
        remaining_percent: 80,
        resets_at: '2026-10-03T23:14:00.000Z',
        resets_in_seconds: 11640,
        pace: { ratio: 0.57, burning_fast: false },
      });
    });

    it('keeps null-reset placeholder groups with null reset fields', () => {
      const placeholder = result.windows[2];
      expect(placeholder.used_percent).toBe(40);
      expect(placeholder.remaining_percent).toBe(60);
      expect(placeholder.resets_at).toBeNull();
      expect(placeholder.resets_in_seconds).toBeNull();
      expect(placeholder.pace).toBeNull();
    });

    it('keeps the reported decimal usageLeft and derives used_percent from it', () => {
      const decimal = result.windows[4];
      expect(decimal.remaining_percent).toBe(90.31);
      expect(decimal.used_percent).toBe(9.69);
      expect(decimal.used_percent + decimal.remaining_percent).toBe(100);
    });

    it('falls back to percentUsed when usageLeft is missing', () => {
      const fallback = normalizeAgentStatus({
        ...agyStatus,
        usage: { models: [{ model: 'Gemini Pro', percentUsed: 12.5, resetsAt: null, resetsInSeconds: null, cycle: 'sessionAgy' }] },
      }, { now: NOW });
      expect(fallback.windows[0]).toMatchObject({ used_percent: 12.5, remaining_percent: 87.5 });
    });

    it('maps legacy per-model entries without a group cycle to session windows', () => {
      const legacy = normalizeAgentStatus({
        ...agyStatus,
        usage: { models: [{ model: 'Gemini Pro', usageLeft: 75, percentUsed: 25, resetsAt: null, resetsInSeconds: null, cycle: 'sessionAgy' }] },
      }, { now: NOW });
      expect(legacy.windows[0].type).toBe('session');
    });
  });

  describe('Codex normalizer', () => {
    const result = normalizeAgentStatus(codexStatus, { now: NOW });

    it('omits a null fiveHour window and converts epoch resets to ISO', () => {
      const weekly = result.windows[0];
      expect(weekly).toEqual({
        type: 'weekly',
        label: 'Weekly limit',
        used_percent: 12,
        remaining_percent: 88,
        resets_at: new Date(codexWeeklyResetEpoch * 1000).toISOString(),
        resets_in_seconds: 603940,
        pace: { ratio: 15, burning_fast: true },
      });
    });

    it('adds per-model limits as qualified windows', () => {
      expect(result.windows.map(w => [w.type, w.label])).toEqual([
        ['weekly', 'Weekly limit'],
        ['five_hour', 'GPT-5.3-Codex-Spark 5h limit'],
      ]);
    });

    it('reports the plan from metadata', () => {
      expect(result.plan).toBe('plus');
      expect(result.provider).toBe('codex');
    });

    it('emits both windows when fiveHour is present', () => {
      const both = normalizeAgentStatus({
        ...codexStatus,
        usage: {
          fiveHour: { percentUsed: 50, percentLeft: 50, resetsAt: '1791100000', resetsInSeconds: 100, label: '5h limit' },
          weekly: codexStatus.usage.weekly,
        },
      }, { now: NOW });
      expect(both.windows.map(w => w.type)).toEqual(['five_hour', 'weekly']);
      expect(both.windows[0].resets_at).toBe(new Date(1791100000 * 1000).toISOString());
    });

    it('resolves human PTY reset strings from the countdown', () => {
      const pty = normalizeAgentStatus({
        ...codexStatus,
        usage: { fiveHour: { percentUsed: 1, percentLeft: 99, resetsAt: '02:44 on 9 Mar', resetsInSeconds: 600 }, weekly: null },
      }, { now: NOW });
      expect(pty.windows[0].resets_at).toBe(new Date(LAST_UPDATED_MS + 600 * 1000).toISOString());
      expect(pty.windows[0].resets_in_seconds).toBe(540);
    });

    it('keeps decimal PTY percentages complementary', () => {
      // codex-pty-helpers computes percentUsed as 100 - percentLeft (9.689999...).
      const pty = normalizeAgentStatus({
        ...codexStatus,
        usage: { fiveHour: null, weekly: { percentUsed: 100 - 90.31, percentLeft: 90.31, resetsAt: null, resetsInSeconds: null } },
      }, { now: NOW });
      expect(pty.windows[0]).toMatchObject({ used_percent: 9.69, remaining_percent: 90.31 });
    });

    it('derives remaining_percent from percentUsed when a payload reports an inconsistent pair', () => {
      const rpc = normalizeAgentStatus({
        ...codexStatus,
        usage: { fiveHour: null, weekly: { percentUsed: 12.4, percentLeft: 88, resetsAt: null, resetsInSeconds: null } },
      }, { now: NOW });
      expect(rpc.windows[0]).toMatchObject({ used_percent: 12.4, remaining_percent: 87.6 });
    });
  });

  describe('multiple accounts from the same provider', () => {
    const work = { ...codexStatus, name: 'codex', alias: 'Work', metadata: { planType: 'pro' } };
    const personal = {
      ...codexStatus,
      name: 'codex',
      alias: 'Personal',
      usage: { ...codexStatus.usage, weekly: { ...codexStatus.usage.weekly, percentUsed: 55, percentLeft: 45 } },
    };
    const { providers } = normalizeStatus({ work, personal }, { now: NOW });

    it('uses the configured id from the status map key, not the provider name', () => {
      expect(providers.map(p => [p.id, p.provider, p.plan])).toEqual([
        ['work', 'codex', 'pro'],
        ['personal', 'codex', 'plus'],
      ]);
    });

    it('keeps each account\'s windows and raw payload separate', () => {
      expect(providers.map(p => p.windows[0].used_percent)).toEqual([12, 55]);
      expect(providers.map(p => p.raw.alias)).toEqual(['Work', 'Personal']);
      expect(providers.map(p => p.raw.id)).toEqual(['work', 'personal']);
    });

    it('normalizes a single account under its configured id', () => {
      const single = normalizeAgentStatus({ ...personal, id: 'personal' }, { now: NOW });
      expect(single).toMatchObject({ id: 'personal', provider: 'codex' });
    });
  });

  describe('canonical schema conformance', () => {
    const { providers } = normalizeStatus({
      claude: claudeStatus,
      agy: agyStatus,
      codex: codexStatus,
    }, { now: NOW });

    const PROVIDER_KEYS = ['error', 'id', 'last_updated', 'plan', 'provider', 'raw', 'status', 'windows'];
    const WINDOW_KEYS = ['label', 'pace', 'remaining_percent', 'resets_at', 'resets_in_seconds', 'type', 'used_percent'];
    const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

    it('returns a providers array with one entry per agent', () => {
      expect(providers.map(p => p.id)).toEqual(['claude', 'agy', 'codex']);
    });

    it.each(['claude', 'agy', 'codex'])('%s conforms to the provider schema', (id) => {
      const provider = providers.find(p => p.id === id);
      expect(Object.keys(provider).sort()).toEqual(PROVIDER_KEYS);
      expect(typeof provider.provider).toBe('string');
      expect(provider.plan === null || typeof provider.plan === 'string').toBe(true);
      expect(typeof provider.status).toBe('string');
      expect(provider.last_updated).toMatch(ISO_8601);
      expect(Array.isArray(provider.windows)).toBe(true);
      expect(provider.windows.length).toBeGreaterThan(0);
    });

    it.each(['claude', 'agy', 'codex'])('%s windows conform to the window schema', (id) => {
      const provider = providers.find(p => p.id === id);
      for (const window of provider.windows) {
        expect(Object.keys(window).sort()).toEqual(WINDOW_KEYS);
        expect(WINDOW_TYPES).toContain(window.type);
        expect(typeof window.label).toBe('string');
        expect(typeof window.used_percent).toBe('number');
        expect(typeof window.remaining_percent).toBe('number');
        // The two percentages are complements; only float error is tolerated.
        expect(window.used_percent + window.remaining_percent).toBeCloseTo(100, 10);
        if (window.resets_at === null) {
          expect(window.resets_in_seconds).toBeNull();
        } else {
          expect(window.resets_at).toMatch(ISO_8601);
          expect(Number.isInteger(window.resets_in_seconds)).toBe(true);
          expect(window.resets_in_seconds).toBeGreaterThanOrEqual(0);
        }
        if (window.pace !== null) {
          expect(Object.keys(window.pace).sort()).toEqual(['burning_fast', 'ratio']);
          expect(typeof window.pace.ratio).toBe('number');
          expect(typeof window.pace.burning_fast).toBe('boolean');
        }
      }
    });

    it('registers a normalizer for every built-in provider', () => {
      expect(Object.keys(NORMALIZERS).sort()).toEqual(['agy', 'claude', 'codex']);
    });

    it('survives a JSON round trip unchanged', () => {
      const { raw: _raw, ...provider } = providers[0];
      expect(JSON.parse(JSON.stringify(provider))).toEqual(provider);
    });
  });

  describe('provider status and edge cases', () => {
    it('reports pending with no windows before the first refresh', () => {
      const result = normalizeAgentStatus({ name: 'claude', provider: 'claude', usage: null, lastUpdated: null, error: null, isRefreshing: false }, { now: NOW });
      expect(result).toMatchObject({ id: 'claude', status: 'pending', last_updated: null, windows: [], plan: null });
    });

    it('reports error and refreshing states', () => {
      expect(normalizeAgentStatus({ ...codexStatus, error: 'Timeout' }, { now: NOW })).toMatchObject({ status: 'error', error: 'Timeout' });
      expect(normalizeAgentStatus({ ...codexStatus, isRefreshing: true }, { now: NOW }).status).toBe('refreshing');
    });

    it('returns null for an unknown agent', () => {
      expect(normalizeAgentStatus(null)).toBeNull();
    });

    it('returns no windows for providers without a registered normalizer', () => {
      const result = normalizeAgentStatus({ name: 'other', provider: 'other', usage: { foo: 1 } }, { now: NOW });
      expect(result.provider).toBe('other');
      expect(result.windows).toEqual([]);
    });

    it('clamps resets in the past to zero seconds', () => {
      const result = normalizeAgentStatus({
        ...agyStatus,
        usage: { models: [{ model: 'X', usageLeft: 50, percentUsed: 50, resetsAt: '2026-10-03T19:00:00.000Z', resetsInSeconds: 1, cycle: 'fiveHour' }] },
      }, { now: NOW });
      expect(result.windows[0].resets_in_seconds).toBe(0);
    });
  });

  describe('normalizePace', () => {
    it('returns null without pace data', () => {
      expect(normalizePace({})).toBeNull();
    });

    it('returns null for a non-finite ratio', () => {
      expect(normalizePace({ pace: { paceRatio: Infinity, isWarning: true } })).toBeNull();
    });
  });

  describe('resolveResetsAt', () => {
    it('handles epoch seconds, epoch milliseconds and ISO strings', () => {
      expect(resolveResetsAt(1791100000, null, NOW)).toBe('2026-10-04T07:46:40.000Z');
      expect(resolveResetsAt(1791100000000, null, NOW)).toBe('2026-10-04T07:46:40.000Z');
      expect(resolveResetsAt('2026-10-04T07:46:40+00:00', null, NOW)).toBe('2026-10-04T07:46:40.000Z');
    });

    it('returns null for unparseable strings without a countdown', () => {
      expect(resolveResetsAt('12:20am (Europe/Berlin)', null, NOW)).toBeNull();
      expect(resolveResetsAt(null, null, NOW)).toBeNull();
    });
  });
});
