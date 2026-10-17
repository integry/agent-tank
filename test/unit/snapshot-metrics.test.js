const {
  extractUsageMetrics,
  extractClaudeMetrics,
  extractAgyMetrics,
  extractCodexMetrics,
} = require('../../src/snapshot-metrics');

describe('snapshot-metrics', () => {
  describe('extractClaudeMetrics', () => {
    it('emits one percent row per reported Claude limit', () => {
      const usage = {
        session: { percent: 10, label: 'Current session' },
        weeklyAll: { percent: 56 },
        weeklyFable: { percent: 82 },
      };

      expect(extractClaudeMetrics(usage)).toEqual([
        { key: 'session', label: 'Current session', model: null, cycle: 'session', percentUsed: 10, value: null, unit: 'percent' },
        { key: 'weeklyAll', label: 'Current week (all models)', model: null, cycle: 'weekly', percentUsed: 56, value: null, unit: 'percent' },
        { key: 'weeklyFable', label: 'Current week (Fable)', model: 'Fable', cycle: 'weekly', percentUsed: 82, value: null, unit: 'percent' },
      ]);
    });

    it('omits limits that are missing or have no finite percentage', () => {
      const metrics = extractClaudeMetrics({ session: { percent: 5 }, weeklyAll: { percent: null }, extraUsage: { percent: 12 } });

      expect(metrics.map(m => m.key)).toEqual(['session', 'extraUsage']);
      expect(metrics[1]).toMatchObject({ cycle: null, percentUsed: 12, unit: 'percent' });
    });

    it('keeps the key stable when the CLI renames a label', () => {
      const before = extractClaudeMetrics({ weeklyAll: { percent: 1, label: 'Current week (all models)' } });
      const after = extractClaudeMetrics({ weeklyAll: { percent: 2, label: 'This week (all models)' } });

      expect(after[0].key).toBe(before[0].key);
      expect(after[0].label).toBe('This week (all models)');
    });
  });

  describe('extractAgyMetrics', () => {
    it('converts remaining quota into percent used and keys rows by model label', () => {
      const usage = {
        models: [
          { model: 'Gemini · Weekly Limit', group: 'Gemini', usageLeft: 90.31, percentUsed: 9.7, cycle: 'weekly' },
          { model: 'Gemini 3 Pro', usageLeft: 40, percentUsed: 60 },
        ],
      };

      expect(extractAgyMetrics(usage)).toEqual([
        { key: 'model:Gemini · Weekly Limit', label: 'Gemini · Weekly Limit', model: 'Gemini', cycle: 'weekly', percentUsed: 9.69, value: null, unit: 'percent' },
        { key: 'model:Gemini 3 Pro', label: 'Gemini 3 Pro', model: 'Gemini 3 Pro', cycle: 'session', percentUsed: 60, value: null, unit: 'percent' },
      ]);
    });

    it('falls back to percentUsed and maps five-hour cycles', () => {
      const [metric] = extractAgyMetrics({ models: [{ model: 'X', percentUsed: 25, cycle: 'fiveHour' }] });

      expect(metric).toMatchObject({ percentUsed: 25, cycle: 'five_hour' });
    });

    it('returns an empty array when models are missing or unusable', () => {
      expect(extractAgyMetrics({})).toEqual([]);
      expect(extractAgyMetrics({ models: [null, { model: 'Y' }, { percentUsed: 3 }] })).toEqual([]);
    });
  });

  describe('extractCodexMetrics', () => {
    it('emits account-wide and per-model rows with model-scoped keys', () => {
      const usage = {
        fiveHour: { percentUsed: 20, label: '5h limit' },
        weekly: { percentUsed: 45 },
        modelLimits: [{ name: 'GPT-5.3-Codex-Spark', fiveHour: { percentUsed: 5 }, weekly: null }],
      };

      expect(extractCodexMetrics(usage)).toEqual([
        { key: 'fiveHour', label: '5h limit', model: null, cycle: 'five_hour', percentUsed: 20, value: null, unit: 'percent' },
        { key: 'weekly', label: 'Weekly limit', model: null, cycle: 'weekly', percentUsed: 45, value: null, unit: 'percent' },
        { key: 'GPT-5.3-Codex-Spark:fiveHour', label: 'GPT-5.3-Codex-Spark 5h limit', model: 'GPT-5.3-Codex-Spark', cycle: 'five_hour', percentUsed: 5, value: null, unit: 'percent' },
      ]);
    });

    it('records the credit balance and context window utilisation', () => {
      const metrics = extractCodexMetrics({
        fiveHour: null,
        weekly: { percentUsed: 81 },
        contextWindow: { percentLeft: 25, usedTokens: 198000, totalTokens: 258000 },
        credits: { remaining: 48405, unit: 'credits' },
      });

      expect(metrics).toEqual([
        { key: 'weekly', label: 'Weekly limit', model: null, cycle: 'weekly', percentUsed: 81, value: null, unit: 'percent' },
        { key: 'contextUsedPercent', label: 'Context window', model: null, cycle: null, percentUsed: 76.74, value: null, unit: 'percent' },
        { key: 'credits', label: 'Credits', model: null, cycle: null, percentUsed: null, value: 48405, unit: 'credits' },
      ]);
    });

    it('falls back to percentLeft for context utilisation without token counts', () => {
      const metrics = extractCodexMetrics({ contextWindow: { percentLeft: 40, usedTokens: null, totalTokens: 272000 } });

      expect(metrics).toEqual([
        { key: 'contextUsedPercent', label: 'Context window', model: null, cycle: null, percentUsed: 60, value: null, unit: 'percent' },
      ]);
    });

    it('skips credits and context rows that carry no number', () => {
      expect(extractCodexMetrics({ contextWindow: { totalTokens: 1 }, credits: { remaining: null } })).toEqual([]);
    });

    it('derives percent used from percentLeft when percentUsed is absent', () => {
      const [metric] = extractCodexMetrics({ fiveHour: null, weekly: { percentLeft: 70 } });

      expect(metric).toMatchObject({ key: 'weekly', percentUsed: 30 });
    });
  });

  describe('extractUsageMetrics', () => {
    it('dispatches on the provider key', () => {
      expect(extractUsageMetrics('claude', { session: { percent: 1 } })[0].key).toBe('session');
      expect(extractUsageMetrics('codex', { weekly: { percentUsed: 1 } })[0].key).toBe('weekly');
      expect(extractUsageMetrics('agy', { models: [{ model: 'M', usageLeft: 99 }] })[0].key).toBe('model:M');
    });

    it('returns an empty array for unknown providers or missing usage', () => {
      expect(extractUsageMetrics('other', { session: { percent: 1 } })).toEqual([]);
      expect(extractUsageMetrics('claude', null)).toEqual([]);
    });
  });
});
