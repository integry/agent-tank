const { BaseAgent } = require('./base.js');

class CodexAgent extends BaseAgent {
  constructor() {
    super('codex', 'codex');
  }

  getTimeout() {
    return 25000; // 25 seconds
  }

  // Override to handle Codex's specific prompt flow
  async runCommand() {
    const pty = require('node-pty');

    return new Promise((resolve, reject) => {
      let output = '';
      let completed = false;
      let statusSent = false;

      const shell = pty.spawn(this.command, this.args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: '/tmp',
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          shell.kill();
          if (output.length > 100) {
            resolve(output);
          } else {
            reject(new Error('Timeout waiting for usage data'));
          }
        }
      }, this.getTimeout());

      shell.onData((data) => {
        output += data;

        // Respond to cursor position query (CSI 6n)
        if (data.includes('\x1b[6n') || data.includes('[6n')) {
          shell.write('\x1b[1;1R');
        }

        // Handle approval prompt for non-git directories
        if (output.includes('Press enter to continue')) {
          shell.write('\r');
        }

        // Send /status when fully ready (model loaded and prompt shown)
        if (!statusSent && output.includes('gpt-') && output.includes('? for shortcuts')) {
          statusSent = true;
          // Type /status then press Enter separately
          setTimeout(() => {
            shell.write('/status');
          }, 1000);
          setTimeout(() => {
            shell.write('\r');
          }, 1500);
        }

        // Check for complete output
        if (statusSent && this.hasCompleteOutput(output)) {
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

      shell.onExit(() => {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          if (output) {
            resolve(output);
          } else {
            reject(new Error('Process exited without output'));
          }
        }
      });
    });
  }

  hasCompleteOutput(output) {
    return output.includes('5h limit') && output.includes('Weekly limit');
  }

  parseOutput(output) {
    const clean = this.stripAnsi(output);
    const usage = {
      fiveHour: null,
      weekly: null,
    };

    // Parse 5h limit: "5h limit:   [████...] XX% left (resets HH:MM)"
    const fiveHourMatch = clean.match(/5h limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i);
    if (fiveHourMatch) {
      usage.fiveHour = {
        percentLeft: parseFloat(fiveHourMatch[1]),
        resetsAt: fiveHourMatch[2].trim(),
        label: '5h limit',
      };
    }

    // Parse Weekly limit: "Weekly limit:   [░░...] XX% left (resets HH:MM)"
    const weeklyMatch = clean.match(/Weekly limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i);
    if (weeklyMatch) {
      usage.weekly = {
        percentLeft: parseFloat(weeklyMatch[1]),
        resetsAt: weeklyMatch[2].trim(),
        label: 'Weekly limit',
      };
    }

    // Extract model info
    const modelMatch = clean.match(/Model:\s*(gpt-[\w.-]+)/i);
    if (modelMatch) {
      usage.model = modelMatch[1].trim();
    }

    // Extract account info
    const accountMatch = clean.match(/Account:\s*(\S+@\S+)/i);
    if (accountMatch) {
      usage.account = accountMatch[1].trim();
    }

    return usage;
  }
}

module.exports = { CodexAgent };
