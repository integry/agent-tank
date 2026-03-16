const { BaseAgent } = require('./base.js');
const { JsonRpcClient } = require('../json-rpc-client.js');
const {
  formatRpcResponseAsOutput,
  parseRpcRateLimits,
} = require('./codex-rpc-helpers.js');
const {
  parseResetTime,
  parseLimitEntry,
  parseVersionInfo,
  parseModelLimits,
  extractMetadataFromOutput,
} = require('./codex-pty-helpers.js');

class CodexAgent extends BaseAgent {
  constructor() {
    super('codex', 'codex');
    this._rpcClient = null;
    this._rpcSupported = null; // null = unknown, true/false = tested
  }

  getTimeout() { return 25000; }

  /**
   * Override runCommand to attempt JSON-RPC first, then fall back to PTY
   */
  async runCommand() {
    if (this._rpcSupported === false) {
      return this._runWithPty();
    }

    try {
      const result = await this._runWithJsonRpc();
      this._rpcSupported = true;
      return result;
    } catch (err) {
      if (this._rpcSupported === null) {
        console.log(`[${this.name}] JSON-RPC not available, falling back to PTY: ${err.message}`);
        this._rpcSupported = false;
      }
      return this._runWithPty();
    }
  }

  /**
   * Run using JSON-RPC app-server mode
   */
  async _runWithJsonRpc() {
    console.log(`[${this.name}] Attempting JSON-RPC mode...`);

    if (this._rpcClient) {
      this._rpcClient.stop();
      this._rpcClient = null;
    }

    this._rpcClient = new JsonRpcClient('codex', ['-s', 'read-only', '-a', 'untrusted', 'app-server'], {
      cwd: '/tmp',
      timeout: this.getTimeout(),
    });

    try {
      await this._rpcClient.start();
      console.log(`[${this.name}] JSON-RPC server started`);

      const rateLimits = await this._rpcClient.call('account/rateLimits/read', {});
      console.log(`[${this.name}] Received rate limits via JSON-RPC:`, JSON.stringify(rateLimits));

      const { marker, data } = formatRpcResponseAsOutput(rateLimits);
      this._rpcRateLimits = data;
      return marker;
    } finally {
      if (this._rpcClient) {
        this._rpcClient.stop();
        this._rpcClient = null;
      }
    }
  }

  /**
   * Run using traditional PTY mode
   */
  async _runWithPty() {
    if (this.freshProcess) {
      return this._runCommandFresh();
    }

    if (!this.shell || !this.processReady) {
      await this.spawnProcess();
    }

    return this.sendCommandAndWait();
  }

  handleTrustPrompt(shell, output) {
    if (!shell) return false;
    const patterns = ['Do you trust', 'trust the files', 'trust this folder', 'Trust this workspace', 'allow access'];
    if (!patterns.some(p => output.toLowerCase().includes(p.toLowerCase()))) return false;
    console.log(`[${this.name}] Detected trust prompt, auto-accepting...`);
    shell.write('y\r');
    setTimeout(() => { if (shell) { console.log(`[${this.name}] Sending Enter to proceed...`); shell.write('\r'); } }, 500);
    return true;
  }

  handleUpdateScreen(shell, output) {
    if (!shell) return false;
    const clean = this.stripAnsi(output);
    if (!(/u?pdate available/i.test(clean) && /[\d.]+\s*->\s*[\d.]+/.test(clean) && /skip/i.test(clean))) return false;
    console.log(`[${this.name}] Detected update screen, selecting '2' to skip...`);
    shell.write('2');
    setTimeout(() => { if (shell) shell.write('\r'); }, 300);
    return true;
  }

  parseVersionInfo(output) {
    return parseVersionInfo(output, this.stripAnsi.bind(this));
  }

  isReadyForCommands(output) { return this.isReadyForStatus(output); }
  isReadyForStatus(output) { return output.includes('? for shortcuts') || output.includes('To get started'); }
  sendCommands(shell, _output) { console.log(`[${this.name}] Sending /status command...`); setTimeout(() => { if (shell) shell.write('/status\r'); }, 100); }

