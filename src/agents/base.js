const pty = require('node-pty');
const process = require('node:process');
const logger = require('../logger.js');

class BaseAgent {
  constructor(name, command, args = []) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.usage = null;
    this.metadata = null;
    this._metadataFetched = false;
    this.lastUpdated = null;
    this.error = null;
    this.auth = null;
    this.isRefreshing = false;
    this.refreshInterval = null;    // Per-agent override (seconds), null = use global
    this.minRefreshInterval = null; // Per-agent minimum (seconds), null = no minimum

    // Persistent process state
    this.shell = null;
    this.processReady = false;
    this.output = '';
    this.freshProcess = false;
    this._onDataCallback = null;
    this._commandInFlight = false;
    this._disposables = [];
    this._stopRequested = false;
  }

  _createStopError() {
    return new Error('Agent stopping');
  }

  isStopping() {
    return this._stopRequested;
  }

  requestStop() {
    this._stopRequested = true;
    this.isRefreshing = false;
    this._commandInFlight = false;
    this._onDataCallback = null;
  }

  getStatus() {
    return {
      name: this.name,
      usage: this.usage,
      metadata: this.metadata,
      lastUpdated: this.lastUpdated,
      error: this.error,
      auth: this.auth,
      isRefreshing: this.isRefreshing,
    };
  }

  async refresh() {
    if (this.isStopping()) {
      logger.agent(this.name, 'Skipping refresh while stopping');
      return;
    }

    if (this.isRefreshing) {
      logger.agent(this.name, 'Already refreshing, skipping...');
      return;
    }

    logger.agent(this.name, 'Starting refresh...');
    this.isRefreshing = true;
    this.error = null;
    this.auth = null;

    try {
      // Fetch metadata once on first refresh (if agent supports it)
      if (!this._metadataFetched && this.fetchMetadata) {
        try {
          logger.agent(this.name, 'Fetching metadata (first refresh)...');
          this.metadata = await this.fetchMetadata();
          logger.agent(this.name, 'Parsed metadata:', logger.json(this.metadata));
        } catch (metaErr) {
          logger.error(`[${this.name}] Error fetching metadata:`, metaErr.message);
          // Continue with usage fetch even if metadata fails
        }
        this._metadataFetched = true;
        // In fresh process mode, kill the persistent process spawned for metadata
        // so that runCommand() starts cleanly with _runCommandFresh()
        if (this.freshProcess) {
          this.killProcess();
        }
      }

      if (this.isStopping()) {
        throw this._createStopError();
      }

      const output = await this.runCommand();
      logger.agent(this.name, 'Got output, length:', logger.dim(`${output.length} chars`));

      // Check for rate limit and session errors before parsing
      // Match actual error messages, not incidental mentions like "rate limits and credits"
      const cleanOutput = this.stripAnsi(output);
      const authState = this.detectAuthenticationState ? this.detectAuthenticationState(cleanOutput) : null;
      if (authState) {
        logger.agent(this.name, 'Authentication issue detected:', logger.json(authState));
        this.auth = authState;
        this.error = this.usage ? `${authState.message} — using cached data` : authState.message;
        this.lastUpdated = new Date().toISOString();
        return;
      }

      if (/rate.?limited|rate_limit_error/i.test(cleanOutput)) {
        logger.agent(this.name, 'Rate limited, preserving last known usage data');
        this.error = 'Rate limited — using cached data';
        this.lastUpdated = new Date().toISOString();
        // Don't overwrite this.usage — keep the last known good data
        return;
      }

      // Check for session/auth errors — preserve cached data if available
      const sessionErrorMatch = cleanOutput.match(/session.?expired|session.?error|invalid.?session|authentication.?error|auth.?failed|Unable to (?:load|fetch)|Error loading|could not (?:load|fetch)|Failed to load usage|not authenticated|login required|sign.?in required/i);
      if (sessionErrorMatch) {
        const errorMsg = sessionErrorMatch[0];
        logger.agent(this.name, 'Session error detected:', logger.dim(errorMsg));
        this.error = this.usage ? `Session error — using cached data` : `Session error: ${errorMsg}`;
        this.lastUpdated = new Date().toISOString();
        return;
      }

      const parsed = this.parseOutput(output);

      // Only update usage if we got meaningful data (not all-null)
      const hasData = parsed && Object.values(parsed).some(v => v !== null && v !== undefined && (typeof v !== 'object' || (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)));
      if (hasData) { this.usage = parsed; this.lastUpdated = new Date().toISOString(); } else if (this.usage) { logger.agent(this.name, 'Parse returned no data, preserving last known usage'); this.error = 'Failed to parse — using cached data'; } else { this.usage = parsed; this.lastUpdated = new Date().toISOString(); }
      logger.agent(this.name, 'Parsed usage:', logger.json(this.usage));
    } catch (err) {
      if (this.isStopping() && err.message === 'Agent stopping') {
        logger.agent(this.name, 'Refresh cancelled during shutdown');
        return;
      }
      logger.error(`[${this.name}] Error during refresh:`, err.message);
      this.error = err.message;
    } finally {
      this.isRefreshing = false;
      logger.agent(this.name, 'Refresh complete');
    }
  }

  async runCommand() {
    if (this.isStopping()) {
      throw this._createStopError();
    }

    if (this.freshProcess) {
      return this._runCommandFresh();
    }

    // Persistent mode: spawn if needed, then send command
    if (!this.shell || !this.processReady) {
      await this.spawnProcess();
    }

    return this.sendCommandAndWait();
  }

  async spawnProcess() {
    if (this.isStopping()) {
      throw this._createStopError();
    }

    return new Promise((resolve, reject) => {
      let trustHandled = false;
      let spawnOutput = '';

      logger.agent(this.name, 'Spawning persistent process:', logger.dim(`${this.command} ${this.args.join(' ')}`));

      try {
        const env = this.getEnv ? this.getEnv() : { ...process.env, TERM: 'xterm-256color' };
        this.shell = pty.spawn(this.command, this.args, {
          name: 'xterm-color',
          cols: 120,
          rows: 40,
          cwd: '/tmp',
          env,
        });
        if (typeof this.shell.pid === 'number') {
          logger.agent(this.name, 'Persistent process pid:', logger.dim(String(this.shell.pid)));
        }
      } catch (spawnErr) {
        logger.error(`[${this.name}] Failed to spawn:`, spawnErr.message);
        reject(new Error(`Failed to spawn ${this.command}: ${spawnErr.message}`));
        return;
      }

      const timer = setTimeout(() => {
        if (this.isStopping()) {
          reject(this._createStopError());
          return;
        }
        logger.error(`[${this.name}] Spawn timeout after ${this.getTimeout()}ms`);
        this.killProcess();
        reject(new Error('Timeout waiting for process to become ready'));
      }, this.getTimeout());

      let trustCooldownUntil = 0;
      const spawnDataHandler = this.shell.onData((data) => {
        if (this.isStopping()) {
          clearTimeout(timer);
          spawnDataHandler.dispose();
          spawnExitHandler.dispose();
          this.killProcess();
          reject(this._createStopError());
          return;
        }

        spawnOutput += data;

        // Handle trust/update prompts during spawn (only once each)
        if (!trustHandled && this.handleTrustPrompt && this.handleTrustPrompt(this.shell, spawnOutput)) {
          trustHandled = true;
          spawnOutput = '';
          trustCooldownUntil = Date.now() + 4000;
          return;
        }
        this._handleAdditionalPrompts(this.shell, data, spawnOutput);
        this._respondToTerminalQueries(data);

        const authState = this.detectAuthenticationState ? this.detectAuthenticationState(spawnOutput) : null;
        if (authState) {
          logger.agent(this.name, 'Authentication issue detected during spawn');
          clearTimeout(timer);
          spawnDataHandler.dispose();
          spawnExitHandler.dispose();
          if (!this.shell) {
            reject(new Error('Process exited during spawn before handlers were attached'));
            return;
          }
          this.processReady = true;
          this.output = spawnOutput;
          this._setupPersistentDataHandler();
          this._setupPersistentExitHandler();
          resolve();
          return;
        }

        if (Date.now() >= trustCooldownUntil && this.isReadyForCommands(spawnOutput)) {
          logger.agent(this.name, 'Process ready for commands');
          clearTimeout(timer);
          spawnDataHandler.dispose();
          spawnExitHandler.dispose();
          if (!this.shell) {
            reject(new Error('Process exited during spawn before handlers were attached'));
            return;
          }
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
        if (this.isStopping()) {
          reject(this._createStopError());
          return;
        }
        reject(new Error(`Process exited during spawn with code ${exitCode}`));
      });
    });
  }

  async sendCommandAndWait() {
    if (this.isStopping()) {
      throw this._createStopError();
    }

    return new Promise((resolve, reject) => {
      const existingOutput = this.output;
      const existingAuthState = this.detectAuthenticationState ? this.detectAuthenticationState(existingOutput) : null;
      if (existingAuthState) {
        logger.agent(this.name, 'Using existing authentication output without sending commands');
        resolve(existingOutput);
        return;
      }

      this.output = '';
      this._commandInFlight = true;

      const finish = (result) => {
        this._commandInFlight = false;
        this._onDataCallback = null;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        if (this.isStopping()) {
          this._commandInFlight = false;
          this._onDataCallback = null;
          reject(this._createStopError());
          return;
        }
        logger.agent(this.name, 'Command timeout after', logger.dim(`${this.getTimeout()}ms`), ', output length:', logger.dim(`${this.output.length}`));
        if (this.output.length > 0) {
          logger.agent(this.name, 'Partial output:', logger.dim(this.stripAnsi(this.output).substring(0, 500)));
          require('fs').writeFileSync(`/tmp/${this.name}-output.txt`, this.output);
        }
        // Kill the stuck process so it respawns fresh on the next refresh
        logger.agent(this.name, 'Killing stuck process to force respawn');
        const partialOutput = this.output;
        this.killProcess();
        if (partialOutput.length > 100) {
          resolve(partialOutput);
        } else {
          reject(new Error('Timeout waiting for usage data'));
        }
      }, this.getTimeout());

      this._onDataCallback = () => {
        if (this.isStopping()) {
          this._commandInFlight = false;
          this._onDataCallback = null;
          clearTimeout(timer);
          reject(this._createStopError());
          return;
        }
        if (this.hasCompleteOutput(this.output)) {
          logger.agent(this.name, 'Complete output detected');
          // Small delay to capture any remaining output
          setTimeout(() => finish(this.output), 100);
        }
      };

      // Process is already at prompt, send commands immediately
      logger.agent(this.name, 'Sending commands to persistent process...');
      this.sendCommands(this.shell, existingOutput);
    });
  }

  _setupPersistentDataHandler() {
    if (!this.shell) {
      logger.agent(this.name, 'Skipping persistent data handler setup: shell already exited');
      return;
    }
    const handler = this.shell.onData((data) => {
      this.output += data;

      // Always respond to terminal queries — suppressing them causes deadlocks
      // when CLIs (e.g. Gemini) wait for cursor position responses before
      // rendering output. Delay slightly during command-in-flight to avoid
      // interleaving with command text being sent via setTimeout.
      if (this._commandInFlight) {
        setTimeout(() => this._respondToTerminalQueries(data), 50);
      } else {
        this._respondToTerminalQueries(data);
      }

      // Invoke command waiter callback if set
      if (this._onDataCallback) {
        this._onDataCallback(data);
      }
    });
    this._disposables.push(handler);
  }

  _setupPersistentExitHandler() {
    if (!this.shell) {
      logger.agent(this.name, 'Skipping persistent exit handler setup: shell already exited');
      return;
    }
    const handler = this.shell.onExit(({ exitCode }) => {
      logger.agent(this.name, 'Persistent process exited with code', logger.dim(exitCode));
      this.shell = null; this.processReady = false; this._onDataCallback = null; this._disposables = [];
    });
    this._disposables.push(handler);
  }

  _respondToTerminalQueries(data, target) {
    const sh = target || this.shell; if (!sh) return;
    if (data.includes('\x1b[6n')) sh.write('\x1b[1;1R'); if (data.includes('\x1b[c')) sh.write('\x1b[?62;22c'); if (data.includes('\x1b[?u')) sh.write('\x1b[?0u');
    if (data.includes('\x1b]10;?')) sh.write('\x1b]10;rgb:ffff/ffff/ffff\x1b\\'); if (data.includes('\x1b]11;?')) sh.write('\x1b]11;rgb:0000/0000/0000\x1b\\');
    if (data.includes('\x1b[>q')) sh.write('\x1bP>|xterm(1)\x1b\\'); if (data.includes('\x1b[>4;?m')) sh.write('\x1b[>4m');
  }

  _handleAdditionalPrompts(_s, _d, _o) { } // Hook for subclasses; killProcess: see below
  killProcess() { // Terminates the persistent PTY process
    if (this.shell) {
      const pidText = typeof this.shell.pid === 'number' ? ` (pid ${this.shell.pid})` : '';
      logger.agent(this.name, `Killing persistent process${pidText}`);
      const shell = this.shell;
      for (const d of this._disposables) { d.dispose(); }
      this._disposables = []; this._onDataCallback = null; this.processReady = false;
      try {
        // PTY-backed CLIs may spawn descendants; kill the whole process group when available.
        if (typeof shell.pid === 'number' && shell.pid > 0) {
          try { process.kill(-shell.pid, 'SIGTERM'); } catch (_e) { /* Group may not exist */ }
        }
        shell.kill();
      } catch (_e) { /* Process may already be dead */ }
      this.shell = null;
    }
  }

  async _runCommandFresh() {
    if (this.isStopping()) {
      throw this._createStopError();
    }

    return new Promise((resolve, reject) => {
      const timeout = this.getTimeout();
      let output = '';
      let completed = false;
      let commandsSent = false;
      let trustHandled = false;

      logger.agent(this.name, 'Spawning:', logger.dim(`${this.command} ${this.args.join(' ')}`));

      let shell;
      try {
        const env = this.getEnv ? this.getEnv() : { ...process.env, TERM: 'xterm-256color' };
        shell = pty.spawn(this.command, this.args, {
          name: 'xterm-color',
          cols: 120,
          rows: 40,
          cwd: '/tmp',
          env,
        });
      } catch (spawnErr) {
        logger.error(`[${this.name}] Failed to spawn:`, spawnErr.message);
        reject(new Error(`Failed to spawn ${this.command}: ${spawnErr.message}`));
        return;
      }

      const timer = setTimeout(() => {
        if (!completed) {
          if (this.isStopping()) {
            completed = true;
            shell.kill();
            reject(this._createStopError());
            return;
          }
          completed = true;
          logger.agent(this.name, 'Timeout after', logger.dim(`${timeout}ms`), ', output length:', logger.dim(`${output.length}`));
          if (output.length > 0) {
            logger.agent(this.name, 'Partial output:', logger.dim(this.stripAnsi(output).substring(0, 500)));
            require('fs').writeFileSync(`/tmp/${this.name}-output.txt`, output);
            logger.agent(this.name, 'Full output written to', logger.dim(`/tmp/${this.name}-output.txt`));
          }
          shell.kill();
          if (output.length > 100) {
            resolve(output);
          } else {
            reject(new Error('Timeout waiting for usage data'));
          }
        }
      }, timeout);

      let trustCooldownUntil = 0;
      shell.onData((data) => {
        if (this.isStopping()) {
          if (!completed) {
            completed = true;
            clearTimeout(timer);
            shell.kill();
            reject(this._createStopError());
          }
          return;
        }

        output += data;

        if (output.length <= data.length) {
          logger.agent(this.name, 'First data received', logger.dim(`(${data.length} chars)`));
          if (data.length < 200) {
            logger.agent(this.name, 'Initial output:', logger.dim(this.stripAnsi(data).substring(0, 100)));
          }
        }

        if (!trustHandled && this.handleTrustPrompt && this.handleTrustPrompt(shell, output)) {
          trustHandled = true;
          output = '';
          trustCooldownUntil = Date.now() + 4000;
          return;
        }

        this._respondToTerminalQueries(data, shell);
        this._handleAdditionalPrompts(shell, data, output);

        if (Date.now() >= trustCooldownUntil && !commandsSent && this.isReadyForCommands(output)) {
          logger.agent(this.name, 'Ready for commands, sending...');
          commandsSent = true;
          this.sendCommands(shell, output);
        }

        // Check if we have enough data to extract usage
        if (commandsSent && this.hasCompleteOutput(output)) {
          logger.agent(this.name, 'Complete output detected, finishing...');
          setTimeout(() => {
            if (!completed) {
              completed = true;
              clearTimeout(timer);
              shell.kill();
              resolve(output);
            }
          }, 300);
        }
      });

      shell.onExit(({ exitCode }) => {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          if (this.isStopping()) {
            reject(this._createStopError());
            return;
          }
          logger.agent(this.name, 'Process exited with code', logger.dim(exitCode), ', output length:', logger.dim(`${output.length}`));
          if (output) {
            resolve(output);
          } else {
            reject(new Error(`Process exited with code ${exitCode}`));
          }
        }
      });
    });
  }

  getTimeout() { return 30000; }
  isReadyForCommands(_o) { return false; }
  hasCompleteOutput(_o) { return false; }
  sendCommands(_s, _o) { }
  parseOutput(_o) { return null; }

  /** Lightweight keepalive method to prevent session expiration. Subclasses can override. @returns {Promise<boolean>} True if keepalive succeeded */
  async keepalive() {
    if (this.isStopping()) { return false; }
    if (this.freshProcess) { console.log(`[${this.name}] Keepalive skipped (fresh process mode)`); return true; }
    if (!this.shell || !this.processReady) { console.log(`[${this.name}] Keepalive: spawning process...`); await this.spawnProcess(); }
    if (this.shell) { console.log(`[${this.name}] Keepalive: sending ping...`); this.shell.write('\x1b'); return true; }
    return false;
  }
  /* eslint-disable no-control-regex */
  static ANSI_CURSOR_RIGHT = /\x1B\[(\d+)C/g; static ANSI_ESCAPE_SEQ = /\x1B\[[0-9;?]*[a-zA-Z]/g;
  static ANSI_OSC_SEQ = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g; static ANSI_DCS_SEQ = /\x1BP[^\x1B]*\x1B\\/g;
  static ANSI_CHARSET = /\x1B[()#][A-Za-z0-9]/g; static ANSI_TWOCHAR = /\x1B[=>DMEH78cNOZn\\|}{~]/g;
  static ANSI_LEFTOVER = /\x1B/g; static MULTI_SPACE = /  +/g; /* eslint-enable no-control-regex */
  stripAnsi(str) { return str.replace(BaseAgent.ANSI_CURSOR_RIGHT, (_, n) => ' '.repeat(parseInt(n))).replace(BaseAgent.ANSI_ESCAPE_SEQ, '').replace(BaseAgent.ANSI_OSC_SEQ, '').replace(BaseAgent.ANSI_DCS_SEQ, '').replace(BaseAgent.ANSI_CHARSET, '').replace(BaseAgent.ANSI_TWOCHAR, '').replace(BaseAgent.ANSI_LEFTOVER, '').replace(/\r/g, '').replace(BaseAgent.MULTI_SPACE, ' '); }
  stripBoxChars(str) { return str ? str.replace(/[│╭╮╯╰─┌┐└┘├┤┬┴┼║═╔╗╚╝╠╣╦╩╬]/g, '').trim() : str; }
}
module.exports = { BaseAgent };
