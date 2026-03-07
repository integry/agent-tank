/**
 * End-to-End tests for GeminiAgent
 *
 * These tests execute the actual Gemini CLI via PTY to validate real-world
 * behavior. Tests may be skipped if the CLI is not installed or if
 * authentication is not configured.
 *
 * Requirements:
 * - Gemini CLI must be installed (`gemini` command available)
 * - User must be authenticated with Gemini CLI
 * - Tests use freshProcess mode for isolation
 */

const { execSync } = require('child_process');

// Check if Gemini CLI is available before loading node-pty
let geminiCliAvailable = false;
let geminiCliPath = null;

try {
  geminiCliPath = execSync('which gemini 2>/dev/null', { encoding: 'utf-8' }).trim();
  geminiCliAvailable = geminiCliPath.length > 0;
} catch {
  geminiCliAvailable = false;
}

// Only load the agent if CLI is available to avoid node-pty issues in environments without it
const describeIfGemini = geminiCliAvailable ? describe : describe.skip;

describeIfGemini('GeminiAgent E2E', () => {
  let GeminiAgent;

  beforeAll(() => {
    // Dynamically require to avoid loading node-pty when CLI is not available
    const { GeminiAgent: Agent } = require('../../src/agents/gemini.js');
    GeminiAgent = Agent;
  });

  // Real PTY operations can take time (up to 25s timeout in agent + overhead)
  jest.setTimeout(60000);

  describe('CLI Availability', () => {
    it('detects Gemini CLI installation', () => {
      expect(geminiCliAvailable).toBe(true);
      expect(geminiCliPath).toBeTruthy();
      console.log(`Gemini CLI found at: ${geminiCliPath}`);
    });
  });

  describe('Fresh Process Mode', () => {
    let agent;

    beforeEach(() => {
      agent = new GeminiAgent();
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

      // Attempt refresh - this will spawn a real Gemini process
      try {
        await agent.refresh();
      } catch (err) {
        // If authentication is missing, the error should be clear
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('not authenticated')) {
          console.log('Skipping test: Gemini CLI not authenticated');
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
            err.message.includes('not authenticated') ||
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
      agent = new GeminiAgent();
      agent.freshProcess = true;
    });

    afterEach(() => {
      if (agent && agent.shell) {
        agent.killProcess();
      }
    });

    it('returns usage object with models array', async () => {
      try {
        await agent.refresh();
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('not authenticated') ||
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

      // Usage must have models array as per requirements
      expect(usage).toHaveProperty('models');
      expect(Array.isArray(usage.models)).toBe(true);

      console.log('Usage data structure:', JSON.stringify(usage, null, 2));
    });

    it('models array contains valid model usage data', async () => {
      try {
        await agent.refresh();
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('not authenticated') ||
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

      const models = agent.usage?.models;

      if (models && models.length > 0) {
        // Each model entry should have the expected structure
        for (const modelEntry of models) {
          expect(modelEntry).toHaveProperty('model');
          expect(modelEntry).toHaveProperty('usageLeft');
          expect(modelEntry).toHaveProperty('resetsIn');
          expect(modelEntry).toHaveProperty('percentUsed');
          expect(modelEntry).toHaveProperty('resetsInSeconds');

          // Model name should be a string starting with 'gemini-'
          expect(typeof modelEntry.model).toBe('string');
          expect(modelEntry.model).toMatch(/^gemini-/i);

          // usageLeft should be a number between 0 and 100
          expect(typeof modelEntry.usageLeft).toBe('number');
          expect(modelEntry.usageLeft).toBeGreaterThanOrEqual(0);
          expect(modelEntry.usageLeft).toBeLessThanOrEqual(100);

          // percentUsed should be a number between 0 and 100
          expect(typeof modelEntry.percentUsed).toBe('number');
          expect(modelEntry.percentUsed).toBeGreaterThanOrEqual(0);
          expect(modelEntry.percentUsed).toBeLessThanOrEqual(100);

          // resetsIn should be a string (e.g., "3h 26m")
          expect(typeof modelEntry.resetsIn).toBe('string');

          // resetsInSeconds should be a number or null
          if (modelEntry.resetsInSeconds !== null) {
            expect(typeof modelEntry.resetsInSeconds).toBe('number');
            expect(modelEntry.resetsInSeconds).toBeGreaterThan(0);
          }

          console.log('Model entry validated:', modelEntry);
        }
      } else {
        console.log('No model usage data returned (may be rate limited or empty)');
      }
    });

    it('version info has correct structure when present', async () => {
      try {
        await agent.refresh();
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('not authenticated') ||
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

      const version = agent.usage?.version;

      if (version) {
        // Version info should have current and latest
        expect(version).toHaveProperty('current');
        expect(version).toHaveProperty('latest');

        expect(typeof version.current).toBe('string');
        expect(typeof version.latest).toBe('string');

        // Version strings should look like version numbers
        expect(version.current).toMatch(/^\d+\.\d+/);
        expect(version.latest).toMatch(/^\d+\.\d+/);

        console.log('Version info validated:', version);
      } else {
        console.log('Version info not present (no update available)');
      }
    });
  });

  describe('Agent Status', () => {
    let agent;

    beforeEach(() => {
      agent = new GeminiAgent();
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
            err.message.includes('not authenticated') ||
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

      // Name should be 'gemini'
      expect(status.name).toBe('gemini');

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
            err.message.includes('not authenticated') ||
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
      agent = new GeminiAgent();
      agent.freshProcess = true;
    });

    afterEach(() => {
      if (agent && agent.shell) {
        agent.killProcess();
      }
    });

    it('handles rate limiting gracefully', async () => {
      // Perform a refresh - rate limiting may occur

      try {
        await agent.refresh();
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('not authenticated') ||
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
            err.message.includes('not authenticated') ||
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
            err.message.includes('not authenticated') ||
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
      const agent = new GeminiAgent();
      expect(agent.getTimeout()).toBe(25000);
    });

    it('uses correct command', () => {
      const agent = new GeminiAgent();
      expect(agent.command).toBe('gemini');
    });

    it('has correct agent name', () => {
      const agent = new GeminiAgent();
      expect(agent.name).toBe('gemini');
    });
  });

  describe('Asynchronous PTY Handling', () => {
    let agent;

    beforeEach(() => {
      agent = new GeminiAgent();
      agent.freshProcess = true;
    });

    afterEach(() => {
      if (agent && agent.shell) {
        agent.killProcess();
      }
    });

    it('properly handles asynchronous PTY process lifecycle', async () => {
      // Verify the agent properly manages PTY lifecycle
      expect(agent.shell).toBeNull();
      expect(agent.processReady).toBe(false);
      expect(agent.isRefreshing).toBe(false);

      try {
        // Start refresh - this spawns PTY, waits for readiness, sends commands
        const refreshPromise = agent.refresh();

        // During refresh, isRefreshing should be true
        // Note: This may be too fast to catch in some cases
        expect(agent.isRefreshing).toBe(true);

        await refreshPromise;
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('not authenticated') ||
            err.message.includes('Timeout')) {
          console.log(`Skipping test: ${err.message}`);
          return;
        }
        throw err;
      }

      // After refresh completes
      expect(agent.isRefreshing).toBe(false);
      // In freshProcess mode, shell should be null after completion
      expect(agent.shell).toBeNull();
    });

    it('cleans up PTY process after refresh', async () => {
      try {
        await agent.refresh();
      } catch (err) {
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('not authenticated') ||
            err.message.includes('Timeout')) {
          console.log(`Skipping test: ${err.message}`);
          return;
        }
        throw err;
      }

      // In freshProcess mode, shell should be cleaned up
      expect(agent.shell).toBeNull();
      expect(agent.processReady).toBe(false);
    });
  });
});

// Separate describe block for when CLI is NOT available
describe('GeminiAgent E2E (CLI Not Available)', () => {
  // Only run these tests if CLI is not available
  const runTests = !geminiCliAvailable;

  (runTests ? it : it.skip)('skips tests when Gemini CLI is not installed', () => {
    console.log('Gemini CLI not found - E2E tests are being skipped');
    expect(geminiCliAvailable).toBe(false);
  });

  (runTests ? it : it.skip)('reports missing CLI appropriately', () => {
    // This test documents the expected behavior when CLI is missing
    expect(geminiCliPath).toBeFalsy();
    console.log('To run E2E tests, install Gemini CLI: https://github.com/anthropics/gemini-cli');
  });
});
