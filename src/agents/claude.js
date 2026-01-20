const { BaseAgent } = require('./base.js');

class ClaudeAgent extends BaseAgent {
  constructor() {
    super('claude', 'claude');
  }

  getTimeout() {
    return 20000; // 20 seconds - extra time for trust prompt
  }

  isReadyForCommands(output) {
    // Claude shows various prompts when ready
    // Look for the prompt character or shortcuts hint
    return output.includes('? for shortcuts') ||
           output.includes('> ') ||
           output.includes('Try "') ||
           (output.includes('>') && output.includes('───'));
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
    // Look for both session and weekly usage data
    return output.includes('Current session') &&
           output.includes('Current week') &&
           output.includes('% used');
  }

  sendCommands(shell, output) {
    console.log(`[${this.name}] Sending /usage command...`);
    // Send /usage command
    setTimeout(() => {
      shell.write('/usage\r');
    }, 100);

    // Confirm autocomplete selection
    setTimeout(() => {
      shell.write('\r');
    }, 400);
  }

  parseOutput(output) {
    const clean = this.stripAnsi(output);
    const usage = {
      session: null,
      weeklyAll: null,
      weeklySonnet: null,
    };

    // Parse session usage - format: "Current session" ... "XX% used"
    // The percentage appears after the progress bar on next line
    const sessionMatch = clean.match(/Current session[\s\S]*?(\d+)\s*%\s*used/i);
    if (sessionMatch) {
      usage.session = {
        percent: parseFloat(sessionMatch[1]),
        label: 'Current session',
      };
    }

    // Parse weekly usage (all models)
    const weeklyAllMatch = clean.match(/Current week \(all models\)[\s\S]*?(\d+)\s*%\s*used/i);
    if (weeklyAllMatch) {
      usage.weeklyAll = {
        percent: parseFloat(weeklyAllMatch[1]),
        label: 'Current week (all models)',
      };
    }

    // Parse weekly usage (Sonnet only)
    const weeklySonnetMatch = clean.match(/Current week \(Sonnet only\)[\s\S]*?(\d+)\s*%\s*used/i);
    if (weeklySonnetMatch) {
      usage.weeklySonnet = {
        percent: parseFloat(weeklySonnetMatch[1]),
        label: 'Current week (Sonnet only)',
      };
    }

    // Legacy format fallback
    if (!usage.weeklyAll && !usage.weeklySonnet) {
      const weeklyMatch = clean.match(/Current week[^%]*?(\d+)\s*%\s*used/i);
      if (weeklyMatch) {
        usage.weekly = {
          percent: parseFloat(weeklyMatch[1]),
          label: 'Current week',
        };
      }
    }

    // Extract reset times
    const resetMatches = clean.matchAll(/Resets\s+([^\n]+)/gi);
    usage.resets = [];
    for (const match of resetMatches) {
      usage.resets.push(match[1].trim());
    }

    return usage;
  }
}

module.exports = { ClaudeAgent };
