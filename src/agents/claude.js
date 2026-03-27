const { BaseAgent } = require('./base.js');
const logger = require('../logger.js');
const { pingKeepalive } = require('./keepalive-helper.js');
const { parseApiResponse } = require('./api-response-parser.js');
const { parsePtyOutput } = require('./pty-output-parser.js');
const https = require('https');
const {
  readCredentials, isTokenExpired, refreshOAuthToken, persistRefreshedTokens,
} = require('./oauth-helper.js');

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
   * @returns {Promise<string|null>} The OAuth token or null
   */
  async _getAuthToken() {
    const creds = readCredentials();
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
    const creds = readCredentials();
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
        persistRefreshedTokens(refreshed);
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
    return parsePtyOutput(clean);
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
