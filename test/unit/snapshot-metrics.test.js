const { extractClaudeMetrics, extractSnapshotMetrics } = require('../../src/snapshot-metrics');

describe('snapshot-metrics', () => {
  describe('extractClaudeMetrics', () => {
    it('stores the Fable allowance alongside session and weekly percentages', () => {
      const usage = {
        session: { percent: 10 },
        weeklyAll: { percent: 56 },
        weeklySonnet: null,
        weeklyFable: { percent: 82 },
      };

      expect(extractClaudeMetrics(usage)).toEqual({
        session: 10,
        weeklyAll: 56,
        weeklySonnet: null,
        weeklyFable: 82,
        weekly: null,
        extraUsage: null,
      });
    });

    it('records null for the Fable allowance when it is not reported', () => {
      const result = extractSnapshotMetrics('claude', { session: { percent: 5 } });

      expect(result.weeklyFable).toBeNull();
      expect(result.session).toBe(5);
    });
  });
});
