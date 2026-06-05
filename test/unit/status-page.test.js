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
});
