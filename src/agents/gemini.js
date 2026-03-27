const { BaseAgent } = require('./base.js');
const { calculatePace } = require('../pace-evaluator.js');
const { CYCLE_DURATIONS } = require('../usage-formatters.js');
const logger = require('../logger.js');

class GeminiAgent extends BaseAgent {
  constructor() {
    super('gemini', 'gemini');
    this._aboutSent = false;
  }

  getTimeout() {
    return 25000; // 25 seconds
  }

  isReadyForCommands(output) {
    // v0.24: "Type your message" prompt
    // v0.35+: "Ready" in terminal title + visible prompt area (no "Type your message")
    // Also check for terminal title sequence containing "Ready"
    return output.includes('Type your message')
      || output.includes('gemini>')
      || /Ready\s*\(/.test(output);
  }

  handleTrustPrompt(shell, output) {
    // Check for trust prompt with various wordings
    const trustPatterns = [
      'Do you trust',
      'trust the files',
      'trust this folder',
      'Trust this workspace',
      'allow access',
      'grant access',
      'grant full access',
    ];

    if (trustPatterns.some(pattern => output.toLowerCase().includes(pattern.toLowerCase()))) {
      logger.agent(this.name, 'Detected trust prompt, auto-accepting...');
      // v0.35+: numbered menu with "1. Trust folder" pre-selected — Enter accepts it
      shell.write('1\r');

      // v0.35+ does an internal restart after trust — send Escape after a delay
      // to dismiss any transitional UI before the process becomes ready again
      setTimeout(() => {
        logger.agent(this.name, 'Post-trust: sending Escape to clear restart UI...');
        shell.write('\x1b');
      }, 3000);

      return true;
    }
    return false;
  }

  hasCompleteOutput(output) {
    // Gemini shows "Usage limits" after the model usage table (v0.24.x)
    if (output.includes('Usage limits span all sessions')) return true;
    const clean = this.stripAnsi(output);
    const hasModel = /gemini-[\w.-]+/i.test(clean);
    const hasPercent = /\d+(?:\.\d+)?%/i.test(clean);
    // v0.24: "Resets in 3h 26m", v0.35+: "(23h 21m)" after time
    const hasResets = /resets?\s+in/i.test(clean) || /\(\d+[hmd]\s+\d+[hmd]?\)/i.test(clean);
    return hasModel && hasPercent && hasResets;
  }

  // Convert duration string like "3h 26m" or "5d 2h" to seconds
  parseDurationToSeconds(durationStr) {
    if (!durationStr) return null;

    let totalSeconds = 0;

    // Match days
    const daysMatch = durationStr.match(/(\d+)\s*d/i);
    if (daysMatch) {
      totalSeconds += parseInt(daysMatch[1]) * 24 * 60 * 60;
    }

    // Match hours
    const hoursMatch = durationStr.match(/(\d+)\s*h/i);
    if (hoursMatch) {
      totalSeconds += parseInt(hoursMatch[1]) * 60 * 60;
    }

    // Match minutes
    const minsMatch = durationStr.match(/(\d+)\s*m/i);
    if (minsMatch) {
      totalSeconds += parseInt(minsMatch[1]) * 60;
    }

    return totalSeconds > 0 ? totalSeconds : null;
  }

  sendCommands(shell, _output) {
    logger.agent(this.name, 'Sending /stats command...');
    // v0.35+: typing /stats triggers autocomplete dropdown.
    // Escape dismisses autocomplete, then Enter submits the command.
    setTimeout(() => shell.write('\x1b'), 50);
    setTimeout(() => shell.write('/stats'), 500);
    setTimeout(() => shell.write('\x1b'), 1000);
    setTimeout(() => shell.write('\r'), 1500);
  }

  // Calculate pace data for a model entry (Gemini uses 24h sessions)
  _addPaceData(entry, resetsInSeconds) {
    const cycleDuration = CYCLE_DURATIONS.sessionGemini;
    if (!cycleDuration || resetsInSeconds == null) return;
    const paceData = calculatePace({ usagePercent: entry.percentUsed, resetsInSeconds, cycleDurationSeconds: cycleDuration });
    if (paceData) entry.pace = paceData;
  }

  parseOutput(output) {
    const clean = this.stripAnsi(output);
    const usage = {
      models: [],
    };

    // Parse model usage lines
    // Format: "gemini-2.5-flash   -90.2% (Resets in 3h 26m)" or "gemini-2.5-flash   90.2% (Resets in 3h 26m)"
    const lines = clean.split('\n');

    for (const line of lines) {
      // v0.24: "gemini-2.5-flash   90.2% (Resets in 3h 26m)" — percentage is REMAINING
      const matchOld = line.match(/(gemini-[\w.-]+)\s+[-\s]*(\d+(?:\.\d+)?)\s*%\s*\(Resets in\s*([^)]+)\)/i);
      // v0.35+: "gemini-2.5-flash   -   ▬▬▬   6%  10:46 PM (23h 21m)" — percentage is USED
      const matchNew = !matchOld && line.match(/(gemini-[\w.-]+)\s+.*?(\d+(?:\.\d+)?)\s*%.*?\((\d+[hmd]\s*\d*[hmd]?)\)/i);
      const match = matchOld || matchNew;
      if (match) {
        const model = match[1];
        const rawPercent = parseFloat(match[2]);
        const resetsIn = match[3].trim();
        const percentUsed = matchOld ? parseFloat((100 - rawPercent).toFixed(1)) : rawPercent;
        const resetsInSeconds = this.parseDurationToSeconds(resetsIn);

        // Avoid duplicates
        if (!usage.models.find(m => m.model === model)) {
          const usageLeft = matchOld ? rawPercent : parseFloat((100 - rawPercent).toFixed(1));
          const modelEntry = { model, usageLeft, resetsIn, percentUsed, resetsInSeconds };
          this._addPaceData(modelEntry, resetsInSeconds);
          usage.models.push(modelEntry);
        }
      }
    }

    // Detect version update notification in output
    // Gemini CLI shows: "Update available! 0.24.5 → 0.32.1" or similar
    const updateMatch = clean.match(/[Uu]pdate\s+available[^\d]*([\d.]+)\s*(?:→|->|to)\s*([\d.]+)/);
    if (updateMatch) {
      usage.version = { current: updateMatch[1], latest: updateMatch[2] };
    }

    return usage;
  }

