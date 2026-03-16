/**
 * Unit tests for CLI output parsing (BaseAgent, Claude, Gemini, Codex)
 *
 * Tests parser logic to ensure complex regex rules and text stripping
 * functions work across different output variations without invoking
 * actual shell processes.
 */

// Mock node-pty to avoid native module issues in unit tests
jest.mock('node-pty', () => ({
  spawn: jest.fn()
}));

const { BaseAgent } = require('../../src/agents/base.js');
const { ClaudeAgent } = require('../../src/agents/claude.js');
const { GeminiAgent } = require('../../src/agents/gemini.js');
const { CodexAgent } = require('../../src/agents/codex.js');

describe('BaseAgent', () => {
  let agent;

  beforeEach(() => {
    agent = new BaseAgent('test', 'test-cmd');
  });

  describe('stripAnsi', () => {
    it('removes basic color codes', () => {
      const input = '\x1B[31mRed text\x1B[0m';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Red text');
    });

    it('removes bold and formatting codes', () => {
      const input = '\x1B[1mBold\x1B[0m \x1B[4mUnderline\x1B[0m';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Bold Underline');
    });

    it('removes 256-color codes', () => {
      const input = '\x1B[38;5;196mColored\x1B[0m';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Colored');
    });

    it('removes RGB color codes', () => {
      const input = '\x1B[38;2;255;100;50mRGB\x1B[0m';
      const result = agent.stripAnsi(input);
      expect(result).toBe('RGB');
    });

    it('converts cursor right movement to spaces (then collapses)', () => {
      const input = 'Hello\x1B[5CWorld';
      const result = agent.stripAnsi(input);
      // Cursor right creates spaces, but MULTI_SPACE collapses them
      expect(result).toBe('Hello World');
    });

    it('removes cursor positioning codes', () => {
      const input = '\x1B[10;20HPositioned\x1B[1A\x1B[2B';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Positioned');
    });

    it('removes cursor save/restore codes', () => {
      const input = '\x1B[sHello\x1B[uWorld';
      const result = agent.stripAnsi(input);
      expect(result).toBe('HelloWorld');
    });

    it('removes scroll region codes', () => {
      const input = '\x1B[0;24rContent';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Content');
    });

    it('removes OSC (Operating System Command) sequences', () => {
      const input = '\x1B]0;Window Title\x07Content';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Content');
    });

    it('removes OSC sequences with ST terminator', () => {
      const input = '\x1B]0;Title\x1B\\Text';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Text');
    });

    it('removes DCS (Device Control String) sequences', () => {
      const input = '\x1BPSome DCS content\x1B\\Normal';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Normal');
    });

    it('removes character set designation codes', () => {
      const input = '\x1B(BText\x1B)0More';
      const result = agent.stripAnsi(input);
      expect(result).toBe('TextMore');
    });

    it('removes two-character escape codes', () => {
      const input = '\x1B=\x1B>\x1BDText\x1BM';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Text');
    });

    it('removes erase line codes', () => {
      const input = 'Start\x1B[KMiddle\x1B[2KEnd';
      const result = agent.stripAnsi(input);
      expect(result).toBe('StartMiddleEnd');
    });

    it('removes clear screen codes', () => {
      const input = '\x1B[2JScreen\x1B[H';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Screen');
    });

    it('removes show/hide cursor codes', () => {
      const input = '\x1B[?25lHidden cursor\x1B[?25h';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Hidden cursor');
    });

    it('removes carriage returns', () => {
      const input = 'Line1\r\nLine2\rLine3';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Line1\nLine2Line3');
    });

    it('collapses multiple spaces to single space', () => {
      const input = 'Word1    Word2     Word3';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Word1 Word2 Word3');
    });

    it('handles complex mixed ANSI output', () => {
      const input = '\x1B[1;32m✓\x1B[0m \x1B[2mStatus:\x1B[0m \x1B[33mPending\x1B[0m\x1B[5C(50%)';
      const result = agent.stripAnsi(input);
      // Cursor movement creates spaces, MULTI_SPACE collapses them
      expect(result).toBe('✓ Status: Pending (50%)');
    });

    it('removes leftover escape characters', () => {
      const input = 'Text\x1BWrongEscape';
      const result = agent.stripAnsi(input);
      expect(result).toBe('TextWrongEscape');
    });

    it('handles empty string', () => {
      const result = agent.stripAnsi('');
      expect(result).toBe('');
    });

    it('preserves text without ANSI codes', () => {
      const input = 'Plain text without any codes';
      const result = agent.stripAnsi(input);
      expect(result).toBe('Plain text without any codes');
    });
  });

  describe('stripBoxChars', () => {
    it('removes box-drawing characters', () => {
      const input = '│Session ID│';
      const result = agent.stripBoxChars(input);
      expect(result).toBe('Session ID');
    });

    it('removes various box character styles', () => {
      const input = '╭─╮Content╰─╯';
      const result = agent.stripBoxChars(input);
      expect(result).toBe('Content');
    });

    it('handles double-line box characters', () => {
      const input = '╔═╗║Value║╚═╝';
      const result = agent.stripBoxChars(input);
      expect(result).toBe('Value');
    });

    it('handles null input', () => {
      const result = agent.stripBoxChars(null);
      expect(result).toBeNull();
    });

    it('handles undefined input', () => {
      const result = agent.stripBoxChars(undefined);
      expect(result).toBeUndefined();
    });
  });
});

