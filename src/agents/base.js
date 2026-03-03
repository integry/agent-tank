const pty = require('node-pty');

class BaseAgent {
  constructor(name, command, args = []) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.usage = null;
    this.lastUpdated = null;
    this.error = null;
    this.isRefreshing = false;
  }

  getStatus() {
    return {
      name: this.name,
      usage: this.usage,
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
          // Trust prompt handled, wait for real prompt
          trustHandled = true;
          return;
        }

        // Respond to cursor position query (CSI 6n) - some CLIs require this
        // Query is: ESC[6n, Response should be: ESC[{row};{col}R
        if (data.includes('\x1b[6n') || data.includes('[6n')) {
          console.log(`[${this.name}] Responding to cursor position query`);
          shell.write('\x1b[1;1R'); // Report cursor at row 1, col 1
        }

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

  // Override in subclasses
  getTimeout() {
    return 30000; // 30 seconds default
  }

  isReadyForCommands(_output) {
    return false; // Override in subclasses
  }

  hasCompleteOutput(_output) {
    return false; // Override in subclasses
  }

  sendCommands(_shell, _output) {
    // Override in subclasses
  }

  parseOutput(_output) {
    // Override in subclasses
    return null;
  }

  // Helper to strip ANSI codes and control sequences
  // eslint-disable-next-line no-control-regex
  static ANSI_CURSOR_RIGHT = /\x1B\[(\d+)C/g;
  // eslint-disable-next-line no-control-regex
  static ANSI_ESCAPE_SEQ = /\x1B\[[0-9;?]*[a-zA-Z]/g;
  // eslint-disable-next-line no-control-regex
  static ANSI_OSC_SEQ = /\x1B\][^\x07]*\x07/g;
  // eslint-disable-next-line no-control-regex
  static ANSI_REMAINING = /\x1B[^[\]]*?[a-zA-Z]/g;

  stripAnsi(str) {
    return str
      .replace(BaseAgent.ANSI_CURSOR_RIGHT, (_, n) => ' '.repeat(parseInt(n)))
      .replace(BaseAgent.ANSI_ESCAPE_SEQ, '')
      .replace(BaseAgent.ANSI_OSC_SEQ, '')
      .replace(BaseAgent.ANSI_REMAINING, '')
      .replace(/\r/g, '')
      .replace(/  +/g, ' ');
  }
}

module.exports = { BaseAgent };