  // Fetch metadata by sending /about command once on first refresh
  async fetchMetadata() {
    if (this._aboutSent) {
      return this.metadata;
    }

    // Ensure process is spawned and ready
    if (!this.shell || !this.processReady) {
      await this.spawnProcess();
    }

    return new Promise((resolve, _reject) => {
      let aboutOutput = '';
      let completed = false;

      const finish = (result) => {
        if (completed) return;
        completed = true;
        this._aboutSent = true;
        this._onDataCallback = null;
        this._commandInFlight = false;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        logger.agent(this.name, '/about timeout, using partial output');
        finish(this._parseAboutOutput(aboutOutput));
      }, 10000); // 10 second timeout for /about

      this._commandInFlight = true;
      this._onDataCallback = () => {
        aboutOutput = this.output;
        // Check if we have complete /about output
        if (this._hasCompleteAboutOutput(aboutOutput)) {
          logger.agent(this.name, 'Complete /about output detected');
          setTimeout(() => finish(this._parseAboutOutput(aboutOutput)), 100);
        }
      };

      logger.agent(this.name, 'Sending /about command for metadata...');
      this.output = '';
      // Escape clears pending state, delay for CLI to be fully interactive,
      // second Enter in case /about has an autocomplete menu in newer versions
      setTimeout(() => this.shell.write('\x1b'), 100);
      setTimeout(() => this.shell.write('/about\r'), 2000);
      setTimeout(() => this.shell.write('\r'), 2500);
    });
  }

  _hasCompleteAboutOutput(output) {
    const clean = this.stripAnsi(output);
    // Require actual /about content (not just status bar text)
    const hasAboutContent = /about\s+gemini/i.test(clean) || /CLI\s+Version/i.test(clean);
    // Require prompt to have returned after the about box
    const hasPrompt = clean.includes('Type your message');
    return hasAboutContent && hasPrompt;
  }

  _parseAboutOutput(output) {
    const clean = this.stripAnsi(output);

    // Guard: verify we have actual /about output, not just status bar noise.
    // The status bar contains "no sandbox (see /docs) Auto (Gemini 2.5) /model"
    // which can false-positive match loose regexes.
    const hasAboutContent = /about\s+gemini/i.test(clean) || /CLI\s+Version/i.test(clean);
    if (!hasAboutContent) {
      logger.agent(this.name, '/about output missing expected header, dumping for debug');
      require('fs').writeFileSync(`/tmp/${this.name}-about-output.txt`, output);
      logger.agent(this.name, 'Stripped output preview:', logger.dim(clean.substring(0, 500)));
      return null;
    }

    const metadata = {};

    // Gemini /about uses whitespace-separated key-value pairs (no colons):
    //   CLI Version    0.24.5
    //   OS             linux
    //   Auth Method    OAuth
    //   User Email     livecart@gmail.com
    // After stripAnsi collapses multi-spaces, these become single-space separated.

    // Extract version: "CLI Version 0.24.5"
    const versionMatch = clean.match(/CLI\s+Version[:\s]+v?([\d.]+)/i);
    if (versionMatch) {
      metadata.version = this.stripBoxChars(versionMatch[1]);
    }

    // Extract email: "User Email livecart@gmail.com"
    const emailMatch = clean.match(/User\s+Email[:\s]+(\S+@\S+)/i);
    if (emailMatch) {
      metadata.email = this.stripBoxChars(emailMatch[1]);
    }

    // Extract auth method: "Auth Method OAuth"
    const authMatch = clean.match(/Auth\s*Method[:\s]+(\w+)/i);
    if (authMatch) {
      metadata.authMethod = this.stripBoxChars(authMatch[1]);
    }

    // Extract model: "Model auto-gemini-2.5" (but NOT "/model" from the status bar)
    const modelMatch = clean.match(/(?<!\/)Model[:\s]+([\w.-]+)/i);
    if (modelMatch) {
      metadata.model = this.stripBoxChars(modelMatch[1]);
    }

    // Extract OS: "OS linux"
    const osMatch = clean.match(/\bOS[:\s]+(\w+)/i);
    if (osMatch) {
      metadata.os = this.stripBoxChars(osMatch[1]);
    }

    // Detect version update notification
    const updateMatch = clean.match(/[Uu]pdate\s+available[^\d]*([\d.]+)\s*(?:→|->|to)\s*([\d.]+)/);
    if (updateMatch) {
      metadata.updateAvailable = { current: updateMatch[1], latest: updateMatch[2] };
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  /**
   * Lightweight keepalive to prevent session expiration.
   * Sends escape key to maintain the PTY session without triggering API calls.
   *
   * @returns {Promise<boolean>} True if keepalive succeeded
   */
  async keepalive() {
    if (this.freshProcess) {
      console.log(`[${this.name}] Keepalive skipped (fresh process mode)`);
      return true;
    }

    if (!this.shell || !this.processReady) {
      console.log(`[${this.name}] Keepalive: spawning process...`);
      await this.spawnProcess();
    }

    if (this.shell) {
      console.log(`[${this.name}] Keepalive: sending ping...`);
      // Send escape key to dismiss any UI and trigger activity
      this.shell.write('\x1b');
      return true;
    }

    return false;
  }
}

module.exports = { GeminiAgent };