describe('ClaudeAgent', () => {
  let agent;

  beforeEach(() => {
    agent = new ClaudeAgent();
  });

  describe('parseOutput', () => {
    it('parses session usage with percentage and reset time', () => {
      const output = `
        Current session
        45% used
        Resets 3:00pm (America/New_York)

        Current week (all models)
        25% used
        Resets Jan 15, 2pm (America/New_York)

        Current week (Sonnet only)
        10% used
        Resets Jan 15, 2pm (America/New_York)
      `;

      const result = agent.parseOutput(output);

      expect(result.session).not.toBeNull();
      expect(result.session.percent).toBe(45);
      expect(result.session.label).toBe('Current session');
    });

    it('parses weekly all models section', () => {
      const output = `
        Current session
        30% used
        Resets 5:00pm (America/New_York)

        Current week (all models)
        60% used
        Resets Jan 20, 9am (America/New_York)

        Current week (Sonnet only)
        40% used
        Resets Jan 20, 9am (America/New_York)
      `;

      const result = agent.parseOutput(output);

      expect(result.weeklyAll).not.toBeNull();
      expect(result.weeklyAll.percent).toBe(60);
      expect(result.weeklyAll.label).toBe('Current week (all models)');
    });

    it('parses weekly Sonnet only section', () => {
      const output = `
        Current session
        20% used
        Resets 6:00pm (America/New_York)

        Current week (all models)
        50% used
        Resets Jan 22, 1pm (America/New_York)

        Current week (Sonnet only)
        75% used
        Resets Jan 22, 1pm (America/New_York)
      `;

      const result = agent.parseOutput(output);

      expect(result.weeklySonnet).not.toBeNull();
      expect(result.weeklySonnet.percent).toBe(75);
      expect(result.weeklySonnet.label).toBe('Current week (Sonnet only)');
    });

    it('parses extra usage section with budget info', () => {
      const output = `
        Current session
        10% used
        Resets 4:00pm (America/New_York)

        Current week (all models)
        30% used
        Resets Feb 1, 8am (America/New_York)

        Current week (Sonnet only)
        20% used
        Resets Feb 1, 8am (America/New_York)

        Extra usage
        50% used
        $25.00 / $50.00 spent
        Resets Feb 1, 8am (America/New_York)
      `;

      const result = agent.parseOutput(output);

      expect(result.extraUsage).toBeDefined();
      expect(result.extraUsage.percent).toBe(50);
      expect(result.extraUsage.spent).toBe(25.00);
      expect(result.extraUsage.budget).toBe(50.00);
    });

    it('parses legacy weekly format (single "Current week")', () => {
      const output = `
        Current session
        35% used
        Resets 2:00pm (America/New_York)

        Current week
        55% used
        Resets Jan 18, 10am (America/New_York)
      `;

      const result = agent.parseOutput(output);

      expect(result.weekly).not.toBeNull();
      expect(result.weekly.percent).toBe(55);
      expect(result.weekly.label).toBe('Current week');
    });

    it('handles ANSI-formatted output correctly', () => {
      const output = `
        \x1B[1;32mCurrent session\x1B[0m
        \x1B[33m25% used\x1B[0m
        Resets \x1B[36m3:30pm\x1B[0m (America/New_York)

        \x1B[1;32mCurrent week (all models)\x1B[0m
        \x1B[33m40% used\x1B[0m
        Resets Jan 25, 11am (America/New_York)

        \x1B[1;32mCurrent week (Sonnet only)\x1B[0m
        \x1B[33m30% used\x1B[0m
        Resets Jan 25, 11am (America/New_York)
      `;

      const result = agent.parseOutput(output);

      expect(result.session).not.toBeNull();
      expect(result.session.percent).toBe(25);
      expect(result.weeklyAll.percent).toBe(40);
      expect(result.weeklySonnet.percent).toBe(30);
    });

    it('returns null for session when no session data present', () => {
      const output = `
        Some random output without usage data
      `;

      const result = agent.parseOutput(output);

      expect(result.session).toBeNull();
    });

    it('handles empty output gracefully', () => {
      const result = agent.parseOutput('');

      expect(result).toEqual({
        session: null,
        weeklyAll: null,
        weeklySonnet: null
      });
    });

    it('handles 0% usage', () => {
      const output = `
        Current session
        0% used
        Resets 11:00pm (America/New_York)

        Current week (all models)
        0% used
        Resets Jan 30, 3pm (America/New_York)

        Current week (Sonnet only)
        0% used
        Resets Jan 30, 3pm (America/New_York)
      `;

      const result = agent.parseOutput(output);

      expect(result.session.percent).toBe(0);
      expect(result.weeklyAll.percent).toBe(0);
      expect(result.weeklySonnet.percent).toBe(0);
    });

    it('handles 100% usage', () => {
      const output = `
        Current session
        100% used
        Resets 8:00am (America/New_York)

        Current week (all models)
        100% used
        Resets Feb 5, 6am (America/New_York)

        Current week (Sonnet only)
        100% used
        Resets Feb 5, 6am (America/New_York)
      `;

      const result = agent.parseOutput(output);

      expect(result.session.percent).toBe(100);
      expect(result.weeklyAll.percent).toBe(100);
      expect(result.weeklySonnet.percent).toBe(100);
    });

    it('includes pace data in session section', () => {
      const output = `
        Current session
        50% used
        Resets 2:30pm (America/New_York)

        Current week (all models)
        25% used
        Resets Jan 15, 2pm (America/New_York)

        Current week (Sonnet only)
        10% used
        Resets Jan 15, 2pm (America/New_York)
      `;

      const result = agent.parseOutput(output);

      // Session should have pace data when resetsInSeconds is available
      expect(result.session).not.toBeNull();
      if (result.session.resetsInSeconds !== null) {
        expect(result.session.pace).toBeDefined();
        expect(typeof result.session.pace.paceRatio).toBe('number');
        expect(typeof result.session.pace.elapsedPercent).toBe('number');
        expect(typeof result.session.pace.isWarning).toBe('boolean');
      }
    });

    it('includes pace data in weekly sections', () => {
      const output = `
        Current session
        30% used
        Resets 5:00pm (America/New_York)

        Current week (all models)
        60% used
        Resets Jan 20, 9am (America/New_York)

        Current week (Sonnet only)
        40% used
        Resets Jan 20, 9am (America/New_York)
      `;

      const result = agent.parseOutput(output);

      // Weekly sections should have pace data
      if (result.weeklyAll && result.weeklyAll.resetsInSeconds !== null) {
        expect(result.weeklyAll.pace).toBeDefined();
        expect(typeof result.weeklyAll.pace.paceRatio).toBe('number');
      }

      if (result.weeklySonnet && result.weeklySonnet.resetsInSeconds !== null) {
        expect(result.weeklySonnet.pace).toBeDefined();
        expect(typeof result.weeklySonnet.pace.paceRatio).toBe('number');
      }
    });
  });

  describe('parseResetTime', () => {
    it('parses time-only format (e.g., "2:59am")', () => {
      const result = agent.parseResetTime('2:59am (America/New_York)');

      expect(result).not.toBeNull();
      expect(result.text).toBeDefined();
      expect(result.seconds).toBeGreaterThanOrEqual(0);
    });

    it('parses 12-hour time with PM', () => {
      const result = agent.parseResetTime('3:30pm (America/New_York)');

      expect(result).not.toBeNull();
      expect(result.text).toBeDefined();
    });

    it('parses date+time format (e.g., "Jan 22, 1pm")', () => {
      const result = agent.parseResetTime('Jan 22, 1pm (America/New_York)');

      expect(result).not.toBeNull();
      expect(result.text).toBeDefined();
    });

    it('handles midnight (12am)', () => {
      const result = agent.parseResetTime('12:00am (America/New_York)');

      expect(result).not.toBeNull();
      expect(result.text).toBeDefined();
    });

    it('handles noon (12pm)', () => {
      const result = agent.parseResetTime('12:00pm (America/New_York)');

      expect(result).not.toBeNull();
      expect(result.text).toBeDefined();
    });

    it('returns null for null input', () => {
      const result = agent.parseResetTime(null);

      expect(result).toBeNull();
    });

    it('handles invalid format gracefully', () => {
      const result = agent.parseResetTime('invalid time string');

      expect(result).toEqual({ text: 'invalid time string', seconds: null });
    });
  });

  describe('_formatDuration', () => {
    it('formats minutes only', () => {
      const result = agent._formatDuration(1800); // 30 minutes
      expect(result).toBe('30m');
    });

    it('formats hours and minutes', () => {
      const result = agent._formatDuration(5400); // 1.5 hours
      expect(result).toBe('1h 30m');
    });

    it('formats days and hours', () => {
      const result = agent._formatDuration(90000); // 25 hours
      expect(result).toBe('1d 1h');
    });
  });
});

