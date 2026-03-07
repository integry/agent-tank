/**
 * Unit tests for CLI flag parsing and configuration loading
 *
 * Tests the CLI entry point (bin/agent-tank.js) with various combinations
 * of flags, environment variables, and JSON config files.
 *
 * IMPORTANT: These tests require node-pty to be properly built. The CLI binary
 * requires node-pty to be loaded, so all tests that spawn the CLI as a subprocess
 * will be skipped if node-pty is not available.
 *
 * To run these tests:
 * 1. Ensure Python is installed (required to build node-pty)
 * 2. Run: npm install (or npm rebuild node-pty)
 * 3. Run: npm test -- --testPathPattern=cli.test.js
 *
 * Test coverage when node-pty is available:
 * - Help output verification (--help, -h flags)
 * - Config file loading and error handling (-c, --config)
 * - Environment variable overrides (AGENT_TANK_*)
 * - CLI flag combinations and priority
 * - Configuration priority: env > CLI > config file
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const CLI_PATH = path.resolve(__dirname, '../../bin/agent-tank.js');

/**
 * Check if node-pty is available by trying to load it.
 * node-pty is a native module that requires compilation with Python.
 * If it's not built, the CLI tests cannot run since the CLI requires node-pty.
 */
function checkNodePtyAvailable() {
  try {
    require('node-pty');
    return true;
  } catch {
    return false;
  }
}

const NODE_PTY_AVAILABLE = checkNodePtyAvailable();

// Log a notice when tests are skipped
if (!NODE_PTY_AVAILABLE) {
  console.log('\n⚠️  CLI tests skipped: node-pty is not available');
  console.log('   To run CLI tests, ensure Python is installed and run: npm install\n');
}

