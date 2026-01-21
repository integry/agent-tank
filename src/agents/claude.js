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

    // Parse session usage - format: "Current session" ... "XX% used" ... "Resets <time>"
    const sessionMatch = clean.match(/Current session[\s\S]*?(\d+)\s*%\s*used[\s\S]*?Resets\s+([^\n]+)/i);
    if (sessionMatch) {
      usage.session = {
        percent: parseFloat(sessionMatch[1]),
        label: 'Current session',
        resetsAt: sessionMatch[2].trim(),
      };
    } else {
      // Fallback - just get percent without reset time
      const sessionPercentMatch = clean.match(/Current session[\s\S]*?(\d+)\s*%\s*used/i);
      if (sessionPercentMatch) {
        usage.session = {
          percent: parseFloat(sessionPercentMatch[1]),
          label: 'Current session',
          resetsAt: null,
        };
      }
    }

    // Parse weekly usage (all models) - format includes "Resets <time>" after percentage
    const weeklyAllMatch = clean.match(/Current week \(all models\)[\s\S]*?(\d+)\s*%\s*used[\s\S]*?Resets\s+([^\n]+)/i);
    if (weeklyAllMatch) {
      usage.weeklyAll = {
        percent: parseFloat(weeklyAllMatch[1]),
        label: 'Current week (all models)',
        resetsAt: weeklyAllMatch[2].trim(),
      };
    } else {
      // Fallback - just get percent without reset time
      const weeklyAllPercentMatch = clean.match(/Current week \(all models\)[\s\S]*?(\d+)\s*%\s*used/i);
      if (weeklyAllPercentMatch) {
        usage.weeklyAll = {
          percent: parseFloat(weeklyAllPercentMatch[1]),
          label: 'Current week (all models)',
          resetsAt: null,
        };
      }
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
      const weeklyMatch = clean.match(/Current week[\s\S]*?(\d+)\s*%\s*used[\s\S]*?Resets\s+([^\n]+)/i);
      if (weeklyMatch) {
        usage.weekly = {
          percent: parseFloat(weeklyMatch[1]),
          label: 'Current week',
          resetsAt: weeklyMatch[2].trim(),
        };
      } else {
        const weeklyPercentMatch = clean.match(/Current week[^%]*?(\d+)\s*%\s*used/i);
        if (weeklyPercentMatch) {
          usage.weekly = {
            percent: parseFloat(weeklyPercentMatch[1]),
            label: 'Current week',
            resetsAt: null,
          };
        }
      }
    }

    return usage;
  }
}

module.exports = { ClaudeAgent };
