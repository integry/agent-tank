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
      return;
    }

    this.isRefreshing = true;
    this.error = null;

    try {
      const output = await this.runCommand();
      this.usage = this.parseOutput(output);
      this.lastUpdated = new Date().toISOString();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.isRefreshing = false;
    }
  }

  async runCommand() {
    return new Promise((resolve, reject) => {
      const timeout = this.getTimeout();
      let output = '';
      let completed = false;
      let commandsSent = false;

      const shell = pty.spawn(this.command, this.args, {
        name: 'xterm-color',
        cols: 120,
        rows: 40,
        cwd: '/tmp',
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
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

        // Respond to cursor position query (CSI 6n) - some CLIs require this
        // Query is: ESC[6n, Response should be: ESC[{row};{col}R
        if (data.includes('\x1b[6n') || data.includes('[6n')) {
          shell.write('\x1b[1;1R'); // Report cursor at row 1, col 1
        }

        // Send commands when ready
        if (!commandsSent && this.isReadyForCommands(output)) {
          commandsSent = true;
          this.sendCommands(shell, output);
        }

        // Check if we have enough data to extract usage
        if (commandsSent && this.hasCompleteOutput(output)) {
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

  isReadyForCommands(output) {
    return false; // Override in subclasses
  }

  hasCompleteOutput(output) {
    return false; // Override in subclasses
  }

  sendCommands(shell, output) {
    // Override in subclasses
  }

  parseOutput(output) {
    // Override in subclasses
    return null;
  }

  // Helper to strip ANSI codes
  stripAnsi(str) {
    return str
      .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\x1B\][^\x07]*\x07/g, '')
      .replace(/\r/g, '');
  }
}

module.exports = { BaseAgent };
