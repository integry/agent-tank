const pty = require('node-pty');

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
    this.isRefreshing = false;

    // Persistent process state
    this.shell = null;
    this.processReady = false;
    this.output = '';
    this.freshProcess = false;
    this._onDataCallback = null;
    this._commandInFlight = false;
    this._disposables = [];
  }

  getStatus() {
    return {
      name: this.name,
      usage: this.usage,
      metadata: this.metadata,
      lastUpdated: this.lastUpdated,
      error: this.error,
      isRefreshing: this.isRefreshing,
    };
  }

  async refresh() {
    if (this.isRefreshing) {
      console.log(`[${this.name}] Already refreshing, skipping...`);
      return;
    }

    console.log(`[${this.name}] Starting refresh...`);
    this.isRefreshing = true;
    this.error = null;

    try {
      // Fetch metadata once on first refresh (if agent supports it)
      if (!this._metadataFetched && this.fetchMetadata) {
        try {
          console.log(`[${this.name}] Fetching metadata (first refresh)...`);
          this.metadata = await this.fetchMetadata();
          console.log(`[${this.name}] Parsed metadata:`, JSON.stringify(this.metadata));
        } catch (metaErr) {
          console.error(`[${this.name}] Error fetching metadata:`, metaErr.message);
          // Continue with usage fetch even if metadata fails
        }
        this._metadataFetched = true;
      }

      const output = await this.runCommand();
      console.log(`[${this.name}] Got output, length: ${output.length} chars`);
      this.usage = this.parseOutput(output);
      console.log(`[${this.name}] Parsed usage:`, JSON.stringify(this.usage));
      this.lastUpdated = new Date().toISOString();
    } catch (err) {
      console.error(`[${this.name}] Error during refresh:`, err.message);
      this.error = err.message;
    } finally {
      this.isRefreshing = false;
      console.log(`[${this.name}] Refresh complete`);
    }
  }

  async runCommand() {
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
    return new Promise((resolve, reject) => {
      let trustHandled = false;
      let spawnOutput = '';

      console.log(`[${this.name}] Spawning persistent process: ${this.command} ${this.args.join(' ')}`);

      try {
        const env = this.getEnv ? this.getEnv() : { ...process.env, TERM: 'xterm-256color' };
        this.shell = pty.spawn(this.command, this.args, {
          name: 'xterm-color',
          cols: 120,
          rows: 40,
          cwd: '/tmp',
          env,
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

        // Handle trust prompt during spawn (only once)
        if (!trustHandled && this.handleTrustPrompt && this.handleTrustPrompt(this.shell, spawnOutput)) {
          trustHandled = true;
          return;
        }

        // Respond to terminal capability queries
        this._respondToTerminalQueries(data);

        // Check if ready for commands
        if (this.isReadyForCommands(spawnOutput)) {
          console.log(`[${this.name}] Process ready for commands`);
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

      const finish = (result) => {
        this._commandInFlight = false;
        this._onDataCallback = null;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
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

      this._onDataCallback = () => {
        if (this.hasCompleteOutput(this.output)) {
          console.log(`[${this.name}] Complete output detected`);
          // Small delay to capture any remaining output
          setTimeout(() => finish(this.output), 100);
        }
      };

      // Process is already at prompt, send commands immediately
      console.log(`[${this.name}] Sending commands to persistent process...`);
      this.sendCommands(this.shell, this.output);
    });
  }

  _setupPersistentDataHandler() {
    const handler = this.shell.onData((data) => {
      this.output += data;

      // Suppress terminal query responses while a command is in-flight
      // to avoid corrupting the CLI's input buffer with interleaved writes
      if (!this._commandInFlight) {
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
    const handler = this.shell.onExit(({ exitCode }) => {
      console.log(`[${this.name}] Persistent process exited with code ${exitCode}`);
      this.shell = null;
      this.processReady = false;
      this._onDataCallback = null;
      this._disposables = [];
    });
    this._disposables.push(handler);
  }

  _respondToTerminalQueries(data, target) {
    const sh = target || this.shell;
    if (!sh) return;
    if (data.includes('\x1b[6n')) sh.write('\x1b[1;1R');        // cursor position
    if (data.includes('\x1b[c')) sh.write('\x1b[?62;22c');      // device attributes
    if (data.includes('\x1b[?u')) sh.write('\x1b[?0u');         // kitty keyboard
    if (data.includes('\x1b]10;?')) sh.write('\x1b]10;rgb:ffff/ffff/ffff\x1b\\'); // fg color
    if (data.includes('\x1b]11;?')) sh.write('\x1b]11;rgb:0000/0000/0000\x1b\\'); // bg color
    if (data.includes('\x1b[>q')) sh.write('\x1bP>|xterm(1)\x1b\\');  // terminal version
    if (data.includes('\x1b[>4;?m')) sh.write('\x1b[>4m');      // modified keys
  }

  // Hook for subclasses to handle additional prompts during fresh process startup
  _handleAdditionalPrompts(_shell, _data, _output) {
    // Override in subclasses (e.g. codex update screen, continuation prompts)
  }

  killProcess() {
    if (this.shell) {
      console.log(`[${this.name}] Killing persistent process`);
      for (const d of this._disposables) {
        d.dispose();
      }
      this._disposables = [];
      this._onDataCallback = null;
      this.processReady = false;
      try {
        this.shell.kill();
      } catch (_e) {
        // Process may already be dead
      }
      this.shell = null;
    }
  }

  async _runCommandFresh() {
    return new Promise((resolve, reject) => {
      const timeout = this.getTimeout();
      let output = '';
      let completed = false;
      let commandsSent = false;
      let trustHandled = false;

      console.log(`[${this.name}] Spawning: ${this.command} ${this.args.join(' ')}`);

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
        console.error(`[${this.name}] Failed to spawn:`, spawnErr.message);
        reject(new Error(`Failed to spawn ${this.command}: ${spawnErr.message}`));
        return;
      }

      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          console.log(`[${this.name}] Timeout after ${timeout}ms, output length: ${output.length}`);
          if (output.length > 0) {
            console.log(`[${this.name}] Partial output:`, this.stripAnsi(output).substring(0, 500));
            // Write full output for debugging
            require('fs').writeFileSync(`/tmp/${this.name}-output.txt`, output);
            console.log(`[${this.name}] Full output written to /tmp/${this.name}-output.txt`);
          }
          shell.kill();
          // If we have some output, try to parse it anyway
          if (output.length > 100) {
            resolve(output);
          } else {
            reject(new Error('Timeout waiting for usage data'));
          }
        }
      }, timeout);

      shell.onData((data) => {
        output += data;

        // Log first data received
        if (output.length <= data.length) {
          console.log(`[${this.name}] First data received (${data.length} chars)`);
          if (data.length < 200) {
            console.log(`[${this.name}] Initial output:`, this.stripAnsi(data).substring(0, 100));
          }
        }

        // Handle trust prompt if agent has this method (only once)
        if (!trustHandled && this.handleTrustPrompt && this.handleTrustPrompt(shell, output)) {
          trustHandled = true;
          return;
        }

        this._respondToTerminalQueries(data, shell);
        this._handleAdditionalPrompts(shell, data, output);

        // Send commands when ready
        if (!commandsSent && this.isReadyForCommands(output)) {
          console.log(`[${this.name}] Ready for commands, sending...`);
          commandsSent = true;
          this.sendCommands(shell, output);
        }

        // Check if we have enough data to extract usage
        if (commandsSent && this.hasCompleteOutput(output)) {
          console.log(`[${this.name}] Complete output detected, finishing...`);
          // Small delay to capture any remaining output
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
          console.log(`[${this.name}] Process exited with code ${exitCode}, output length: ${output.length}`);
          if (output) {
            resolve(output);
          } else {
            reject(new Error(`Process exited with code ${exitCode}`));
          }
        }
      });
    });
  }

  getTimeout() { return 30000; } // Override in subclasses
  isReadyForCommands(_output) { return false; } // Override in subclasses
  hasCompleteOutput(_output) { return false; } // Override in subclasses
  sendCommands(_shell, _output) { /* Override in subclasses */ }
  parseOutput(_output) { return null; } // Override in subclasses

  /* eslint-disable no-control-regex */
  static ANSI_CURSOR_RIGHT = /\x1B\[(\d+)C/g;
  static ANSI_ESCAPE_SEQ = /\x1B\[[0-9;?]*[a-zA-Z]/g;
  static ANSI_OSC_SEQ = /\x1B\][^\x07]*\x07/g;
  static ANSI_REMAINING = /\x1B[^[\]]*?[a-zA-Z]/g;
  /* eslint-enable no-control-regex */
  stripAnsi(str) {
    return str
      .replace(BaseAgent.ANSI_CURSOR_RIGHT, (_, n) => ' '.repeat(parseInt(n)))
      .replace(BaseAgent.ANSI_ESCAPE_SEQ, '')
      .replace(BaseAgent.ANSI_OSC_SEQ, '')
      .replace(BaseAgent.ANSI_REMAINING, '')
      .replace(/\r/g, '')
      .replace(/  +/g, ' ');
  }

  stripBoxChars(str) {
    return str ? str.replace(/[│╭╮╯╰─┌┐└┘├┤┬┴┼║═╔╗╚╝╠╣╦╩╬]/g, '').trim() : str;
  }
}

module.exports = { BaseAgent };
