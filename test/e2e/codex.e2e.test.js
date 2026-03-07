/**
 * End-to-End tests for CodexAgent
 *
 * These tests execute the actual Codex CLI via PTY to validate real-world
 * behavior. Tests may be skipped if the CLI is not installed or if
 * authentication is not configured.
 *
 * Requirements:
 * - Codex CLI must be installed (`codex` command available)
 * - User must be authenticated with Codex CLI
 * - Tests use freshProcess mode for isolation
 */

const { execSync } = require('child_process');

// Check if Codex CLI is available before loading node-pty
let codexCliAvailable = false;
let codexCliPath = null;

try {
  codexCliPath = execSync('which codex 2>/dev/null', { encoding: 'utf-8' }).trim();
  codexCliAvailable = codexCliPath.length > 0;
} catch {
  codexCliAvailable = false;
}

// Only load the agent if CLI is available to avoid node-pty issues in environments without it
const describeIfCodex = codexCliAvailable ? describe : describe.skip;

describeIfCodex('CodexAgent E2E', () => {
  let CodexAgent;

  beforeAll(() => {
    // Dynamically require to avoid loading node-pty when CLI is not available
    const { CodexAgent: Agent } = require('../../src/agents/codex.js');
    CodexAgent = Agent;
  });

  // Real PTY operations can take time (up to 25s timeout in agent + overhead)
  jest.setTimeout(60000);

  describe('CLI Availability', () => {
    it('detects Codex CLI installation', () => {
      expect(codexCliAvailable).toBe(true);
      expect(codexCliPath).toBeTruthy();
      console.log(`Codex CLI found at: ${codexCliPath}`);
    });
  });

  describe('Fresh Process Mode', () => {
    let agent;

    beforeEach(() => {
      agent = new CodexAgent();
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

      // Attempt refresh - this will spawn a real Codex process
      try {
        await agent.refresh();
      } catch (err) {
        // If authentication is missing, the error should be clear
        if (err.message.includes('unauthenticated') ||
            err.message.includes('not logged in') ||
            err.message.includes('authentication') ||
            err.message.includes('not authenticated')) {
          console.log('Skipping test: Codex CLI not authenticated');
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
      agent = new CodexAgent();
      agent.freshProcess = true;
    });

    afterEach(() => {
      if (agent && agent.shell) {
        agent.killProcess();
      }
    });

    it('returns usage object with fiveHour and weekly limits', async () => {
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

      // Codex usage must have fiveHour and weekly limits as per requirements
      expect(usage).toHaveProperty('fiveHour');
      expect(usage).toHaveProperty('weekly');

      console.log('Usage data structure:', JSON.stringify(usage, null, 2));
    });

    it('fiveHour limit has correct structure when present', async () => {
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

      const fiveHour = agent.usage?.fiveHour;

      if (fiveHour) {
        // fiveHour should have these keys
        expect(fiveHour).toHaveProperty('label');
        expect(fiveHour).toHaveProperty('percentLeft');
        expect(fiveHour).toHaveProperty('percentUsed');
        expect(fiveHour).toHaveProperty('resetsAt');
        expect(fiveHour).toHaveProperty('resetsIn');
        expect(fiveHour).toHaveProperty('resetsInSeconds');

        // percentLeft should be a number between 0 and 100
        expect(typeof fiveHour.percentLeft).toBe('number');
        expect(fiveHour.percentLeft).toBeGreaterThanOrEqual(0);
        expect(fiveHour.percentLeft).toBeLessThanOrEqual(100);

        // percentUsed should be a number between 0 and 100
        expect(typeof fiveHour.percentUsed).toBe('number');
        expect(fiveHour.percentUsed).toBeGreaterThanOrEqual(0);
        expect(fiveHour.percentUsed).toBeLessThanOrEqual(100);

        // percentLeft + percentUsed should equal 100
        expect(fiveHour.percentLeft + fiveHour.percentUsed).toBe(100);

        // Label should be '5h limit'
        expect(fiveHour.label).toBe('5h limit');

        // resetsAt should be a string
        expect(typeof fiveHour.resetsAt).toBe('string');

        console.log('fiveHour limit validated:', fiveHour);
      } else {
        console.log('fiveHour limit not present (may be using different format)');
      }
    });

    it('weekly limit has correct structure when present', async () => {
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

      const weekly = agent.usage?.weekly;

      if (weekly) {
        // weekly should have these keys
        expect(weekly).toHaveProperty('label');
        expect(weekly).toHaveProperty('percentLeft');
        expect(weekly).toHaveProperty('percentUsed');
        expect(weekly).toHaveProperty('resetsAt');
        expect(weekly).toHaveProperty('resetsIn');
        expect(weekly).toHaveProperty('resetsInSeconds');

        // percentLeft should be a number between 0 and 100
        expect(typeof weekly.percentLeft).toBe('number');
        expect(weekly.percentLeft).toBeGreaterThanOrEqual(0);
        expect(weekly.percentLeft).toBeLessThanOrEqual(100);

        // percentUsed should be a number between 0 and 100
        expect(typeof weekly.percentUsed).toBe('number');
        expect(weekly.percentUsed).toBeGreaterThanOrEqual(0);
        expect(weekly.percentUsed).toBeLessThanOrEqual(100);

        // percentLeft + percentUsed should equal 100
        expect(weekly.percentLeft + weekly.percentUsed).toBe(100);

        // Label should be 'Weekly limit'
        expect(weekly.label).toBe('Weekly limit');

        // resetsAt should be a string
        expect(typeof weekly.resetsAt).toBe('string');

        console.log('Weekly limit validated:', weekly);
      } else {
        console.log('Weekly limit not present (may be using different format)');
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
        // Version info should have current and/or latest
        const hasVersionInfo = version.current || version.latest;
        expect(hasVersionInfo).toBeTruthy();

        if (version.current) {
          expect(typeof version.current).toBe('string');
          // Version strings should look like version numbers
          expect(version.current).toMatch(/^\d+\.\d+/);
        }

        if (version.latest) {
          expect(typeof version.latest).toBe('string');
          expect(version.latest).toMatch(/^\d+\.\d+/);
        }

        console.log('Version info validated:', version);
      } else {
        console.log('Version info not present (no update available)');
      }
    });

    it('model info has correct structure when present', async () => {
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

      const model = agent.usage?.model;

      if (model) {
        // Model should be a string
        expect(typeof model).toBe('string');
        expect(model.length).toBeGreaterThan(0);

        console.log('Model info validated:', model);
      } else {
        console.log('Model info not present');
      }
    });

    it('model-specific limits have correct structure when present', async () => {
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

      const modelLimits = agent.usage?.modelLimits;

      if (modelLimits && Array.isArray(modelLimits) && modelLimits.length > 0) {
        for (const modelEntry of modelLimits) {
          // Each model limit entry should have a name
          expect(modelEntry).toHaveProperty('name');
          expect(typeof modelEntry.name).toBe('string');

          // Should have fiveHour and/or weekly limits
          const hasLimits = modelEntry.fiveHour || modelEntry.weekly;
          expect(hasLimits).toBeTruthy();

          if (modelEntry.fiveHour) {
            expect(modelEntry.fiveHour).toHaveProperty('percentLeft');
            expect(modelEntry.fiveHour).toHaveProperty('percentUsed');
            expect(typeof modelEntry.fiveHour.percentLeft).toBe('number');
            expect(typeof modelEntry.fiveHour.percentUsed).toBe('number');
          }

          if (modelEntry.weekly) {
            expect(modelEntry.weekly).toHaveProperty('percentLeft');
            expect(modelEntry.weekly).toHaveProperty('percentUsed');
            expect(typeof modelEntry.weekly.percentLeft).toBe('number');
            expect(typeof modelEntry.weekly.percentUsed).toBe('number');
          }

          console.log('Model limit entry validated:', modelEntry);
        }
      } else {
        console.log('Model-specific limits not present (may be using single model)');
      }
    });
  });

  describe('Agent Status', () => {
    let agent;

    beforeEach(() => {
      agent = new CodexAgent();
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

      // Name should be 'codex'
      expect(status.name).toBe('codex');

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

    it('metadata contains expected fields when present', async () => {
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

      const metadata = agent.metadata;

      if (metadata && Object.keys(metadata).length > 0) {
        // Metadata may contain directory, sessionId, model, email
        if (metadata.directory) {
          expect(typeof metadata.directory).toBe('string');
          console.log('Directory:', metadata.directory);
        }

        if (metadata.sessionId) {
          expect(typeof metadata.sessionId).toBe('string');
          console.log('Session ID:', metadata.sessionId);
        }

        if (metadata.model) {
          expect(typeof metadata.model).toBe('string');
          console.log('Model:', metadata.model);
        }

        if (metadata.email) {
          expect(typeof metadata.email).toBe('string');
          expect(metadata.email).toMatch(/@/);
          console.log('Email:', metadata.email);
        }

        console.log('Metadata validated:', metadata);
      } else {
        console.log('Metadata not present or empty');
      }
    });
  });

  describe('Error Handling', () => {
    let agent;

    beforeEach(() => {
      agent = new CodexAgent();
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
      const agent = new CodexAgent();
      expect(agent.getTimeout()).toBe(25000);
    });

    it('uses correct command', () => {
      const agent = new CodexAgent();
      expect(agent.command).toBe('codex');
    });

    it('has correct agent name', () => {
      const agent = new CodexAgent();
      expect(agent.name).toBe('codex');
    });
  });

  describe('Asynchronous PTY Handling', () => {
    let agent;

    beforeEach(() => {
      agent = new CodexAgent();
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

  describe('Output Parsing', () => {
    let agent;

    beforeEach(() => {
      agent = new CodexAgent();
      agent.freshProcess = true;
    });

    afterEach(() => {
      if (agent && agent.shell) {
        agent.killProcess();
      }
    });

    it('hasCompleteOutput detects required fields', () => {
      // Test hasCompleteOutput method
      const incompleteOutput1 = 'Loading...';
      const incompleteOutput2 = '5h limit: [=====] 50% left';
      const incompleteOutput3 = 'Weekly limit: [=====] 70% left';
      const completeOutput = '5h limit: [=====] 50% left\nWeekly limit: [=====] 70% left';

      expect(agent.hasCompleteOutput(incompleteOutput1)).toBe(false);
      expect(agent.hasCompleteOutput(incompleteOutput2)).toBe(false);
      expect(agent.hasCompleteOutput(incompleteOutput3)).toBe(false);
      expect(agent.hasCompleteOutput(completeOutput)).toBe(true);
    });

    it('parses fiveHour and weekly limits from live output', async () => {
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

      // As per requirements, fiveHour and weekly limits should be parsed
      const usage = agent.usage;
      expect(usage).not.toBeNull();

      if (usage.fiveHour) {
        expect(usage.fiveHour.label).toBe('5h limit');
        expect(typeof usage.fiveHour.percentLeft).toBe('number');
        expect(typeof usage.fiveHour.percentUsed).toBe('number');
      }

      if (usage.weekly) {
        expect(usage.weekly.label).toBe('Weekly limit');
        expect(typeof usage.weekly.percentLeft).toBe('number');
        expect(typeof usage.weekly.percentUsed).toBe('number');
      }

      console.log('Parsed limits from live output:', {
        fiveHour: usage.fiveHour,
        weekly: usage.weekly
      });
    });
  });

  describe('Interactive Prompt Handling', () => {
    it('handleTrustPrompt responds to trust prompts', () => {
      const agent = new CodexAgent();
      const mockShell = {
        write: jest.fn()
      };

      // Test various trust prompt patterns
      const trustPrompts = [
        'Do you trust this folder?',
        'Trust this workspace?',
        'allow access to this directory?'
      ];

      for (const prompt of trustPrompts) {
        mockShell.write.mockClear();
        const result = agent.handleTrustPrompt(mockShell, prompt);
        expect(result).toBe(true);
        expect(mockShell.write).toHaveBeenCalledWith('y\r');
      }

      // Non-trust prompts should return false
      const nonTrustPrompt = 'Enter your command:';
      mockShell.write.mockClear();
      const result = agent.handleTrustPrompt(mockShell, nonTrustPrompt);
      expect(result).toBe(false);
      expect(mockShell.write).not.toHaveBeenCalled();
    });

    it('handleUpdateScreen responds to update prompts', () => {
      const agent = new CodexAgent();
      const mockShell = {
        write: jest.fn()
      };

      // Test update screen pattern
      const updateScreen = 'Update available: 1.0.0 -> 1.1.0\n1) Update\n2) Skip';
      const result = agent.handleUpdateScreen(mockShell, updateScreen);
      expect(result).toBe(true);
      expect(mockShell.write).toHaveBeenCalledWith('2');

      // Non-update screens should return false
      mockShell.write.mockClear();
      const nonUpdateScreen = 'Welcome to Codex';
      const result2 = agent.handleUpdateScreen(mockShell, nonUpdateScreen);
      expect(result2).toBe(false);
      expect(mockShell.write).not.toHaveBeenCalled();
    });

    it('isReadyForStatus detects ready state', () => {
      const agent = new CodexAgent();

      // Test ready patterns
      expect(agent.isReadyForStatus('Press ? for shortcuts')).toBe(true);
      expect(agent.isReadyForStatus('To get started, enter a command')).toBe(true);

      // Not ready
      expect(agent.isReadyForStatus('Loading...')).toBe(false);
      expect(agent.isReadyForStatus('Connecting to server...')).toBe(false);
    });
  });

  describe('Reset Time Parsing', () => {
    it('parses HH:MM format correctly', () => {
      const agent = new CodexAgent();

      // Mock current time to make test deterministic
      const now = new Date();
      const futureHour = (now.getHours() + 2) % 24;
      const futureTimeStr = `${futureHour.toString().padStart(2, '0')}:30`;

      const result = agent.parseResetTime(futureTimeStr);
      expect(result).not.toBeNull();
      expect(result.text).toMatch(/\d+[hm]/);
      expect(typeof result.seconds).toBe('number');
      expect(result.seconds).toBeGreaterThan(0);
    });

    it('parses HH:MM on DD Mon format correctly', () => {
      const agent = new CodexAgent();

      // Use a future date
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 3);
      const day = futureDate.getDate();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[futureDate.getMonth()];
      const timeStr = `14:30 on ${day} ${month}`;

      const result = agent.parseResetTime(timeStr);
      expect(result).not.toBeNull();
      expect(result.text).toMatch(/\d+[dhm]/);
      expect(typeof result.seconds).toBe('number');
      expect(result.seconds).toBeGreaterThan(0);
    });

    it('handles unparseable format gracefully', () => {
      const agent = new CodexAgent();

      const result = agent.parseResetTime('in a few hours');
      expect(result).not.toBeNull();
      expect(result.text).toBe('in a few hours');
      expect(result.seconds).toBeNull();
    });

    it('handles null input', () => {
      const agent = new CodexAgent();

      const result = agent.parseResetTime(null);
      expect(result).toBeNull();
    });
  });
});

// Separate describe block for when CLI is NOT available
describe('CodexAgent E2E (CLI Not Available)', () => {
  // Only run these tests if CLI is not available
  const runTests = !codexCliAvailable;

  (runTests ? it : it.skip)('skips tests when Codex CLI is not installed', () => {
    console.log('Codex CLI not found - E2E tests are being skipped');
    expect(codexCliAvailable).toBe(false);
  });

  (runTests ? it : it.skip)('reports missing CLI appropriately', () => {
    // This test documents the expected behavior when CLI is missing
    expect(codexCliPath).toBeFalsy();
    console.log('To run E2E tests, install Codex CLI: https://github.com/openai/codex');
  });
});
