const { BaseAgent } = require('./base.js');

class CodexAgent extends BaseAgent {
  constructor() {
    super('codex', 'codex');
  }

  getTimeout() {
    return 25000; // 25 seconds
  }

  handleTrustPrompt(shell, output) {
    // Check for trust prompt with various wordings
    const trustPatterns = [
      'Do you trust',
      'trust the files',
      'trust this folder',
      'Trust this workspace',
      'allow access'
    ];

    if (trustPatterns.some(pattern => output.toLowerCase().includes(pattern.toLowerCase()))) {
      console.log(`[${this.name}] Detected trust prompt, auto-accepting...`);
      shell.write('y\r');

      // Wait a bit then send Enter to proceed past the trust confirmation
      setTimeout(() => {
        console.log(`[${this.name}] Sending Enter to proceed...`);
        shell.write('\r');
      }, 500);

      return true;
    }
    return false;
  }

  // Override to handle Codex's specific prompt flow
  async runCommand() {
    const pty = require('node-pty');

    return new Promise((resolve, reject) => {
      let output = '';
      let completed = false;
      let statusSent = false;
      let trustHandled = false;
      let continuationHandled = false;

      console.log(`[${this.name}] Spawning: ${this.command} ${this.args.join(' ')}`);

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
          console.log(`[${this.name}] Timeout after ${this.getTimeout()}ms, output length: ${output.length}`);
          if (output.length > 0) {
            console.log(`[${this.name}] Partial output:`, this.stripAnsi(output).substring(0, 500));
            // Write full output for debugging
            require('fs').writeFileSync(`/tmp/${this.name}-output.txt`, output);
            console.log(`[${this.name}] Full output written to /tmp/${this.name}-output.txt`);
          }
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

        // Log first data received
        if (output.length <= data.length) {
          console.log(`[${this.name}] First data received (${data.length} chars)`);
          if (data.length < 200) {
            console.log(`[${this.name}] Initial output:`, this.stripAnsi(data).substring(0, 100));
          }
        }

        // Handle trust prompt if needed (only once)
        if (!trustHandled && this.handleTrustPrompt(shell, output)) {
          trustHandled = true;
          return;
        }

        // Respond to cursor position query (CSI 6n)
        if (data.includes('\x1b[6n') || data.includes('[6n')) {
          console.log(`[${this.name}] Responding to cursor position query`);
          shell.write('\x1b[1;1R');
        }

        // Handle approval prompt for non-git directories (only once)
        if (!continuationHandled && output.includes('Press enter to continue')) {
          console.log(`[${this.name}] Detected continuation prompt`);
          continuationHandled = true;
          shell.write('\r');
        }

        // Send /status when fully ready (model loaded and prompt shown)
        if (!statusSent && (output.includes('gpt-') || output.includes('OpenAI Codex')) &&
            (output.includes('? for shortcuts') || output.includes('To get started'))) {
          console.log(`[${this.name}] Ready for commands, sending /status...`);
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
          console.log(`[${this.name}] Complete output detected, finishing...`);
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

  hasCompleteOutput(output) {
    return output.includes('5h limit') && output.includes('Weekly limit');
  }

  // Convert reset timestamp to duration string (e.g., "5h 30m")
  parseResetTime(resetStr) {
    const now = new Date();
    let resetDate;

    // Format: "HH:MM" (today) or "HH:MM on DD Mon"
    const timeOnDateMatch = resetStr.match(/(\d{1,2}):(\d{2})\s*on\s*(\d{1,2})\s*(\w+)/i);
    const timeOnlyMatch = resetStr.match(/^(\d{1,2}):(\d{2})$/);

    if (timeOnDateMatch) {
      const [, hours, minutes, day, month] = timeOnDateMatch;
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthIndex = monthNames.indexOf(month.toLowerCase().substring(0, 3));
      resetDate = new Date(now.getFullYear(), monthIndex, parseInt(day), parseInt(hours), parseInt(minutes));
      // If the date is in the past, it's next year
      if (resetDate < now) {
        resetDate.setFullYear(resetDate.getFullYear() + 1);
      }
    } else if (timeOnlyMatch) {
      const [, hours, minutes] = timeOnlyMatch;
      resetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(hours), parseInt(minutes));
      // If time is in the past, it's tomorrow
      if (resetDate < now) {
        resetDate.setDate(resetDate.getDate() + 1);
      }
    } else {
      return resetStr; // Return original if can't parse
    }

    const diffMs = resetDate - now;
    if (diffMs <= 0) return 'soon';

    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    } else if (hours > 0) {
      return `${hours}h ${mins}m`;
    } else {
      return `${mins}m`;
    }
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
      const percentLeft = parseFloat(fiveHourMatch[1]);
      const resetsAt = fiveHourMatch[2].trim();
      usage.fiveHour = {
        percentLeft,
        resetsAt,
        label: '5h limit',
        // Normalized fields for consistent display
        percentUsed: 100 - percentLeft,
        resetsIn: this.parseResetTime(resetsAt),
      };
    }

    // Parse Weekly limit: "Weekly limit:   [░░...] XX% left (resets HH:MM)"
    const weeklyMatch = clean.match(/Weekly limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i);
    if (weeklyMatch) {
      const percentLeft = parseFloat(weeklyMatch[1]);
      const resetsAt = weeklyMatch[2].trim();
      usage.weekly = {
        percentLeft,
        resetsAt,
        label: 'Weekly limit',
        // Normalized fields for consistent display
        percentUsed: 100 - percentLeft,
        resetsIn: this.parseResetTime(resetsAt),
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
