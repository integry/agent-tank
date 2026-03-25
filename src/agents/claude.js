const { BaseAgent } = require('./base.js');
const { calculatePace } = require('../pace-evaluator.js');
const { CYCLE_DURATIONS } = require('../usage-formatters.js');
const logger = require('../logger.js');
const { pingKeepalive } = require('./keepalive-helper.js');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

// API response sentinel for parseOutput to detect
const API_RESPONSE_SENTINEL = '__API_RESPONSE__';

class ClaudeAgent extends BaseAgent {
  constructor(options = {}) {
    super('claude', 'claude');
    this._statusSent = false;
    this.useApi = options.useApi || false;
    this._apiResponse = null; // Stores the API response when using direct API
    // PTY default: 600s (10 minutes), API mode: 60s (1 minute)
    this.minRefreshInterval = this.useApi ? 60 : 600;
  }

  /**
   * Resolve OAuth token from various sources:
   * 1. CLAUDE_CODE_OAUTH_TOKEN environment variable
   * 2. ~/.claude/.credentials.json file
   * 3. macOS Keychain (via security command)
   * 4. Linux secret-tool
   * @returns {string|null} The OAuth token or null if not found
   */
  _getAuthToken() {
    // 1. Check environment variable first
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      logger.agent(this.name, 'Using OAuth token from CLAUDE_CODE_OAUTH_TOKEN env var');
      return process.env.CLAUDE_CODE_OAUTH_TOKEN;
    }

    // 2. Check credentials file
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const credentialsPath = path.join(homeDir, '.claude', '.credentials.json');
    try {
      if (fs.existsSync(credentialsPath)) {
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        if (credentials.claudeAiOauth?.accessToken) {
          logger.agent(this.name, 'Using OAuth token from credentials file');
          return credentials.claudeAiOauth.accessToken;
        }
      }
    } catch (err) {
      logger.agent(this.name, 'Error reading credentials file:', err.message);
    }

    // 3. Try macOS Keychain
    if (process.platform === 'darwin') {
      try {
        const result = execSync(
          'security find-generic-password -s "claude-code" -w 2>/dev/null',
          { encoding: 'utf8', timeout: 5000 }
        ).trim();
        if (result) {
          // The keychain stores the full credentials JSON
          const parsed = JSON.parse(result);
          if (parsed.claudeAiOauth?.accessToken) {
            logger.agent(this.name, 'Using OAuth token from macOS Keychain');
            return parsed.claudeAiOauth.accessToken;
          }
        }
      } catch (_err) {
        // Keychain entry not found or error parsing - continue to next method
      }
    }

    // 4. Try Linux secret-tool
    if (process.platform === 'linux') {
      try {
        const result = execSync(
          'secret-tool lookup service claude-code 2>/dev/null',
          { encoding: 'utf8', timeout: 5000 }
        ).trim();
        if (result) {
          const parsed = JSON.parse(result);
          if (parsed.claudeAiOauth?.accessToken) {
            logger.agent(this.name, 'Using OAuth token from Linux secret-tool');
            return parsed.claudeAiOauth.accessToken;
          }
        }
      } catch (_err) {
        // secret-tool not available or entry not found - continue
      }
    }

