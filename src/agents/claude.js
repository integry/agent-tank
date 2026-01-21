const { BaseAgent } = require('./base.js');

class ClaudeAgent extends BaseAgent {
  constructor() {
    super('claude', 'claude');
  }

  getTimeout() {
    return 20000; // 20 seconds - extra time for trust prompt
  }

  // Use dumb terminal to avoid cursor positioning that corrupts text
  getEnv() {
    return { ...process.env, TERM: 'dumb', NO_COLOR: '1' };
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

  // Convert reset timestamp to duration string (e.g., "5h 30m")
  // Formats:
  //   - "2:59am (Europe/London)" - time only (session reset, same day or next day)
  //   - "Jan 22, 1pm (Europe/London)" - date and time (weekly reset)
  parseResetTime(resetStr) {
    if (!resetStr) return null;

    const now = new Date();

    // Extract timezone if present (we'll ignore it and use local time for simplicity)
    const cleanStr = resetStr.replace(/\s*\([^)]+\)\s*$/, '').trim();

    let resetDate;

    // Try time-only format first: "2:59am" or "12:30pm" (session resets)
    const timeOnlyMatch = cleanStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (timeOnlyMatch) {
      const [, hourRaw, minutes = '0', ampm] = timeOnlyMatch;
      let hour = parseInt(hourRaw);
      if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
      if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;

      resetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, parseInt(minutes));
      // If time is in the past, it's tomorrow
      if (resetDate <= now) {
        resetDate.setDate(resetDate.getDate() + 1);
      }
    } else {
      // Try date + time format: "Jan 22, 1pm" or "Jan 22, 12:30pm"
      const dateTimeMatch = cleanStr.match(/(\w+)\s+(\d{1,2}),?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
      if (!dateTimeMatch) return resetStr;

      const [, month, day, hourRaw, minutes = '0', ampm] = dateTimeMatch;
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthIndex = monthNames.indexOf(month.toLowerCase().substring(0, 3));
      if (monthIndex === -1) return resetStr;

      let hour = parseInt(hourRaw);
      if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
      if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;

      resetDate = new Date(now.getFullYear(), monthIndex, parseInt(day), hour, parseInt(minutes));
      // If the date is in the past, it's next year
      if (resetDate < now) {
        resetDate.setFullYear(resetDate.getFullYear() + 1);
      }
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

  sendCommands(shell, output) {
    console.log(`[${this.name}] Sending /usage command...`);
    // Clear any partial input first with Escape
    setTimeout(() => {
      shell.write('\x1b');
    }, 100);
    // Type the full /usage command
    setTimeout(() => {
      shell.write('/usage');
    }, 300);
    // Wait for autocomplete, then press Enter
    setTimeout(() => {
      shell.write('\r');
    }, 800);
  }

  parseOutput(output) {
    const clean = this.stripAnsi(output);
    const usage = {
      session: null,
      weeklyAll: null,
      weeklySonnet: null,
    };

    // Helper to extract section between two headers
    const extractSection = (start, end) => {
      const regex = end
        ? new RegExp(`${start}([\\s\\S]*?)(?=${end}|$)`, 'i')
        : new RegExp(`${start}([\\s\\S]*)$`, 'i');
      const match = clean.match(regex);
      return match ? match[1] : null;
    };

    // Helper to parse a section for percent and reset time
    const parseSection = (section) => {
      if (!section) return null;
      const percentMatch = section.match(/(\d+)\s*%\s*used/i);

      // ANSI stripping corrupts text, so look for time patterns directly
      // Date+time: "Jan 22, 1pm (Europe/London)" - for weekly resets
      // Time-only: "2:59am (Europe/London)" - for session resets
      let resetsAt = null;

      // Look for date+time pattern FIRST (more specific): Mon DD, H:MMam/pm or Mon DD, Ham/pm (timezone)
      const dateTimeMatch = section.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{1,2}(?::\d{2})?\s*(am|pm))\s*\(([^)]+)\)/i);
      if (dateTimeMatch) {
        resetsAt = `${dateTimeMatch[1]} (${dateTimeMatch[3]})`;
      }

      // Fall back to time-only pattern (session): H:MMam/pm (timezone)
      if (!resetsAt) {
        const timeOnlyMatch = section.match(/(\d{1,2}:\d{2}\s*(am|pm))\s*\(([^)]+)\)/i);
        if (timeOnlyMatch) {
          resetsAt = `${timeOnlyMatch[1]} (${timeOnlyMatch[3]})`;
        }
      }

      if (!percentMatch) return null;
      return {
        percent: parseFloat(percentMatch[1]),
        resetsAt,
        resetsIn: resetsAt ? this.parseResetTime(resetsAt) : null,
      };
    };

    // Parse session (between "Current session" and "Current week")
    const sessionSection = extractSection('Current session', 'Current week');
    const sessionData = parseSection(sessionSection);
    if (sessionData) {
      usage.session = { label: 'Current session', ...sessionData };
    }

    // Parse weekly (all models) - between "Current week (all models)" and "Current week (Sonnet"
    const weeklyAllSection = extractSection('Current week \\(all models\\)', 'Current week \\(Sonnet');
    const weeklyAllData = parseSection(weeklyAllSection);
    if (weeklyAllData) {
      usage.weeklyAll = { label: 'Current week (all models)', ...weeklyAllData };
    }

    // Parse weekly (Sonnet only) - from "Current week (Sonnet only)" to end or next section
    const weeklySonnetSection = extractSection('Current week \\(Sonnet only\\)', 'esc to cancel|Current week \\(');
    const weeklySonnetData = parseSection(weeklySonnetSection);
    if (weeklySonnetData) {
      usage.weeklySonnet = { label: 'Current week (Sonnet only)', ...weeklySonnetData };
    }

    // Legacy format fallback
    if (!usage.weeklyAll && !usage.weeklySonnet) {
      const weeklyMatch = clean.match(/Current week[\s\S]*?(\d+)\s*%\s*used[\s\S]*?Resets\s+([^\n]+)/i);
      if (weeklyMatch) {
        const resetsAt = weeklyMatch[2].trim();
        usage.weekly = {
          percent: parseFloat(weeklyMatch[1]),
          label: 'Current week',
          resetsAt,
          resetsIn: this.parseResetTime(resetsAt),
        };
      } else {
        const weeklyPercentMatch = clean.match(/Current week[^%]*?(\d+)\s*%\s*used/i);
        if (weeklyPercentMatch) {
          usage.weekly = {
            percent: parseFloat(weeklyPercentMatch[1]),
            label: 'Current week',
            resetsAt: null,
            resetsIn: null,
          };
        }
      }
    }

    return usage;
  }
}

module.exports = { ClaudeAgent };
