/**
 * Unit tests for the Usage Formatters module
 *
 * Tests the integration of pace evaluation into the Claude and Codex
 * usage formatters, ensuring pace warnings are properly calculated
 * and displayed when usage is out-pacing the time window.
 */

const {
  formatClaudeUsage,
  formatCodexUsage,
  resetInfoItem,
  parseResetsInToSeconds,
  CYCLE_DURATIONS
} = require('../../src/usage-formatters');

describe('UsageFormatters', () => {
  describe('parseResetsInToSeconds', () => {
    it('parses hours and minutes', () => {
      expect(parseResetsInToSeconds('2h 30m')).toBe(2 * 60 * 60 + 30 * 60);
    });

    it('parses hours only', () => {
      expect(parseResetsInToSeconds('3h')).toBe(3 * 60 * 60);
    });

    it('parses minutes only', () => {
      expect(parseResetsInToSeconds('45m')).toBe(45 * 60);
    });

    it('parses days and hours', () => {
      expect(parseResetsInToSeconds('1d 12h')).toBe(24 * 60 * 60 + 12 * 60 * 60);
    });

    it('returns null for empty input', () => {
      expect(parseResetsInToSeconds('')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(parseResetsInToSeconds(null)).toBeNull();
    });

    it('returns null for non-string input', () => {
      expect(parseResetsInToSeconds(123)).toBeNull();
    });
  });

  describe('CYCLE_DURATIONS', () => {
    it('has correct session duration (5 hours)', () => {
      expect(CYCLE_DURATIONS.session).toBe(5 * 60 * 60);
    });

    it('has correct weekly duration (7 days)', () => {
      expect(CYCLE_DURATIONS.weekly).toBe(7 * 24 * 60 * 60);
    });

    it('has correct fiveHour duration', () => {
      expect(CYCLE_DURATIONS.fiveHour).toBe(5 * 60 * 60);
    });

    it('has correct sessionGemini duration (24 hours)', () => {
      expect(CYCLE_DURATIONS.sessionGemini).toBe(24 * 60 * 60);
    });
  });

  describe('resetInfoItem with pace data', () => {
    it('includes pace warning HTML when pace data shows warning', () => {
      const paceData = {
        paceRatio: 1.5,
        elapsedPercent: 40,
        isWarning: true,
        warningMessage: 'Using 1.5x faster than sustainable'
      };

      const result = resetInfoItem('2h 30m', null, 'session', false, paceData);

      expect(result).toContain('pace-warning');
      expect(result).toContain('1.5x pace');
    });

    it('does not include pace warning when no warning', () => {
      const paceData = {
        paceRatio: 0.8,
        elapsedPercent: 50,
        isWarning: false,
        warningMessage: null
      };

      const result = resetInfoItem('2h 30m', null, 'session', false, paceData);

      expect(result).not.toContain('pace-warning');
    });

    it('does not include pace warning when pace data is null', () => {
      const result = resetInfoItem('2h 30m', null, 'session', false, null);

      expect(result).not.toContain('pace-warning');
    });

    it('includes time progress bar', () => {
      const result = resetInfoItem('2h 30m', null, 'session', false);

      expect(result).toContain('time-progress-bar');
      expect(result).toContain('time-progress-fill');
    });

    it('hides wrapper when isZero is true', () => {
      const result = resetInfoItem('5h', null, 'session', true);

      expect(result).toContain('style="display:none"');
    });
  });

  describe('formatClaudeUsage pace integration', () => {
    it('calculates pace for session section', () => {
      const usage = {
        session: {
          percent: 80,
          resetsIn: '1h' // 1h remaining of 5h = 4h elapsed = 80% time, 80% usage = 1x pace
        }
      };

      const result = formatClaudeUsage(usage);

      // Should have session info rendered
      expect(result).toContain('Session');
      expect(result).toContain('80');
      expect(result).toContain('% used');
    });

    it('shows pace warning for high-pace session usage', () => {
      const usage = {
        session: {
          percent: 80,
          resetsIn: '4h' // 4h remaining of 5h = 1h elapsed = 20% time, 80% usage = 4x pace
        }
      };

      const result = formatClaudeUsage(usage);

      expect(result).toContain('pace-warning');
      expect(result).toContain('pace-critical'); // 4x pace is critical
    });

    it('calculates pace for weekly section', () => {
      const usage = {
        weeklyAll: {
          percent: 50,
          resetsIn: '3d 12h' // 3.5 days remaining of 7 days = 50% time, 50% usage = 1x pace
        }
      };

      const result = formatClaudeUsage(usage);

      expect(result).toContain('Weekly (all)');
      expect(result).not.toContain('pace-warning'); // Normal pace
    });

    it('shows pace warning for high-pace weekly usage', () => {
      const usage = {
        weeklyAll: {
          percent: 60,
          resetsIn: '6d' // 6 days remaining = ~14% time elapsed, 60% usage = ~4x pace
        }
      };

      const result = formatClaudeUsage(usage);

      expect(result).toContain('pace-warning');
    });

    it('calculates pace for extra usage section', () => {
      const usage = {
        extraUsage: {
          percent: 50,
          spent: 25,
          budget: 50,
          resetsIn: '3d 12h'
        }
      };

      const result = formatClaudeUsage(usage);

      expect(result).toContain('Extra');
      expect(result).toContain('$25.00 / $50.00');
    });

    it('handles missing resetsIn gracefully', () => {
      const usage = {
        session: {
          percent: 50
          // No resetsIn
        }
      };

      const result = formatClaudeUsage(usage);

      expect(result).toContain('Session');
      expect(result).not.toContain('pace-warning'); // Can't calculate without time
    });

    it('renders all sections with pace calculation', () => {
      const usage = {
        session: { percent: 30, resetsIn: '3h 30m' },
        weeklyAll: { percent: 40, resetsIn: '5d' },
        weeklySonnet: { percent: 25, resetsIn: '5d' }
      };

      const result = formatClaudeUsage(usage);

      expect(result).toContain('Session');
      expect(result).toContain('Weekly (all)');
      expect(result).toContain('Weekly (Sonnet)');
    });
  });

  describe('formatCodexUsage pace integration', () => {
    it('calculates pace for 5h limit', () => {
      const usage = {
        model: 'GPT-4',
        fiveHour: {
          percentUsed: 50,
          resetsIn: '2h 30m' // 2.5h remaining of 5h = 50% time, 50% usage = 1x pace
        }
      };

      const result = formatCodexUsage(usage);

      expect(result).toContain('5h limit');
      expect(result).not.toContain('pace-warning'); // Normal pace
    });

    it('shows pace warning for high-pace 5h usage', () => {
      const usage = {
        model: 'GPT-4',
        fiveHour: {
          percentUsed: 80,
          resetsIn: '4h' // 4h remaining of 5h = 1h elapsed = 20% time, 80% usage = 4x pace
        }
      };

      const result = formatCodexUsage(usage);

      expect(result).toContain('pace-warning');
      expect(result).toContain('pace-critical');
    });

    it('calculates pace for weekly limit', () => {
      const usage = {
        model: 'GPT-4',
        weekly: {
          percentUsed: 40,
          resetsIn: '4d 4h' // ~4.17 days remaining of 7 = ~40% time, 40% usage = 1x pace
        }
      };

      const result = formatCodexUsage(usage);

      expect(result).toContain('Weekly');
      expect(result).not.toContain('pace-warning'); // Normal pace
    });

    it('shows pace warning for high-pace weekly usage', () => {
      const usage = {
        model: 'GPT-4',
        weekly: {
          percentUsed: 70,
          resetsIn: '6d' // 6 days remaining = ~14% time elapsed, 70% usage = 5x pace
        }
      };

      const result = formatCodexUsage(usage);

      expect(result).toContain('pace-warning');
    });

    it('handles modelLimits array', () => {
      const usage = {
        modelLimits: [
          {
            name: 'GPT-4',
            fiveHour: { percentUsed: 30, resetsIn: '3h' },
            weekly: { percentUsed: 20, resetsIn: '5d' }
          }
        ]
      };

      const result = formatCodexUsage(usage);

      expect(result).toContain('GPT-4');
      expect(result).toContain('5h limit');
      expect(result).toContain('Weekly');
    });

    it('handles missing resetsIn gracefully', () => {
      const usage = {
        model: 'GPT-4',
        fiveHour: {
          percentUsed: 50
          // No resetsIn
        }
      };

      const result = formatCodexUsage(usage);

      expect(result).toContain('5h limit');
      expect(result).not.toContain('pace-warning');
    });

    it('renders both fiveHour and weekly with pace', () => {
      const usage = {
        model: 'GPT-4',
        fiveHour: { percentUsed: 25, resetsIn: '4h' },
        weekly: { percentUsed: 10, resetsIn: '6d' }
      };

      const result = formatCodexUsage(usage);

      expect(result).toContain('5h limit');
      expect(result).toContain('Weekly');
    });
  });

  describe('pace warning threshold behavior', () => {
    it('does not show warning at exactly 1.0x pace', () => {
      const usage = {
        session: {
          percent: 50,
          resetsIn: '2h 30m' // Exactly 50% time elapsed, 50% usage
        }
      };

      const result = formatClaudeUsage(usage);

      expect(result).not.toContain('pace-warning');
    });

    it('does not show warning at 1.19x pace', () => {
      // 59.5% usage with 50% time elapsed = 1.19x (just under threshold)
      const usage = {
        session: {
          percent: 59,
          resetsIn: '2h 30m'
        }
      };

      const result = formatClaudeUsage(usage);

      expect(result).not.toContain('pace-warning');
    });

    it('shows warning at 1.2x pace', () => {
      // 60% usage with 50% time elapsed = 1.2x (at threshold)
      const usage = {
        session: {
          percent: 60,
          resetsIn: '2h 30m'
        }
      };

      const result = formatClaudeUsage(usage);

      expect(result).toContain('pace-warning');
    });
  });
});
