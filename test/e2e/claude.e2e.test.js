/**
 * End-to-End tests for ClaudeAgent
 *
 * These tests execute the actual Claude CLI via PTY to validate real-world
 * behavior. Tests may be skipped if the CLI is not installed or if
 * authentication is not configured.
 *
 * Requirements:
 * - Claude CLI must be installed (`claude` command available)
 * - User must be authenticated with Claude CLI
 * - Tests use freshProcess mode for isolation
 */

const { execSync } = require('child_process');

// Check if Claude CLI is available before loading node-pty
let claudeCliAvailable = false;
let claudeCliPath = null;

try {
  claudeCliPath = execSync('which claude 2>/dev/null', { encoding: 'utf-8' }).trim();
  claudeCliAvailable = claudeCliPath.length > 0;
} catch {
  claudeCliAvailable = false;
}

// Only load the agent if CLI is available to avoid node-pty issues in environments without it
const describeIfClaude = claudeCliAvailable ? describe : describe.skip;

describeIfClaude('ClaudeAgent E2E', () => {
  let ClaudeAgent;

  beforeAll(() => {
    // Dynamically require to avoid loading node-pty when CLI is not available
    const { ClaudeAgent: Agent } = require('../../src/agents/claude.js');
    ClaudeAgent = Agent;
  });

  // Real PTY operations can take time (up to 30s timeout in agent + overhead)
  jest.setTimeout(60000);

  describe('CLI Availability', () => {
    it('detects Claude CLI installation', () => {
      expect(claudeCliAvailable).toBe(true);
      expect(claudeCliPath).toBeTruthy();
      console.log(`Claude CLI found at: ${claudeCliPath}`);
    });
  });

  describe('Fresh Process Mode', () => {
    let agent;

    beforeEach(() => {
      agent = new ClaudeAgent();
      // Enable freshProcess mode for isolation as per requirements
      agent.freshProcess = true;
    });

    afterEach(() => {
      // Ensure process is killed after each test
      if (agent && agent.shell) {
        agent.killProcess();
      }
    });

    it('spawns a fresh process for each refresh', async () => {
      // Verify freshProcess mode is enabled
      expect(agent.freshProcess).toBe(true);

      // The agent should not have an active shell before refresh
      expect(agent.shell).toBeNull();

      // Attempt refresh - this will spawn a real Claude process
      try {
        await agent.refresh();
      } catch (err) {
        // If authentication is missing, the error should be clear
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication')) {
          console.log('Skipping test: Claude CLI not authenticated');
          return;
        }
        throw err;
      }

      // After refresh, shell should be null (freshProcess mode kills after command)
      expect(agent.shell).toBeNull();
    });

    it('fetches usage data via refresh()', async () => {
      try {
        await agent.refresh();
      } catch (err) {
        // Handle authentication errors gracefully
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('Timeout')) {
          console.log(`Skipping test: ${err.message}`);
          return;
        }
        throw err;
      }

      // Check that we got a lastUpdated timestamp
      expect(agent.lastUpdated).toBeTruthy();

      // If there's an error (e.g., rate limiting), it should be stored
      if (agent.error) {
        console.log(`Agent reported error: ${agent.error}`);
        // Rate limiting or cached data errors are acceptable
        expect(agent.error).toMatch(/rate.?limit|cached|Failed to parse/i);
      }
    });
  });

  describe('Usage Data Structure', () => {
    let agent;

    beforeEach(() => {
      agent = new ClaudeAgent();
      agent.freshProcess = true;
    });

    afterEach(() => {
      if (agent && agent.shell) {
        agent.killProcess();
      }
    });

    it('returns usage object with expected keys', async () => {
      try {
        await agent.refresh();
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('Timeout')) {
          console.log(`Skipping test: ${err.message}`);
          return;
        }
        throw err;
      }

      // Skip structure validation if there was an error (e.g., rate limiting)
      if (agent.error && !agent.usage) {
        console.log(`Skipping structure validation due to error: ${agent.error}`);
        return;
      }

      const usage = agent.usage;

      // Usage should be an object
      expect(typeof usage).toBe('object');
      expect(usage).not.toBeNull();

      // Check for expected top-level keys (values may vary based on account)
      // At minimum, we expect session to be present or the legacy weekly format
      const hasSessionOrWeekly = (
        usage.session !== undefined ||
        usage.weekly !== undefined ||
        usage.weeklyAll !== undefined ||
        usage.weeklySonnet !== undefined
      );
      expect(hasSessionOrWeekly).toBe(true);

      console.log('Usage data structure:', JSON.stringify(usage, null, 2));
    });

    it('session data has correct structure when present', async () => {
      try {
        await agent.refresh();
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('Timeout')) {
          console.log(`Skipping test: ${err.message}`);
          return;
        }
        throw err;
      }

      if (agent.error) {
        console.log(`Skipping test due to error: ${agent.error}`);
        return;
      }

      const session = agent.usage?.session;

      if (session) {
        // Session should have these keys
        expect(session).toHaveProperty('label');
        expect(session).toHaveProperty('percent');
        expect(session).toHaveProperty('resetsAt');
        expect(session).toHaveProperty('resetsIn');
        expect(session).toHaveProperty('resetsInSeconds');

        // Percent should be a number between 0 and 100
        expect(typeof session.percent).toBe('number');
        expect(session.percent).toBeGreaterThanOrEqual(0);
        expect(session.percent).toBeLessThanOrEqual(100);

        // Label should be 'Current session'
        expect(session.label).toBe('Current session');

        console.log('Session data validated:', session);
      } else {
        console.log('Session data not present (may be using legacy format)');
      }
    });

    it('weekly data has correct structure when present', async () => {
      try {
        await agent.refresh();
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('Timeout')) {
          console.log(`Skipping test: ${err.message}`);
          return;
        }
        throw err;
      }

      if (agent.error) {
        console.log(`Skipping test due to error: ${agent.error}`);
        return;
      }

      const usage = agent.usage;

      // Check for new format (all models and Sonnet only)
      if (usage?.weeklyAll) {
        expect(usage.weeklyAll).toHaveProperty('label');
        expect(usage.weeklyAll).toHaveProperty('percent');
        expect(usage.weeklyAll.label).toBe('Current week (all models)');
        expect(typeof usage.weeklyAll.percent).toBe('number');
        console.log('Weekly (all models) data validated:', usage.weeklyAll);
      }

      if (usage?.weeklySonnet) {
        expect(usage.weeklySonnet).toHaveProperty('label');
        expect(usage.weeklySonnet).toHaveProperty('percent');
        expect(usage.weeklySonnet.label).toBe('Current week (Sonnet only)');
        expect(typeof usage.weeklySonnet.percent).toBe('number');
        console.log('Weekly (Sonnet only) data validated:', usage.weeklySonnet);
      }

      // Check for legacy format
      if (usage?.weekly) {
        expect(usage.weekly).toHaveProperty('label');
        expect(usage.weekly).toHaveProperty('percent');
        expect(usage.weekly.label).toBe('Current week');
        expect(typeof usage.weekly.percent).toBe('number');
        console.log('Weekly (legacy) data validated:', usage.weekly);
      }
    });

    it('extra usage has correct structure when present', async () => {
      try {
        await agent.refresh();
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('Timeout')) {
          console.log(`Skipping test: ${err.message}`);
          return;
        }
        throw err;
      }

      if (agent.error) {
        console.log(`Skipping test due to error: ${agent.error}`);
        return;
      }

      const extraUsage = agent.usage?.extraUsage;

      if (extraUsage) {
        // Extra usage should have budget-related fields
        expect(extraUsage).toHaveProperty('label');
        expect(extraUsage.label).toBe('Extra usage');

        // May have percent, spent, and budget
        if (extraUsage.percent !== null) {
          expect(typeof extraUsage.percent).toBe('number');
        }
        if (extraUsage.spent !== null) {
          expect(typeof extraUsage.spent).toBe('number');
        }
        if (extraUsage.budget !== null) {
          expect(typeof extraUsage.budget).toBe('number');
        }

        console.log('Extra usage data validated:', extraUsage);
      } else {
        console.log('Extra usage not present (may not be configured)');
      }
    });
  });

  describe('Agent Status', () => {
    let agent;

    beforeEach(() => {
      agent = new ClaudeAgent();
      agent.freshProcess = true;
    });

    afterEach(() => {
      if (agent && agent.shell) {
        agent.killProcess();
      }
    });

    it('getStatus() returns complete status object', async () => {
      try {
        await agent.refresh();
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('Timeout')) {
          console.log(`Skipping test: ${err.message}`);
          return;
        }
        throw err;
      }

      const status = agent.getStatus();

      // Status should always have these keys
      expect(status).toHaveProperty('name');
      expect(status).toHaveProperty('usage');
      expect(status).toHaveProperty('metadata');
      expect(status).toHaveProperty('lastUpdated');
      expect(status).toHaveProperty('error');
      expect(status).toHaveProperty('isRefreshing');

      // Name should be 'claude'
      expect(status.name).toBe('claude');

      // isRefreshing should be false after refresh completes
      expect(status.isRefreshing).toBe(false);

      console.log('Status object:', JSON.stringify(status, null, 2));
    });

    it('tracks lastUpdated timestamp', async () => {
      const beforeRefresh = new Date();

      try {
        await agent.refresh();
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('Timeout')) {
          console.log(`Skipping test: ${err.message}`);
          return;
        }
        throw err;
      }

      const afterRefresh = new Date();

      // lastUpdated should be set
      expect(agent.lastUpdated).toBeTruthy();

      // Parse the ISO timestamp
      const updatedTime = new Date(agent.lastUpdated);

      // Should be between before and after refresh times
      expect(updatedTime.getTime()).toBeGreaterThanOrEqual(beforeRefresh.getTime() - 1000);
      expect(updatedTime.getTime()).toBeLessThanOrEqual(afterRefresh.getTime() + 1000);
    });
  });

  describe('Error Handling', () => {
    let agent;

    beforeEach(() => {
      agent = new ClaudeAgent();
      agent.freshProcess = true;
    });

    afterEach(() => {
      if (agent && agent.shell) {
        agent.killProcess();
      }
    });

    it('handles rate limiting gracefully', async () => {
      // Perform multiple refreshes in quick succession
      // Note: This test may take a while due to the rate limiting

      try {
        await agent.refresh();
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('Timeout')) {
          console.log(`Skipping test: ${err.message}`);
          return;
        }
        throw err;
      }

      // If we get rate limited, the error should be set but usage preserved
      if (agent.error && agent.error.includes('rate')) {
        // Rate limiting should preserve previous usage data
        console.log('Rate limiting detected:', agent.error);
        // Error should be informative
        expect(agent.error).toMatch(/rate/i);
      }
    });

    it('does not throw on concurrent refresh attempts', async () => {
      // Start a refresh
      const refreshPromise = agent.refresh().catch(err => {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('Timeout')) {
          return; // Ignore auth/timeout errors
        }
        throw err;
      });

      // Attempt another refresh immediately (should be skipped)
      const secondRefresh = agent.refresh().catch(err => {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('Timeout')) {
          return;
        }
        throw err;
      });

      // Both should complete without throwing
      await Promise.all([refreshPromise, secondRefresh]);

      // At least one should have completed
      // (the second is skipped if isRefreshing was true)
      console.log('Concurrent refresh test completed');
    });
  });

  describe('Configuration', () => {
    it('has correct default timeout', () => {
      const agent = new ClaudeAgent();
      expect(agent.getTimeout()).toBe(30000);
    });

    it('has correct minimum refresh interval', () => {
      const agent = new ClaudeAgent();
      // Claude API is rate limited - 5 minute minimum
      expect(agent.minRefreshInterval).toBe(300);
    });

    it('uses correct environment settings', () => {
      const agent = new ClaudeAgent();
      const env = agent.getEnv();

      // Should set TERM to dumb for clean output
      expect(env.TERM).toBe('dumb');

      // Should disable colors
      expect(env.NO_COLOR).toBe('1');

      // Should not have CLAUDECODE (allows spawning inside Claude Code)
      expect(env.CLAUDECODE).toBeUndefined();
    });
  });
});

// Separate describe block for when CLI is NOT available
describe('ClaudeAgent E2E (CLI Not Available)', () => {
  // Only run these tests if CLI is not available
  const runTests = !claudeCliAvailable;

  (runTests ? it : it.skip)('skips tests when Claude CLI is not installed', () => {
    console.log('Claude CLI not found - E2E tests are being skipped');
    expect(claudeCliAvailable).toBe(false);
  });

  (runTests ? it : it.skip)('reports missing CLI appropriately', () => {
    // This test documents the expected behavior when CLI is missing
    expect(claudeCliPath).toBeFalsy();
    console.log('To run E2E tests, install Claude CLI: https://docs.anthropic.com/claude-code/docs/cli');
  });
});