  _handleAdditionalPrompts(shell, _data, output) {
    if (!shell) return;
    if (!this._updateHandled && this.handleUpdateScreen(shell, output)) {
      this._updateHandled = true;
      return;
    }
    const cleanOutput = this.stripAnsi(output);
    const isUpdateScreen = /u?pdate available/i.test(cleanOutput) && /[\d.]+\s*->\s*[\d.]+/.test(cleanOutput);
    if (!this._continuationHandled && !isUpdateScreen && output.includes('Press enter to continue')) {
      console.log(`[${this.name}] Detected continuation prompt`);
      this._continuationHandled = true;
      shell.write('\r');
    }
  }

  handleInteractivePrompts(shell, data, output, state) {
    if (!shell) return false;

    if (!state.trustHandled && this.handleTrustPrompt(shell, output)) {
      state.trustHandled = true;
      return true;
    }

    if (!state.updateHandled && this.handleUpdateScreen(shell, output)) {
      state.updateHandled = true;
      return true;
    }

    this._respondToTerminalQueries(data, shell);

    const cleanOutput = this.stripAnsi(output);
    const isUpdateScreen = /u?pdate available/i.test(cleanOutput) && /[\d.]+\s*->\s*[\d.]+/.test(cleanOutput);
    if (!state.continuationHandled && !isUpdateScreen && output.includes('Press enter to continue')) {
      console.log(`[${this.name}] Detected continuation prompt`);
      state.continuationHandled = true;
      shell.write('\r');
    }

    return false;
  }

  async spawnProcess() {
    return new Promise((resolve, reject) => {
      const pty = require('node-pty');
      let spawnOutput = '';
      const state = { trustHandled: false, continuationHandled: false, updateHandled: false };

      console.log(`[${this.name}] Spawning persistent process: ${this.command} ${this.args.join(' ')}`);

      try {
        this.shell = pty.spawn(this.command, this.args, {
          name: 'xterm-256color',
          cols: 120,
          rows: 40,
          cwd: '/tmp',
          env: { ...process.env, TERM: 'xterm-256color' },
        });
      } catch (spawnErr) {
        console.error(`[${this.name}] Failed to spawn:`, spawnErr.message);
        reject(new Error(`Failed to spawn ${this.command}: ${spawnErr.message}`));
        return;
      }

      const timer = setTimeout(() => {
        console.error(`[${this.name}] Spawn timeout after ${this.getTimeout()}ms`);
        this.killProcess();
        reject(new Error('Timeout waiting for process to become ready'));
      }, this.getTimeout());

      const spawnDataHandler = this.shell.onData((data) => {
        spawnOutput += data;
        this.handleInteractivePrompts(this.shell, data, spawnOutput, state);

        if (this.isReadyForStatus(spawnOutput)) {
          console.log(`[${this.name}] Process ready for commands`);
          const versionFromSpawn = this.parseVersionInfo(spawnOutput);
          if (versionFromSpawn) {
            this._spawnVersionInfo = versionFromSpawn;
            console.log(`[${this.name}] Version info from spawn:`, JSON.stringify(versionFromSpawn));
          }
          clearTimeout(timer);
          spawnDataHandler.dispose();
          this.processReady = true;
          this._setupPersistentDataHandler();
          this._setupPersistentExitHandler();
          resolve();
        }
      });

      const spawnExitHandler = this.shell.onExit(({ exitCode }) => {
        clearTimeout(timer);
        spawnDataHandler.dispose();
        spawnExitHandler.dispose();
        this.shell = null;
        this.processReady = false;
        reject(new Error(`Process exited during spawn with code ${exitCode}`));
      });
    });
  }

