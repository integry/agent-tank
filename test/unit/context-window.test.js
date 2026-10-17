/**
 * Unit tests for best-effort context window detection.
 */

const {
  KNOWN_CONTEXT_WINDOWS,
  detectContextWindow,
  normaliseModelName,
  normaliseContextWindowOverrides,
  parseTokenCount,
} = require('../../src/context-window.js');

describe('context-window', () => {
  describe('detectContextWindow', () => {
    it('prefers the window the CLI reported and derives percentages from tokens', () => {
      const result = detectContextWindow({
        reported: { percentLeft: 25, usedTokens: 198000, totalTokens: 258000 },
        model: 'GPT-6-Astra',
        overrides: { 'gpt-6-astra': 300000 },
      });

      expect(result).toEqual({
        total_tokens: 258000,
        used_tokens: 198000,
        used_percent: 76.74,
        remaining_percent: 23.26,
        model: 'GPT-6-Astra',
        source: 'cli',
      });
    });

    it('falls back to percentLeft when the CLI reported no token count', () => {
      const result = detectContextWindow({ reported: { percentLeft: 40, usedTokens: null, totalTokens: 272000 } });

      expect(result).toMatchObject({ used_tokens: null, used_percent: 60, remaining_percent: 40, model: null, source: 'cli' });
    });

    it('uses a config-file override before the built-in table', () => {
      const result = detectContextWindow({ model: 'claude-opus-5-5', overrides: { 'claude-opus-5-5': 500000 } });

      expect(result).toMatchObject({ total_tokens: 500000, source: 'override' });
    });

    it('matches the built-in table by normalised substring, most specific first', () => {
      expect(detectContextWindow({ model: 'claude-opus-5-5' })).toEqual({
        total_tokens: 1000000,
        used_tokens: null,
        used_percent: null,
        remaining_percent: null,
        model: 'claude-opus-5-5',
        source: 'known-model',
      });
      expect(detectContextWindow({ model: 'claude-opus-4-5' }).total_tokens).toBe(200000);
      expect(detectContextWindow({ model: 'claude-opus-4-6' }).total_tokens).toBe(1000000);
      expect(detectContextWindow({ model: 'Gemini 3 Pro (High)' }).total_tokens).toBe(1048576);
      expect(detectContextWindow({ model: 'gpt-5.1-codex-max' }).total_tokens).toBe(272000);
    });

    it('lets a more specific override win over a broader one', () => {
      const overrides = { 'gpt-6': 400000, 'gpt-6-astra': 300000 };

      expect(detectContextWindow({ model: 'GPT-6-Astra', overrides }).total_tokens).toBe(300000);
      expect(detectContextWindow({ model: 'gpt-6-nova', overrides }).total_tokens).toBe(400000);
    });

    it('returns null when nothing is reported and the model is unknown', () => {
      expect(detectContextWindow({ model: 'Gemini 4 Argon (Medium)' })).toBeNull();
      expect(detectContextWindow({ model: null })).toBeNull();
      expect(detectContextWindow()).toBeNull();
    });

    it('ignores a reported window without a positive total', () => {
      expect(detectContextWindow({ reported: { totalTokens: 0, usedTokens: 5 }, model: 'claude-haiku-4-5' }))
        .toMatchObject({ total_tokens: 200000, source: 'known-model' });
    });

    it('clamps a used count above the total to 100%', () => {
      const result = detectContextWindow({ reported: { usedTokens: 300, totalTokens: 200 } });

      expect(result).toMatchObject({ used_percent: 100, remaining_percent: 0 });
    });
  });

  describe('normaliseModelName', () => {
    it('lowercases and collapses whitespace and separators', () => {
      expect(normaliseModelName('  Claude  Opus 5.5 ')).toBe('claude-opus-5-5');
      expect(normaliseModelName('claude_opus-5.5')).toBe('claude-opus-5-5');
      expect(normaliseModelName(null)).toBe('');
    });
  });

  describe('normaliseContextWindowOverrides', () => {
    it('keeps only positive numeric entries', () => {
      expect(normaliseContextWindowOverrides({ 'GPT-6 Astra': 300000, bad: 'x', zero: 0, neg: -1 }))
        .toEqual({ 'gpt-6-astra': 300000 });
    });

    it('returns an empty object for non-object input', () => {
      expect(normaliseContextWindowOverrides(undefined)).toEqual({});
      expect(normaliseContextWindowOverrides([1, 2])).toEqual({});
      expect(normaliseContextWindowOverrides('x')).toEqual({});
    });
  });

  describe('parseTokenCount', () => {
    it.each([
      ['258K', 258000],
      ['198k', 198000],
      ['1.2M', 1200000],
      ['198,000', 198000],
      ['4500', 4500],
      [4500, 4500],
    ])('parses %p as %p', (input, expected) => {
      expect(parseTokenCount(input)).toBe(expected);
    });

    it('returns null for unparseable values', () => {
      expect(parseTokenCount('lots')).toBeNull();
      expect(parseTokenCount('')).toBeNull();
      expect(parseTokenCount(null)).toBeNull();
      expect(parseTokenCount(-1)).toBeNull();
    });
  });

  describe('KNOWN_CONTEXT_WINDOWS', () => {
    it('holds only positive token counts', () => {
      for (const tokens of Object.values(KNOWN_CONTEXT_WINDOWS)) {
        expect(Number.isInteger(tokens) && tokens > 0).toBe(true);
      }
    });
  });
});
