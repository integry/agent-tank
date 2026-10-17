/**
 * Preloaded with `node -r` by the CLI history tests. Replaces AgentTank#start
 * so the real CLI runs end to end without spawning any vendor CLI: each
 * configured agent reports canned usage, which is recorded to history the
 * same way a real refresh records it.
 */

const { AgentTank } = require('../../src/index.js');

const USAGE = {
  claude: {
    session: { label: 'Current session', percent: 42 },
    weeklyAll: { label: 'Current week (all models)', percent: 10 },
  },
  codex: {
    fiveHour: { label: '5h limit', percentUsed: 5 },
    weekly: { label: 'Weekly limit', percentUsed: 12 },
  },
};

AgentTank.prototype.start = async function start() {
  for (const spec of this.requestedAgents) {
    const id = typeof spec === 'string' ? spec : spec.id;
    const provider = typeof spec === 'string' ? spec : spec.provider;
    const agent = {
      name: provider,
      alias: null,
      provider,
      usage: USAGE[provider],
      usageUpdatedAt: '2026-10-17T10:00:00.000Z',
      getStatus: () => ({ name: provider, usage: USAGE[provider], metadata: null, error: null }),
      requestStop: () => {},
      killProcess: () => {},
    };
    this.agents.set(id, agent);
    this._recordSnapshot(id, agent);
  }
  process.stderr.write(`stub: history ${JSON.stringify(this.getHistoryConfig())}\n`);
};
