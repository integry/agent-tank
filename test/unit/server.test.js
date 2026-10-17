/**
 * Unit tests for the HTTP request handler's canonical /status responses.
 *
 * Uses mock req/res objects so no socket has to be bound.
 */

jest.mock('node-pty', () => ({
  spawn: jest.fn()
}));

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgentTank } = require('../../src/index.js');
const { createRequestHandler } = require('../../src/server.js');
const { createHistoryStore } = require('../../src/history-store.js');

function sqliteAvailable() {
  try {
    require('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

const describeIfSqlite = sqliteAvailable() ? describe : describe.skip;

function mockResponse() {
  const res = {
    headers: {},
    statusCode: null,
    body: null,
    setHeader: jest.fn((name, value) => { res.headers[name] = value; }),
    writeHead: jest.fn((code) => { res.statusCode = code; }),
    end: jest.fn((body) => { res.body = body; }),
  };
  return res;
}

async function invoke(handler, method, url) {
  const res = mockResponse();
  await handler({ method, url, headers: {} }, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

describe('server request handler', () => {
  let tank;
  let handler;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    tank = new AgentTank({ autoDiscover: false, autoRefreshEnabled: false, historyEnabled: false });
    const claude = tank.createAgent('claude');
    claude.usage = {
      session: { label: 'Current session', percent: 42, resetsAt: '2026-10-03T22:00:00Z', resetsInSeconds: 7200 },
      weeklyAll: null,
      weeklyFable: null,
    };
    claude.lastUpdated = new Date().toISOString();
    tank.agents.set('claude', claude);
    handler = createRequestHandler(tank);
  });

  afterEach(() => {
    tank.stop();
    jest.restoreAllMocks();
  });

  it('GET /status returns the canonical providers array with raw payloads', async () => {
    const { status, json } = await invoke(handler, 'GET', '/status');

    expect(status).toBe(200);
    expect(Object.keys(json)).toEqual(['providers']);
    expect(json.providers).toHaveLength(1);
    const [provider] = json.providers;
    expect(provider).toMatchObject({ id: 'claude', provider: 'claude', status: 'ok' });
    expect(provider.windows).toHaveLength(1);
    expect(provider.windows[0]).toMatchObject({
      type: 'session',
      used_percent: 42,
      remaining_percent: 58,
      resets_at: '2026-10-03T22:00:00.000Z',
    });
    expect(provider.raw.usage.session.percent).toBe(42);
  });

  it('GET /status/:id returns a single canonical provider', async () => {
    const { status, json } = await invoke(handler, 'GET', '/status/claude');

    expect(status).toBe(200);
    expect(json.id).toBe('claude');
    expect(json.windows[0].type).toBe('session');
    expect(json.raw.name).toBe('claude');
  });

  it('GET /status/:id returns 404 for unknown agents', async () => {
    const { status, json } = await invoke(handler, 'GET', '/status/missing');

    expect(status).toBe(404);
    expect(json).toEqual({ error: 'Agent not found' });
  });

  it('POST /refresh returns the canonical providers array', async () => {
    jest.spyOn(tank, 'refreshAll').mockResolvedValue();

    const { status, json } = await invoke(handler, 'POST', '/refresh');

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.providers.map(p => p.id)).toEqual(['claude']);
  });

  it('POST /refresh/:id returns the canonical provider', async () => {
    jest.spyOn(tank, 'refreshAgent').mockResolvedValue();

    const { status, json } = await invoke(handler, 'POST', '/refresh/claude');

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.provider.id).toBe('claude');
  });

  describe('multiple accounts from the same provider', () => {
    function addCodexAccount(id, alias, percentUsed, planType) {
      const agent = tank.createAgent({ provider: 'codex', id, alias, configPath: `/srv/accounts/codex-${id}` });
      agent.usage = {
        fiveHour: null,
        weekly: { percentUsed, percentLeft: 100 - percentUsed, resetsAt: '2026-10-10T00:00:00Z', resetsInSeconds: 3600 },
      };
      agent.metadata = { planType };
      agent.lastUpdated = new Date().toISOString();
      tank.agents.set(id, agent);
    }

    beforeEach(() => {
      tank.agents.clear();
      addCodexAccount('work', 'Work', 70, 'pro');
      addCodexAccount('personal', 'Personal', 15, 'plus');
    });

    it('GET /status keys each provider by its configured id, not the provider family', async () => {
      const { json } = await invoke(handler, 'GET', '/status');

      expect(json.providers.map(p => [p.id, p.provider, p.plan, p.windows[0].used_percent])).toEqual([
        ['work', 'codex', 'pro', 70],
        ['personal', 'codex', 'plus', 15],
      ]);
      expect(json.providers.map(p => p.raw.alias)).toEqual(['Work', 'Personal']);
    });

    it('GET /status/:id resolves each configured id independently', async () => {
      const work = await invoke(handler, 'GET', '/status/work');
      const personal = await invoke(handler, 'GET', '/status/personal');
      const family = await invoke(handler, 'GET', '/status/codex');

      expect(work.json).toMatchObject({ id: 'work', provider: 'codex', plan: 'pro' });
      expect(personal.json).toMatchObject({ id: 'personal', provider: 'codex', plan: 'plus' });
      expect(family.status).toBe(404);
    });

    it('POST /refresh/:id refreshes and returns only the configured account', async () => {
      const refreshAgent = jest.spyOn(tank, 'refreshAgent').mockResolvedValue();

      const { status, json } = await invoke(handler, 'POST', '/refresh/personal');

      expect(status).toBe(200);
      expect(refreshAgent).toHaveBeenCalledWith('personal');
      expect(json.provider).toMatchObject({ id: 'personal', provider: 'codex' });
      expect(json.provider.windows[0].used_percent).toBe(15);
    });
  });

  describe('history routes with history disabled', () => {
    it('GET /config reports the history backend as "none"', async () => {
      const { status, json } = await invoke(handler, 'GET', '/config');

      expect(status).toBe(200);
      expect(json.history).toEqual({ enabled: false, store: 'none', path: null, retentionDays: 14 });
    });

    it('GET /history returns empty stats', async () => {
      const { status, json } = await invoke(handler, 'GET', '/history');

      expect(status).toBe(200);
      expect(json).toMatchObject({ store: 'none', enabled: false, totalRows: 0, agents: {} });
    });

    it('GET /history/:id returns no series', async () => {
      const { json } = await invoke(handler, 'GET', '/history/claude');

      expect(json).toEqual({ id: 'claude', store: 'none', series: [] });
    });
  });

  describeIfSqlite('history routes with the SQLite store', () => {
    let testDir;
    let dbPath;

    beforeEach(async () => {
      tank.stop();
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-history-test-'));
      dbPath = path.join(testDir, 'history.db');
      tank = new AgentTank({
        autoDiscover: false,
        autoRefreshEnabled: false,
        historyStore: createHistoryStore({ dbPath, retentionDays: 7 }),
      });
      const work = tank.createAgent({ provider: 'codex', id: 'work', configPath: '/srv/codex-work' });
      work.refresh = jest.fn(async () => {
        work._setUsage({ fiveHour: { percentUsed: 20 }, weekly: { percentUsed: 45 } });
      });
      tank.agents.set('work', work);
      handler = createRequestHandler(tank);
      await tank.refreshAgent('work');
    });

    afterEach(() => {
      tank.stop();
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('GET /config reports the sqlite backend and database path', async () => {
      const { json } = await invoke(handler, 'GET', '/config');

      expect(json.history).toEqual({ enabled: true, store: 'sqlite', path: dbPath, retentionDays: 7 });
    });

    it('GET /history reports the backend and per-agent row counts', async () => {
      const { json } = await invoke(handler, 'GET', '/history');

      expect(json).toMatchObject({ store: 'sqlite', path: dbPath, totalRows: 2 });
      expect(json.agents.work).toMatchObject({ provider: 'codex', rows: 2, snapshots: 1, metrics: 2 });
    });

    it('GET /history/:id returns metric series, filterable by metric key', async () => {
      const all = await invoke(handler, 'GET', '/history/work');
      const weekly = await invoke(handler, 'GET', '/history/work?metric=weekly');

      expect(all.json.store).toBe('sqlite');
      expect(all.json.series.map(s => s.key)).toEqual(['fiveHour', 'weekly']);
      expect(weekly.json.series).toHaveLength(1);
      expect(weekly.json.series[0]).toMatchObject({ key: 'weekly', unit: 'percent', cycle: 'weekly' });
      expect(weekly.json.series[0].points[0].percent).toBe(45);
    });

    it('GET /history/:id honours the since filter', async () => {
      const future = Date.now() + 60_000;
      const { json } = await invoke(handler, 'GET', `/history/work?since=${future}`);

      expect(json.series).toEqual([]);
    });
  });
});
