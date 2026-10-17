/**
 * Metadata collection end to end: command submission over a chunked PTY,
 * through metadata capture, to the canonical `plan` and `context_window`.
 *
 * Fixtures are the screens rendered by Claude Code 2.1.302 and agy 1.4.0.
 */

jest.mock('node-pty', () => ({
  spawn: jest.fn(),
}));

const pty = require('node-pty');
const { ClaudeAgent } = require('../../src/agents/claude.js');
const { AgyAgent } = require('../../src/agents/agy.js');
const { normalizeAgentStatus } = require('../../src/usage-normalizer.js');

const ESC = '\x1b';

// Typing "/status" opens the slash-command autocomplete menu before Enter.
const CLAUDE_AUTOCOMPLETE_MENU = [
  `${ESC}[2K❯ /status`,
  `${ESC}[2K${ESC}[2m  /status   Show Claude Code status including version, model, account${ESC}[22m`,
  `${ESC}[2K${ESC}[2m  /usage    Show session cost, plan usage limits and duration${ESC}[22m`,
  '',
].join('\r\n');

// The Status panel after ANSI stripping; cursor-forward escapes remove spaces.
const CLAUDE_STATUS_PANEL = [
  'Settings  Status   Config   Usage   Stats',
  ' Version:2.1.302',
  ' Session ID:        00000000-0000-0000-0000-000000000000',
  ' Session kind:      interactive',
  ' cwd:               /tmp',
  ' Login method:ClaudeMaxaccount',
  " Organization:user@example.com'sOrganization",
  ' Email:user@example.com',
  ' Model:opus[1m](claude-opus-5-5[1m])',
  ' MCP servers:2 connected,4 need auth· /mcp',
  ' Esc to cancel',
].join('\n');

const AGY_BANNER_LINES = [
  ' ▄▀▀▄        Antigravity CLI 1.4.0',
  '▀▀▀▀▀▀       user@example.com (Google AI Pro)',
  '▀▀▀▀▀▀▀▀      Gemini 4 Argon (Medium)',
  '⚠ Warning',
  '  ⎿  "Gemini 3.1 Pro (High)" is no longer available. Using "Gemini 4 Argon (Medium)".',
];
const AGY_BANNER = [...AGY_BANNER_LINES, '? for shortcuts Gemini 4 Argon · medium'].join('\n');

// agy 1.4.0 without credentials: the spinner is drawn next to the login menu.
const AGY_SIGN_IN_SCREEN = [
  ' Welcome to the Antigravity CLI. You are currently not signed in.',
  '',
  ' ⣾  Signing in...\r Select login method:',
  ' > 1. Google OAuth',
  '   2. Use a Google Cloud project',
  '',
  '   ↑/↓ Navigate · enter Select',
].join('\r\n');

/**
 * A fake PTY that fans data out to every onData subscriber and replies to
 * writes through `respond(data, emit)`. Chunks are emitted on timers so the
 * agent sees them arrive the way a real PTY delivers them.
 */
function createChunkedShell({ startup = [], respond = () => {} }) {
  const listeners = new Set();
  const emit = (chunks, gapMs = 20) => {
    chunks.forEach((chunk, i) => {
      setTimeout(() => [...listeners].forEach(listener => listener(chunk)), (i + 1) * gapMs);
    });
  };
  const shell = {
    pid: 4242,
    onData: jest.fn((listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    }),
    onExit: jest.fn(() => ({ dispose: jest.fn() })),
    write: jest.fn(data => respond(data, emit)),
    kill: jest.fn(),
    resize: jest.fn(),
  };
  pty.spawn.mockReturnValue(shell);
  // The spawn handler is attached synchronously after pty.spawn returns.
  emit(startup);
  return shell;
}

async function refreshWithStubbedUsage(agent, ms) {
  agent.runCommand = jest.fn().mockResolvedValue('');
  const done = agent.refresh();
  await jest.advanceTimersByTimeAsync(ms);
  await done;
}

