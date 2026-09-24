/**
 * End-to-End tests for the Antigravity usage pipeline.
 *
 * Drives raw `/usage` screen output through the full chain the server uses —
 * parse, pace evaluation, dashboard rendering — without requiring the
 * Antigravity CLI to be installed.
 */

const { AgyAgent } = require('../../src/agents/agy.js');
const { attachPaceEvaluation } = require('../../src/pace-attachment.js');
const { statusPage } = require('../../src/status-page.js');

// Captured from `agy` → /usage on a grouped "Models & Quota" build.
const USAGE_SCREEN = `
└ Models & Quota

  Account: user@example.com

GEMINI MODELS
  Models within this group: Gemini Flash, Gemini Pro

  Weekly Limit Remaining
    [█████████████████████████████████████████████████░] 97.68%
    Refreshes in 160h 12m

  Five Hour Limit Remaining
    [█████████████████████████████████████████████░░░░░] 90.31%
    Refreshes in 58m


CLAUDE AND GPT MODELS
  Models within this group: Claude Opus, Claude Sonnet, GPT-OSS

  Weekly Limit Remaining
    [██████████████████████████████████████████████████] 100.00%
    Quota available

  Five Hour Limit Remaining
    [██████████████████████████████████████████████████] 100.00%
    Quota available
`;

describe('Antigravity usage pipeline E2E', () => {
  let usage;

  beforeEach(() => {
    const agent = new AgyAgent();
    usage = agent.parseOutput(USAGE_SCREEN);
    attachPaceEvaluation('agy', usage);
  });

  it('carries every reset the CLI displays through to the API payload', () => {
    expect(usage.models.map(m => ({ model: m.model, resetsIn: m.resetsIn, resetsInSeconds: m.resetsInSeconds }))).toEqual([
      { model: 'Gemini · Weekly Limit Remaining', resetsIn: '160h 12m', resetsInSeconds: 576720 },
      { model: 'Gemini · Five Hour Limit Remaining', resetsIn: '58m', resetsInSeconds: 3480 },
      { model: 'Claude and GPT · Weekly Limit Remaining', resetsIn: null, resetsInSeconds: null },
      { model: 'Claude and GPT · Five Hour Limit Remaining', resetsIn: null, resetsInSeconds: null },
    ]);
  });

  it('records an absolute reset timestamp alongside the countdown', () => {
    const before = Date.now();

    for (const model of usage.models) {
      if (model.resetsInSeconds === null) {
        expect(model.resetsAt).toBeNull();
        continue;
      }
      const resetsAt = Date.parse(model.resetsAt);
      expect(Number.isNaN(resetsAt)).toBe(false);
      expect(resetsAt).toBeGreaterThanOrEqual(before + model.resetsInSeconds * 1000 - 5000);
      expect(resetsAt).toBeLessThanOrEqual(Date.now() + model.resetsInSeconds * 1000);
    }
  });

  it('evaluates pace per limit without flagging a weekly reset as out of cycle', () => {
    const weekly = usage.models.find(m => m.model === 'Gemini · Weekly Limit Remaining');
    expect(weekly.paceEval.isBurningFast).toBe(false);
    expect(Number.isFinite(weekly.paceEval.paceRatio)).toBe(true);
  });

  it('renders the countdowns on the dashboard', () => {
    const html = statusPage({
      agy: {
        usage,
        metadata: { cli: 'agy' },
        lastUpdated: '2026-09-23T10:54:24.962Z',
        error: null,
        auth: null,
        isRefreshing: false,
        publicStatus: null,
      },
    });

    expect(html).toContain('160h 12m');
    expect(html).toContain('58m');
    expect(html).not.toContain('Infinityx pace');
  });
});
