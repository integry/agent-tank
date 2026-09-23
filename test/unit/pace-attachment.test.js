const { attachPaceEvaluation } = require('../../src/pace-attachment.js');

describe('attachPaceEvaluation', () => {
  describe('Antigravity usage', () => {
    it('evaluates a weekly limit against the weekly cycle', () => {
      const usage = {
        models: [
          {
            model: 'Gemini · Weekly Limit Remaining',
            percentUsed: 2.3,
            resetsInSeconds: 160 * 60 * 60 + 12 * 60,
            cycle: 'weekly',
          },
        ],
      };

      attachPaceEvaluation('agy', usage);

      // ~4.64% of a 7-day cycle has elapsed, so 2.3% used is under pace.
      expect(usage.models[0].paceEval.elapsedPercent).toBeCloseTo(4.64, 1);
      expect(usage.models[0].paceEval.isBurningFast).toBe(false);
      expect(usage.models[0].paceEval.etaSeconds).toBeNull();
    });

    it('evaluates a five hour limit against the five hour cycle', () => {
      const usage = {
        models: [
          {
            model: 'Gemini · Five Hour Limit Remaining',
            percentUsed: 9.7,
            resetsInSeconds: 58 * 60,
            cycle: 'fiveHour',
          },
        ],
      };

      attachPaceEvaluation('agy', usage);

      expect(usage.models[0].paceEval.elapsedPercent).toBeCloseTo(80.67, 1);
      expect(usage.models[0].paceEval.isBurningFast).toBe(false);
    });

    it('falls back to the 24h cycle when an entry carries no cycle', () => {
      const usage = {
        models: [
          { model: 'Gemini 3.5 Flash (Medium)', percentUsed: 50, resetsInSeconds: 12 * 60 * 60 },
        ],
      };

      attachPaceEvaluation('agy', usage);

      expect(usage.models[0].paceEval.elapsedPercent).toBe(50);
    });

    it('leaves entries without reset timing untouched', () => {
      const usage = {
        models: [
          { model: 'Claude and GPT · Weekly Limit Remaining', percentUsed: 0, resetsInSeconds: null, cycle: 'weekly' },
        ],
      };

      attachPaceEvaluation('agy', usage);

      expect(usage.models[0].paceEval).toBeUndefined();
    });

    it('ignores usage without a models array', () => {
      const usage = {};

      expect(() => attachPaceEvaluation('agy', usage)).not.toThrow();
      expect(usage).toEqual({});
    });
  });
});
