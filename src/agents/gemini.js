const { BaseAgent } = require('./base.js');

class GeminiAgent extends BaseAgent {
  constructor() {
    super('gemini', 'gemini');
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
    // Send /stats command
    setTimeout(() => {
      shell.write('/stats\r');
    }, 100);

    // Handle autocomplete menu - select default (session stats)
    setTimeout(() => {
      shell.write('\r');
    }, 300);
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
}

module.exports = { GeminiAgent };