  async sendCommandAndWait() {
    return new Promise((resolve, reject) => {
      this.output = '';
      this._commandInFlight = true;
      let retryTimer = null;
      let settleTimer = null;

      const finish = (result) => {
        this._commandInFlight = false;
        this._onDataCallback = null;
        clearTimeout(timer);
        if (retryTimer) clearInterval(retryTimer);
        if (settleTimer) clearTimeout(settleTimer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        if (retryTimer) clearInterval(retryTimer);
        if (settleTimer) clearTimeout(settleTimer);
        console.log(`[${this.name}] Command timeout after ${this.getTimeout()}ms, output length: ${this.output.length}`);
        if (this.output.length > 0) {
          console.log(`[${this.name}] Partial output:`, this.stripAnsi(this.output).substring(0, 500));
          require('fs').writeFileSync(`/tmp/${this.name}-output.txt`, this.output);
        }
        if (this.output.length > 100) {
          finish(this.output);
        } else {
          this._commandInFlight = false;
          this._onDataCallback = null;
          reject(new Error('Timeout waiting for usage data'));
        }
      }, this.getTimeout());

      retryTimer = setInterval(() => {
        if (!this.hasCompleteOutput(this.output) && this.shell) {
          console.log(`[${this.name}] Retrying /status...`);
          this.output = '';
          this.shell.write('/status\r');
        }
      }, 500);

      this._onDataCallback = () => {
        if (this.hasCompleteOutput(this.output)) {
          if (!settleTimer) {
            console.log(`[${this.name}] Complete output detected, waiting to settle...`);
            settleTimer = setTimeout(() => finish(this.output), 200);
          }
        }
      };

      console.log(`[${this.name}] Sending /status to persistent process...`);
      setTimeout(() => { if (this.shell) this.shell.write('/status\r'); }, 100);
    });
  }

  hasCompleteOutput(output) {
    return output.includes('5h limit') && output.includes('Weekly limit');
  }

  parseResetTime(resetStr) {
    return parseResetTime(resetStr);
  }

  parseLimitEntry(match, label, cycleType) {
    return parseLimitEntry(match, label, cycleType);
  }

  parseOutput(output) {
    // Check if this is an RPC response marker
    if (output === '__RPC_RESPONSE__' && this._rpcRateLimits) {
      const context = {
        versionInfo: this._spawnVersionInfo || null,
        parseResetTime: this.parseResetTime.bind(this),
      };
      const { usage, metadataUpdates } = parseRpcRateLimits(this._rpcRateLimits, context);
      this._rpcRateLimits = null;

      // Apply metadata updates
      if (!this.metadata) this.metadata = {};
      Object.assign(this.metadata, metadataUpdates);

      return usage;
    }

    const clean = this.stripAnsi(output);
    const usage = {
      fiveHour: null,
      weekly: null,
      version: (() => {
        const v = { ...this._spawnVersionInfo, ...this.parseVersionInfo(output) };
        return Object.keys(v).length > 0 ? v : null;
      })(),
    };

    const fiveHourMatch = clean.match(/5h limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i);
    if (fiveHourMatch) {
      usage.fiveHour = this.parseLimitEntry(fiveHourMatch, '5h limit', 'fiveHour');
    }

    const weeklyMatch = clean.match(/Weekly limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i);
    if (weeklyMatch) {
      usage.weekly = this.parseLimitEntry(weeklyMatch, 'Weekly limit', 'weekly');
    }

    const modelLimits = parseModelLimits(clean);
    if (modelLimits.length > 0) {
      usage.modelLimits = modelLimits;
    }

    const modelMatch = clean.match(/Model:\s*([\w.-]+)/i);
    if (modelMatch) {
      usage.model = this.stripBoxChars(modelMatch[1]);
    }

    const accountMatch = clean.match(/Account:\s*(\S+@\S+)/i);
    if (accountMatch) {
      usage.account = this.stripBoxChars(accountMatch[1]);
    }

    this._updateMetadataFromOutput(clean);

    return usage;
  }

