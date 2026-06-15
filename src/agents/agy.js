const { BaseAgent } = require('./base.js');
const { calculatePace } = require('../pace-evaluator.js');
const { CYCLE_DURATIONS } = require('../usage-formatters.js');
const logger = require('../logger.js');

class AgyAgent extends BaseAgent {
  // Matches both the older "Model Quota" screen and the newer grouped
  // "Models & Quota" screen reported by recent Antigravity CLI builds.
  static QUOTA_HEADER = /Models?\s*&?\s*Quota/i;

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
    setTimeout(() => shell.write('/usage'), 200);
    setTimeout(() => shell.write('\r'), 600);
  }

  // Convert an ALL-CAPS Antigravity group header (e.g. "CLAUDE AND GPT") into a
  // readable label ("Claude and GPT"), preserving known acronyms and lowercasing
  // connective words.
  _formatGroupName(raw) {
    const acronyms = new Set(['GPT', 'GPU', 'AI', 'CLI', 'API', 'OSS']);
    const connectives = new Set(['and', 'or', 'of', 'the', 'for', 'with']);
    return raw
      .split(/\s+/)
      .map((word, idx) => {
        const upper = word.toUpperCase();
        if (acronyms.has(upper)) return upper;
        const lower = word.toLowerCase();
        if (idx > 0 && connectives.has(lower)) return lower;
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(' ');
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
    if (!AgyAgent.QUOTA_HEADER.test(clean)) return;

    const lines = clean.split('\n').map(line => line.trim()).filter(Boolean);
    const knownMarkers = new Set([
      'Model Quota',
      'Models & Quota',
      'Quota available',
      '? for shortcuts',
    ]);

    // Newer Antigravity builds group quotas under section headers such as
    // "GEMINI MODELS" / "CLAUDE AND GPT MODELS", with each group reporting its
    // own "Weekly Limit" and "Five Hour Limit". Track the active group so those
    // generic labels can be qualified and not collapsed into a single entry.
    let currentGroup = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const groupMatch = line.match(/^([A-Z][A-Z0-9 &/-]*?)\s+MODELS$/);
      if (groupMatch) {
        currentGroup = this._formatGroupName(groupMatch[1].trim());
        continue;
      }

      if (knownMarkers.has(line) || /^(?:[>└│]|[-─↑/↓]|esc\s+to\s+cancel)/i.test(line)) {
        continue;
      }
      // Descriptive lines that are not models (e.g. "Account: ...",
      // "Models within this group: ...").
      if (/^(?:Account|Models within this group)\s*:/i.test(line)) {
        continue;
      }
      if (!/[A-Za-z]/.test(line) || /\d+\s*%/.test(line)) {
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

      // Qualify shared limit labels with their group so entries from different
      // groups stay distinct; per-model labels are already unique on their own.
      const isSharedLimit = /^(?:weekly|five[\s-]?hour|5[\s-]?hour|daily|hourly)\b/i.test(line);
      const modelName = (currentGroup && isSharedLimit)
        ? `${currentGroup} · ${line}`
        : line;

      if (!usage.models.find(m => m.model === modelName)) {
        const modelEntry = { model: modelName, usageLeft, percentUsed, resetsIn, resetsInSeconds };
        if (currentGroup) modelEntry.group = currentGroup;
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