describe('agent metadata collection', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    pty.spawn.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('ClaudeAgent /status completion', () => {
    it('does not treat the slash-command autocomplete menu as the Status panel', () => {
      const agent = new ClaudeAgent();

      expect(agent._hasCompleteStatusOutput(CLAUDE_AUTOCOMPLETE_MENU)).toBe(false);
    });

    it('does not complete on a panel whose footer has not rendered yet', () => {
      const agent = new ClaudeAgent();
      const partial = `${CLAUDE_AUTOCOMPLETE_MENU}${CLAUDE_STATUS_PANEL.split('\n').slice(0, 3).join('\n')}`;

      expect(agent._hasCompleteStatusOutput(partial)).toBe(false);
    });

    it('treats the rendered Status panel as complete and parses it', () => {
      const agent = new ClaudeAgent();
      const output = `${CLAUDE_AUTOCOMPLETE_MENU}${CLAUDE_STATUS_PANEL}`;

      expect(agent._hasCompleteStatusOutput(output)).toBe(true);
      expect(agent._parseStatusOutput(output)).toMatchObject({
        loginMethod: 'ClaudeMaxaccount',
        model: 'claude-opus-5-5',
        version: '2.1.302',
        sessionId: '00000000-0000-0000-0000-000000000000',
        email: 'user@example.com',
      });
    });

    it('derives plan and context window from the parsed panel', () => {
      const agent = new ClaudeAgent();
      const metadata = agent._parseStatusOutput(CLAUDE_STATUS_PANEL);

      const provider = normalizeAgentStatus({ name: 'claude', metadata, usage: null });

      expect(provider.plan).toBe('max');
      expect(provider.context_window).toMatchObject({
        total_tokens: 1000000,
        model: 'claude-opus-5-5',
        source: 'known-model',
      });
    });
  });

  describe('ClaudeAgent metadata over a chunked PTY', () => {
    function createClaudeShell() {
      return createChunkedShell({
        startup: ['Welcome to Claude Code\r\n', '? for shortcuts\r\n'],
        respond: (data, emit) => {
          if (data === '/status') {
            emit([CLAUDE_AUTOCOMPLETE_MENU.slice(0, 30), CLAUDE_AUTOCOMPLETE_MENU.slice(30)]);
          } else if (data === '\r') {
            // Split mid-field so completion cannot rely on a single frame.
            const cut = CLAUDE_STATUS_PANEL.indexOf('Login method') + 6;
            emit([CLAUDE_STATUS_PANEL.slice(0, cut), CLAUDE_STATUS_PANEL.slice(cut)], 150);
          }
        },
      });
    }

    it('waits past the autocomplete menu for the panel submitted by Enter', async () => {
      const agent = new ClaudeAgent();
      const shell = createClaudeShell();

      await refreshWithStubbedUsage(agent, 2000);

      const writes = shell.write.mock.calls.map(([data]) => data);
      expect(writes.slice(0, 2)).toEqual(['/status', '\r']);
      expect(agent.metadata).toMatchObject({
        loginMethod: 'ClaudeMaxaccount',
        model: 'claude-opus-5-5',
        version: '2.1.302',
      });
    });

    it('exposes plan and context window from collected metadata', async () => {
      const agent = new ClaudeAgent();
      createClaudeShell();

      await refreshWithStubbedUsage(agent, 2000);
      const provider = normalizeAgentStatus(agent.getStatus());

      expect(provider.plan).toBe('max');
      expect(provider.context_window).toMatchObject({ total_tokens: 1000000, source: 'known-model' });
    });
  });

  describe('AgyAgent banner metadata', () => {
    it('parses version, email and model from the 1.4.0 banner', () => {
      const agent = new AgyAgent();

      expect(agent._parseAgyMetadata(AGY_BANNER)).toEqual({
        version: '1.4.0',
        email: 'user@example.com',
        plan: 'Google AI Pro',
        model: 'Gemini 4 Argon',
        cli: 'agy',
      });
    });

    it('omits the plan when the account line has no plan in parentheses', () => {
      const agent = new AgyAgent();
      const noPlan = AGY_BANNER.replace('user@example.com (Google AI Pro)', 'user@example.com');

      expect(agent._parseAgyMetadata(noPlan).plan).toBeUndefined();
    });

    it('reports the banner plan as the canonical plan', () => {
      const metadata = new AgyAgent()._parseAgyMetadata(AGY_BANNER);
      const result = normalizeAgentStatus({ name: 'agy', id: 'agy', provider: 'agy', usage: { models: [] }, metadata });

      expect(result.plan).toBe('google ai pro');
    });

    it('ignores the model quoted in the "no longer available" notice', () => {
      const agent = new AgyAgent();
      const withoutBannerModel = AGY_BANNER.replace('▀▀▀▀▀▀▀▀      Gemini 4 Argon (Medium)\n', '');

      // Falls back to the status line, never the retired "Gemini 3.1 Pro".
      expect(agent._parseAgyMetadata(withoutBannerModel).model).toBe('Gemini 4 Argon');
      expect(agent._parseAgyMetadata(AGY_BANNER_LINES.filter((_, i) => i !== 2).join('\n')).model)
        .toBeUndefined();
    });

    it('reports the sign-in menu as unauthenticated despite its spinner', () => {
      expect(new AgyAgent().detectAuthenticationState(AGY_SIGN_IN_SCREEN)).toMatchObject({
        authenticated: false,
        status: 'unauthenticated',
      });
    });

    it('still treats a sign-in without the login menu as in progress', () => {
      expect(new AgyAgent().detectAuthenticationState(' You are currently not signed in.\n ⣾  Signing in...')).toBeNull();
    });

    it('returns only the cli marker when nothing has rendered', () => {
      expect(new AgyAgent()._parseAgyMetadata('')).toEqual({ cli: 'agy' });
    });
  });

  describe('AgyAgent metadata over a chunked PTY', () => {
    it('spawns the CLI and parses the banner on the first refresh', async () => {
      const agent = new AgyAgent();
      createChunkedShell({
        startup: [`${AGY_BANNER_LINES.slice(0, 2).join('\r\n')}\r\n`, `${AGY_BANNER_LINES.slice(2).join('\r\n')}\r\n>\r\n`],
      });

      await refreshWithStubbedUsage(agent, 1000);

      expect(pty.spawn).toHaveBeenCalledTimes(1);
      expect(agent.metadata).toEqual({
        version: '1.4.0',
        email: 'user@example.com',
        plan: 'Google AI Pro',
        model: 'Gemini 4 Argon',
        cli: 'agy',
      });
    });

    it('waits for a model line that renders after the prompt', async () => {
      const agent = new AgyAgent();
      createChunkedShell({
        startup: [`${AGY_BANNER_LINES[0]}\r\n${AGY_BANNER_LINES[1]}\r\n>\r\n`, '? for shortcuts Gemini 4 Argon · medium\r\n'],
      });

      await refreshWithStubbedUsage(agent, 1000);

      expect(agent.metadata.model).toBe('Gemini 4 Argon');
    });

    it('waits for the plan that agy redraws next to the account after the model', async () => {
      const agent = new AgyAgent();
      // agy 1.4.0 prints the account bare, then ~2s later moves the cursor up
      // and draws " (Google AI Pro)" after it.
      createChunkedShell({
        startup: [
          `${AGY_BANNER_LINES[0]}\r\n▀▀▀▀▀▀       ${ESC}[90muser@example.com${ESC}[m\r\n>\r\n`
            + `${ESC}[90m? for shortcuts${ESC}[m${ESC}[82X${ESC}[82C${ESC}[2mGemini 4 Argon · medium\r${ESC}[m`,
          `${ESC}[2A${ESC}[2C${ESC}[?25h${ESC}[?25l${ESC}[9A${ESC}[34C${ESC}[90m (Google AI Pro)${ESC}[m\n\n${ESC}[50D`,
        ],
      });

      await refreshWithStubbedUsage(agent, 1000);

      expect(agent.metadata).toMatchObject({ model: 'Gemini 4 Argon', plan: 'Google AI Pro' });
      expect(normalizeAgentStatus(agent.getStatus()).plan).toBe('google ai pro');
    });

    it('still reports the model when no plan is ever drawn', async () => {
      const agent = new AgyAgent();
      createChunkedShell({ startup: [`${AGY_BANNER_LINES[0]}\r\n>\r\n? for shortcuts Gemini 4 Argon · medium\r\n`] });

      await refreshWithStubbedUsage(agent, 5000);

      expect(agent.metadata.model).toBe('Gemini 4 Argon');
      expect(agent.metadata.plan).toBeUndefined();
    });

    it('stops at the sign-in screen instead of waiting out the spawn timeout', async () => {
      const agent = new AgyAgent();
      createChunkedShell({ startup: [AGY_SIGN_IN_SCREEN] });

      await refreshWithStubbedUsage(agent, 100);

      expect(agent.isRefreshing).toBe(false);
      expect(agent.metadata).toEqual({ cli: 'agy' });
      expect(agent.runCommand).toHaveBeenCalledTimes(1);
    });

    it('applies a contextWindows override for Gemini 4 Argon end to end', async () => {
      const agent = new AgyAgent();
      createChunkedShell({ startup: [`${AGY_BANNER}\r\n>\r\n`] });

      await refreshWithStubbedUsage(agent, 1000);
      const status = agent.getStatus();

      expect(normalizeAgentStatus(status).context_window).toBeNull();
      expect(normalizeAgentStatus(status, { contextWindows: { 'Gemini 4 Argon': 2000000 } }).context_window)
        .toMatchObject({ total_tokens: 2000000, model: 'Gemini 4 Argon', source: 'override' });
    });
  });
});
