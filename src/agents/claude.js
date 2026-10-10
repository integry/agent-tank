/* eslint-disable max-lines -- Claude PTY and API integrations share one provider implementation. */

const { BaseAgent } = require('./base.js');
const logger = require('../logger.js');
const { pingKeepalive } = require('./keepalive-helper.js');
const { parseApiResponse } = require('./api-response-parser.js');
const { readRecentFableAllowance } = require('./claude-usage-cache.js');
const { parsePtyOutput, FABLE_SECTION_START } = require('./pty-output-parser.js');

// Matches the Fable allowance header alone, before its "N% used" row has rendered.
const FABLE_SECTION_HEADER = new RegExp(FABLE_SECTION_START, 'i');
const USAGE_SETTLE_TIMEOUT_MS = 10000;
const USAGE_SETTLE_POLL_MS = 50;
// A healthy Claude /usage dialog starts returning its core rows almost
// immediately. Persistent PTYs occasionally swallow the slash command and emit
// only terminal-mode control bytes; retry once instead of waiting 30 seconds
// for the generic command timeout to tear down the process.
const USAGE_COMMAND_RETRY_MS = 2500;
const USAGE_COMMAND_RESET_MS = 200;
const https = require('https');
const {
  readCredentials, isTokenExpired, refreshOAuthToken, persistRefreshedTokens,
} = require('./oauth-helper.js');

// API response sentinel for parseOutput to detect
const API_RESPONSE_SENTINEL = '__API_RESPONSE__';