  _updateMetadataFromOutput(clean) {
    if (!this.metadata) this.metadata = {};
    const extracted = extractMetadataFromOutput(clean, this.stripBoxChars.bind(this));
    Object.assign(this.metadata, extracted);
  }

  get usingJsonRpc() {
    return this._rpcSupported;
  }

  setRpcMode(useRpc) {
    this._rpcSupported = useRpc;
  }

  killProcess() {
    if (this._rpcClient) {
      this._rpcClient.stop();
      this._rpcClient = null;
    }
    super.killProcess();
  }

  /** Lightweight keepalive to prevent session expiration. @returns {Promise<boolean>} True if keepalive succeeded */
  async keepalive() {
    if (this._rpcSupported === true) { console.log(`[${this.name}] Keepalive skipped (JSON-RPC mode)`); return true; }
    if (this.freshProcess) { console.log(`[${this.name}] Keepalive skipped (fresh process mode)`); return true; }
    if (!this.shell || !this.processReady) { console.log(`[${this.name}] Keepalive: spawning process...`); await this.spawnProcess(); }
    if (this.shell) { console.log(`[${this.name}] Keepalive: sending ping...`); this.shell.write('\x1b'); return true; }
    return false;
  }

  /**
   * Spawns a fresh CLI process, sends /status to refresh the session token,
   * then tears down the process cleanly. This is a silent operation that
   * does not affect the main usage/error state.
   * @returns {Promise<boolean>} True if the ping succeeded
   */
  async pingKeepalive() {
    // If JSON-RPC is supported, skip the ping (session is managed by RPC)
    if (this._rpcSupported === true) {
      console.log(`[${this.name}] pingKeepalive: skipped (JSON-RPC mode)`);
      return true;
    }

    const pty = require('node-pty');
    console.log(`[${this.name}] pingKeepalive: spawning fresh process for session refresh...`);

    return new Promise((resolve) => {
      let shell = null;
      let output = '';
      let commandsSent = false;
      let completed = false;
      const state = { trustHandled: false, continuationHandled: false, updateHandled: false };

      const cleanup = (success) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        if (shell) {
          try { shell.kill(); } catch (_e) { /* Process may already be dead */ }
        }
        console.log(`[${this.name}] pingKeepalive: ${success ? 'succeeded' : 'failed'}`);
        resolve(success);
      };

      // Use a shorter timeout for keepalive pings (10 seconds)
      const timer = setTimeout(() => {
        console.log(`[${this.name}] pingKeepalive: timeout after 10s`);
        cleanup(false);
      }, 10000);

      try {
        shell = pty.spawn(this.command, this.args, {
          name: 'xterm-256color',
          cols: 120,
          rows: 40,
          cwd: '/tmp',
          env: { ...process.env, TERM: 'xterm-256color' },
        });
      } catch (spawnErr) {
        console.error(`[${this.name}] pingKeepalive: spawn failed: ${spawnErr.message}`);
        cleanup(false);
        return;
      }

      shell.onData((data) => {
        output += data;

        // Handle interactive prompts (trust, update screens, etc.)
        this.handleInteractivePrompts(shell, data, output, state);

        // Respond to terminal capability queries
        this._respondToTerminalQueries(data, shell);

        // Wait for CLI to be ready, then send /status
        if (!commandsSent && this.isReadyForStatus(output)) {
          console.log(`[${this.name}] pingKeepalive: CLI ready, sending /status...`);
          commandsSent = true;
          setTimeout(() => shell.write('/status\r'), 100);
        }

        // Check if /status output is complete (has limit information)
        if (commandsSent && this.hasCompleteOutput(output)) {
          console.log(`[${this.name}] pingKeepalive: /status response received`);
          setTimeout(() => cleanup(true), 100);
        }
      });

      shell.onExit(({ exitCode }) => {
        console.log(`[${this.name}] pingKeepalive: process exited with code ${exitCode}`);
        // Consider success if we sent commands (session was refreshed)
        cleanup(commandsSent);
      });
    });
  }
}

module.exports = { CodexAgent };
