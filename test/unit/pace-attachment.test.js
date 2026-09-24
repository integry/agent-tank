const { attachClaudePace } = require('../../src/pace-attachment');

describe('pace-attachment', () => {
  describe('attachClaudePace', () => {
    it('attaches a weekly pace evaluation to the Fable allowance', () => {
      const usage = {
        session: { percent: 10, resetsInSeconds: 3 * 60 * 60 },
        weeklyFable: { percent: 82, resetsInSeconds: 24 * 60 * 60 },
      };

      attachClaudePace(usage);

      // 6 of 7 days elapsed → ~85.7% expected usage for the weekly cycle.
      expect(usage.weeklyFable.paceEval).toBeDefined();
      expect(usage.weeklyFable.paceEval.expectedPercent).toBeCloseTo(85.71, 1);
      expect(usage.session.paceEval).toBeDefined();
    });

    it('skips the Fable allowance when it has no reset time', () => {
      const usage = { weeklyFable: { percent: 40, resetsInSeconds: null } };

      attachClaudePace(usage);

      expect(usage.weeklyFable.paceEval).toBeUndefined();
    });
  });
});