describe('GeminiAgent', () => {
  let agent;

  beforeEach(() => {
    agent = new GeminiAgent();
  });

  describe('parseOutput', () => {
    it('parses single model usage', () => {
      const output = `
        gemini-2.5-flash   90% (Resets in 3h 26m)
        Usage limits span all sessions
      `;

      const result = agent.parseOutput(output);

      expect(result.models).toHaveLength(1);
      expect(result.models[0].model).toBe('gemini-2.5-flash');
      expect(result.models[0].usageLeft).toBe(90);
      expect(result.models[0].percentUsed).toBe(10);
      expect(result.models[0].resetsIn).toBe('3h 26m');
    });

    it('parses multiple model usages', () => {
      const output = `
        gemini-2.5-flash   80% (Resets in 2h 15m)
        gemini-2.5-pro     50% (Resets in 5h 45m)
        gemini-1.5-pro     100% (Resets in 30m)
        Usage limits span all sessions
      `;

      const result = agent.parseOutput(output);

      expect(result.models).toHaveLength(3);
      expect(result.models[0].model).toBe('gemini-2.5-flash');
      expect(result.models[0].usageLeft).toBe(80);
      expect(result.models[1].model).toBe('gemini-2.5-pro');
      expect(result.models[1].usageLeft).toBe(50);
      expect(result.models[2].model).toBe('gemini-1.5-pro');
      expect(result.models[2].usageLeft).toBe(100);
    });

    it('handles negative/dash prefix in percentage (output formatting artifact)', () => {
      const output = `
        gemini-2.5-flash   -90.2% (Resets in 3h 26m)
        Usage limits span all sessions
      `;

      const result = agent.parseOutput(output);

      expect(result.models).toHaveLength(1);
      expect(result.models[0].usageLeft).toBe(90.2);
    });

    it('calculates percentUsed correctly', () => {
      const output = `
        gemini-2.5-flash   75% (Resets in 1h 30m)
        Usage limits span all sessions
      `;

      const result = agent.parseOutput(output);

      expect(result.models[0].percentUsed).toBe(25);
    });

    it('calculates resetsInSeconds correctly', () => {
      const output = `
        gemini-2.5-flash   90% (Resets in 2h 30m)
        Usage limits span all sessions
      `;

      const result = agent.parseOutput(output);

      expect(result.models[0].resetsInSeconds).toBe(2 * 60 * 60 + 30 * 60);
    });

    it('detects version update notification', () => {
      const output = `
        Update available! 0.24.5 → 0.32.1
        gemini-2.5-flash   90% (Resets in 3h 26m)
        Usage limits span all sessions
      `;

      const result = agent.parseOutput(output);

      expect(result.version).toBeDefined();
      expect(result.version.current).toBe('0.24.5');
      expect(result.version.latest).toBe('0.32.1');
    });

    it('handles ANSI-formatted output', () => {
      const output = `
        \x1B[32mgemini-2.5-flash\x1B[0m   \x1B[33m85%\x1B[0m (Resets in 4h 10m)
        Usage limits span all sessions
      `;

      const result = agent.parseOutput(output);

      expect(result.models).toHaveLength(1);
      expect(result.models[0].model).toBe('gemini-2.5-flash');
      expect(result.models[0].usageLeft).toBe(85);
    });

    it('avoids duplicate model entries', () => {
      const output = `
        gemini-2.5-flash   90% (Resets in 3h 26m)
        gemini-2.5-flash   90% (Resets in 3h 26m)
        Usage limits span all sessions
      `;

      const result = agent.parseOutput(output);

      expect(result.models).toHaveLength(1);
    });

    it('handles empty output gracefully', () => {
      const result = agent.parseOutput('');

      expect(result.models).toEqual([]);
    });

    it('handles output with no model data', () => {
      const output = 'Some random output without model usage';

      const result = agent.parseOutput(output);

      expect(result.models).toEqual([]);
    });

    it('handles 0% usage left', () => {
      const output = `
        gemini-2.5-flash   0% (Resets in 5h 0m)
        Usage limits span all sessions
      `;

      const result = agent.parseOutput(output);

      expect(result.models[0].usageLeft).toBe(0);
      expect(result.models[0].percentUsed).toBe(100);
    });

    it('handles decimal percentages', () => {
      const output = `
        gemini-2.5-flash   87.5% (Resets in 2h 45m)
        Usage limits span all sessions
      `;

      const result = agent.parseOutput(output);

      expect(result.models[0].usageLeft).toBe(87.5);
      expect(result.models[0].percentUsed).toBe(12.5);
    });

    it('includes pace data for each model', () => {
      const output = `
        gemini-2.5-flash   75% (Resets in 12h)
        gemini-2.5-pro     50% (Resets in 18h)
        Usage limits span all sessions
      `;

      const result = agent.parseOutput(output);

      expect(result.models.length).toBe(2);

      // Each model should have pace data
      for (const model of result.models) {
        if (model.resetsInSeconds !== null) {
          expect(model.pace).toBeDefined();
          expect(typeof model.pace.paceRatio).toBe('number');
          expect(typeof model.pace.elapsedPercent).toBe('number');
          expect(typeof model.pace.isWarning).toBe('boolean');
        }
      }
    });
  });

  describe('parseDurationToSeconds', () => {
    it('parses hours only', () => {
      const result = agent.parseDurationToSeconds('5h');
      expect(result).toBe(5 * 60 * 60);
    });

    it('parses minutes only', () => {
      const result = agent.parseDurationToSeconds('45m');
      expect(result).toBe(45 * 60);
    });

    it('parses hours and minutes', () => {
      const result = agent.parseDurationToSeconds('3h 26m');
      expect(result).toBe(3 * 60 * 60 + 26 * 60);
    });

    it('parses days', () => {
      const result = agent.parseDurationToSeconds('2d 5h');
      expect(result).toBe(2 * 24 * 60 * 60 + 5 * 60 * 60);
    });

    it('parses days, hours, and minutes', () => {
      const result = agent.parseDurationToSeconds('1d 12h 30m');
      expect(result).toBe(1 * 24 * 60 * 60 + 12 * 60 * 60 + 30 * 60);
    });

    it('returns null for null input', () => {
      const result = agent.parseDurationToSeconds(null);
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = agent.parseDurationToSeconds('');
      expect(result).toBeNull();
    });

    it('returns null for invalid format', () => {
      const result = agent.parseDurationToSeconds('invalid');
      expect(result).toBeNull();
    });

    it('handles case insensitivity', () => {
      const result = agent.parseDurationToSeconds('3H 26M');
      expect(result).toBe(3 * 60 * 60 + 26 * 60);
    });
  });
});

