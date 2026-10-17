const { BaseAgent } = require('./base.js');
const { calculatePace } = require('../pace-evaluator.js');
const { CYCLE_DURATIONS } = require('../usage-formatters.js');
const logger = require('../logger.js');
const { QUOTA_HEADER, RESET_LINE, formatGroupName, cycleTypeFor, parseAgyUsage } = require('./agy-usage-parser.js');

class AgyAgent extends BaseAgent {
  // See agy-usage-parser.js for the screen formats these match.
  static QUOTA_HEADER = QUOTA_HEADER;
  static RESET_LINE = RESET_LINE;

  constructor(options = {}) {
    super('agy', 'agy', ['--dangerously-skip-permissions']);
    this.configPath = options.configPath || null;
    this._aboutSent = false;
  }

  getTimeout() {
    return 35000; // Antigravity can take 10+ seconds to start and sign in
  }

  getEnv() {
    // Use xterm-256color for proper terminal support
    // Antigravity CLI needs good terminal emulation for its TUI
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    };
    if (this.configPath) env.GEMINI_CLI_HOME = this.configPath;
    return env;
  }

  _hasReadyPrompt(output) {
    const clean = this.stripAnsi(output);
    return /Antigravity CLI[\s\S]*\n>\s*(?:\n|$)/i.test(clean)
      || /Google AI Pro[\s\S]*\n>\s*(?:\n|$)/i.test(clean)
      || /Ready\s*\(/.test(clean);
  }

  isReadyForCommands(output) {
    // Don't consider ready if authentication is in progress
    if (this._isAuthenticating(output)) {
      return false;
    }
    return this._hasReadyPrompt(output);
  }

  _isAuthenticating(output) {
    // Detect OAuth/authentication screens where Escape would cancel the flow
    const clean = this.stripAnsi(output);
    const hasAuthFlow = /waiting for authentication/i.test(clean)
      || /signing in/i.test(clean)
      || /press esc.*to cancel/i.test(clean)
      || /authenticating\.\.\./i.test(clean);

    if (!hasAuthFlow) {
      return false;
    }

    // Footer hints can render before the actual input prompt is available.
    // Treat auth as complete only when the real prompt has returned.
    return !this._hasReadyPrompt(clean);
  }

  detectAuthenticationState(output) {
    const clean = this.stripAnsi(output);
    if (!clean) return null;

    const hasAuthFailure = /failed to sign in\.\s*message:\s*([^\n]+)/i.test(clean)
      || /authentication consent could not be obtained/i.test(clean);
    if (hasAuthFailure) {
      const failureMatch = clean.match(/failed to sign in\.\s*message:\s*([^\n]+)/i);
      const detail = failureMatch
        ? `Failed to sign in: ${failureMatch[1].trim()}`
        : 'Antigravity CLI authentication failed.';

      return {
        authenticated: false,
        status: 'unauthenticated',
        message: 'Authentication required',
        detail,
        action: 'Run agy in an interactive terminal to authenticate.',
      };
    }

    // agy 1.4.0 draws a "Signing in..." spinner next to its login menu, so a
    // menu still asking for a login method means nobody is signed in.
    const awaitingLoginChoice = /currently not signed in/i.test(clean) && /select login method/i.test(clean);
    if (this._hasReadyPrompt(clean) || (/signing in/i.test(clean) && !awaitingLoginChoice)) {
      return null;
    }

    const hasAuthMenu = /how would you like to authenticate for this project\?/i.test(clean)
      || /currently not signed in/i.test(clean);

    if (!hasAuthMenu) {
      return null;
    }

    return {
      authenticated: false,
      status: 'unauthenticated',
      message: 'Authentication required',
      detail: 'Antigravity CLI is waiting for authentication.',
      action: 'Run agy in an interactive terminal to authenticate.',
    };
  }

  handleTrustPrompt(shell, output) {
    // Check for trust prompt with various wordings
    const trustPatterns = [
      'Do you trust',
      'trust the files',
      'trust this folder',
      'Trust this workspace',
      'allow access',
      'grant access',
      'grant full access',
    ];

    if (trustPatterns.some(pattern => output.toLowerCase().includes(pattern.toLowerCase()))) {
      logger.agent(this.name, 'Detected trust prompt, auto-accepting...');
      // Numbered menu with "1. Trust folder" pre-selected; Enter accepts it.
      shell.write('1\r');

      // Antigravity can redraw after trust; clear transitional UI before readiness.
      setTimeout(() => {
        if (!shell) return;
        logger.agent(this.name, 'Post-trust: sending Escape to clear restart UI...');
        shell.write('\x1b');
      }, 3000);

      return true;
    }
    return false;
  }

  hasCompleteOutput(output) {
    const clean = this.stripAnsi(output);
    if (this.detectAuthenticationState(clean)) return true;
    if (AgyAgent.QUOTA_HEADER.test(clean)) {
      return /(?:Gemini|Claude|GPT|Weekly\s+Limit|Five[\s-]?Hour\s+Limit)[\s\S]*\d+(?:\.\d+)?\s*%/i.test(clean);
    }
    const hasModel = /(?:Gemini|Claude|GPT)[^\n]+/i.test(clean);
    const hasPercent = /\d+(?:\.\d+)?%/i.test(clean);
    return hasModel && hasPercent;
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

  sendCommands(shell, output) {
    // Check if authentication is still in progress - don't send commands that could interfere
    if (this._isAuthenticating(output) || this.detectAuthenticationState(output)) {
      logger.agent(this.name, 'Authentication required or in progress, cannot send /usage command');
      // Don't retry - let the timeout handle it. Sending Escape would cancel auth.
      return;
    }
    logger.agent(this.name, 'Sending /usage command...');
    // A prior /usage leaves Antigravity's usage modal open. On a reused
    // persistent process that modal swallows the next /usage (0 bytes back ->
    // 35s timeout -> kill/respawn, which is why refreshes alternated
    // success/timeout). Press Escape first to return to the prompt; it is a
    // no-op at a clean prompt and safe because auth flows are guarded above.
    setTimeout(() => shell.write('\x1b'), 200);
    setTimeout(() => shell.write('/usage'), 600);
    setTimeout(() => shell.write('\r'), 1000);
  }

  _formatGroupName(raw) {
    return formatGroupName(raw);
  }

  // Read the countdown line that follows a limit's percentage bar. Returns
  // nulls when the limit is fully replenished ("Quota available") or the line
  // is something else entirely.
  _parseResetLine(line) {
    // A redrawn frame can leave box borders on the line, so normalise before
    // matching the countdown's leading keyword.
    const resetMatch = this.stripBoxChars(line || '').match(AgyAgent.RESET_LINE);
    const resetsIn = resetMatch?.[1]?.trim() || null;
    const resetsInSeconds = resetsIn ? this.parseDurationToSeconds(resetsIn) : null;
    // The countdown goes stale as soon as it is stored, so also record the
    // absolute instant it refers to.
    const resetsAt = resetsInSeconds == null
      ? null
      : new Date(Date.now() + resetsInSeconds * 1000).toISOString();
    return { resetsIn, resetsInSeconds, resetsAt };
  }

  _cycleTypeFor(label) {
    return cycleTypeFor(label);
  }

  // Calculate pace data for a model entry when reset timing is available.
  _addPaceData(entry, resetsInSeconds, cycleType = 'sessionAgy') {
    const cycleDuration = CYCLE_DURATIONS[cycleType];
    if (!cycleDuration || resetsInSeconds == null) return;
    const paceData = calculatePace({ usagePercent: entry.percentUsed, resetsInSeconds, cycleDurationSeconds: cycleDuration });
    if (paceData) entry.pace = paceData;
  }

  parseOutput(output) {
    const clean = this.stripAnsi(output);
    const usage = {
      models: [],
    };

    this._parseAgyUsage(clean, usage);

    // Detect version update notification in output
    const updateMatch = clean.match(/[Uu]pdate\s+available[^\d]*([\d.]+)\s*(?:→|->|to)\s*([\d.]+)/);
    if (updateMatch) {
      usage.version = { current: updateMatch[1], latest: updateMatch[2] };
    }

    return usage;
  }

  _parseAgyUsage(clean, usage) {
    parseAgyUsage(clean, usage, this);
  }

  async fetchMetadata() {
    if (this._aboutSent) {
      return this.metadata;
    }

    this._aboutSent = true;
    // The version, account and model are only printed in the startup banner,
    // so the process has to be running before there is anything to parse.
    if (!this.shell || !this.processReady) {
      await this.spawnProcess();
    }
    return this._parseAgyMetadata(await this._waitForBanner());
  }

  // Resolve with the startup output once the banner's model and plan have
  // rendered or a sign-in screen is up (else after a short grace period, since
  // the prompt can appear before the model line and agy draws the plan ~2s
  // after startup).
  _waitForBanner(timeoutMs = 4000) {
    const banner = () => `${this.spawnOutput || ''}${this.output || ''}`;
    const settled = () => {
      const clean = this.stripAnsi(banner());
      return (this._parseBannerModel(clean) && this._parseBannerPlan(clean))
        || this.detectAuthenticationState(banner());
    };
    if (!this.shell || settled()) {
      return Promise.resolve(banner());
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this._onDataCallback = null;
        resolve(banner());
      };
      const timer = setTimeout(done, timeoutMs);
      this._onDataCallback = () => {
        if (settled()) done();
      };
    });
  }

  // "Gemini 4 Argon (Medium)" on its own banner line, or the status line
  // "? for shortcuts Gemini 4 Argon · medium". Quoted names belong to notices
  // such as '"Gemini 3.1 Pro (High)" is no longer available', not the model.
  _parseBannerModel(clean) {
    const bannerLine = clean.match(/^[^\n"]*?\b((?:Gemini|Claude|GPT)\b[^\n\r"()·]*?)[ \t]*\([^)\n]*\)\s*$/im);
    if (bannerLine) return this.stripBoxChars(bannerLine[1]).trim();
    const statusLine = clean.match(/\?\s+for\s+shortcuts[ \t]+([^\n·]+?)(?:[ \t]*·[^\n]*)?[ \t]*$/im);
    return statusLine ? this.stripBoxChars(statusLine[1]).trim() : null;
  }

  // The plan in parentheses after the account: "user@example.com (Google AI Pro)".
  // agy 1.4.0 draws it in a later redraw by moving the cursor back to the
  // account line, so once escapes are stripped it can also stand on its own.
  _parseBannerPlan(clean) {
    const match = clean.match(/\S+@\S+[ \t]+\(([^)\n]+)\)/)
      || clean.match(/\((Google\s+AI\s+[^)\n]+)\)/i);
    return match ? match[1].trim() : null;
  }

  _parseAgyMetadata(output) {
    const clean = this.stripAnsi(output);
    const metadata = {};

    const versionMatch = clean.match(/Antigravity\s+CLI\s+v?([\d.]+)/i);
    if (versionMatch) metadata.version = versionMatch[1];

    const emailMatch = clean.match(/(\S+@\S+)/);
    if (emailMatch) metadata.email = this.stripBoxChars(emailMatch[1]);

    const plan = this._parseBannerPlan(clean);
    if (plan) metadata.plan = plan;

    const cwdMatch = clean.match(/\n\s*(\/[^\n]+)\n/);
    if (cwdMatch) metadata.cwd = this.stripBoxChars(cwdMatch[1]);

    const model = this._parseBannerModel(clean);
    if (model) metadata.model = model;

    metadata.cli = 'agy';
    return Object.keys(metadata).length > 1 ? metadata : { cli: 'agy' };
  }

  /**
   * Lightweight keepalive to prevent session expiration.
   * Sends escape key to maintain the PTY session without triggering API calls.
   *
   * @returns {Promise<boolean>} True if keepalive succeeded
   */
  async keepalive() {
    if (this.freshProcess) {
      console.log(`[${this.name}] Keepalive skipped (fresh process mode)`);
      return true;
    }

    if (!this.shell || !this.processReady) {
      console.log(`[${this.name}] Keepalive: spawning process...`);
      await this.spawnProcess();
    }

    if (this.shell) {
      console.log(`[${this.name}] Keepalive: sending ping...`);
      // Send escape key to dismiss any UI and trigger activity
      this.shell.write('\x1b');
      return true;
    }

    return false;
  }
}

module.exports = { AgyAgent };
