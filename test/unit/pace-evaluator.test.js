/**
 * Unit tests for the Pace Evaluator module
 *
 * Tests the calculatePace function that determines if usage is out-pacing
 * the time window and warns users if they are burning through rate limits
 * faster than time is elapsing.
 */

const { calculatePace, formatPaceWarning } = require('../../src/pace-evaluator');

describe('PaceEvaluator', () => {
  describe('calculatePace', () => {
    describe('normal pace scenarios', () => {
      it('returns no warning when usage matches time elapsed', () => {
        // 50% usage, 50% time elapsed
        const result = calculatePace({
          usagePercent: 50,
          resetsInSeconds: 2.5 * 60 * 60, // 2.5h remaining of 5h cycle
          cycleDurationSeconds: 5 * 60 * 60 // 5h cycle
        });

        expect(result.paceRatio).toBe(1);
        expect(result.elapsedPercent).toBe(50);
        expect(result.isWarning).toBe(false);
        expect(result.warningMessage).toBeNull();
      });

      it('returns no warning when usage is less than time elapsed', () => {
        // 30% usage, 50% time elapsed (using less than expected)
        const result = calculatePace({
          usagePercent: 30,
          resetsInSeconds: 2.5 * 60 * 60,
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result.paceRatio).toBe(0.6);
        expect(result.isWarning).toBe(false);
      });

      it('returns no warning for zero usage', () => {
        const result = calculatePace({
          usagePercent: 0,
          resetsInSeconds: 2 * 60 * 60,
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result.paceRatio).toBe(0);
        expect(result.isWarning).toBe(false);
        expect(result.warningMessage).toBeNull();
      });

      it('returns no warning when just under threshold (1.19x pace)', () => {
        // 60% usage, 50% time elapsed = 1.2x pace (right at threshold)
        // Let's test 59.5% usage = 1.19x
        const result = calculatePace({
          usagePercent: 59.5,
          resetsInSeconds: 2.5 * 60 * 60,
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result.paceRatio).toBe(1.19);
        expect(result.isWarning).toBe(false);
      });
    });

    describe('warning scenarios', () => {
      it('returns warning when usage exceeds time elapsed by 20%', () => {
        // 60% usage, 50% time elapsed = 1.2x pace
        const result = calculatePace({
          usagePercent: 60,
          resetsInSeconds: 2.5 * 60 * 60,
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result.paceRatio).toBe(1.2);
        expect(result.isWarning).toBe(true);
        expect(result.warningMessage).toBe('Using 1.2x faster than sustainable');
      });

      it('returns warning for double pace usage', () => {
        // 80% usage, 40% time elapsed = 2x pace
        const result = calculatePace({
          usagePercent: 80,
          resetsInSeconds: 3 * 60 * 60, // 3h remaining of 5h
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result.paceRatio).toBe(2);
        expect(result.isWarning).toBe(true);
        expect(result.warningMessage).toBe('Using 2.0x faster than sustainable');
      });

      it('returns warning for extreme pace (5x)', () => {
        // 50% usage, 10% time elapsed = 5x pace
        const result = calculatePace({
          usagePercent: 50,
          resetsInSeconds: 4.5 * 60 * 60, // 4.5h remaining of 5h
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result.paceRatio).toBe(5);
        expect(result.isWarning).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('handles usage at start of cycle (no time elapsed)', () => {
        const result = calculatePace({
          usagePercent: 10,
          resetsInSeconds: 5 * 60 * 60, // Full 5h remaining
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result.paceRatio).toBe(Infinity);
        expect(result.elapsedPercent).toBe(0);
        expect(result.isWarning).toBe(true);
        expect(result.warningMessage).toBe('Usage started before time window opened');
      });

      it('handles zero usage at start of cycle', () => {
        const result = calculatePace({
          usagePercent: 0,
          resetsInSeconds: 5 * 60 * 60,
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result.paceRatio).toBe(0);
        expect(result.isWarning).toBe(false);
      });

      it('handles 100% usage near end of cycle', () => {
        // 100% usage, 90% time elapsed = ~1.11x pace (acceptable)
        const result = calculatePace({
          usagePercent: 100,
          resetsInSeconds: 30 * 60, // 30m remaining of 5h
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result.paceRatio).toBe(1.11);
        expect(result.isWarning).toBe(false);
      });

      it('handles weekly cycle durations', () => {
        // 50% usage, 50% time elapsed (3.5 days in)
        const weeklySeconds = 7 * 24 * 60 * 60;
        const result = calculatePace({
          usagePercent: 50,
          resetsInSeconds: 3.5 * 24 * 60 * 60,
          cycleDurationSeconds: weeklySeconds
        });

        expect(result.paceRatio).toBe(1);
        expect(result.isWarning).toBe(false);
      });
    });

    describe('custom threshold', () => {
      it('uses custom warning threshold', () => {
        // 45% usage, 30% time elapsed = 1.5x pace
        const result = calculatePace({
          usagePercent: 45,
          resetsInSeconds: 3.5 * 60 * 60,
          cycleDurationSeconds: 5 * 60 * 60,
          warningThreshold: 1.5 // Only warn at 1.5x or above
        });

        expect(result.paceRatio).toBe(1.5);
        expect(result.isWarning).toBe(true);
      });

      it('respects stricter threshold', () => {
        // 40% usage, 30% time elapsed = 1.33x pace
        const result = calculatePace({
          usagePercent: 40,
          resetsInSeconds: 3.5 * 60 * 60,
          cycleDurationSeconds: 5 * 60 * 60,
          warningThreshold: 1.1 // Stricter: warn at 1.1x
        });

        expect(result.paceRatio).toBe(1.33);
        expect(result.isWarning).toBe(true);
      });
    });

    describe('invalid inputs', () => {
      it('returns null for missing usagePercent', () => {
        const result = calculatePace({
          resetsInSeconds: 2 * 60 * 60,
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result).toBeNull();
      });

      it('returns null for missing resetsInSeconds', () => {
        const result = calculatePace({
          usagePercent: 50,
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result).toBeNull();
      });

      it('returns null for missing cycleDurationSeconds', () => {
        const result = calculatePace({
          usagePercent: 50,
          resetsInSeconds: 2 * 60 * 60
        });

        expect(result).toBeNull();
      });

      it('returns null for zero cycleDurationSeconds', () => {
        const result = calculatePace({
          usagePercent: 50,
          resetsInSeconds: 2 * 60 * 60,
          cycleDurationSeconds: 0
        });

        expect(result).toBeNull();
      });

      it('returns null for negative cycleDurationSeconds', () => {
        const result = calculatePace({
          usagePercent: 50,
          resetsInSeconds: 2 * 60 * 60,
          cycleDurationSeconds: -1
        });

        expect(result).toBeNull();
      });

      it('returns null for non-number usagePercent', () => {
        const result = calculatePace({
          usagePercent: '50',
          resetsInSeconds: 2 * 60 * 60,
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result).toBeNull();
      });
    });

    describe('rounding', () => {
      it('rounds pace ratio to 2 decimal places', () => {
        // 45% usage, 30% time elapsed = 1.5x pace
        const result = calculatePace({
          usagePercent: 45,
          resetsInSeconds: 3.5 * 60 * 60,
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result.paceRatio).toBe(1.5);
        expect(typeof result.paceRatio).toBe('number');
      });

      it('rounds elapsed percent to 2 decimal places', () => {
        // 1h elapsed of 5h = 20%
        const result = calculatePace({
          usagePercent: 25,
          resetsInSeconds: 4 * 60 * 60,
          cycleDurationSeconds: 5 * 60 * 60
        });

        expect(result.elapsedPercent).toBe(20);
      });
    });
  });

  describe('formatPaceWarning', () => {
    it('returns empty string for null pace data', () => {
      const result = formatPaceWarning(null);
      expect(result).toBe('');
    });

    it('returns empty string when no warning', () => {
      const paceData = {
        paceRatio: 0.8,
        isWarning: false,
        warningMessage: null
      };
      const result = formatPaceWarning(paceData);
      expect(result).toBe('');
    });

    it('returns HTML for warning state', () => {
      const paceData = {
        paceRatio: 1.5,
        isWarning: true,
        warningMessage: 'Using 1.5x faster than sustainable'
      };
      const result = formatPaceWarning(paceData);

      expect(result).toContain('class="pace-warning"');
      expect(result).toContain('1.5x pace');
      expect(result).toContain('title="Using 1.5x faster than sustainable"');
      expect(result).toContain('pace-icon');
      expect(result).toContain('&#9888;'); // Warning symbol
    });

    it('adds critical class for 2x or higher pace', () => {
      const paceData = {
        paceRatio: 2.5,
        isWarning: true,
        warningMessage: 'Using 2.5x faster than sustainable'
      };
      const result = formatPaceWarning(paceData);

      expect(result).toContain('pace-critical');
      expect(result).toContain('2.5x pace');
    });

    it('does not add critical class for pace below 2x', () => {
      const paceData = {
        paceRatio: 1.9,
        isWarning: true,
        warningMessage: 'Using 1.9x faster than sustainable'
      };
      const result = formatPaceWarning(paceData);

      expect(result).not.toContain('pace-critical');
      expect(result).toContain('1.9x pace');
    });

    it('formats pace ratio with one decimal place', () => {
      const paceData = {
        paceRatio: 1.23,
        isWarning: true,
        warningMessage: 'Using 1.2x faster than sustainable'
      };
      const result = formatPaceWarning(paceData);

      // toFixed(1) should give "1.2"
      expect(result).toContain('1.2x pace');
    });
  });
});