describe('CodexAgent', () => {
  let agent;

  beforeEach(() => {
    agent = new CodexAgent();
  });

  describe('parseOutput', () => {
    it('parses 5h limit usage', () => {
      const output = `
        5h limit: [████████░░] 80% left (resets 14:30)
        Weekly limit: [██████████] 100% left (resets 10:00 on 15 Mar)
      `;

      const result = agent.parseOutput(output);

      expect(result.fiveHour).not.toBeNull();
      expect(result.fiveHour.percentLeft).toBe(80);
      expect(result.fiveHour.percentUsed).toBe(20);
      expect(result.fiveHour.label).toBe('5h limit');
    });

    it('parses weekly limit usage', () => {
      const output = `
        5h limit: [██████████] 100% left (resets 16:45)
        Weekly limit: [████░░░░░░] 40% left (resets 09:00 on 20 Mar)
      `;

      const result = agent.parseOutput(output);

      expect(result.weekly).not.toBeNull();
      expect(result.weekly.percentLeft).toBe(40);
      expect(result.weekly.percentUsed).toBe(60);
      expect(result.weekly.label).toBe('Weekly limit');
    });

    it('calculates resetsInSeconds for time-only format', () => {
      const output = `
        5h limit: [████████░░] 80% left (resets 23:30)
        Weekly limit: [██████████] 100% left (resets 10:00 on 15 Mar)
      `;

      const result = agent.parseOutput(output);

      expect(result.fiveHour.resetsInSeconds).toBeDefined();
      expect(typeof result.fiveHour.resetsInSeconds).toBe('number');
    });

    it('calculates resetsInSeconds for date+time format', () => {
      const output = `
        5h limit: [██████████] 100% left (resets 14:00)
        Weekly limit: [████░░░░░░] 40% left (resets 09:00 on 25 Mar)
      `;

      const result = agent.parseOutput(output);

      expect(result.weekly.resetsInSeconds).toBeDefined();
    });

    it('extracts model name', () => {
      const output = `
        Model: GPT-5.3-Codex-Spark
        5h limit: [████████░░] 80% left (resets 14:30)
        Weekly limit: [██████████] 100% left (resets 10:00 on 15 Mar)
      `;

      const result = agent.parseOutput(output);

      expect(result.model).toBe('GPT-5.3-Codex-Spark');
    });

    it('extracts account email', () => {
      const output = `
        Account: user@example.com
        5h limit: [████████░░] 80% left (resets 14:30)
        Weekly limit: [██████████] 100% left (resets 10:00 on 15 Mar)
      `;

      const result = agent.parseOutput(output);

      expect(result.account).toBe('user@example.com');
    });

    it('handles ANSI-formatted output', () => {
      const output = `
        \x1B[32m5h limit:\x1B[0m [\x1B[33m████████░░\x1B[0m] 80% left (resets 14:30)
        \x1B[32mWeekly limit:\x1B[0m [\x1B[33m██████████\x1B[0m] 100% left (resets 10:00 on 15 Mar)
      `;

      const result = agent.parseOutput(output);

      expect(result.fiveHour).not.toBeNull();
      expect(result.fiveHour.percentLeft).toBe(80);
      expect(result.weekly.percentLeft).toBe(100);
    });

    it('handles empty output gracefully', () => {
      const result = agent.parseOutput('');

      expect(result.fiveHour).toBeNull();
      expect(result.weekly).toBeNull();
    });

    it('handles output without limit data', () => {
      const output = 'Some random output without limit information';

      const result = agent.parseOutput(output);

      expect(result.fiveHour).toBeNull();
      expect(result.weekly).toBeNull();
    });

    it('handles 0% left', () => {
      const output = `
        5h limit: [░░░░░░░░░░] 0% left (resets 15:00)
        Weekly limit: [░░░░░░░░░░] 0% left (resets 08:00 on 22 Mar)
      `;

      const result = agent.parseOutput(output);

      expect(result.fiveHour.percentLeft).toBe(0);
      expect(result.fiveHour.percentUsed).toBe(100);
      expect(result.weekly.percentLeft).toBe(0);
      expect(result.weekly.percentUsed).toBe(100);
    });

    it('parses model-specific limit sections', () => {
      const output = `
        5h limit: [████████░░] 80% left (resets 14:30)
        Weekly limit: [██████████] 100% left (resets 10:00 on 15 Mar)

        GPT-5.3-Codex-Spark limit:
        5h limit: [██████░░░░] 60% left (resets 15:00)
        Weekly limit: [████████░░] 80% left (resets 08:00 on 20 Mar)
      `;

      const result = agent.parseOutput(output);

      expect(result.modelLimits).toBeDefined();
      expect(result.modelLimits.length).toBeGreaterThan(0);
    });

    it('detects version info from update screen', () => {
      agent._spawnVersionInfo = { current: '1.0.0', latest: '1.1.0' };

      const output = `
        5h limit: [██████████] 100% left (resets 14:30)
        Weekly limit: [██████████] 100% left (resets 10:00 on 15 Mar)
      `;

      const result = agent.parseOutput(output);

      expect(result.version).toBeDefined();
      expect(result.version.current).toBe('1.0.0');
      expect(result.version.latest).toBe('1.1.0');
    });

    it('includes pace data in fiveHour and weekly limits', () => {
      const output = `
        5h limit: [████████░░] 80% left (resets 14:30)
        Weekly limit: [██████████] 100% left (resets 10:00 on 15 Mar)
      `;

      const result = agent.parseOutput(output);

      // Both limits should have pace data
      if (result.fiveHour && result.fiveHour.resetsInSeconds !== null) {
        expect(result.fiveHour.pace).toBeDefined();
        expect(typeof result.fiveHour.pace.paceRatio).toBe('number');
        expect(typeof result.fiveHour.pace.elapsedPercent).toBe('number');
        expect(typeof result.fiveHour.pace.isWarning).toBe('boolean');
      }

      if (result.weekly && result.weekly.resetsInSeconds !== null) {
        expect(result.weekly.pace).toBeDefined();
        expect(typeof result.weekly.pace.paceRatio).toBe('number');
      }
    });

    it('includes pace data in model-specific limits', () => {
      const output = `
        5h limit: [████████░░] 80% left (resets 14:30)
        Weekly limit: [██████████] 100% left (resets 10:00 on 15 Mar)

        GPT-5.3-Codex-Spark limit:
        5h limit: [██████░░░░] 60% left (resets 15:00)
        Weekly limit: [████████░░] 80% left (resets 08:00 on 20 Mar)
      `;

      const result = agent.parseOutput(output);

      expect(result.modelLimits).toBeDefined();
      expect(result.modelLimits.length).toBeGreaterThan(0);

      // Model-specific limits should also have pace data
      for (const modelLimit of result.modelLimits) {
        if (modelLimit.fiveHour && modelLimit.fiveHour.resetsInSeconds !== null) {
          expect(modelLimit.fiveHour.pace).toBeDefined();
        }
        if (modelLimit.weekly && modelLimit.weekly.resetsInSeconds !== null) {
          expect(modelLimit.weekly.pace).toBeDefined();
        }
      }
    });
  });

  describe('parseResetTime', () => {
    it('parses time-only format (HH:MM)', () => {
      const result = agent.parseResetTime('14:30');

      expect(result).not.toBeNull();
      expect(result.text).toBeDefined();
      expect(result.seconds).toBeGreaterThanOrEqual(0);
    });

    it('parses date+time format (HH:MM on DD Mon)', () => {
      const result = agent.parseResetTime('10:00 on 15 Mar');

      expect(result).not.toBeNull();
      expect(result.text).toBeDefined();
    });

    it('formats duration as days and hours for long durations', () => {
      // Parse a time that's more than 24 hours away
      const result = agent.parseResetTime('12:00 on 10 Dec');

      expect(result).not.toBeNull();
      // Duration formatting depends on the current time, just verify structure
      expect(typeof result.text).toBe('string');
    });

    it('formats duration as hours and minutes', () => {
      const result = agent.parseResetTime('23:30');

      expect(result).not.toBeNull();
      expect(result.text).toMatch(/^\d+[hmd]\s*\d*[hm]?$/);
    });

    it('returns null for null input', () => {
      const result = agent.parseResetTime(null);

      expect(result).toBeNull();
    });

    it('handles invalid format gracefully', () => {
      const result = agent.parseResetTime('invalid time');

      expect(result).toEqual({ text: 'invalid time', seconds: null });
    });
  });

  describe('parseLimitEntry', () => {
    it('creates correct limit entry structure', () => {
      const match = ['full match', '75', '14:30'];
      const result = agent.parseLimitEntry(match, '5h limit', 'fiveHour');

      expect(result.percentLeft).toBe(75);
      expect(result.percentUsed).toBe(25);
      expect(result.resetsAt).toBe('14:30');
      expect(result.label).toBe('5h limit');
    });

    it('includes resetsIn text', () => {
      const match = ['full match', '50', '16:00'];
      const result = agent.parseLimitEntry(match, 'Weekly limit', 'weekly');

      expect(result.resetsIn).toBeDefined();
    });

    it('includes resetsInSeconds', () => {
      const match = ['full match', '80', '18:30'];
      const result = agent.parseLimitEntry(match, '5h limit', 'fiveHour');

      expect(typeof result.resetsInSeconds).toBe('number');
    });

    it('includes pace data when resetsInSeconds is available', () => {
      const match = ['full match', '50', '14:30']; // 50% left = 50% used
      const result = agent.parseLimitEntry(match, '5h limit', 'fiveHour');

      // Pace data should be present
      expect(result.pace).toBeDefined();
      expect(result.pace.paceRatio).toBeGreaterThanOrEqual(0);
      expect(typeof result.pace.elapsedPercent).toBe('number');
      expect(typeof result.pace.isWarning).toBe('boolean');
    });
  });

  describe('parseVersionInfo', () => {
    it('parses update arrow format', () => {
      const output = '1.0.5 -> 1.1.0';
      const result = agent.parseVersionInfo(output);

      expect(result.current).toBe('1.0.5');
      expect(result.latest).toBe('1.1.0');
    });

    it('parses version from header', () => {
      const output = 'OpenAI Codex CLI (v1.2.3)';
      const result = agent.parseVersionInfo(output);

      expect(result.current).toBe('1.2.3');
    });

    it('returns null for no version info', () => {
      const output = 'No version information here';
      const result = agent.parseVersionInfo(output);

      expect(result).toBeNull();
    });
  });
});

