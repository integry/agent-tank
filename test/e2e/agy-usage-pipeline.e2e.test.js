/**
 * End-to-End tests for the Antigravity usage pipeline.
 *
 * Drives raw `/usage` screen output through the full chain the server uses —
 * parse, pace evaluation, dashboard rendering — without requiring the
 * Antigravity CLI to be installed.
 */

const http = require('node:http');
const { AgyAgent } = require('../../src/agents/agy.js');
const { AgentTank } = require('../../src/index.js');
const { createRequestHandler } = require('../../src/server.js');
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

// Captured from `agy` 1.3.x → /usage, where Gemini 4 Argon is a separate
// quota pool whose group header has no "MODELS" suffix.
const ARGON_USAGE_SCREEN = `
└ Models & Quota

GEMINI MODELS
  Models within this group: Gemini Flash, Gemini Pro

  Weekly Limit Remaining
    [█████████████████████████████████████████████████░] 98.71%
    Refreshes in 160h 45m

  Five Hour Limit Remaining
    [█████████████████████████████████████████████████░] 98.32%
    Refreshes in 2h 45m


CLAUDE AND GPT MODELS
  Models within this group: Claude Opus, Claude Sonnet, GPT-OSS

  Weekly Limit Remaining
    [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0.00%
    Refreshes in 36h 36m

  Five Hour Limit Remaining
    Disabled: You have hit your weekly limit, the 5-hour limit does not currently apply.


GEMINI 4 ARGON
  For paid Pro plans, Argon quota is separate. Higher Argon quota (included as part of the larger Gemini quota bucket) is available on Ultra plans.

  Gemini 4 Argon Weekly Limit
    [█████████████████████████████████████████████████░] 98.23%
    Refreshes in 158h 44m
`;

// The CLI banner shown before /usage, naming the active model.
const ARGON_BANNER = `
 Antigravity CLI v1.3.2
 user@example.com
 /home/user/project

>
? for shortcuts    Gemini 4 Argon (Medium)
`;

describe('Antigravity Gemini 4 Argon pipeline E2E', () => {
  let tank;
  let server;
  let baseUrl;

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    tank = new AgentTank({ autoDiscover: false, autoRefreshEnabled: false, historyEnabled: false });
    const agent = tank.createAgent('agy');
    // Only the PTY is replaced: spawning the process prints the startup banner
    // that metadata is read from, and runCommand returns the /usage screen.
    agent.spawnProcess = jest.fn(async () => { agent.spawnOutput = ARGON_BANNER; });
    agent.runCommand = jest.fn().mockResolvedValue(ARGON_USAGE_SCREEN);
    tank.agents.set('agy', agent);
    await tank.refreshAgent('agy');

    server = http.createServer(createRequestHandler(tank));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    tank.stop();
    jest.restoreAllMocks();
  });

  async function getStatus() {
    const res = await fetch(`${baseUrl}/status`);
    expect(res.status).toBe(200);
    const { providers } = await res.json();
    return providers.find(p => p.id === 'agy');
  }

  it('parses the Argon pool as its own weekly limit', () => {
    const { models } = tank.agents.get('agy').usage;

    expect(models.map(m => m.model)).toEqual([
      'Gemini · Weekly Limit Remaining',
      'Gemini · Five Hour Limit Remaining',
      'Claude and GPT · Weekly Limit Remaining',
      'Gemini 4 Argon Weekly Limit',
    ]);
    const argon = models[3];
    expect(argon).toMatchObject({
      group: 'Gemini 4 Argon',
      cycle: 'weekly',
      usageLeft: 98.23,
      percentUsed: 1.8,
      resetsIn: '158h 44m',
      resetsInSeconds: 571440,
    });
    expect(Number.isNaN(Date.parse(argon.resetsAt))).toBe(false);
    expect(argon.paceEval.isBurningFast).toBe(false);
  });

  it('reports the Argon limit as a weekly window on GET /status', async () => {
    const provider = await getStatus();

    const argon = provider.windows.find(w => w.label === 'Gemini 4 Argon Weekly Limit');
    expect(argon).toMatchObject({
      type: 'weekly',
      model: 'Gemini 4 Argon',
      remaining_percent: 98.23,
      used_percent: 1.77,
      resets_in_seconds: expect.any(Number),
    });
    expect(Number.isNaN(Date.parse(argon.resets_at))).toBe(false);
    expect(provider.windows).toHaveLength(4);
    expect(provider.windows.some(w => /Disabled|paid Pro plans|GEMINI 4 ARGON/.test(w.label))).toBe(false);
  });

  it('keeps the unverified Argon context window unknown by default', async () => {
    const provider = await getStatus();

    expect(provider.context_window).toBeNull();
  });

  it('reports an operator override for the Argon context window', async () => {
    tank.contextWindows = { 'gemini-4-argon': 2000000 };

    const provider = await getStatus();

    expect(provider.context_window).toMatchObject({
      total_tokens: 2000000,
      model: 'Gemini 4 Argon',
      source: 'override',
    });
  });

  it('renders the Argon countdown on the dashboard', async () => {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('Gemini 4 Argon Weekly Limit');
    expect(html).toContain('158h 44m');
    expect(html).not.toContain('For paid Pro plans');
    expect(html).not.toContain('Infinityx pace');
  });
});
