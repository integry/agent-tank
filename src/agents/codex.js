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

  handleUpdateScreen(shell, output) {
    const clean = this.stripAnsi(output);
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

  isReadyForCommands(output) {
    return this.isReadyForStatus(output);
  }

  isReadyForStatus(output) {
    return output.includes('? for shortcuts') || output.includes('To get started');
  }

  sendCommands(shell, _output) {
    console.log(`[${this.name}] Sending /status command...`);
    setTimeout(() => shell.write('/status\r'), 100);
  }

  _handleAdditionalPrompts(shell, _data, output) {
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

      // Start retry timer immediately — on first run the model may still
      // be loading so /status won't return limits yet
      retryTimer = setInterval(() => {
        if (!this.hasCompleteOutput(this.output)) {
          console.log(`[${this.name}] Retrying /status...`);
          this.output = '';
          this.shell.write('/status\r');
        }
      }, 500);

      this._onDataCallback = () => {
        if (this.hasCompleteOutput(this.output)) {
          // Delay to let additional model sections render
          if (!settleTimer) {
            console.log(`[${this.name}] Complete output detected, waiting to settle...`);
            settleTimer = setTimeout(() => finish(this.output), 200);
          }
        }
      };

      console.log(`[${this.name}] Sending /status to persistent process...`);
      setTimeout(() => this.shell.write('/status\r'), 100);
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