describe('Graceful Degradation', () => {
  describe('BaseAgent', () => {
    it('stripAnsi handles null-like values safely', () => {
      const agent = new BaseAgent('test', 'test-cmd');
      // Note: stripAnsi doesn't handle null directly, but we test empty string
      expect(agent.stripAnsi('')).toBe('');
    });
  });

  describe('ClaudeAgent', () => {
    it('returns all-null usage for malformed output', () => {
      const agent = new ClaudeAgent();
      const result = agent.parseOutput('completely invalid output with no recognizable patterns');

      expect(result.session).toBeNull();
      expect(result.weeklyAll).toBeNull();
      expect(result.weeklySonnet).toBeNull();
    });

    it('handles partial data (session only)', () => {
      const agent = new ClaudeAgent();
      const output = `
        Current session
        50% used
        Resets 5:00pm (America/New_York)
      `;

      const result = agent.parseOutput(output);

      expect(result.session).not.toBeNull();
      expect(result.session.percent).toBe(50);
      expect(result.weeklyAll).toBeNull();
    });

    it('handles corrupted percentage values', () => {
      const agent = new ClaudeAgent();
      const output = `
        Current session
        invalid% used

        Current week (all models)
        25% used
        Resets Jan 15, 2pm (America/New_York)

        Current week (Sonnet only)
        10% used
        Resets Jan 15, 2pm (America/New_York)
      `;

      const result = agent.parseOutput(output);

      // Session parsing fails due to invalid percentage
      expect(result.session).toBeNull();
      // But weekly should still parse
      expect(result.weeklyAll.percent).toBe(25);
    });
  });

  describe('hasCompleteOutput – session error detection', () => {
    it('detects "session expired" as complete output', () => {
      const agent = new ClaudeAgent();
      expect(agent.hasCompleteOutput('Your session expired. Please sign in again.')).toBe(true);
    });

    it('detects "session error" as complete output', () => {
      const agent = new ClaudeAgent();
      expect(agent.hasCompleteOutput('session error: unable to retrieve usage data')).toBe(true);
    });

    it('detects "authentication error" as complete output', () => {
      const agent = new ClaudeAgent();
      expect(agent.hasCompleteOutput('Authentication error - please log in again')).toBe(true);
    });

    it('detects "Failed to load usage" as complete output', () => {
      const agent = new ClaudeAgent();
      expect(agent.hasCompleteOutput('Failed to load usage data')).toBe(true);
    });

    it('detects "Unable to load" as complete output', () => {
      const agent = new ClaudeAgent();
      expect(agent.hasCompleteOutput('Unable to load usage information')).toBe(true);
    });

    it('detects "not authenticated" as complete output', () => {
      const agent = new ClaudeAgent();
      expect(agent.hasCompleteOutput('Error: not authenticated')).toBe(true);
    });

    it('detects rate_limit_error as complete output', () => {
      const agent = new ClaudeAgent();
      expect(agent.hasCompleteOutput('rate_limit_error: too many requests')).toBe(true);
    });

    it('does not treat normal loading screen as complete', () => {
      const agent = new ClaudeAgent();
      expect(agent.hasCompleteOutput('Loading usage data…')).toBe(false);
    });
  });

  describe('GeminiAgent', () => {
    it('returns empty models array for malformed output', () => {
      const agent = new GeminiAgent();
      const result = agent.parseOutput('random garbage data');

      expect(result.models).toEqual([]);
    });

    it('parseDurationToSeconds returns null for malformed duration', () => {
      const agent = new GeminiAgent();

      expect(agent.parseDurationToSeconds('not a duration')).toBeNull();
      expect(agent.parseDurationToSeconds(undefined)).toBeNull();
    });
  });

  describe('CodexAgent', () => {
    it('returns null limits for malformed output', () => {
      const agent = new CodexAgent();
      const result = agent.parseOutput('garbage data with no patterns');

      expect(result.fiveHour).toBeNull();
      expect(result.weekly).toBeNull();
    });

    it('handles partial data (5h limit only)', () => {
      const agent = new CodexAgent();
      const output = `
        5h limit: [████████░░] 80% left (resets 14:30)
        Some other content
      `;

      const result = agent.parseOutput(output);

      expect(result.fiveHour).not.toBeNull();
      expect(result.weekly).toBeNull();
    });

    it('parseResetTime handles edge cases', () => {
      const agent = new CodexAgent();

      expect(agent.parseResetTime(null)).toBeNull();
      expect(agent.parseResetTime(undefined)).toBeNull();
      // Empty string returns null (no reset time to parse)
      expect(agent.parseResetTime('')).toBeNull();
    });
  });
});
