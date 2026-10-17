/**
 * Unit tests for the dashboard's client-side /status polling.
 *
 * The browser script is evaluated in a vm sandbox with stubbed DOM and fetch;
 * /status responses come from the real request handler so the test covers the
 * canonical { providers: [...] } shape the page consumes.
 */

jest.mock('node-pty', () => ({
  spawn: jest.fn()
}));

const vm = require('vm');
const { AgentTank } = require('../../src/index.js');
const { createRequestHandler } = require('../../src/server.js');
const { autoRefreshScript } = require('../../src/client-auto-refresh.js');

function fakeClassList() {
  const classes = new Set();
  return {
    add: (...names) => names.forEach(n => classes.add(n)),
    remove: (...names) => names.forEach(n => classes.delete(n)),
    contains: (name) => classes.has(name),
    values: () => [...classes].sort(),
  };
}

function fakeCard(agentId) {
  return { dataset: { agentId }, classList: fakeClassList() };
}

async function fetchFromHandler(handler, url) {
  const res = {
    statusCode: null,
    body: null,
    setHeader: () => {},
    writeHead: (code) => { res.statusCode = code; },
    end: (body) => { res.body = body; },
  };
  await handler({ method: 'GET', url, headers: {} }, res);
  return { ok: res.statusCode === 200, status: res.statusCode, json: async () => JSON.parse(res.body) };
}

function loadDashboard(handler, cards, extras = []) {
  const context = {
    console: { log: () => {}, warn: () => {}, error: jest.fn() },
    // Disable the timer-driven loop; tests call performAutoRefresh directly.
    fetch: (url) => url === '/config'
      ? Promise.resolve({ ok: true, json: async () => ({ autoRefresh: { enabled: false, interval: 0 } }) })
      : fetchFromHandler(handler, url),
    document: {
      querySelector: () => null,
      querySelectorAll: (selector) => {
        if (selector === '.agent-card') return cards;
        if (selector === '.usage-extras') return extras;
        return [];
      },
    },
    localStorage: { setItem: () => {} },
    autoRefreshConfig: { enabled: false, interval: 0 },
    autoRefreshTimer: null,
    pinnedMetric: null,
    trackedMetric: null,
    highlightTrackedMetric: () => {},
    updateFaviconAndTitle: () => {},
    checkAndNotify: () => {},
    renderHistoryCharts: () => {},
    setTimeout,
    clearInterval,
    setInterval,
  };
  vm.createContext(context);
  vm.runInContext(autoRefreshScript, context);
  context.updatedMetrics = [];
  context.updateMetricDOM = (metric) => context.updatedMetrics.push(metric);
  return context;
}

describe('dashboard auto-refresh polling', () => {
  let tank;
  let handler;

  function addClaudeAccount(id, alias, percent, error = null) {
    const agent = tank.createAgent({ provider: 'claude', id, alias, configPath: `/srv/accounts/claude-${id}` });
    agent.usage = {
      session: { label: 'Current session', percent, resetsIn: '1h', resetsAt: '2026-10-03T22:00:00Z', resetsInSeconds: 3600 },
      weeklyAll: null,
      weeklyFable: null,
    };
    agent.error = error;
    agent.lastUpdated = new Date().toISOString();
    tank.agents.set(id, agent);
  }

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    tank = new AgentTank({ autoDiscover: false, autoRefreshEnabled: false });
    addClaudeAccount('work', 'Work', 64);
    addClaudeAccount('personal', 'Personal', 12, 'Timeout waiting for usage data');
    handler = createRequestHandler(tank);
  });

  afterEach(() => {
    tank.stop();
    jest.restoreAllMocks();
  });

  it('updates metrics for each configured account id of the same provider', async () => {
    const dashboard = loadDashboard(handler, [fakeCard('work'), fakeCard('personal')]);

    await dashboard.performAutoRefresh();

    expect(dashboard.console.error).not.toHaveBeenCalled();
    expect(dashboard.updatedMetrics.map(m => [m.metricId, m.agent, m.percent])).toEqual([
      ['work-session', 'work', 64],
      ['personal-session', 'personal', 12],
    ]);
  });

  it('applies each account\'s state to its own agent card', async () => {
    const work = fakeCard('work');
    const personal = fakeCard('personal');
    const dashboard = loadDashboard(handler, [work, personal]);

    await dashboard.performAutoRefresh();

    expect(work.classList.values()).toEqual(['ok']);
    expect(personal.classList.values()).toEqual(['error']);
  });

  it('tracks the highest metric across accounts by configured id', async () => {
    const dashboard = loadDashboard(handler, []);

    await dashboard.performAutoRefresh();

    expect(dashboard.trackedMetric).toMatchObject({ metricId: 'work-session', agent: 'work', percent: 64 });
  });

  describe('context window and credits rows', () => {
    function addCodexAccount(id, usage) {
      const agent = tank.createAgent({ provider: 'codex', id, alias: id });
      agent.usage = usage;
      agent.lastUpdated = new Date().toISOString();
      tank.agents.set(id, agent);
      return agent;
    }

    function fakeExtras(agentId) {
      return { dataset: { agentId }, innerHTML: '', style: { display: 'none' } };
    }

    it('fills in a Codex card\'s rows after an XHR refresh', async () => {
      addCodexAccount('codex', {
        fiveHour: null,
        weekly: { percentUsed: 81, percentLeft: 19, resetsIn: '4d 2h' },
        model: 'GPT-6-Astra',
        contextWindow: { percentLeft: 25, usedTokens: 198000, totalTokens: 258000 },
        credits: { remaining: 48405, unit: 'credits' },
      });
      const extras = fakeExtras('codex');
      const dashboard = loadDashboard(handler, [], [extras]);

      await dashboard.performAutoRefresh();

      expect(extras.style.display).toBe('');
      expect(extras.innerHTML).toContain('Context window');
      expect(extras.innerHTML).toContain('198K / 258K');
      expect(extras.innerHTML).toContain('48,405 credits');
    });

    it('redraws the rows with new values and hides them once they disappear', async () => {
      const agent = addCodexAccount('codex', {
        weekly: { percentUsed: 10 },
        contextWindow: { usedTokens: 10000, totalTokens: 258000 },
        credits: { remaining: 100 },
      });
      const extras = fakeExtras('codex');
      const dashboard = loadDashboard(handler, [], [extras]);

      await dashboard.performAutoRefresh();
      expect(extras.innerHTML).toContain('10K / 258K');
      expect(extras.innerHTML).toContain('100 credits');

      agent.usage = { weekly: { percentUsed: 12 }, contextWindow: { usedTokens: 50000, totalTokens: 258000 }, credits: { remaining: 90 } };
      await dashboard.performAutoRefresh();
      expect(extras.innerHTML).toContain('50K / 258K');
      expect(extras.innerHTML).toContain('90 credits');

      agent.usage = { weekly: { percentUsed: 12 } };
      await dashboard.performAutoRefresh();
      expect(extras.innerHTML).toBe('');
      expect(extras.style.display).toBe('none');
    });

    it('leaves a Claude card without a known model hidden', async () => {
      const extras = fakeExtras('work');
      const dashboard = loadDashboard(handler, [], [extras]);

      await dashboard.performAutoRefresh();

      expect(extras.innerHTML).toBe('');
      expect(extras.style.display).toBe('none');
    });
  });
});
