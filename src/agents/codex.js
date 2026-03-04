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

  // Detect update notification screen and select Skip option
  handleUpdateScreen(shell, output) {
    const clean = this.stripAnsi(output);

    // Detect Codex update screen format:
    // "Update available! X.X.X -> Y.Y.Y"
    // "› 1. Update now"
    // "  2. Skip"
    // "  3. Skip until next version"
    // Note: First char may be cut off ("pdate available" instead of "Update available")
    // Note: Text may be concatenated without proper spacing after ANSI stripping
    const hasUpdateAvailable = /u?pdate available/i.test(clean);
    const hasVersionArrow = /[\d.]+\s*->\s*[\d.]+/.test(clean);
    // Also check for "Skip" with various patterns - may appear as "2.Skip" or just "Skip"
    const hasSkipOption = /skip/i.test(clean);

    if (hasUpdateAvailable && hasVersionArrow && hasSkipOption) {
      console.log(`[${this.name}] Detected update screen, selecting '2' to skip...`);
      // Send '2' to select Skip option, then Enter to confirm
      shell.write('2');
      setTimeout(() => shell.write('\r'), 300);
      return true;
    }

    return false;
  }

  // Parse version info from output (update screen or regular output)
  parseVersionInfo(output) {
    const clean = this.stripAnsi(output);
    const versionInfo = {};

    // First check for update screen format: "0.87.0 -> 0.89.0"
    const updateScreenMatch = clean.match(/([\d.]+)\s*->\s*([\d.]+)/);
    if (updateScreenMatch) {
      versionInfo.current = updateScreenMatch[1];
      versionInfo.latest = updateScreenMatch[2];
      return versionInfo;
    }

    // Extract current version from header: "OpenAI Codex (v0.87.0)"
    const currentMatch = clean.match(/OpenAI Codex[^(]*\(v?([\d.]+)\)/i);
    if (currentMatch) {
      versionInfo.current = currentMatch[1];
    }

    // Extract new version from update notification
    // Patterns like: "v0.88.0 available", "new version: 0.88.0", "update to 0.88.0"
    const newVersionPatterns = [
      /v?([\d.]+)\s*(?:is\s+)?available/i,
      /new version[:\s]+v?([\d.]+)/i,
      /update to v?([\d.]+)/i,
      /latest[:\s]+v?([\d.]+)/i
    ];

    for (const pattern of newVersionPatterns) {
      const match = clean.match(pattern);
      if (match && match[1] !== versionInfo.current) {
        versionInfo.latest = match[1];
        break;
      }
    }

    return Object.keys(versionInfo).length > 0 ? versionInfo : null;
  }

  isReadyForStatus(output) {
    return output.includes('? for shortcuts') || output.includes('To get started');
  }

  handleInteractivePrompts(shell, data, output, state) {
    if (!state.trustHandled && this.handleTrustPrompt(shell, output)) {
      state.trustHandled = true;
      return true;
    }

    if (!state.updateHandled && this.handleUpdateScreen(shell, output)) {
      state.updateHandled = true;
      return true;
    }

    // Respond to terminal capability queries to avoid ~2s timeouts each
    if (data.includes('\x1b[6n')) shell.write('\x1b[1;1R');        // cursor position
    if (data.includes('\x1b[c')) shell.write('\x1b[?62;22c');      // device attributes
    if (data.includes('\x1b[?u')) shell.write('\x1b[?0u');         // kitty keyboard
    if (data.includes('\x1b]10;?')) shell.write('\x1b]10;rgb:ffff/ffff/ffff\x1b\\'); // fg color
    if (data.includes('\x1b]11;?')) shell.write('\x1b]11;rgb:0000/0000/0000\x1b\\'); // bg color

    const cleanOutput = this.stripAnsi(output);
    const isUpdateScreen = /u?pdate available/i.test(cleanOutput) && /[\d.]+\s*->\s*[\d.]+/.test(cleanOutput);
    if (!state.continuationHandled && !isUpdateScreen && output.includes('Press enter to continue')) {
      console.log(`[${this.name}] Detected continuation prompt`);
      state.continuationHandled = true;
      shell.write('\r');
    }

    return false;
  }

  async runCommand() {
    const pty = require('node-pty');

    return new Promise((resolve, reject) => {
      let output = '';
      let completed = false;
      let statusSent = false;
      let retryTimer = null;
      const state = { trustHandled: false, continuationHandled: false, updateHandled: false };

      console.log(`[${this.name}] Spawning: ${this.command} ${this.args.join(' ')}`);

      const shell = pty.spawn(this.command, this.args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: '/tmp',
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      const cleanup = () => {
        clearTimeout(timer);
        if (retryTimer) clearInterval(retryTimer);
      };

      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          cleanup();
          console.log(`[${this.name}] Timeout after ${this.getTimeout()}ms, output length: ${output.length}`);
          if (output.length > 0) {
            console.log(`[${this.name}] Partial output:`, this.stripAnsi(output).substring(0, 500));
            require('fs').writeFileSync(`/tmp/${this.name}-output.txt`, output);
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

        if (this.handleInteractivePrompts(shell, data, output, state)) return;

        // Send /status when ready
        if (!statusSent && this.isReadyForStatus(output)) {
          console.log(`[${this.name}] Ready for commands, sending /status...`);
          statusSent = true;
          setTimeout(() => shell.write('/status'), 50);
          setTimeout(() => shell.write('\r'), 150);
        }

        // Retry /status every second if limits data wasn't available yet
        if (statusSent && !retryTimer && output.includes('data not available yet')) {
          console.log(`[${this.name}] Limits not available yet, retrying...`);
          retryTimer = setInterval(() => {
            if (completed) { clearInterval(retryTimer); return; }
            console.log(`[${this.name}] Retrying /status...`);
            shell.write('/status\r');
          }, 500);
        }

        if (statusSent && this.hasCompleteOutput(output)) {
          console.log(`[${this.name}] Complete output detected, finishing...`);
          if (!completed) {
            completed = true;
            cleanup();
            shell.kill();
            resolve(output);
          }
        }
      });

      shell.onExit(({ exitCode }) => {
        if (!completed) {
          completed = true;
          cleanup();
          console.log(`[${this.name}] Process exited with code ${exitCode}, output length: ${output.length}`);
          require('fs').writeFileSync(`/tmp/${this.name}-output.txt`, output);
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

  parseResetTime(resetStr) {
    if (!resetStr) return null;

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
      return { text: resetStr, seconds: null }; // Return original if can't parse
    }

    const diffMs = resetDate - now;
    if (diffMs <= 0) return { text: 'soon', seconds: 0 };

    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSeconds / 60);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;

    let text;
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      text = `${days}d ${remainingHours}h`;
    } else if (hours > 0) {
      text = `${hours}h ${mins}m`;
    } else {
      text = `${mins}m`;
    }

    return { text, seconds: diffSeconds };
  }

  parseLimitEntry(match, label) {
    const percentLeft = parseFloat(match[1]);
    const resetsAt = match[2].trim();
    const resetData = this.parseResetTime(resetsAt);
    return {
      percentLeft,
      resetsAt,
      label,
      percentUsed: 100 - percentLeft,
      resetsIn: resetData?.text || null,
      resetsInSeconds: resetData?.seconds || null,
    };
  }

  parseOutput(output) {
    const clean = this.stripAnsi(output);
    const usage = {
      fiveHour: null,
      weekly: null,
      version: this.parseVersionInfo(output),
    };

    const fiveHourMatch = clean.match(/5h limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i);
    if (fiveHourMatch) {
      usage.fiveHour = this.parseLimitEntry(fiveHourMatch, '5h limit');
    }

    const weeklyMatch = clean.match(/Weekly limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i);
    if (weeklyMatch) {
      usage.weekly = this.parseLimitEntry(weeklyMatch, 'Weekly limit');
    }

    // Parse model-specific limit sections (e.g. "GPT-5.3-Codex-Spark limit:")
    const modelHeaderRegex = /([\w][\w.-]+)\s+limit:\s*[│╮╯]?/gi;
    const limitRegex = /5h limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i;
    const weeklyLimitRegex = /Weekly limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i;

    const modelLimits = [];
    let headerMatch;
    while ((headerMatch = modelHeaderRegex.exec(clean)) !== null) {
      const name = headerMatch[1];
      if (/^(5h|Weekly)$/i.test(name)) continue;

      const sectionStart = headerMatch.index + headerMatch[0].length;
      const remaining = clean.substring(sectionStart);
      const nextHeader = remaining.search(/[\w][\w.-]*-[\w.-]+\s+limit:/i);
      const endBox = remaining.indexOf('╰');
      let sectionEnd = remaining.length;
      if (nextHeader > 0 && (endBox < 0 || nextHeader < endBox)) sectionEnd = nextHeader;
      else if (endBox > 0) sectionEnd = endBox;
      const content = remaining.substring(0, sectionEnd);

      const entry = { name };
      const fh = content.match(limitRegex);
      if (fh) {
        entry.fiveHour = this.parseLimitEntry(fh, '5h limit');
      }
      const wk = content.match(weeklyLimitRegex);
      if (wk) {
        entry.weekly = this.parseLimitEntry(wk, 'Weekly limit');
      }
      if (entry.fiveHour || entry.weekly) {
        modelLimits.push(entry);
      }
    }
    if (modelLimits.length > 0) {
      usage.modelLimits = modelLimits;
    }

    const modelMatch = clean.match(/Model:\s*(gpt-[\w.-]+)/i);
    if (modelMatch) {
      usage.model = modelMatch[1].trim();
    }

    const accountMatch = clean.match(/Account:\s*(\S+@\S+)/i);
    if (accountMatch) {
      usage.account = accountMatch[1].trim();
    }

    return usage;
  }
}

module.exports = { CodexAgent };
