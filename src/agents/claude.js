const { BaseAgent } = require('./base.js');
const { calculatePace } = require('../pace-evaluator.js');
const { CYCLE_DURATIONS } = require('../usage-formatters.js');
const { pingKeepalive } = require('./keepalive-helper.js');

class ClaudeAgent extends BaseAgent {
  constructor() {
    super('claude', 'claude');
    this._statusSent = false;
    // Claude's /usage API is rate limited — minimum 5 minutes between refreshes
    this.minRefreshInterval = 300;
  }

  getTimeout() { return 30000; }
  getEnv() {
    const env = { ...process.env, TERM: 'dumb', NO_COLOR: '1' };
    delete env.CLAUDECODE; // Allow spawning inside a Claude Code session
    return env;
  }

  isReadyForCommands(output) {
    const clean = this.stripAnsi(output);
    return clean.includes('? for shortcuts') || clean.includes('❯') ||
           clean.includes('> ') || clean.includes('Try "');
  }

  handleTrustPrompt(shell, output) {
    const patterns = ['Do you trust', 'trust the files', 'trust this folder', 'Trust this workspace', 'allow access'];
    if (!patterns.some(p => output.toLowerCase().includes(p.toLowerCase()))) return false;
    console.log(`[${this.name}] Detected trust prompt, auto-accepting...`);
    shell.write('y\r');
    setTimeout(() => { console.log(`[${this.name}] Sending Enter to proceed...`); shell.write('\r'); }, 500);
    return true;
  }

  hasCompleteOutput(output) {
    const clean = this.stripAnsi(output);
    // Detect error responses (rate limiting, session errors) — treat as complete
    if (/rate.?limited|rate_limit_error|Failed to load usage|session.?expired|session.?error|invalid.?session|authentication.?error|auth.?failed|Unable to (?:load|fetch)|Error loading|could not (?:load|fetch)|not authenticated|login required|sign.?in required/i.test(clean)) return true;
    // Basic requirements - must have actual usage data, not just the loading screen
    const hasSession = clean.includes('Current session');
    const hasWeekly = clean.includes('Current week');
    const hasPercentUsed = clean.includes('% used');
    if (!hasSession || !hasWeekly || !hasPercentUsed) return false;

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

  // Convert 12-hour time to 24-hour
  _to24Hour(hourRaw, ampm) {
    let hour = parseInt(hourRaw);
    if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
    return hour;
  }

  // Format duration from seconds to readable text
  _formatDuration(diffSeconds) {
    const mins = Math.floor(diffSeconds / 60), hours = Math.floor(mins / 60), m = mins % 60;
    return hours > 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : hours > 0 ? `${hours}h ${m}m` : `${m}m`;
  }

  // Parse date with time: "Jan 22, 1pm" or date-only: "Apr 1"
  _parseDateTimeStr(cleanStr, now, monthNames) {
    const dateTimeMatch = cleanStr.match(/(\w+)\s+(\d{1,2}),?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    const dateOnlyMatch = !dateTimeMatch && cleanStr.match(/(\w+)\s+(\d{1,2})$/i);
    if (!dateTimeMatch && !dateOnlyMatch) return null;

    let resetDate;
    if (dateTimeMatch) {
      const [, month, day, hourRaw, minutes = '0', ampm] = dateTimeMatch;
      const monthIndex = monthNames.indexOf(month.toLowerCase().substring(0, 3));
      if (monthIndex === -1) return null;
      resetDate = new Date(now.getFullYear(), monthIndex, parseInt(day), this._to24Hour(hourRaw, ampm), parseInt(minutes));
    } else {
      const [, month, day] = dateOnlyMatch;
      const monthIndex = monthNames.indexOf(month.toLowerCase().substring(0, 3));
      if (monthIndex === -1) return null;
      resetDate = new Date(now.getFullYear(), monthIndex, parseInt(day));
    }
    if (resetDate < now) resetDate.setFullYear(resetDate.getFullYear() + 1);
    return resetDate;
  }

  // Convert reset timestamp to duration object with string and seconds
  parseResetTime(resetStr) {
    if (!resetStr) return null;
    const now = new Date();
    const cleanStr = resetStr.replace(/\s*\([^)]+\)\s*$/, '').trim();
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

    let resetDate;
    // Try time-only format first: "2:59am" or "12:30pm"
    const timeOnlyMatch = cleanStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (timeOnlyMatch) {
      const [, hourRaw, minutes = '0', ampm] = timeOnlyMatch;
      resetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), this._to24Hour(hourRaw, ampm), parseInt(minutes));
      if (resetDate <= now) resetDate.setDate(resetDate.getDate() + 1);
    } else {
      resetDate = this._parseDateTimeStr(cleanStr, now, monthNames);
      if (!resetDate) return { text: resetStr, seconds: null };
    }

