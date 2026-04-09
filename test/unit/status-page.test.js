const { statusPage } = require('../../src/status-page.js');

describe('statusPage', () => {
  it('renders authentication-required notices from agent status', () => {
    const html = statusPage({
      gemini: {
        usage: null,
        metadata: null,
        lastUpdated: '2026-04-09T12:00:00.000Z',
        error: 'Authentication required',
        auth: {
          authenticated: false,
          status: 'unauthenticated',
          message: 'Authentication required',
          detail: 'Failed to sign in: Authentication consent could not be obtained.',
          action: 'Run Gemini CLI in an interactive terminal to authenticate, or use NO_BROWSER=true for manual authentication.',
        },
        isRefreshing: false,
        publicStatus: null,
      },
    });

    expect(html).toContain('Run Gemini CLI in an interactive terminal to authenticate');
    expect(html).toContain('NO_BROWSER=true');
    expect(html).toContain('auth-notice');
    expect(html).not.toContain('Failed to sign in');
  });
});