class ClaudeAgent extends BaseAgent {
  constructor(options = {}) {
    super('claude', 'claude');
    this.configPath = options.configPath || null;
    this._statusSent = false;
    this._trustHandledShells = new WeakSet();
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
   * @returns {Promise<string|null>} The OAuth token or null
   */
  async _getAuthToken() {
    const creds = readCredentials(this.configPath);
    if (!creds) {
      logger.agent(this.name, 'No OAuth token found in any credential source');
      return null;
    }
    logger.agent(this.name, `Using OAuth token from ${creds.source}`);
    if (!isTokenExpired(creds.expiresAt)) return creds.accessToken;

    // Token is expired — try to refresh
    logger.agent(this.name, 'Access token expired, attempting refresh...');
    return this._refreshAndGetToken();
  }

  /**
   * Make an HTTP GET request to the usage API with the given token.
   * @param {string} token - OAuth access token
   * @param {number} timeout - Request timeout in milliseconds
   * @returns {Promise<{ statusCode: number, body: string }>}
   */
  _fetchUsageApi(token, timeout) {
    return new Promise((resolve) => {
      const req = https.request('https://api.anthropic.com/api/oauth/usage', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'Content-Type': 'application/json',
          'User-Agent': 'agent-tank/1.0',
        },
        timeout,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });
      req.on('error', (err) => resolve({ statusCode: 0, body: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0, body: 'timeout' }); });
      req.end();
    });
  }

  /**
   * Fetch usage data directly from the Anthropic OAuth usage API.
   * On 401, attempts a token refresh and retries once.
   * @param {number} timeout - Request timeout in milliseconds
   * @returns {Promise<Object|null>} The API response or null on failure
   */
  async _runWithApi(timeout = 10000) {
    const token = await this._getAuthToken();
    if (!token) {
      logger.agent(this.name, 'No OAuth token available for API fetch');
      return null;
    }

    const result = await this._fetchUsageApi(token, timeout);

    if (result.statusCode === 200) {
      return this._parseUsageResponse(result.body);
    }

    // On 401, try refreshing the token and retry once
    if (result.statusCode === 401) {
      logger.agent(this.name, 'API returned 401, attempting token refresh...');
      const refreshedToken = await this._refreshAndGetToken();
      if (refreshedToken) {
        const retry = await this._fetchUsageApi(refreshedToken, timeout);
        if (retry.statusCode === 200) {
          return this._parseUsageResponse(retry.body);
        }
        logger.agent(this.name, `API retry failed (${retry.statusCode})`);
      }
      return null;
    }

    if (result.statusCode === 0) {
      logger.agent(this.name, 'API request error:', result.body);
    } else {
      logger.agent(this.name, `API request failed with status ${result.statusCode}`);
    }
    return null;
  }

  /**
   * Parse the usage API JSON response.
   * @param {string} body - Raw response body
   * @returns {Object|null}
   */
  _parseUsageResponse(body) {
    try {
      const parsed = JSON.parse(body);
      logger.agent(this.name, 'API response received successfully');
      return parsed;
    } catch (err) {
      logger.agent(this.name, 'Failed to parse API response:', err.message);
      return null;
    }
  }

  /**
   * Force-refresh the OAuth token (regardless of expiresAt) and return the new access token.
   * @returns {Promise<string|null>}
   */
  async _refreshAndGetToken() {
    const creds = readCredentials(this.configPath);
    if (!creds?.refreshToken) {
      logger.agent(this.name, 'No refresh token available');
      return null;
    }

    const refreshed = await refreshOAuthToken(creds.refreshToken);
    if (!refreshed) {
      logger.agent(this.name, 'Token refresh failed');
      return null;
    }

    logger.agent(this.name, 'OAuth token refreshed successfully');
    if (creds.source === 'credentials_file') {
      try {
        persistRefreshedTokens(refreshed, this.configPath);
        logger.agent(this.name, 'Refreshed tokens persisted to credentials file');
      } catch (err) {
        logger.agent(this.name, 'Failed to persist refreshed tokens:', err.message);
      }
    }
    return refreshed.accessToken;
  }

  /**
   * Override runCommand to attempt API fetch first when useApi is enabled
   * Falls back to PTY if API fails
   */
  async runCommand() {
    this._cachedPtyFable = null;
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
    const output = await super.runCommand();
    const parsed = parsePtyOutput(this.stripAnsi(output));
    if (parsed.session && parsed.weeklyAll && !parsed.weeklyFable) {
      this._cachedPtyFable = readRecentFableAllowance(this.configPath);
    }
    return output;
  }

  getTimeout() { return 30000; }
  getEnv() {
    const env = { ...process.env, TERM: 'dumb', NO_COLOR: '1' };
    delete env.CLAUDECODE; // Allow spawning inside a Claude Code session
    if (this.configPath) env.CLAUDE_CONFIG_DIR = this.configPath;
    return env;
  }

  isReadyForCommands(output) {
    const clean = this.stripAnsi(output);
    const trustMenu = clean.search(/yes,?\s*i\s*trust\s*this\s*folder/i);
    if (trustMenu >= 0 && !/\?\s*for\s*shortcuts/i.test(clean.slice(trustMenu))) return false;
    return clean.includes('? for shortcuts') || clean.includes('❯') ||
           clean.includes('> ') || clean.includes('Try "');
  }

  handleTrustPrompt(shell, output) {
    const clean = this.stripAnsi(output);
    // Newer CLIs render spaces as cursor movements and default to No.
    if (/yes,?\s*i\s*trust\s*this\s*folder/i.test(clean)) {
      if (this._trustHandledShells.has(shell)) return false;
      this._trustHandledShells.add(shell);
      let active = true;
      const exit = shell.onExit?.(() => { active = false; });
      const write = value => {
        if (active && !this.isStopping()) {
          try { shell.write(value); } catch { /* Process exited during setup. */ }
        }
      };
      // The terminal capability handshake redraws and resets the selection.
      // Wait for it before selecting Yes, then allow that selection to render.
      setTimeout(() => {
        if (!/❯\s*Yes,?\s*I\s*trust/i.test(clean)) write('\x1b[B');
      }, 750);
      setTimeout(() => {
        write('\r');
        exit?.dispose();
      }, 1000);
      return true;
    }
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
    const parsed = parsePtyOutput(clean);

    const hasSessionData = parsed.session && typeof parsed.session.percent === 'number';
    const hasLegacyWeekly = parsed.weekly && typeof parsed.weekly.percent === 'number';
    const hasAllModelsWeekly = parsed.weeklyAll && typeof parsed.weeklyAll.percent === 'number';
    const hasFableWeekly = parsed.weeklyFable && typeof parsed.weeklyFable.percent === 'number';

    // Only Max accounts get a Fable allowance row, so never block on it unless the
    // dialog has actually started drawing one — otherwise Pro accounts would wait
    // out the full command timeout for a section that is never coming.
    if (hasAllModelsWeekly && FABLE_SECTION_HEADER.test(clean) && !hasFableWeekly) return false;

    // Newer Claude builds often emit usable session/weekly data before the UI fully settles.
    return Boolean(hasSessionData && (hasLegacyWeekly || hasAllModelsWeekly));
  }

  sendCommands(shell, _output, canWrite = () => true) {
    logger.agent(this.name, 'Sending /usage command...');
    // Claude keeps slash-command suggestions open for /usage on newer builds.
    // Confirm the command selection, then submit the actual command execution.
    const writeIfActive = (value) => {
      if (!shell || !canWrite()) return;
      try {
        shell.write(value);
      } catch (_err) {
        // The persistent exit handler records the underlying process state.
      }
    };
    setTimeout(() => writeIfActive('/usage'), 100);
    setTimeout(() => writeIfActive('\r'), 500);
    setTimeout(() => writeIfActive('\r'), 900);
  }

  _isUsageDialogSettled(output) {
    const clean = this.stripAnsi(output);
    const usage = parsePtyOutput(clean);
    if (!usage.weeklyAll || usage.weeklyFable) return true;

    // A visible Fable header without its percentage is still mid-render.
    if (FABLE_SECTION_HEADER.test(clean)) return false;

    // Claude renders the usage footer after its asynchronous local-session scan.
    // Reaching it without a Fable row means this account has no Fable allowance.
    const weeklyIndex = clean.search(/Current\s*week\s*\(?\s*all\s*models/i);
    const afterWeekly = weeklyIndex === -1 ? clean : clean.slice(weeklyIndex);
    return /Usage\s*credits\s+are|Extra\s+usage/i.test(afterWeekly);
  }

  async _waitForUsageDialogSettlement(initialOutput) {
    const deadline = Date.now() + USAGE_SETTLE_TIMEOUT_MS;
    let latestOutput = this.output || initialOutput;

    while (!this._isUsageDialogSettled(latestOutput) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, USAGE_SETTLE_POLL_MS));
      latestOutput = this.output || latestOutput;
    }

    return latestOutput;
  }

  _hasParseableUsageRows(output) {
    const parsed = parsePtyOutput(this.stripAnsi(output));
    return [parsed.session, parsed.weekly, parsed.weeklyAll, parsed.weeklyFable]
      .some(row => row && typeof row.percent === 'number');
  }

  _retryStalledUsageCommand() {
    const shell = this.shell;
    const commandCallback = this._onDataCallback;
    // Rows can arrive during either the reset delay or delayed submission while
    // the Fable allowance is still rendering. Retry only the original waiter
    // with no parseable rows, and continue to respect completed error responses.
    const canRetry = () => shell && this.shell === shell && this._commandInFlight &&
      this._onDataCallback === commandCallback && !this._hasParseableUsageRows(this.output) &&
      !this.hasCompleteOutput(this.output);
    if (!canRetry()) return;

    logger.agent(this.name, 'No usage rows after 2.5s; resetting prompt and retrying /usage...');
    try {
      // Dismiss a half-open dialog or suggestion menu before resubmitting.
      shell.write('\x1b');
    } catch (_err) {
      return;
    }

    setTimeout(() => {
      if (!canRetry()) return;
      this.output = '';
      this.sendCommands(shell, '', canRetry);
    }, USAGE_COMMAND_RESET_MS);
  }

  // After getting /usage output, let Claude finish its asynchronous allowance
  // rows, then dismiss the dialog so the next refresh starts with a clean prompt.
  async sendCommandAndWait() {
    const retryTimer = setTimeout(() => this._retryStalledUsageCommand(), USAGE_COMMAND_RETRY_MS);
    let result;
    try {
      result = await super.sendCommandAndWait();
    } finally {
      clearTimeout(retryTimer);
    }
    result = await this._waitForUsageDialogSettlement(result);
    if (this.shell) { this.shell.write('\x1b'); await new Promise(r => setTimeout(r, 1000)); this.output = ''; }
    return result;
  }

  /**
   * Parse the direct API response into the unified usage schema
   * Delegates to the external api-response-parser module
   * @param {Object} apiResponse - The raw API response from Anthropic
   * @returns {Object} The parsed usage object matching the PTY format
   */
  _parseApiResponse(apiResponse) {
    return parseApiResponse(apiResponse);
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

    // Debug: log session section for troubleshooting
    const sessionIdx = clean.indexOf('Current session');
    const weeklyIdx = clean.indexOf('Current week');
    if (sessionIdx !== -1 && weeklyIdx !== -1) {
      logger.agent(this.name, 'Session section preview:', logger.dim(clean.substring(sessionIdx, weeklyIdx).substring(0, 200)));
    }

    // Delegate to PTY output parser module
    const usage = parsePtyOutput(clean);
    if (!usage.weeklyFable && this._cachedPtyFable) usage.weeklyFable = this._cachedPtyFable;
    this._cachedPtyFable = null;
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
        if (this.shell && statusOutput) {
          try {
            this.shell.write('\x1b');
          } catch (_err) {
            // The persistent exit handler records the underlying process state.
          }
          setTimeout(() => {
            this.output = '';
            resolve(result);
          }, 300);
          return;
        }
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
      const writeIfActive = (value) => {
        if (!this.shell) {
          finish(this._parseStatusOutput(statusOutput));
          return;
        }
        try {
          this.shell.write(value);
        } catch (_err) {
          finish(this._parseStatusOutput(statusOutput));
        }
      };
      setTimeout(() => writeIfActive('/status'), 100);
      setTimeout(() => writeIfActive('\r'), 500);
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

    // Claude 2.1.284 redraws the /status table in-place. Once terminal control
    // sequences are removed, several fields can share one logical line, so a
    // newline-only value boundary consumes every field that follows it. Keep
    // line and box boundaries too, including before prompts or unknown labels.
    const fieldStart = [
      'Version', 'Claude\\s*Code', 'Session\\s*name', 'Session\\s*ID', 'Session\\s*kind',
      'Peer\\s*address', 'Working\\s*directory', 'Cwd', 'Current\\s*directory', 'Directory',
      'Login\\s*method', 'Organization', 'Org', 'Email', 'Account', 'User', 'Logged\\s*in\\s*as',
      'Cloud\\s*sessions', 'Model', 'Using\\s*model', 'MCP\\s*servers', 'Setting\\s*sources',
      'Auto\\s*mode\\s*server',
    ].join('|');
    const readField = (labels) => {
      const match = clean.match(new RegExp(
        `(?:${labels})\\s*:\\s*(.*?)(?=\\s*(?:(?:${fieldStart})\\s*:|Esc\\s*to\\s*cancel)|[\\r\\n│]|$)`,
        'i'
      ));
      return match ? this.stripBoxChars(match[1]).trim() : null;
    };

    const sessionId = readField('Session(?:\\s*ID)?');
    if (sessionId) {
      const match = sessionId.match(/[a-f0-9-]+/i);
      if (match) metadata.sessionId = match[0];
    }

    const cwd = readField('Working\\s*directory|Cwd|Current\\s*directory|Directory');
    if (cwd) metadata.cwd = cwd;

    const organization = readField('Organization|Org');
    if (organization) metadata.organization = organization;

    const email = readField('Email|Account|User|Logged\\s*in\\s*as');
    if (email) {
      const match = email.match(/\S+@\S+/);
      if (match) metadata.email = match[0];
    }

    const model = readField('Model|Using\\s*model');
    if (model) {
      const claudeModel = model.match(/claude[-\w.]+/i);
      metadata.model = claudeModel ? claudeModel[0] : model.replace(/\[\d+m/g, '').trim();
    }

    const version = readField('Version|Claude\\s*Code');
    if (version) {
      const match = version.match(/v?([\d.]+)/i);
      if (match) metadata.version = match[1];
    }
    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  /** Lightweight keepalive to prevent session expiration. @returns {Promise<boolean>} True if keepalive succeeded */
  async keepalive() {
    if (this.freshProcess) { console.log(`[${this.name}] Keepalive skipped (fresh process mode)`); return true; }
    if (this.isRefreshing || this._commandInFlight) {
      console.log(`[${this.name}] Keepalive skipped (command in flight)`);
      return true;
    }
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
