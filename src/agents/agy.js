const { BaseAgent } = require('./base.js');
const { calculatePace } = require('../pace-evaluator.js');
const { CYCLE_DURATIONS } = require('../usage-formatters.js');
const logger = require('../logger.js');

class AgyAgent extends BaseAgent {
  constructor() {
    super('agy', 'agy', ['--dangerously-skip-permissions']);
    this._aboutSent = false;
  }

  getTimeout() {
    return 35000; // Antigravity can take 10+ seconds to start and sign in
  }

  getEnv() {
    // Use xterm-256color for proper terminal support
    // Antigravity CLI needs good terminal emulation for its TUI
    return {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    };
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

    if (this._hasReadyPrompt(clean) || /signing in/i.test(clean)) {
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
    if (/Model\s+Quota/i.test(clean)) {
      return /(?:Gemini|Claude|GPT)[\s\S]*\d+(?:\.\d+)?%/i.test(clean);
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
    setTimeout(() => shell.write('/usage'), 200);
    setTimeout(() => shell.write('\r'), 600);
  }

  // Calculate pace data for a model entry when reset timing is available.
  _addPaceData(entry, resetsInSeconds) {
    const cycleDuration = CYCLE_DURATIONS.sessionAgy;
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
    if (!/Model\s+Quota/i.test(clean)) return;

    const lines = clean.split('\n').map(line => line.trim()).filter(Boolean);
    const knownMarkers = new Set([
      'Model Quota',
      'Quota available',
      '? for shortcuts',
    ]);

    for (let i = 0; i < lines.length; i++) {
      const modelLine = lines[i];
      if (knownMarkers.has(modelLine) || /^(?:[>└]|[-─↑/↓]|esc\s+to\s+cancel)/i.test(modelLine)) {
        continue;
      }
      if (!/[A-Za-z]/.test(modelLine) || /\d+\s*%/.test(modelLine)) {
        continue;
      }

      const percentLine = lines[i + 1] || '';
      const percentMatch = percentLine.match(/(\d+(?:\.\d+)?)\s*%/);
      if (!percentMatch) {
        continue;
      }

      const usageLeft = parseFloat(percentMatch[1]);
      const percentUsed = Number((100 - usageLeft).toFixed(1));
      const resetLine = lines[i + 2] || '';
      const resetMatch = resetLine.match(/(?:resets?|available)\s*(?:in|at)?\s*([0-9dhm\s]+)?/i);
      const resetsIn = resetMatch?.[1]?.trim() || null;
      const resetsInSeconds = resetsIn ? this.parseDurationToSeconds(resetsIn) : null;

      if (!usage.models.find(m => m.model === modelLine)) {
        const modelEntry = { model: modelLine, usageLeft, percentUsed, resetsIn, resetsInSeconds };
        this._addPaceData(modelEntry, resetsInSeconds);
        usage.models.push(modelEntry);
      }
    }
  }

  async fetchMetadata() {
    if (this._aboutSent) {
      return this.metadata;
    }

    this._aboutSent = true;
    return this._parseAgyMetadata(this.output);
  }

  _parseAgyMetadata(output) {
    const clean = this.stripAnsi(output);
    const metadata = {};

    const versionMatch = clean.match(/Antigravity\s+CLI\s+v?([\d.]+)/i);
    if (versionMatch) metadata.version = versionMatch[1];

    const emailMatch = clean.match(/(\S+@\S+)/);
    if (emailMatch) metadata.email = this.stripBoxChars(emailMatch[1]);

    const cwdMatch = clean.match(/\n\s*(\/[^\n]+)\n/);
    if (cwdMatch) metadata.cwd = this.stripBoxChars(cwdMatch[1]);

    const modelMatch = clean.match(/((?:Gemini|Claude|GPT)[^\n]+?)\s+\((?:Google AI|[^)]*Pro|[^)]*Free|[^)]*)\)/i)
      || clean.match(/\?\s+for\s+shortcuts\s+(.+?)(?:\n|$)/i);
    if (modelMatch) metadata.model = this.stripBoxChars(modelMatch[1]);

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