    const diffMs = resetDate - now;
    if (diffMs <= 0) return { text: 'soon', seconds: 0 };
    const diffSeconds = Math.floor(diffMs / 1000);
    return { text: this._formatDuration(diffSeconds), seconds: diffSeconds };
  }

  sendCommands(shell, _output) {
    console.log(`[${this.name}] Sending /usage command...`);
    // Escape dismisses any previous output/UI, then type command + Enter
    setTimeout(() => shell.write('\x1b'), 50);
    setTimeout(() => shell.write('/usage'), 600);
    setTimeout(() => shell.write('\r'), 1000);
  }

  // After getting /usage output, dismiss dialog so next refresh starts with clean prompt
  async sendCommandAndWait() {
    const result = await super.sendCommandAndWait();
    if (this.shell) { this.shell.write('\x1b'); await new Promise(r => setTimeout(r, 1000)); this.output = ''; }
    return result;
  }

  // Extract section between two regex patterns from text
  _extractSection(text, start, end) {
    const regex = end ? new RegExp(`${start}([\\s\\S]*?)(?=${end}|$)`, 'i') : new RegExp(`${start}([\\s\\S]*)$`, 'i');
    return text.match(regex)?.[1] || null;
  }

  // Extract reset time string from a section (handles PTY corruption)
  _extractResetTime(section) {
    // Look for date+time pattern FIRST (more specific)
    const dateTimeMatch = section.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{1,2}(?::\d{2})?\s*(am|pm))\s*\(([^)]+)\)/i);
    if (dateTimeMatch) return `${dateTimeMatch[1]} (${dateTimeMatch[3]})`;
    // Try clean time-only pattern
    const timeOnlyMatch = section.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*\(([^)]+)\)/i);
    if (timeOnlyMatch) return `${timeOnlyMatch[1]} (${timeOnlyMatch[2]})`;
    // Handle PTY-corrupted time: "1 m" or "2 59 m" (missing a/p)
    const corruptedMatch = section.match(/(\d{1,2})(?:\s*:?\s*(\d{2}))?\s+m\s*\(([^)]+)\)/i);
    if (corruptedMatch) {
      const [, hour, minutes, tz] = corruptedMatch;
      const mins = minutes ? `:${minutes}` : '';
      const am = `${hour}${mins}am (${tz})`, pm = `${hour}${mins}pm (${tz})`;
      const amSec = this.parseResetTime(am)?.seconds ?? Infinity;
      const pmSec = this.parseResetTime(pm)?.seconds ?? Infinity;
      return amSec <= pmSec ? am : pm;
    }
    return null;
  }

  // Parse a usage section for percent and reset time
  _parseUsageSection(section) {
    if (!section) return null;
    const percentMatch = section.match(/(\d+)\s*%\s*used/i);
    if (!percentMatch) return null;
    const resetsAt = this._extractResetTime(section), resetData = resetsAt ? this.parseResetTime(resetsAt) : null;
    return { percent: parseFloat(percentMatch[1]), resetsAt, resetsIn: resetData?.text || null, resetsInSeconds: resetData?.seconds || null };
  }

  // Parse extra usage section with budget info
  _parseExtraUsage(extraSection) {
    const percentMatch = extraSection.match(/(\d+)\s*%\s*used/i);
    const spentMatch = extraSection.match(/\$([0-9.]+)\s*\/\s*\$([0-9.]+)\s*spent/i);
    if (!percentMatch && !spentMatch) return null;
    const dateMatch = extraSection.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*(?:\d{1,2}(?::\d{2})?\s*(?:am|pm))?)\s*\(([^)]+)\)/i);
    const resetsAt = dateMatch ? `${dateMatch[1].trim()} (${dateMatch[2]})` : null;
    const resetData = resetsAt ? this.parseResetTime(resetsAt) : null;
    return {
      label: 'Extra usage', percent: percentMatch ? parseFloat(percentMatch[1]) : null,
      spent: spentMatch ? parseFloat(spentMatch[1]) : null,
      budget: spentMatch ? parseFloat(spentMatch[2]) : null,
      resetsAt, resetsIn: resetData?.text || null, resetsInSeconds: resetData?.seconds || null,
    };
  }

  // Parse legacy weekly format (single "Current week" without model qualifiers)
  _parseLegacyWeekly(clean) {
    const weeklyMatch = clean.match(/Current\s+week[\s\S]*?(\d+)\s*%\s*used[\s\S]*?Resets\s+([\s\S]*?)(?=esc\s+to\s+cancel|current\s+week|$)/i);
    if (weeklyMatch) {
      const resetSection = weeklyMatch[2];
      const tzMatch = resetSection.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*\([^)]+\)|\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*\([^)]+\))/i);
      const resetsAt = tzMatch ? tzMatch[1].trim() : resetSection.trim().split(/\s{2,}/)[0];
      const resetData = this.parseResetTime(resetsAt);
      return { percent: parseFloat(weeklyMatch[1]), label: 'Current week', resetsAt, resetsIn: resetData?.text || null, resetsInSeconds: resetData?.seconds || null };
    }
    const percentMatch = clean.match(/Current\s+week[^%]*?(\d+)\s*%\s*used/i);
    if (percentMatch) return { percent: parseFloat(percentMatch[1]), label: 'Current week', resetsAt: null, resetsIn: null, resetsInSeconds: null };
    return null;
  }

  // Calculate pace data for a usage section
  _addPaceData(sectionData, cycleType) {
    if (!sectionData || sectionData.resetsInSeconds == null) return sectionData;
    const cycleDuration = CYCLE_DURATIONS[cycleType];
    if (!cycleDuration) return sectionData;
    const paceData = calculatePace({ usagePercent: sectionData.percent ?? 0, resetsInSeconds: sectionData.resetsInSeconds, cycleDurationSeconds: cycleDuration });
    if (paceData) sectionData.pace = paceData;
    return sectionData;
  }

  parseOutput(output) {
    const clean = this.stripAnsi(output);
    const usage = { session: null, weeklyAll: null, weeklySonnet: null };

    // Debug: log session section for troubleshooting
    const sessionIdx = clean.indexOf('Current session'), weeklyIdx = clean.indexOf('Current week');
    if (sessionIdx !== -1 && weeklyIdx !== -1) {
      console.log(`[${this.name}] Session section preview:`, clean.substring(sessionIdx, weeklyIdx).substring(0, 200));
    }

    // Parse session
    const sessionData = this._parseUsageSection(this._extractSection(clean, 'Current\\s+session', 'Current\\s+week'));
    if (sessionData) {
      usage.session = { label: 'Current session', ...sessionData };
      this._addPaceData(usage.session, 'session');
    }

    // Parse weekly (all models)
    const weeklyAllData = this._parseUsageSection(this._extractSection(clean, 'Current\\s+week\\s*\\(?\\s*all\\s+models\\s*\\)?', 'Current\\s+week\\s*\\(?\\s*Sonnet'));
    if (weeklyAllData) {
      usage.weeklyAll = { label: 'Current week (all models)', ...weeklyAllData };
      this._addPaceData(usage.weeklyAll, 'weekly');
    }

    // Parse weekly (Sonnet only)
    const weeklySonnetData = this._parseUsageSection(this._extractSection(clean, 'Current\\s+week\\s*\\(?\\s*Sonnet\\s+only\\s*\\)?', 'Extra\\s+usage|esc\\s+to\\s+cancel|Current\\s+week\\s*\\('));
    if (weeklySonnetData) {
      usage.weeklySonnet = { label: 'Current week (Sonnet only)', ...weeklySonnetData };
      this._addPaceData(usage.weeklySonnet, 'weekly');
    }

    // Parse extra usage section
    const extraSection = this._extractSection(clean, 'Extra\\s+usage', 'esc\\s+to\\s+cancel');
    if (extraSection) {
      const extraData = this._parseExtraUsage(extraSection);
      if (extraData) {
        usage.extraUsage = extraData;
        this._addPaceData(usage.extraUsage, 'weekly');
      }
    }

    // Legacy format fallback
    if (!usage.weeklyAll && !usage.weeklySonnet) {
      const legacyWeekly = this._parseLegacyWeekly(clean);
      if (legacyWeekly) {
        usage.weekly = legacyWeekly;
        this._addPaceData(usage.weekly, 'weekly');
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

    return new Promise((resolve, _reject) => {
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
      setTimeout(() => this.shell.write('/status'), 600);
      setTimeout(() => this.shell.write('\r'), 1000);
    });
  }

  _hasCompleteStatusOutput(output) {
    const clean = this.stripAnsi(output);
    const hasSessionInfo = /session/i.test(clean) || /working directory|cwd/i.test(clean);
    const hasPrompt = ['? for shortcuts', '❯', '> ', 'esc to'].some(p => clean.includes(p));
    return hasSessionInfo && hasPrompt;
  }

  _parseStatusOutput(output) {
    const clean = this.stripAnsi(output);
    const metadata = {};
    const patterns = [
      ['sessionId', /Session(?:\s+ID)?:\s*([a-f0-9-]+)/i],
      ['cwd', /(?:Working directory|Cwd|Current directory|Directory):\s*([^\n│]+)/i],
      ['organization', /(?:Organization|Org):\s*([^\n│]+)/i],
      ['email', /(?:Email|Account|User|Logged in as):\s*(\S+@\S+)/i],
      ['model', /(?:Model|Using model):\s*(claude[-\w.]+)/i],
      ['version', /(?:Version|Claude Code):\s*v?([\d.]+)/i],
    ];
    for (const [key, regex] of patterns) {
      const match = clean.match(regex);
      if (match) metadata[key] = this.stripBoxChars(match[1]);
    }
    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  /** Lightweight keepalive to prevent session expiration. @returns {Promise<boolean>} True if keepalive succeeded */
  async keepalive() {
    if (this.freshProcess) { console.log(`[${this.name}] Keepalive skipped (fresh process mode)`); return true; }
    if (!this.shell || !this.processReady) { console.log(`[${this.name}] Keepalive: spawning process...`); await this.spawnProcess(); }
    if (this.shell) { console.log(`[${this.name}] Keepalive: sending ping...`); this.shell.write('\x1b'); return true; }
    return false;
  }

  /** Spawns fresh CLI, sends /status to refresh session, then tears down cleanly. @returns {Promise<boolean>} */
  async pingKeepalive() {
    return pingKeepalive({
      name: this.name,
      command: this.command,
      args: this.args,
      env: this.getEnv(),
      termName: 'xterm-color',
      isReady: (output) => this.isReadyForCommands(output),
      sendCommand: (shell) => {
        setTimeout(() => shell.write('\x1b'), 50);
        setTimeout(() => shell.write('/status'), 300);
        setTimeout(() => shell.write('\r'), 500);
      },
      isComplete: (output) => this._hasCompleteStatusOutput(output),
      handlePrompts: (shell, _data, output) => this.handleTrustPrompt(shell, output),
      respondToTerminalQueries: (data, shell) => this._respondToTerminalQueries(data, shell),
    });
  }
}

module.exports = { ClaudeAgent };
