/**
 * Unit tests for the custom ANSI logger utility
 */

const logger = require('../../src/logger');

describe('Logger', () => {
  let consoleLogSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('ANSI codes', () => {
    it('exports ANSI escape codes', () => {
      expect(logger.ANSI).toBeDefined();
      expect(logger.ANSI.reset).toBe('\x1b[0m');
      expect(logger.ANSI.red).toBe('\x1b[31m');
      expect(logger.ANSI.green).toBe('\x1b[32m');
      expect(logger.ANSI.blue).toBe('\x1b[34m');
      expect(logger.ANSI.magenta).toBe('\x1b[35m');
      expect(logger.ANSI.cyan).toBe('\x1b[36m');
      expect(logger.ANSI.yellow).toBe('\x1b[33m');
    });

    it('exports text style codes', () => {
      expect(logger.ANSI.bold).toBe('\x1b[1m');
      expect(logger.ANSI.dim).toBe('\x1b[2m');
      expect(logger.ANSI.underline).toBe('\x1b[4m');
    });

    it('exports bright color codes', () => {
      expect(logger.ANSI.brightRed).toBe('\x1b[91m');
      expect(logger.ANSI.brightGreen).toBe('\x1b[92m');
      expect(logger.ANSI.brightBlue).toBe('\x1b[94m');
    });
  });

  describe('AGENT_COLORS', () => {
    it('maps claude to magenta', () => {
      expect(logger.AGENT_COLORS.claude).toBe(logger.ANSI.magenta);
    });

    it('maps gemini to cyan', () => {
      expect(logger.AGENT_COLORS.gemini).toBe(logger.ANSI.cyan);
    });

    it('maps codex to green', () => {
      expect(logger.AGENT_COLORS.codex).toBe(logger.ANSI.green);
    });
  });

  describe('info()', () => {
    it('logs with INFO prefix in blue', () => {
      logger.info('Test message');
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[INFO]');
      expect(output).toContain('Test message');
      expect(output).toContain(logger.ANSI.blue);
    });

    it('handles multiple arguments', () => {
      logger.info('Message', 'with', 'parts');
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('Message with parts');
    });

    it('handles objects', () => {
      logger.info('Data:', { key: 'value' });
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('{"key":"value"}');
    });
  });

  describe('success()', () => {
    it('logs with SUCCESS prefix in green', () => {
      logger.success('Operation completed');
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[SUCCESS]');
      expect(output).toContain('Operation completed');
      expect(output).toContain(logger.ANSI.green);
    });
  });

  describe('warn()', () => {
    it('logs with WARN prefix in yellow using console.warn', () => {
      logger.warn('Warning message');
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      const output = consoleWarnSpy.mock.calls[0][0];
      expect(output).toContain('[WARN]');
      expect(output).toContain('Warning message');
      expect(output).toContain(logger.ANSI.yellow);
    });
  });

  describe('error()', () => {
    it('logs with ERROR prefix in red using console.error', () => {
      logger.error('Error occurred');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const output = consoleErrorSpy.mock.calls[0][0];
      expect(output).toContain('[ERROR]');
      expect(output).toContain('Error occurred');
      expect(output).toContain(logger.ANSI.red);
    });

    it('handles error objects', () => {
      const error = new Error('Test error');
      logger.error('Failed:', error.message);
      const output = consoleErrorSpy.mock.calls[0][0];
      expect(output).toContain('Test error');
    });
  });

  describe('agent()', () => {
    it('logs claude messages in magenta', () => {
      logger.agent('claude', 'Starting refresh');
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[claude]');
      expect(output).toContain('Starting refresh');
      expect(output).toContain(logger.ANSI.magenta);
    });

    it('logs gemini messages in cyan', () => {
      logger.agent('gemini', 'Fetching status');
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[gemini]');
      expect(output).toContain(logger.ANSI.cyan);
    });

    it('logs codex messages in green', () => {
      logger.agent('codex', 'Parsing output');
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[codex]');
      expect(output).toContain(logger.ANSI.green);
    });

    it('handles case-insensitive agent names', () => {
      logger.agent('CLAUDE', 'Test');
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[CLAUDE]');
      expect(output).toContain(logger.ANSI.magenta);
    });

    it('uses white for unknown agents', () => {
      logger.agent('unknown', 'Test');
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[unknown]');
      expect(output).toContain(logger.ANSI.white);
    });

    it('preserves original agent name casing in output', () => {
      logger.agent('Claude', 'Test');
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[Claude]');
    });
  });

  describe('server()', () => {
    it('logs with SERVER prefix in cyan', () => {
      logger.server('Listening on port 3000');
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[SERVER]');
      expect(output).toContain('Listening on port 3000');
      expect(output).toContain(logger.ANSI.cyan);
    });
  });

  describe('getAgentColor()', () => {
    it('returns magenta for claude', () => {
      expect(logger.getAgentColor('claude')).toBe(logger.ANSI.magenta);
    });

    it('returns cyan for gemini', () => {
      expect(logger.getAgentColor('gemini')).toBe(logger.ANSI.cyan);
    });

    it('returns green for codex', () => {
      expect(logger.getAgentColor('codex')).toBe(logger.ANSI.green);
    });

    it('handles case-insensitive input', () => {
      expect(logger.getAgentColor('CLAUDE')).toBe(logger.ANSI.magenta);
      expect(logger.getAgentColor('Gemini')).toBe(logger.ANSI.cyan);
      expect(logger.getAgentColor('CODEX')).toBe(logger.ANSI.green);
    });

    it('returns white for unknown agents', () => {
      expect(logger.getAgentColor('unknown')).toBe(logger.ANSI.white);
    });
  });

  describe('highlightUrls()', () => {
    it('highlights HTTP URLs', () => {
      const text = 'Visit http://example.com for more';
      const result = logger.highlightUrls(text);
      expect(result).toContain(logger.ANSI.blue);
      expect(result).toContain(logger.ANSI.underline);
      expect(result).toContain('http://example.com');
    });

    it('highlights HTTPS URLs', () => {
      const text = 'Visit https://secure.example.com';
      const result = logger.highlightUrls(text);
      expect(result).toContain(logger.ANSI.blue);
      expect(result).toContain(logger.ANSI.underline);
      expect(result).toContain('https://secure.example.com');
    });

    it('highlights multiple URLs', () => {
      const text = 'Links: https://one.com and https://two.com';
      const result = logger.highlightUrls(text);
      const urlCount = (result.match(/\x1b\[34m/g) || []).length;
      expect(urlCount).toBe(2);
    });

    it('handles URLs with paths and query strings', () => {
      const text = 'API: https://api.example.com/v1/users?id=123&active=true';
      const result = logger.highlightUrls(text);
      expect(result).toContain('https://api.example.com/v1/users?id=123&active=true');
    });

    it('returns non-string values unchanged', () => {
      expect(logger.highlightUrls(123)).toBe(123);
      expect(logger.highlightUrls(null)).toBe(null);
      expect(logger.highlightUrls(undefined)).toBe(undefined);
    });

    it('handles text without URLs', () => {
      const text = 'No URLs here';
      const result = logger.highlightUrls(text);
      expect(result).toBe('No URLs here');
    });

    it('highlights URLs in logged messages', () => {
      logger.info('Check https://example.com/docs');
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain(logger.ANSI.underline);
      expect(output).toContain('https://example.com/docs');
    });
  });

  describe('edge cases', () => {
    it('handles empty messages', () => {
      logger.info();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[INFO]');
    });

    it('handles null and undefined arguments', () => {
      logger.info(null, undefined, 'text');
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('null');
      expect(output).toContain('undefined');
      expect(output).toContain('text');
    });

    it('handles arrays', () => {
      logger.info('Array:', [1, 2, 3]);
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[1,2,3]');
    });

    it('handles circular references gracefully', () => {
      const obj = { name: 'test' };
      obj.self = obj;
      // Should not throw
      expect(() => logger.info('Circular:', obj)).not.toThrow();
    });

    it('includes reset codes after colored text', () => {
      logger.info('Test');
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain(logger.ANSI.reset);
    });
  });

  describe('dim()', () => {
    it('wraps text with dim ANSI codes', () => {
      const result = logger.dim('verbose output');
      expect(result).toContain(logger.ANSI.dim);
      expect(result).toContain('verbose output');
      expect(result).toContain(logger.ANSI.reset);
    });

    it('returns dimmed empty string for empty input', () => {
      const result = logger.dim('');
      expect(result).toBe(`${logger.ANSI.dim}${logger.ANSI.reset}`);
    });

    it('can be used inline with agent logging', () => {
      logger.agent('claude', 'Output length:', logger.dim('500 chars'));
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[claude]');
      expect(output).toContain(logger.ANSI.dim);
      expect(output).toContain('500 chars');
    });
  });

  describe('json()', () => {
    it('formats and dims JSON objects', () => {
      const result = logger.json({ key: 'value' });
      expect(result).toContain(logger.ANSI.dim);
      expect(result).toContain('{"key":"value"}');
      expect(result).toContain(logger.ANSI.reset);
    });

    it('formats arrays as JSON', () => {
      const result = logger.json([1, 2, 3]);
      expect(result).toContain('[1,2,3]');
      expect(result).toContain(logger.ANSI.dim);
    });

    it('handles null values', () => {
      const result = logger.json(null);
      expect(result).toContain('null');
      expect(result).toContain(logger.ANSI.dim);
    });

    it('handles nested objects', () => {
      const result = logger.json({ a: { b: { c: 1 } } });
      expect(result).toContain('{"a":{"b":{"c":1}}}');
    });

    it('supports pretty printing', () => {
      const result = logger.json({ key: 'value' }, true);
      expect(result).toContain('{\n');
      expect(result).toContain('  "key": "value"');
      expect(result).toContain('\n}');
    });

    it('handles circular references gracefully', () => {
      const obj = { name: 'test' };
      obj.self = obj;
      // Should not throw and return string representation
      expect(() => logger.json(obj)).not.toThrow();
    });

    it('can be used inline with agent logging', () => {
      logger.agent('gemini', 'Parsed metadata:', logger.json({ version: '1.0' }));
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[gemini]');
      expect(output).toContain(logger.ANSI.dim);
      expect(output).toContain('{"version":"1.0"}');
    });
  });

  describe('module exports', () => {
    it('exports info method', () => {
      expect(typeof logger.info).toBe('function');
    });

    it('exports success method', () => {
      expect(typeof logger.success).toBe('function');
    });

    it('exports warn method', () => {
      expect(typeof logger.warn).toBe('function');
    });

    it('exports error method', () => {
      expect(typeof logger.error).toBe('function');
    });

    it('exports agent method', () => {
      expect(typeof logger.agent).toBe('function');
    });

    it('exports server method', () => {
      expect(typeof logger.server).toBe('function');
    });

    it('exports highlightUrls method', () => {
      expect(typeof logger.highlightUrls).toBe('function');
    });

    it('exports getAgentColor method', () => {
      expect(typeof logger.getAgentColor).toBe('function');
    });

    it('exports dim method', () => {
      expect(typeof logger.dim).toBe('function');
    });

    it('exports json method', () => {
      expect(typeof logger.json).toBe('function');
    });

    it('exports ANSI codes object', () => {
      expect(typeof logger.ANSI).toBe('object');
    });

    it('exports AGENT_COLORS object', () => {
      expect(typeof logger.AGENT_COLORS).toBe('object');
    });
  });
});
