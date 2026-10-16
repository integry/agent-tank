/**
 * Preloaded with `node -r` by the CLI --once --json test. Replaces
 * AgentTank#start so the real CLI runs end to end without spawning any
 * vendor CLI: the configured agents report canned usage instead.
 */

const { AgentTank } = require('../../src/index.js');

const CAPTURED_AT = '2026-10-03T19:00:00.000Z';

const USAGE = {
  claude: {
    session: { label: 'Current session', percent: 42, resetsAt: '8pm (UTC)', resetsInSeconds: 3600 },
    weeklyAll: null,
    weeklyFable: null,
  },
  codex: {
    fiveHour: null,
    weekly: { label: 'Weekly limit', percentUsed: 12, percentLeft: 88, resetsAt: '2026-10-10T19:00:00Z', resetsInSeconds: 604800 },
  },
};

AgentTank.prototype.start = async function start() {
  for (const spec of this.requestedAgents) {
    const id = typeof spec === 'string' ? spec : spec.id;
    const provider = typeof spec === 'string' ? spec : spec.provider;
    this.agents.set(id, {
      name: provider,
      alias: null,
      provider,
      getStatus: () => ({
        name: provider,
        usage: USAGE[provider],
        metadata: null,
        // A later refresh failed and kept the cached usage.
        lastUpdated: '2026-10-03T19:30:00.000Z',
        usageUpdatedAt: CAPTURED_AT,
        error: 'Session error — using cached data',
        auth: null,
        isRefreshing: false,
      }),
      requestStop: () => {},
      killProcess: () => {},
    });
  }
  // Noise that --json mode must keep off stdout.
  console.log('stub: agents started');
};
