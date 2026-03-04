const { BaseAgent } = require('./base.js');

class CodexAgent extends BaseAgent {
  constructor() {
    super('codex', 'codex');
  }

  getTimeout() { return 25000; }

  handleTrustPrompt(shell, output) {
    const trustPatterns = ['Do you trust', 'trust the files', 'trust this folder', 'Trust this workspace', 'allow access'];
    if (trustPatterns.some(p => output.toLowerCase().includes(p.toLowerCase()))) {
      console.log(`[${this.name}] Detected trust prompt, auto-accepting...`);
      shell.write('y\r');
      setTimeout(() => { console.log(`[${this.name}] Sending Enter to proceed...`); shell.write('\r'); }, 500);
      return true;
    }
    return false;
  }

  handleUpdateScreen(shell, output) {
    const clean = this.stripAnsi(output);
    if (/u?pdate available/i.test(clean) && /[\d.]+\s*->\s*[\d.]+/.test(clean) && /skip/i.test(clean)) {
      console.log(`[${this.name}] Detected update screen, selecting '2' to skip...`);
      shell.write('2');
      setTimeout(() => shell.write('\r'), 300);
      return true;
    }
    return false;
  }

  parseVersionInfo(output) {
    const clean = this.stripAnsi(output);
    const versionInfo = {};
    const updateMatch = clean.match(/([\d.]+)\s*->\s*([\d.]+)/);
    if (updateMatch) { versionInfo.current = updateMatch[1]; versionInfo.latest = updateMatch[2]; return versionInfo; }
    const currentMatch = clean.match(/OpenAI Codex[^(]*\(v?([\d.]+)\)/i);
    if (currentMatch) versionInfo.current = currentMatch[1];
    const patterns = [/v?([\d.]+)\s*(?:is\s+)?available/i, /new version[:\s]+v?([\d.]+)/i, /update to v?([\d.]+)/i, /latest[:\s]+v?([\d.]+)/i];
    for (const p of patterns) { const m = clean.match(p); if (m && m[1] !== versionInfo.current) { versionInfo.latest = m[1]; break; } }
    return Object.keys(versionInfo).length > 0 ? versionInfo : null;
  }

  isReadyForCommands(output) { return this.isReadyForStatus(output); }
  isReadyForStatus(output) { return output.includes('? for shortcuts') || output.includes('To get started'); }
  sendCommands(shell, _output) { console.log(`[${this.name}] Sending /status command...`); setTimeout(() => shell.write('/status\r'), 100); }

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

    // Extract model and account for backward compatibility (also in metadata)
    const modelMatch = clean.match(/Model:\s*([\w.-]+)/i);
    if (modelMatch) {
      usage.model = this.stripBoxChars(modelMatch[1]);
    }

    const accountMatch = clean.match(/Account:\s*(\S+@\S+)/i);
    if (accountMatch) {
      usage.account = this.stripBoxChars(accountMatch[1]);
    }

    // Update metadata with latest values from status output
    this._updateMetadataFromOutput(clean);

    return usage;
  }

  // Extract metadata from /status output
  _updateMetadataFromOutput(clean) {
    if (!this.metadata) {
      this.metadata = {};
    }

    // Extract directory/cwd
    const dirMatch = clean.match(/(?:Directory|Working directory|Cwd|Current directory):\s*([^\n│]+)/i);
    if (dirMatch) {
      this.metadata.directory = this.stripBoxChars(dirMatch[1]);
    }

    // Extract session ID
    const sessionMatch = clean.match(/Session(?:\s+ID)?:\s*([a-f0-9-]+)/i);
    if (sessionMatch) {
      this.metadata.sessionId = this.stripBoxChars(sessionMatch[1]);
    }

    // Extract collaboration mode (solo/team/etc)
    const collabMatch = clean.match(/(?:Collaboration|Mode):\s*(\w+)/i);
    if (collabMatch) {
      this.metadata.collaborationMode = this.stripBoxChars(collabMatch[1]);
    }

    // Extract model
    const modelMatch = clean.match(/Model:\s*([\w.-]+)/i);
    if (modelMatch) {
      this.metadata.model = this.stripBoxChars(modelMatch[1]);
    }

    // Extract account/email
    const accountMatch = clean.match(/Account:\s*(\S+@\S+)/i);
    if (accountMatch) {
      this.metadata.email = this.stripBoxChars(accountMatch[1]);
    }
  }
}

module.exports = { CodexAgent };
