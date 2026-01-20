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
    return output.includes('Type your message');
  }

  hasCompleteOutput(output) {
    // Gemini shows "Usage limits" after the model usage table
    return output.includes('Usage limits span all sessions');
  }

  sendCommands(shell, output) {
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
          usage.models.push({ model, usageLeft, resetsIn });
        }
      }
    }

    return usage;
  }
}

module.exports = { GeminiAgent };
