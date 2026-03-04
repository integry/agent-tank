const { BaseAgent } = require('./base.js');

class GeminiAgent extends BaseAgent {
  constructor() {
    super('gemini', 'gemini');
    this._aboutSent = false;
  }

  getTimeout() {
    return 25000; // 25 seconds
  }

  isReadyForCommands(output) {
    // Gemini shows "Type your message" when ready
    // Also check for the prompt character
    return output.includes('Type your message') || output.includes('gemini>') || output.includes('> ');
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

  hasCompleteOutput(output) {
    // Gemini shows "Usage limits" after the model usage table
    return output.includes('Usage limits span all sessions');
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
    console.log(`[${this.name}] Sending /stats command...`);
    if (this.freshProcess) {
      // Fresh mode: longer delays for autocomplete menu
      setTimeout(() => shell.write('/stats\r'), 100);
      setTimeout(() => shell.write('\r'), 300);
    } else {
      // Persistent mode: tighter delays
      setTimeout(() => shell.write('/stats\r'), 50);
      setTimeout(() => shell.write('\r'), 150);
    }
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
      // Match model name followed by percentage and reset time
      const match = line.match(/(gemini-[\w.-]+)\s+[-\s]*(\d+(?:\.\d+)?)\s*%\s*\(Resets in\s*([^)]+)\)/i);
      if (match) {
        const model = match[1];
        const usageLeft = parseFloat(match[2]);
        const resetsIn = match[3].trim();

        // Avoid duplicates
        if (!usage.models.find(m => m.model === model)) {
          usage.models.push({
            model,
            usageLeft,
            resetsIn,
            // Normalized fields for consistent display
            percentUsed: parseFloat((100 - usageLeft).toFixed(1)),
            resetsInSeconds: this.parseDurationToSeconds(resetsIn),
          });
        }
      }
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

    return new Promise((resolve, reject) => {
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
        console.log(`[${this.name}] /about timeout, using partial output`);
        finish(this._parseAboutOutput(aboutOutput));
      }, 10000); // 10 second timeout for /about

      this._commandInFlight = true;
      this._onDataCallback = () => {
        aboutOutput = this.output;
        // Check if we have complete /about output
        if (this._hasCompleteAboutOutput(aboutOutput)) {
          console.log(`[${this.name}] Complete /about output detected`);
          setTimeout(() => finish(this._parseAboutOutput(aboutOutput)), 100);
        }
      };

      console.log(`[${this.name}] Sending /about command for metadata...`);
      this.output = '';
      setTimeout(() => this.shell.write('/about\r'), 50);
      setTimeout(() => this.shell.write('\r'), 150);
    });
  }

  _hasCompleteAboutOutput(output) {
    const clean = this.stripAnsi(output);
    // /about output typically contains version and auth info
    // Look for typical end patterns like prompt return or footer
    const hasVersion = /version/i.test(clean) || /gemini\s+cli/i.test(clean);
    const hasAuth = /auth|logged|account|email/i.test(clean);
    const hasPrompt = clean.includes('gemini>') || clean.includes('> ') || clean.includes('Type your message');
    return (hasVersion || hasAuth) && hasPrompt;
  }

  _parseAboutOutput(output) {
    const clean = this.stripAnsi(output);
    const metadata = {};

    // Extract OS/platform
    const osMatch = clean.match(/(?:OS|Platform|System):\s*([^\n│]+)/i);
    if (osMatch) {
      metadata.os = this.stripBoxChars(osMatch[1]);
    }

    // Extract version
    const versionMatch = clean.match(/(?:Version|Gemini CLI):\s*v?([\d.]+)/i);
    if (versionMatch) {
      metadata.version = this.stripBoxChars(versionMatch[1]);
    }

    // Also try pattern like "gemini-cli/1.2.3" or "Gemini CLI v1.2.3"
    if (!metadata.version) {
      const altVersionMatch = clean.match(/gemini[-\s]?cli[/\s]+v?([\d.]+)/i);
      if (altVersionMatch) {
        metadata.version = this.stripBoxChars(altVersionMatch[1]);
      }
    }

    // Extract email/account
    const emailMatch = clean.match(/(?:Email|Account|User|Logged in as):\s*(\S+@\S+)/i);
    if (emailMatch) {
      metadata.email = this.stripBoxChars(emailMatch[1]);
    }

    // Extract auth method
    const authMatch = clean.match(/(?:Auth(?:entication)?(?:\s+method)?|Login(?:\s+method)?|Signed in (?:with|via)):\s*([^\n│]+)/i);
    if (authMatch) {
      metadata.authMethod = this.stripBoxChars(authMatch[1]);
    }

    // Alternative auth pattern: "Authenticated via OAuth"
    if (!metadata.authMethod) {
      const altAuthMatch = clean.match(/Authenticated\s+(?:via|using|with)\s+(\w+)/i);
      if (altAuthMatch) {
        metadata.authMethod = this.stripBoxChars(altAuthMatch[1]);
      }
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  }
}

module.exports = { GeminiAgent };