    logger.agent(this.name, 'No OAuth token found in any credential source');
    return null;
  }

  /**
   * Fetch usage data directly from the Anthropic OAuth usage API
   * @param {number} timeout - Request timeout in milliseconds
   * @returns {Promise<Object|null>} The API response or null on failure
   */
  async _runWithApi(timeout = 10000) {
    const token = this._getAuthToken();
    if (!token) {
      logger.agent(this.name, 'No OAuth token available for API fetch');
      return null;
    }

    return new Promise((resolve) => {
      const url = 'https://api.anthropic.com/api/oauth/usage';

      const req = https.request(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'agent-tank/1.0',
        },
        timeout,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data);
              logger.agent(this.name, 'API response received successfully');
              resolve(parsed);
            } catch (err) {
              logger.agent(this.name, 'Failed to parse API response:', err.message);
              resolve(null);
            }
          } else if (res.statusCode === 401) {
            logger.agent(this.name, 'API authentication failed (401) - token may be expired');
            resolve(null);
          } else {
            logger.agent(this.name, `API request failed with status ${res.statusCode}`);
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        logger.agent(this.name, 'API request error:', err.message);
        resolve(null);
      });

      req.on('timeout', () => {
        logger.agent(this.name, 'API request timed out');
        req.destroy();
        resolve(null);
      });

      req.end();
    });
  }

  /**
   * Override runCommand to attempt API fetch first when useApi is enabled
   * Falls back to PTY if API fails
   */
  async runCommand() {
    if (this.useApi) {
      logger.agent(this.name, 'Attempting direct API fetch...');
      const apiResponse = await this._runWithApi();
      if (apiResponse) {
        this._apiResponse = apiResponse;
        return API_RESPONSE_SENTINEL;
      }
      logger.agent(this.name, 'API fetch failed, falling back to PTY');
      // Reset minRefreshInterval to PTY default for fallback
      this.minRefreshInterval = 600;
    }

    // Fall back to PTY command execution
    return super.runCommand();
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
    logger.agent(this.name, 'Detected trust prompt, auto-accepting...');
    shell.write('y\r');
    setTimeout(() => { logger.agent(this.name, 'Sending Enter to proceed...'); shell.write('\r'); }, 500);
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
    logger.agent(this.name, 'Sending /usage command...');
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

  /**
   * Parse the direct API response into the unified usage schema
   * @param {Object} apiResponse - The raw API response from Anthropic
   * @returns {Object} The parsed usage object matching the PTY format
   */
  _parseApiResponse(apiResponse) {
    const usage = { session: null, weeklyAll: null, weeklySonnet: null };

    if (!apiResponse) return usage;

    const now = new Date();

    // Helper to calculate reset time info from an ISO timestamp
    const parseResetTimestamp = (isoTimestamp) => {
      if (!isoTimestamp) return { resetsAt: null, resetsIn: null, resetsInSeconds: null };
      const resetDate = new Date(isoTimestamp);
      const diffMs = resetDate - now;
      if (diffMs <= 0) return { resetsAt: isoTimestamp, resetsIn: 'soon', resetsInSeconds: 0 };
      const diffSeconds = Math.floor(diffMs / 1000);
      return {
        resetsAt: isoTimestamp,
        resetsIn: this._formatDuration(diffSeconds),
        resetsInSeconds: diffSeconds,
      };
    };

    // Parse session limit (if present)
    if (apiResponse.sessionLimit) {
      const sl = apiResponse.sessionLimit;
      const percent = sl.percentUsed ?? (sl.used && sl.limit ? Math.round((sl.used / sl.limit) * 100) : null);
      if (percent !== null) {
        const resetInfo = parseResetTimestamp(sl.resetsAt);
        usage.session = {
          label: 'Current session',
          percent,
          ...resetInfo,
        };
        this._addPaceData(usage.session, 'session');
      }
    }

    // Parse weekly all models limit (if present)
    if (apiResponse.weeklyAllModels || apiResponse.weeklyLimit) {
      const wl = apiResponse.weeklyAllModels || apiResponse.weeklyLimit;
      const percent = wl.percentUsed ?? (wl.used && wl.limit ? Math.round((wl.used / wl.limit) * 100) : null);
      if (percent !== null) {
        const resetInfo = parseResetTimestamp(wl.resetsAt);
        usage.weeklyAll = {
          label: 'Current week (all models)',
          percent,
          ...resetInfo,
        };
        this._addPaceData(usage.weeklyAll, 'weekly');
      }
    }

    // Parse weekly Sonnet only limit (if present)
    if (apiResponse.weeklySonnet || apiResponse.weeklySonnetOnly) {
      const ws = apiResponse.weeklySonnet || apiResponse.weeklySonnetOnly;
      const percent = ws.percentUsed ?? (ws.used && ws.limit ? Math.round((ws.used / ws.limit) * 100) : null);
      if (percent !== null) {
        const resetInfo = parseResetTimestamp(ws.resetsAt);
        usage.weeklySonnet = {
          label: 'Current week (Sonnet only)',
          percent,
          ...resetInfo,
        };
        this._addPaceData(usage.weeklySonnet, 'weekly');
      }
    }

    // Parse extra usage (if present)
    if (apiResponse.extraUsage) {
      const eu = apiResponse.extraUsage;
      const percent = eu.percentUsed ?? (eu.spent && eu.budget ? Math.round((eu.spent / eu.budget) * 100) : null);
      const resetInfo = parseResetTimestamp(eu.resetsAt);
      usage.extraUsage = {
        label: 'Extra usage',
        percent,
        spent: eu.spent ?? null,
        budget: eu.budget ?? null,
        ...resetInfo,
      };
      this._addPaceData(usage.extraUsage, 'weekly');
    }

    // Handle alternative API response structures
    // The API might return data in a different format - handle common variations
    if (apiResponse.usage) {
      // Nested usage object format
      return this._parseApiResponse(apiResponse.usage);
    }

    // Handle flat percentage fields
    if (!usage.session && apiResponse.sessionPercent !== undefined) {
      usage.session = {
        label: 'Current session',
        percent: apiResponse.sessionPercent,
        ...parseResetTimestamp(apiResponse.sessionResetsAt),
      };
      this._addPaceData(usage.session, 'session');
    }

    if (!usage.weeklyAll && apiResponse.weeklyPercent !== undefined) {
      usage.weeklyAll = {
        label: 'Current week (all models)',
        percent: apiResponse.weeklyPercent,
        ...parseResetTimestamp(apiResponse.weeklyResetsAt),
      };
      this._addPaceData(usage.weeklyAll, 'weekly');
    }

    return usage;
  }

  parseOutput(output) {
    // Check if this is an API response (sentinel marker)
    if (output === API_RESPONSE_SENTINEL && this._apiResponse) {
      logger.agent(this.name, 'Parsing API response');
      const usage = this._parseApiResponse(this._apiResponse);
      this._apiResponse = null; // Clear after parsing
      return usage;
    }

    const clean = this.stripAnsi(output);
    const usage = { session: null, weeklyAll: null, weeklySonnet: null };

    // Debug: log session section for troubleshooting
    const sessionIdx = clean.indexOf('Current session'), weeklyIdx = clean.indexOf('Current week');
    if (sessionIdx !== -1 && weeklyIdx !== -1) {
      logger.agent(this.name, 'Session section preview:', logger.dim(clean.substring(sessionIdx, weeklyIdx).substring(0, 200)));
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
        logger.agent(this.name, '/status timeout, using partial output');
        finish(this._parseStatusOutput(statusOutput));
      }, 10000); // 10 second timeout for /status

      this._commandInFlight = true;
      this._onDataCallback = () => {
        statusOutput = this.output;
        // Check if we have complete /status output
        if (this._hasCompleteStatusOutput(statusOutput)) {
          logger.agent(this.name, 'Complete /status output detected');
          setTimeout(() => finish(this._parseStatusOutput(statusOutput)), 100);
        }
      };

      logger.agent(this.name, 'Sending /status command for metadata...');
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
