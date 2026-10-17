const { statusPage } = require('../../src/status-page.js');

describe('statusPage', () => {
  it('renders authentication-required notices from agent status', () => {
    const html = statusPage({
      agy: {
        usage: null,
        metadata: null,
        lastUpdated: '2026-04-09T12:00:00.000Z',
        error: 'Authentication required',
        auth: {
          authenticated: false,
          status: 'unauthenticated',
          message: 'Authentication required',
          detail: 'Failed to sign in: Authentication consent could not be obtained.',
          action: 'Run agy in an interactive terminal to authenticate.',
        },
        isRefreshing: false,
        publicStatus: null,
      },
    });

    expect(html).toContain('Run agy in an interactive terminal to authenticate');
    expect(html).toContain('auth-notice');
    expect(html).not.toContain('Failed to sign in');
  });

  it('renders Antigravity as the agy display name', () => {
    const html = statusPage({
      agy: {
        usage: { models: [] },
        metadata: null,
        lastUpdated: null,
        error: null,
        auth: null,
        isRefreshing: false,
        publicStatus: null,
      },
    });

    expect(html).toContain('<span>Antigravity</span>');
    expect(html).not.toContain('<span>Agy</span>');
  });

  it('shows reset info for zero-usage codex metrics when reset time exists', () => {
    const html = statusPage({
      codex: {
        usage: {
          model: 'gpt-5.4',
          fiveHour: {
            percentUsed: 0,
            resetsAt: '03:00',
            resetsIn: '3h 45m',
            resetsInSeconds: 13500,
          },
        },
        metadata: null,
        lastUpdated: '2026-04-11T00:00:00.000Z',
        error: null,
        auth: null,
        isRefreshing: false,
        publicStatus: null,
      },
    });

    expect(html).toContain('3h 45m');
    expect(html).not.toContain('reset-info-wrapper" style="display:none"');
  });

  it('renders separate cards and metric ids for multiple accounts of one provider', () => {
    const usage = {
      model: 'gpt-5.4',
      fiveHour: { percentUsed: 10, resetsIn: '4h' },
    };
    const baseStatus = {
      name: 'codex',
      usage,
      metadata: null,
      lastUpdated: null,
      error: null,
      auth: null,
      isRefreshing: false,
      publicStatus: null,
      provider: 'codex',
    };

    const html = statusPage({
      work: { ...baseStatus, id: 'work', alias: 'work' },
      personal: { ...baseStatus, id: 'personal', alias: 'personal' },
    });

    expect(html).toContain('<span>Codex · work</span>');
    expect(html).toContain('<span>Codex · personal</span>');
    expect(html).toContain('data-agent-id="work"');
    expect(html).toContain('data-agent-id="personal"');
    expect(html).toContain('data-metric-id="work-gpt-5-4-5h"');
    expect(html).toContain('data-metric-id="personal-gpt-5-4-5h"');
  });

  describe('usage-history chart container', () => {
    const codexStatus = {
      name: 'codex',
      provider: 'codex',
      usage: { model: 'gpt-5.4', fiveHour: { percentUsed: 10, resetsIn: '4h' } },
      metadata: null,
      lastUpdated: null,
      error: null,
      auth: null,
      isRefreshing: false,
      publicStatus: null,
    };

    it('adds one chart container per card, keyed by agent id, when enabled', () => {
      const html = statusPage({
        work: { ...codexStatus, id: 'work', alias: 'work' },
        personal: { ...codexStatus, id: 'personal', alias: 'personal' },
      }, { historyChart: true });

      expect(html.match(/class="history-chart"/g)).toHaveLength(2);
      expect(html).toContain('<div class="history-chart" data-agent-id="work"');
      expect(html).toContain('<div class="history-chart" data-agent-id="personal"');
      expect(html).toContain('<div class="history-chart-empty">Loading history…</div>');
    });

    it('escapes the agent id in the container', () => {
      const html = statusPage({ 'a"b': { ...codexStatus } }, { historyChart: true });

      expect(html).toContain('<div class="history-chart" data-agent-id="a&quot;b"');
    });

    it('omits the container when disabled or not requested', () => {
      const disabled = statusPage({ codex: codexStatus }, { historyChart: false });
      const defaulted = statusPage({ codex: codexStatus });

      expect(disabled).not.toContain('class="history-chart"');
      expect(defaulted).not.toContain('class="history-chart"');
    });

    it('ships the sparkline script and its styles with the page', () => {
      const html = statusPage({ codex: codexStatus }, { historyChart: true });

      expect(html).toContain('function renderHistoryCharts()');
      expect(html).toContain('.history-sparkline');
      expect(html).toContain('--chart-series-1');
    });
  });

  describe('context window and credits rows', () => {
    const codexStatus = {
      name: 'codex',
      provider: 'codex',
      usage: {
        model: 'GPT-6-Astra',
        fiveHour: null,
        weekly: { percentUsed: 81, percentLeft: 19, resetsIn: '4d 2h' },
        contextWindow: { percentLeft: 25, usedTokens: 198000, totalTokens: 258000 },
        credits: { remaining: 48405, unit: 'credits' },
      },
      metadata: null,
      error: null,
      isRefreshing: false,
      publicStatus: null,
    };

    it('renders a context-window row and a credits row on the Codex card', () => {
      const html = statusPage({ codex: codexStatus });

      expect(html).toContain('<div class="usage-extras" data-agent-id="codex">');
      expect(html).toContain('<span class="usage-label">Context window</span>');
      expect(html).toContain('<span class="usage-percent">77</span><span class="usage-suffix">% used</span>');
      expect(html).toContain('198K / 258K');
      expect(html).toContain('48,405 credits');
      expect(html).toContain('title="GPT-6-Astra: reported by the CLI"');
    });

    it('renders a known-model window size for a Claude card', () => {
      const html = statusPage({
        claude: { name: 'claude', provider: 'claude', usage: { session: { percent: 5 } }, metadata: { model: 'claude-opus-5-5' } },
      });

      const extras = html.match(/<div class="usage-extras" data-agent-id="claude">(.*?)<\/div>\s*<\/div>\s*\n/s)[1];

      expect(extras).toContain('<span class="usage-value">1M tokens</span>');
      expect(extras).toContain('title="claude-opus-5-5: known model window"');
      expect(extras).not.toContain('Credits');
    });

    it('applies config-file overrides', () => {
      const html = statusPage({
        codex: { ...codexStatus, usage: { ...codexStatus.usage, contextWindow: undefined } },
      }, { contextWindows: { 'gpt-6-astra': 300000 } });

      expect(html).toContain('300K tokens');
      expect(html).toContain('title="GPT-6-Astra: from the config file"');
    });

    it('keeps a hidden container when there is nothing to show so XHR can fill it', () => {
      const html = statusPage({ codex: { ...codexStatus, usage: { weekly: { percentUsed: 1 } } } });

      expect(html).toContain('<div class="usage-extras" data-agent-id="codex" style="display:none"></div>');
    });
  });
});
