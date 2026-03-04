const { BaseAgent } = require('./base.js');

class ClaudeAgent extends BaseAgent {
  constructor() {
    super('claude', 'claude');
    this._statusSent = false;
  }

  getTimeout() {
    return 30000; // 30 seconds - extra time for trust prompt and usage data loading
  }

  // Use dumb terminal to avoid cursor positioning that corrupts text
  getEnv() {
    const env = { ...process.env, TERM: 'dumb', NO_COLOR: '1' };
    // Remove CLAUDECODE to allow spawning inside a Claude Code session
    delete env.CLAUDECODE;
    return env;
  }

  isReadyForCommands(output) {
    const clean = this.stripAnsi(output);
    // Claude shows various prompts when ready
    // Look for the prompt character (❯ or >) or shortcuts hint
    return clean.includes('? for shortcuts') ||
           clean.includes('❯') ||
           clean.includes('> ') ||
           clean.includes('Try "');
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
    const clean = this.stripAnsi(output);

    // Basic requirements - must have actual usage data, not just the loading screen
    const hasSession = clean.includes('Current session');
    const hasWeekly = clean.includes('Current week');
    const hasPercentUsed = clean.includes('% used');

    if (!hasSession || !hasWeekly || !hasPercentUsed) {
      return false;
    }

    // If "all models" section exists, wait for "Sonnet only" section to render
    const hasAllModels = /Current\s+week\s*\(?\s*all\s+models/i.test(clean);
    if (hasAllModels) {
      const hasSonnetOnly = /Current\s+week\s*\(?\s*Sonnet\s+only/i.test(clean);
      if (!hasSonnetOnly) {
        return false;
      }
      // Both sections exist, check we have at least one timezone per section
      const allModelsIdx = clean.search(/Current\s+week\s*\(?\s*all\s+models/i);
      const sonnetOnlyIdx = clean.search(/Current\s+week\s*\(?\s*Sonnet\s+only/i);
      const allModelsSection = clean.substring(allModelsIdx, sonnetOnlyIdx);
      const sonnetSection = clean.substring(sonnetOnlyIdx);

      const allModelsHasTimezone = /\([A-Za-z]+\/[A-Za-z_]+\)/.test(allModelsSection);
      const sonnetHasTimezone = /\([A-Za-z]+\/[A-Za-z_]+\)/.test(sonnetSection);

      return allModelsHasTimezone && sonnetHasTimezone;
    }

    // Fallback for legacy format (single "Current week" without model qualifiers)
    // Check for timezone pattern which indicates reset times are fully loaded
    const hasTimezone = /\([A-Za-z]+\/[A-Za-z_]+\)/.test(clean);
    return hasTimezone;
  }

  // Convert reset timestamp to duration object with string and seconds
  // Formats:
  //   - "2:59am (Europe/London)" - time only (session reset, same day or next day)
  //   - "Jan 22, 1pm (Europe/London)" - date and time (weekly reset)
  // Returns: { text: "5h 30m", seconds: 19800 } or null
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
      if (!dateTimeMatch) return { text: resetStr, seconds: null };

      const [, month, day, hourRaw, minutes = '0', ampm] = dateTimeMatch;
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthIndex = monthNames.indexOf(month.toLowerCase().substring(0, 3));
      if (monthIndex === -1) return { text: resetStr, seconds: null };

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

  sendCommands(shell, _output) {
    console.log(`[${this.name}] Sending /usage command...`);
    // Escape dismisses any previous output/UI, then type command + Enter
    if (this.freshProcess) {
      setTimeout(() => shell.write('\x1b'), 50);
      setTimeout(() => shell.write('/usage'), 150);
      setTimeout(() => shell.write('\r'), 500);
    } else {
      // Persistent mode: tighter timings
      setTimeout(() => shell.write('\x1b'), 50);
      setTimeout(() => shell.write('/usage'), 150);
      setTimeout(() => shell.write('\r'), 400);
    }
  }

  parseOutput(output) {
    const clean = this.stripAnsi(output);
    const usage = {
      session: null,
      weeklyAll: null,
      weeklySonnet: null,
    };

    // Debug: log session section for troubleshooting
    const sessionIdx = clean.indexOf('Current session');
    const weeklyIdx = clean.indexOf('Current week');
    if (sessionIdx !== -1 && weeklyIdx !== -1) {
      const sessionSection = clean.substring(sessionIdx, weeklyIdx);
      console.log(`[${this.name}] Session section preview:`, sessionSection.substring(0, 200));
    }

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

      // Fall back to time-only pattern (session): H:MMam/pm or Ham/pm (timezone)
      // Minutes are optional (shows "11am" for exact hours)
      if (!resetsAt) {
        const timeOnlyMatch = section.match(/(\d{1,2}(?::\d{2})?\s*(am|pm))\s*\(([^)]+)\)/i);
        if (timeOnlyMatch) {
          resetsAt = `${timeOnlyMatch[1]} (${timeOnlyMatch[3]})`;
        }
      }

      if (!percentMatch) return null;
      const resetData = resetsAt ? this.parseResetTime(resetsAt) : null;
      return {
        percent: parseFloat(percentMatch[1]),
        resetsAt,
        resetsIn: resetData?.text || null,
        resetsInSeconds: resetData?.seconds || null,
      };
    };

    // Parse session (between "Current session" and "Current week")
    // Use resilient patterns to handle whitespace/newline variations from PTY redraws
    const sessionSection = extractSection('Current\\s+session', 'Current\\s+week');
    const sessionData = parseSection(sessionSection);
    if (sessionData) {
      usage.session = { label: 'Current session', ...sessionData };
    }

    // Parse weekly (all models) - between "Current week (all models)" and "Current week (Sonnet"
    // Use flexible whitespace matching: Current week (all models) with optional spaces
    const weeklyAllSection = extractSection('Current\\s+week\\s*\\(?\\s*all\\s+models\\s*\\)?', 'Current\\s+week\\s*\\(?\\s*Sonnet');
    const weeklyAllData = parseSection(weeklyAllSection);
    if (weeklyAllData) {
      usage.weeklyAll = { label: 'Current week (all models)', ...weeklyAllData };
    }

    // Parse weekly (Sonnet only) - from "Current week (Sonnet only)" to end or next section
    // Use flexible whitespace matching and lookahead for end markers
    const weeklySonnetSection = extractSection('Current\\s+week\\s*\\(?\\s*Sonnet\\s+only\\s*\\)?', 'esc\\s+to\\s+cancel|Current\\s+week\\s*\\(');
    const weeklySonnetData = parseSection(weeklySonnetSection);
    if (weeklySonnetData) {
      usage.weeklySonnet = { label: 'Current week (Sonnet only)', ...weeklySonnetData };
    }

    // Legacy format fallback
    if (!usage.weeklyAll && !usage.weeklySonnet) {
      // Use lookahead to prevent greedy matching across un-newline-separated PTY redraw streams
      // Match reset time until we hit "esc to cancel", another "current week" section, or end of string
      const weeklyMatch = clean.match(/Current\s+week[\s\S]*?(\d+)\s*%\s*used[\s\S]*?Resets\s+([\s\S]*?)(?=esc\s+to\s+cancel|current\s+week|$)/i);
      if (weeklyMatch) {
        // Extract the reset time - find timezone pattern to get clean reset string
        const resetSection = weeklyMatch[2];
        const timezoneMatch = resetSection.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*\([^)]+\)|\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*\([^)]+\))/i);
        const resetsAt = timezoneMatch ? timezoneMatch[1].trim() : resetSection.trim().split(/\s{2,}/)[0];
        const resetData = this.parseResetTime(resetsAt);
        usage.weekly = {
          percent: parseFloat(weeklyMatch[1]),
          label: 'Current week',
          resetsAt,
          resetsIn: resetData?.text || null,
          resetsInSeconds: resetData?.seconds || null,
        };
      } else {
        const weeklyPercentMatch = clean.match(/Current\s+week[^%]*?(\d+)\s*%\s*used/i);
        if (weeklyPercentMatch) {
          usage.weekly = {
            percent: parseFloat(weeklyPercentMatch[1]),
            label: 'Current week',
            resetsAt: null,
            resetsIn: null,
            resetsInSeconds: null,
          };
        }
      }
    }

    return usage;
  }

  // Fetch metadata by sending /status command once on first refresh
  async fetchMetadata() {
    if (this._statusSent) {
      return this.metadata;
    }

    // Ensure process is spawned and ready
    if (!this.shell || !this.processReady) {
      await this.spawnProcess();
    }

    return new Promise((resolve, reject) => {
      let statusOutput = '';
      let completed = false;

      const finish = (result) => {
        if (completed) return;
        completed = true;
        this._statusSent = true;
        this._onDataCallback = null;
        this._commandInFlight = false;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        console.log(`[${this.name}] /status timeout, using partial output`);
        finish(this._parseStatusOutput(statusOutput));
      }, 10000); // 10 second timeout for /status

      this._commandInFlight = true;
      this._onDataCallback = () => {
        statusOutput = this.output;
        // Check if we have complete /status output
        if (this._hasCompleteStatusOutput(statusOutput)) {
          console.log(`[${this.name}] Complete /status output detected`);
          setTimeout(() => finish(this._parseStatusOutput(statusOutput)), 100);
        }
      };

      console.log(`[${this.name}] Sending /status command for metadata...`);
      this.output = '';
      // Send escape first to dismiss any UI, then /status
      setTimeout(() => this.shell.write('\x1b'), 50);
      setTimeout(() => this.shell.write('/status'), 150);
      setTimeout(() => this.shell.write('\r'), 400);
    });
  }

  _hasCompleteStatusOutput(output) {
    const clean = this.stripAnsi(output);
    // /status output typically contains session info and prompt
    const hasSessionInfo = /session/i.test(clean) || /working directory|cwd/i.test(clean);
    const hasPrompt = clean.includes('? for shortcuts') ||
                      clean.includes('❯') ||
                      clean.includes('> ') ||
                      clean.includes('esc to');
    return hasSessionInfo && hasPrompt;
  }

  _parseStatusOutput(output) {
    const clean = this.stripAnsi(output);
    const metadata = {};

    // Extract session ID
    const sessionMatch = clean.match(/Session(?:\s+ID)?:\s*([a-f0-9-]+)/i);
    if (sessionMatch) {
      metadata.sessionId = this.stripBoxChars(sessionMatch[1]);
    }

    // Extract working directory/cwd
    const cwdMatch = clean.match(/(?:Working directory|Cwd|Current directory|Directory):\s*([^\n│]+)/i);
    if (cwdMatch) {
      metadata.cwd = this.stripBoxChars(cwdMatch[1]);
    }

    // Extract organization
    const orgMatch = clean.match(/(?:Organization|Org):\s*([^\n│]+)/i);
    if (orgMatch) {
      metadata.organization = this.stripBoxChars(orgMatch[1]);
    }

    // Extract email/account
    const emailMatch = clean.match(/(?:Email|Account|User|Logged in as):\s*(\S+@\S+)/i);
    if (emailMatch) {
      metadata.email = this.stripBoxChars(emailMatch[1]);
    }

    // Extract model if present
    const modelMatch = clean.match(/(?:Model|Using model):\s*(claude[-\w.]+)/i);
    if (modelMatch) {
      metadata.model = this.stripBoxChars(modelMatch[1]);
    }

    // Extract version if present
    const versionMatch = clean.match(/(?:Version|Claude Code):\s*v?([\d.]+)/i);
    if (versionMatch) {
      metadata.version = this.stripBoxChars(versionMatch[1]);
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  }
}

module.exports = { ClaudeAgent };
