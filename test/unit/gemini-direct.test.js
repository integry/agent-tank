const {
  buildModelEntry,
  buildUsageFromQuota,
  formatDurationFromSeconds,
  normalizeGeminiMode,
} = require('../../src/agents/gemini-direct.js');

describe('gemini-direct helpers', () => {
  describe('normalizeGeminiMode', () => {
    it('defaults invalid values to fallback', () => {
      expect(normalizeGeminiMode(undefined)).toBe('fallback');
      expect(normalizeGeminiMode('bogus')).toBe('fallback');
    });

    it('accepts supported values', () => {
      expect(normalizeGeminiMode('pty')).toBe('pty');
      expect(normalizeGeminiMode('direct')).toBe('direct');
      expect(normalizeGeminiMode('fallback')).toBe('fallback');
    });
  });

  describe('formatDurationFromSeconds', () => {
    it('formats minute-only durations', () => {
      expect(formatDurationFromSeconds(30)).toBe('1m');
      expect(formatDurationFromSeconds(9 * 60)).toBe('9m');
    });

    it('formats hour and day durations', () => {
      expect(formatDurationFromSeconds((2 * 60 * 60) + (15 * 60))).toBe('2h 15m');
      expect(formatDurationFromSeconds((3 * 24 * 60 * 60) + (4 * 60 * 60))).toBe('3d 4h');
    });
  });

  describe('buildModelEntry', () => {
    it('converts a quota bucket into the project usage shape', () => {
      const originalNow = Date.now;
      Date.now = jest.fn(() => Date.parse('2026-05-05T06:00:00.000Z'));

      const entry = buildModelEntry({
        modelId: 'gemini-2.5-pro',
        remainingFraction: 0.42,
        resetTime: '2026-05-05T08:30:00.000Z',
      });

      expect(entry).toEqual({
        model: 'gemini-2.5-pro',
        usageLeft: 42,
        percentUsed: 58,
        resetsIn: '2h 30m',
        resetsInSeconds: 9000,
      });

      Date.now = originalNow;
    });
  });

  describe('buildUsageFromQuota', () => {
    it('deduplicates repeated model buckets', () => {
      const usage = buildUsageFromQuota({
        buckets: [
          { modelId: 'gemini-2.5-flash', remainingFraction: 0.9 },
          { modelId: 'gemini-2.5-flash', remainingFraction: 0.8 },
          { modelId: 'gemini-2.5-pro', remainingFraction: 0.5 },
        ],
      });

      expect(usage.models).toHaveLength(2);
      expect(usage.models[0].model).toBe('gemini-2.5-flash');
      expect(usage.models[1].model).toBe('gemini-2.5-pro');
    });
  });
});