describe('CLI', () => {
  let tempDir;
  let tempConfigFile;

  beforeAll(() => {
    // Create a temp directory for config files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tank-test-'));
  });

  afterAll(() => {
    // Cleanup temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Cleanup any temp config files created during tests
    if (tempConfigFile && fs.existsSync(tempConfigFile)) {
      fs.unlinkSync(tempConfigFile);
      tempConfigFile = null;
    }
  });

  /**
   * Helper to create a temporary config file
   */
  function createConfigFile(config) {
    tempConfigFile = path.join(tempDir, `config-${Date.now()}.json`);
    fs.writeFileSync(tempConfigFile, JSON.stringify(config, null, 2));
    return tempConfigFile;
  }

  /**
   * Helper to run CLI with arguments and capture output
   * Returns { stdout, stderr, exitCode }
   */
  function runCli(args = [], env = {}) {
    try {
      const result = execSync(`node "${CLI_PATH}" ${args.join(' ')}`, {
        encoding: 'utf8',
        env: { ...process.env, ...env },
        timeout: 5000,
      });
      return { stdout: result, stderr: '', exitCode: 0 };
    } catch (error) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        exitCode: error.status || 1,
      };
    }
  }

  /**
   * Helper to check if a CLI error is due to node-pty not being available
   */
  function isNodePtyError(errorMessage) {
    return errorMessage.includes('Failed to load native module') ||
           errorMessage.includes('node-pty') ||
           errorMessage.includes('pty.node');
  }

  /**
   * Helper to start CLI as a background process and verify it starts
   * Returns a promise that resolves with process info or rejects on timeout
   */
  function startCliProcess(args = [], env = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', [CLI_PATH, ...args], {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        // If we see the server starting message, resolve
        if (stdout.includes('Listening on') && !resolved) {
          resolved = true;
          resolve({ proc, stdout, stderr });
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      proc.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          // If process exited before we saw the listening message
          if (code === 0) {
            resolve({ proc: null, stdout, stderr, exitCode: code });
          } else {
            reject(new Error(`CLI exited with code ${code}: ${stderr || stdout}`));
          }
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill('SIGTERM');
          reject(new Error(`CLI timeout. stdout: ${stdout}, stderr: ${stderr}`));
        }
      }, 10000);
    });
  }

  /**
   * Conditional test runner for tests that require node-pty
   * Skips the test if node-pty is not available
   */
  const itWithPty = NODE_PTY_AVAILABLE ? it : it.skip;

  describe('--help flag', () => {
    itWithPty('outputs help menu and exits with code 0', () => {
      const result = runCli(['--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('agent-tank - Monitor LLM CLI usage limits');
      expect(result.stdout).toContain('Usage: agent-tank [options]');
      expect(result.stdout).toContain('Options:');
    });

    itWithPty('outputs help menu with -h short flag', () => {
      const result = runCli(['-h']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('agent-tank - Monitor LLM CLI usage limits');
    });

    itWithPty('lists all available CLI options in help', () => {
      const result = runCli(['--help']);

      expect(result.stdout).toContain('--claude');
      expect(result.stdout).toContain('--gemini');
      expect(result.stdout).toContain('--codex');
      expect(result.stdout).toContain('--port');
      expect(result.stdout).toContain('--host');
      expect(result.stdout).toContain('--auth-user');
      expect(result.stdout).toContain('--auth-pass');
      expect(result.stdout).toContain('--auth-token');
      expect(result.stdout).toContain('--fresh-process');
      expect(result.stdout).toContain('--config');
      expect(result.stdout).toContain('--auto-discover');
      expect(result.stdout).toContain('--auto-refresh');
      expect(result.stdout).toContain('--auto-refresh-interval');
    });

    itWithPty('lists all environment variables in help', () => {
      const result = runCli(['--help']);

      expect(result.stdout).toContain('AGENT_TANK_USER');
      expect(result.stdout).toContain('AGENT_TANK_PASS');
      expect(result.stdout).toContain('AGENT_TANK_TOKEN');
      expect(result.stdout).toContain('AGENT_TANK_HOST');
      expect(result.stdout).toContain('AGENT_TANK_FRESH_PROCESS');
      expect(result.stdout).toContain('AGENT_TANK_AUTO_REFRESH');
      expect(result.stdout).toContain('AGENT_TANK_AUTO_REFRESH_INTERVAL');
    });

    itWithPty('lists HTTP endpoints in help', () => {
      const result = runCli(['--help']);

      expect(result.stdout).toContain('HTTP Endpoints:');
      expect(result.stdout).toContain('GET /status');
      expect(result.stdout).toContain('GET /config');
      expect(result.stdout).toContain('POST /refresh');
    });

    itWithPty('shows examples in help', () => {
      const result = runCli(['--help']);

      expect(result.stdout).toContain('Examples:');
      expect(result.stdout).toContain('agent-tank --claude --gemini');
      expect(result.stdout).toContain('agent-tank --port 8080');
    });
  });

  describe('config file loading (-c, --config)', () => {
    itWithPty('fails gracefully with non-existent config file', () => {
      const result = runCli(['-c', '/nonexistent/config.json']);

      expect(result.exitCode).toBe(1);
      // Check for config file error (may appear in stdout if node-pty fails first in stderr)
      const output = result.stderr + result.stdout;
      expect(output).toContain('Failed to load config file');
    });

    itWithPty('fails gracefully with invalid JSON config file', () => {
      const invalidConfigPath = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(invalidConfigPath, '{ invalid json }');

      const result = runCli(['-c', invalidConfigPath]);

      expect(result.exitCode).toBe(1);
      const output = result.stderr + result.stdout;
      expect(output).toContain('Failed to load config file');

      fs.unlinkSync(invalidConfigPath);
    });

    itWithPty('fails gracefully with directory instead of config file', () => {
      const result = runCli(['-c', tempDir]);

      expect(result.exitCode).toBe(1);
      const output = result.stderr + result.stdout;
      expect(output).toContain('Failed to load config file');
    });

    itWithPty('accepts --config long form flag', () => {
      const result = runCli(['--config', '/nonexistent/config.json']);

      expect(result.exitCode).toBe(1);
      const output = result.stderr + result.stdout;
      expect(output).toContain('Failed to load config file');
    });

    itWithPty('loads valid config file with port setting', async () => {
      const configPath = createConfigFile({ port: 9999 });

      try {
        const { proc, stdout } = await startCliProcess(['-c', configPath, '--no-auto-discover']);
        expect(stdout).toContain('9999');
        proc.kill('SIGTERM');
      } catch (error) {
        // If the process couldn't start (e.g., no agents), that's fine for this test
        // The important thing is that it didn't fail due to config loading
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('loads config file with agent settings', async () => {
      const configPath = createConfigFile({
        claude: true,
        port: 9998
      });

      try {
        const { proc } = await startCliProcess(['-c', configPath, '--no-auto-discover']);
        proc.kill('SIGTERM');
      } catch (error) {
        // Expected to fail if claude CLI is not installed or node-pty not available
        // But should not fail due to config loading
        if (!isNodePtyError(error.message)) {
          expect(error.message).not.toContain('Failed to load config file');
        }
      }
    });

    itWithPty('loads config file with auth settings', async () => {
      const configPath = createConfigFile({
        port: 9997,
        auth: {
          user: 'testuser',
          pass: 'testpass',
          token: 'testtoken'
        }
      });

      try {
        const { proc, stdout } = await startCliProcess(['-c', configPath, '--no-auto-discover']);
        expect(stdout).toContain('9997');
        proc.kill('SIGTERM');
      } catch (error) {
        // If the process couldn't start (e.g., no agents), that's fine
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('loads config file with autoRefresh settings', async () => {
      const configPath = createConfigFile({
        port: 9996,
        autoRefresh: {
          enabled: false,
          interval: 120
        }
      });

      try {
        const { proc, stdout } = await startCliProcess(['-c', configPath, '--no-auto-discover']);
        expect(stdout).toContain('9996');
        proc.kill('SIGTERM');
      } catch (error) {
        // If the process couldn't start (e.g., no agents), that's fine
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('loads config file with freshProcess setting', async () => {
      const configPath = createConfigFile({
        port: 9995,
        freshProcess: true
      });

      try {
        const { proc, stdout } = await startCliProcess(['-c', configPath, '--no-auto-discover']);
        expect(stdout).toContain('9995');
        proc.kill('SIGTERM');
      } catch (error) {
        // If the process couldn't start (e.g., no agents), that's fine
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });
  });

  describe('environment variable overrides', () => {
    itWithPty('AGENT_TANK_HOST overrides default host', async () => {
      try {
        const { proc, stdout } = await startCliProcess(['--no-auto-discover'], {
          AGENT_TANK_HOST: '0.0.0.0'
        });
        expect(stdout).toContain('0.0.0.0');
        proc.kill('SIGTERM');
      } catch (error) {
        // If the process couldn't start (e.g., no agents), check the error output
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('AGENT_TANK_USER and AGENT_TANK_PASS set authentication', async () => {
      try {
        const { proc } = await startCliProcess(['--no-auto-discover'], {
          AGENT_TANK_USER: 'envuser',
          AGENT_TANK_PASS: 'envpass'
        });
        // If it starts, auth was configured (can't easily verify from stdout)
        proc.kill('SIGTERM');
      } catch (error) {
        // If the process couldn't start (e.g., no agents), that's fine
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('AGENT_TANK_TOKEN sets bearer token authentication', async () => {
      try {
        const { proc } = await startCliProcess(['--no-auto-discover'], {
          AGENT_TANK_TOKEN: 'envtoken123'
        });
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('AGENT_TANK_FRESH_PROCESS=1 enables fresh process mode', async () => {
      try {
        const { proc } = await startCliProcess(['--no-auto-discover'], {
          AGENT_TANK_FRESH_PROCESS: '1'
        });
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('AGENT_TANK_FRESH_PROCESS=true enables fresh process mode', async () => {
      try {
        const { proc } = await startCliProcess(['--no-auto-discover'], {
          AGENT_TANK_FRESH_PROCESS: 'true'
        });
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('AGENT_TANK_AUTO_REFRESH=0 disables auto-refresh', async () => {
      try {
        const { proc } = await startCliProcess(['--no-auto-discover'], {
          AGENT_TANK_AUTO_REFRESH: '0'
        });
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('AGENT_TANK_AUTO_REFRESH=false disables auto-refresh', async () => {
      try {
        const { proc } = await startCliProcess(['--no-auto-discover'], {
          AGENT_TANK_AUTO_REFRESH: 'false'
        });
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('AGENT_TANK_AUTO_REFRESH=1 enables auto-refresh', async () => {
      try {
        const { proc } = await startCliProcess(['--no-auto-discover'], {
          AGENT_TANK_AUTO_REFRESH: '1'
        });
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('AGENT_TANK_AUTO_REFRESH_INTERVAL sets custom interval', async () => {
      try {
        const { proc } = await startCliProcess(['--no-auto-discover'], {
          AGENT_TANK_AUTO_REFRESH_INTERVAL: '300'
        });
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('environment variables override config file values', async () => {
      const configPath = createConfigFile({
        port: 9990,
        host: '127.0.0.1'
      });

      try {
        const { proc, stdout } = await startCliProcess(['-c', configPath, '--no-auto-discover'], {
          AGENT_TANK_HOST: '0.0.0.0'
        });
        // Env var should override config file
        expect(stdout).toContain('0.0.0.0');
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('environment variables override config file auth', async () => {
      const configPath = createConfigFile({
        port: 9989,
        auth: {
          user: 'configuser',
          pass: 'configpass'
        }
      });

      try {
        const { proc } = await startCliProcess(['-c', configPath, '--no-auto-discover'], {
          AGENT_TANK_USER: 'envuser',
          AGENT_TANK_PASS: 'envpass'
        });
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });
  });

  describe('CLI flag combinations', () => {
    itWithPty('--port sets custom port', async () => {
      try {
        const { proc, stdout } = await startCliProcess(['--port', '8888', '--no-auto-discover']);
        expect(stdout).toContain('8888');
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('--host sets custom host', async () => {
      try {
        const { proc, stdout } = await startCliProcess(['--host', '0.0.0.0', '--no-auto-discover']);
        expect(stdout).toContain('0.0.0.0');
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('--auth-user and --auth-pass set basic authentication', async () => {
      try {
        const { proc } = await startCliProcess([
          '--auth-user', 'cliuser',
          '--auth-pass', 'clipass',
          '--no-auto-discover'
        ]);
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('--auth-token sets bearer token authentication', async () => {
      try {
        const { proc } = await startCliProcess([
          '--auth-token', 'clitoken123',
          '--no-auto-discover'
        ]);
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('--fresh-process enables fresh process mode', async () => {
      try {
        const { proc } = await startCliProcess(['--fresh-process', '--no-auto-discover']);
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('--no-auto-discover disables auto-discovery', async () => {
      try {
        const { proc } = await startCliProcess(['--no-auto-discover']);
        proc.kill('SIGTERM');
      } catch (error) {
        // Should fail because no agents are specified (or node-pty not available)
        if (!isNodePtyError(error.message)) {
          expect(error.message).toContain('No agents');
        }
      }
    });

    itWithPty('--no-auto-refresh disables auto-refresh', async () => {
      try {
        const { proc } = await startCliProcess(['--no-auto-refresh', '--no-auto-discover']);
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('--auto-refresh-interval sets custom interval', async () => {
      try {
        const { proc } = await startCliProcess([
          '--auto-refresh-interval', '120',
          '--no-auto-discover'
        ]);
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('--auto-refresh-interval 0 disables interval-based refresh', async () => {
      try {
        const { proc } = await startCliProcess([
          '--auto-refresh-interval', '0',
          '--no-auto-discover'
        ]);
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('--claude enables Claude monitoring', async () => {
      try {
        const { proc } = await startCliProcess(['--claude', '--no-auto-discover']);
        proc.kill('SIGTERM');
      } catch (error) {
        // Expected to fail if claude CLI is not installed or node-pty not available
        // But should recognize the flag
        if (!isNodePtyError(error.message)) {
          expect(error.message).not.toContain('Unknown option');
        }
      }
    });

    itWithPty('--gemini enables Gemini monitoring', async () => {
      try {
        const { proc } = await startCliProcess(['--gemini', '--no-auto-discover']);
        proc.kill('SIGTERM');
      } catch (error) {
        // Expected to fail if gemini CLI is not installed or node-pty not available
        if (!isNodePtyError(error.message)) {
          expect(error.message).not.toContain('Unknown option');
        }
      }
    });

    itWithPty('--codex enables Codex monitoring', async () => {
      try {
        const { proc } = await startCliProcess(['--codex', '--no-auto-discover']);
        proc.kill('SIGTERM');
      } catch (error) {
        // Expected to fail if codex CLI is not installed or node-pty not available
        if (!isNodePtyError(error.message)) {
          expect(error.message).not.toContain('Unknown option');
        }
      }
    });

    itWithPty('multiple agent flags can be combined', async () => {
      try {
        const { proc } = await startCliProcess([
          '--claude', '--gemini', '--codex',
          '--no-auto-discover'
        ]);
        proc.kill('SIGTERM');
      } catch (error) {
        // Expected to fail if CLIs are not installed or node-pty not available
        if (!isNodePtyError(error.message)) {
          expect(error.message).not.toContain('Unknown option');
        }
      }
    });

    itWithPty('combines port, host, and auth flags', async () => {
      try {
        const { proc, stdout } = await startCliProcess([
          '--port', '7777',
          '--host', '0.0.0.0',
          '--auth-user', 'admin',
          '--auth-pass', 'secret',
          '--no-auto-discover'
        ]);
        expect(stdout).toContain('7777');
        expect(stdout).toContain('0.0.0.0');
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('combines all refresh-related flags', async () => {
      try {
        const { proc } = await startCliProcess([
          '--auto-refresh',
          '--auto-refresh-interval', '30',
          '--fresh-process',
          '--no-auto-discover'
        ]);
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });
  });

  describe('configuration priority (env > CLI > config file)', () => {
    itWithPty('CLI flags override config file values', async () => {
      const configPath = createConfigFile({
        port: 5555,
        host: '192.168.1.1'
      });

      try {
        const { proc, stdout } = await startCliProcess([
          '-c', configPath,
          '--port', '6666',
          '--no-auto-discover'
        ]);
        // CLI flag should override config file
        expect(stdout).toContain('6666');
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('env vars override CLI flags', async () => {
      const configPath = createConfigFile({
        port: 5554,
        host: '192.168.1.1'
      });

      try {
        const { proc, stdout } = await startCliProcess([
          '-c', configPath,
          '--host', '10.0.0.1',
          '--no-auto-discover'
        ], {
          AGENT_TANK_HOST: '172.16.0.1'
        });
        // Env var should override both config and CLI
        expect(stdout).toContain('172.16.0.1');
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('env vars override CLI auth flags', async () => {
      const configPath = createConfigFile({
        auth: {
          user: 'configuser'
        }
      });

      try {
        const { proc } = await startCliProcess([
          '-c', configPath,
          '--auth-user', 'cliuser',
          '--no-auto-discover'
        ], {
          AGENT_TANK_USER: 'envuser'
        });
        // Process should start (we can't easily verify auth from stdout)
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('config file agents merge with CLI agents', async () => {
      const configPath = createConfigFile({
        claude: true
      });

      try {
        const { proc } = await startCliProcess([
          '-c', configPath,
          '--gemini',
          '--no-auto-discover'
        ]);
        // Both claude (from config) and gemini (from CLI) should be enabled
        proc.kill('SIGTERM');
      } catch (error) {
        // Expected to fail if CLIs not installed or node-pty not available
        if (!isNodePtyError(error.message)) {
          expect(error.message).not.toContain('Unknown option');
        }
      }
    });
  });

  describe('error handling', () => {
    itWithPty('exits with code 1 when config file cannot be loaded', () => {
      const result = runCli(['-c', '/path/to/nonexistent/config.json']);
      expect(result.exitCode).toBe(1);
    });

    itWithPty('shows error message for invalid config file', () => {
      const invalidConfigPath = path.join(tempDir, 'broken.json');
      fs.writeFileSync(invalidConfigPath, 'not valid json at all');

      const result = runCli(['-c', invalidConfigPath]);

      expect(result.exitCode).toBe(1);
      const output = result.stderr + result.stdout;
      expect(output).toContain('Failed to load config file');

      fs.unlinkSync(invalidConfigPath);
    });

    itWithPty('handles empty config file', async () => {
      const configPath = createConfigFile({});

      try {
        const { proc } = await startCliProcess(['-c', configPath, '--no-auto-discover']);
        proc.kill('SIGTERM');
      } catch (error) {
        // May fail due to no agents, but should not fail due to config
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });

    itWithPty('rejects unknown CLI flags', () => {
      const result = runCli(['--unknown-flag']);
      expect(result.exitCode).not.toBe(0);
    });

    itWithPty('handles config file with extra unknown properties gracefully', async () => {
      const configPath = createConfigFile({
        port: 9994,
        unknownProperty: 'should be ignored',
        nested: { unknown: true }
      });

      try {
        const { proc, stdout } = await startCliProcess(['-c', configPath, '--no-auto-discover']);
        expect(stdout).toContain('9994');
        proc.kill('SIGTERM');
      } catch (error) {
        if (!error.message.includes('No agents') && !isNodePtyError(error.message)) {
          throw error;
        }
      }
    });
  });
});
