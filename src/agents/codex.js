const { BaseAgent } = require('./base.js');

class CodexAgent extends BaseAgent {
  constructor() {
    super('codex', 'codex');
  }

  getTimeout() {
    return 25000; // 25 seconds
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

  // Detect update notification screen and select Skip option
  handleUpdateScreen(shell, output) {
    const clean = this.stripAnsi(output);

    // Detect Codex update screen format:
    // "Update available! X.X.X -> Y.Y.Y"
    // "› 1. Update now"
    // "  2. Skip"
    // "  3. Skip until next version"
    // Note: First char may be cut off ("pdate available" instead of "Update available")
    // Note: Text may be concatenated without proper spacing after ANSI stripping
    const hasUpdateAvailable = /u?pdate available/i.test(clean);
    const hasVersionArrow = /[\d.]+\s*->\s*[\d.]+/.test(clean);
    // Also check for "Skip" with various patterns - may appear as "2.Skip" or just "Skip"
    const hasSkipOption = /skip/i.test(clean);

    if (hasUpdateAvailable && hasVersionArrow && hasSkipOption) {
      console.log(`[${this.name}] Detected update screen, selecting '2' to skip...`);
      // Send '2' to select Skip option, then Enter to confirm
      shell.write('2');
      setTimeout(() => shell.write('\r'), 300);
      return true;
    }

    return false;
  }

  // Parse version info from output (update screen or regular output)
  parseVersionInfo(output) {
    const clean = this.stripAnsi(output);
    const versionInfo = {};

    // First check for update screen format: "0.87.0 -> 0.89.0"
    const updateScreenMatch = clean.match(/([\d.]+)\s*->\s*([\d.]+)/);
    if (updateScreenMatch) {
      versionInfo.current = updateScreenMatch[1];
      versionInfo.latest = updateScreenMatch[2];
      return versionInfo;
    }

    // Extract current version from header: "OpenAI Codex (v0.87.0)"
    const currentMatch = clean.match(/OpenAI Codex[^\(]*\(v?([\d.]+)\)/i);
    if (currentMatch) {
      versionInfo.current = currentMatch[1];
    }

    // Extract new version from update notification
    // Patterns like: "v0.88.0 available", "new version: 0.88.0", "update to 0.88.0"
    const newVersionPatterns = [
      /v?([\d.]+)\s*(?:is\s+)?available/i,
      /new version[:\s]+v?([\d.]+)/i,
      /update to v?([\d.]+)/i,
      /latest[:\s]+v?([\d.]+)/i
    ];

    for (const pattern of newVersionPatterns) {
      const match = clean.match(pattern);
      if (match && match[1] !== versionInfo.current) {
        versionInfo.latest = match[1];
        break;
      }
    }

    return Object.keys(versionInfo).length > 0 ? versionInfo : null;
  }

  // Override to handle Codex's specific prompt flow
  async runCommand() {
    const pty = require('node-pty');

    return new Promise((resolve, reject) => {
      let output = '';
      let completed = false;
      let statusSent = false;
      let trustHandled = false;
      let continuationHandled = false;
      let updateHandled = false;

      console.log(`[${this.name}] Spawning: ${this.command} ${this.args.join(' ')}`);

      const shell = pty.spawn(this.command, this.args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        cwd: '/tmp',
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          console.log(`[${this.name}] Timeout after ${this.getTimeout()}ms, output length: ${output.length}`);
          if (output.length > 0) {
            console.log(`[${this.name}] Partial output:`, this.stripAnsi(output).substring(0, 500));
            // Write full output for debugging
            require('fs').writeFileSync(`/tmp/${this.name}-output.txt`, output);
            console.log(`[${this.name}] Full output written to /tmp/${this.name}-output.txt`);
          }
          shell.kill();
          if (output.length > 100) {
            resolve(output);
          } else {
            reject(new Error('Timeout waiting for usage data'));
          }
        }
      }, this.getTimeout());

      shell.onData((data) => {
        output += data;

        // Log first data received
        if (output.length <= data.length) {
          console.log(`[${this.name}] First data received (${data.length} chars)`);
          if (data.length < 200) {
            console.log(`[${this.name}] Initial output:`, this.stripAnsi(data).substring(0, 100));
          }
        }

        // Handle trust prompt if needed (only once)
        if (!trustHandled && this.handleTrustPrompt(shell, output)) {
          trustHandled = true;
          return;
        }

        // Handle update notification screen (only once)
        if (!updateHandled && this.handleUpdateScreen(shell, output)) {
          updateHandled = true;
          return;
        }

        // Respond to cursor position query (CSI 6n)
        if (data.includes('\x1b[6n') || data.includes('[6n')) {
          console.log(`[${this.name}] Responding to cursor position query`);
          shell.write('\x1b[1;1R');
        }

        // Handle approval prompt for non-git directories (only once)
        // But NOT if this is part of an update screen (which has its own handler)
        const cleanOutput = this.stripAnsi(output);
        const isUpdateScreen = /u?pdate available/i.test(cleanOutput) && /[\d.]+\s*->\s*[\d.]+/.test(cleanOutput);
        if (!continuationHandled && !isUpdateScreen && output.includes('Press enter to continue')) {
          console.log(`[${this.name}] Detected continuation prompt`);
          continuationHandled = true;
          shell.write('\r');
        }

        // Send /status when fully ready (model loaded and prompt shown)
        if (!statusSent && (output.includes('gpt-') || output.includes('OpenAI Codex')) &&
            (output.includes('? for shortcuts') || output.includes('To get started'))) {
          console.log(`[${this.name}] Ready for commands, sending /status...`);
          statusSent = true;
          // Type /status then press Enter separately
          setTimeout(() => {
            shell.write('/status');
          }, 1000);
          setTimeout(() => {
            shell.write('\r');
          }, 1500);
        }

        // Check for complete output
        if (statusSent && this.hasCompleteOutput(output)) {
          console.log(`[${this.name}] Complete output detected, finishing...`);
          setTimeout(() => {
            if (!completed) {
              completed = true;
              clearTimeout(timer);
              shell.kill();
              resolve(output);
            }
          }, 300);
        }
      });

      shell.onExit(({ exitCode }) => {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          console.log(`[${this.name}] Process exited with code ${exitCode}, output length: ${output.length}`);
          // Save output for debugging
          require('fs').writeFileSync(`/tmp/${this.name}-output.txt`, output);
          if (output) {
            resolve(output);
          } else {
            reject(new Error(`Process exited with code ${exitCode}`));
          }
        }
      });
    });
  }

  hasCompleteOutput(output) {
    return output.includes('5h limit') && output.includes('Weekly limit');
  }

  // Convert reset timestamp to duration object with string and seconds
  // Returns: { text: "5h 30m", seconds: 19800 } or null
  parseResetTime(resetStr) {
    if (!resetStr) return null;

    const now = new Date();
    let resetDate;

    // Format: "HH:MM" (today) or "HH:MM on DD Mon"
    const timeOnDateMatch = resetStr.match(/(\d{1,2}):(\d{2})\s*on\s*(\d{1,2})\s*(\w+)/i);
    const timeOnlyMatch = resetStr.match(/^(\d{1,2}):(\d{2})$/);

    if (timeOnDateMatch) {
      const [, hours, minutes, day, month] = timeOnDateMatch;
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthIndex = monthNames.indexOf(month.toLowerCase().substring(0, 3));
      resetDate = new Date(now.getFullYear(), monthIndex, parseInt(day), parseInt(hours), parseInt(minutes));
      // If the date is in the past, it's next year
      if (resetDate < now) {
        resetDate.setFullYear(resetDate.getFullYear() + 1);
      }
    } else if (timeOnlyMatch) {
      const [, hours, minutes] = timeOnlyMatch;
      resetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(hours), parseInt(minutes));
      // If time is in the past, it's tomorrow
      if (resetDate < now) {
        resetDate.setDate(resetDate.getDate() + 1);
      }
    } else {
      return { text: resetStr, seconds: null }; // Return original if can't parse
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

  parseOutput(output) {
    const clean = this.stripAnsi(output);
    const usage = {
      fiveHour: null,
      weekly: null,
      version: this.parseVersionInfo(output),
    };

    // Parse 5h limit: "5h limit:   [████...] XX% left (resets HH:MM)"
    const fiveHourMatch = clean.match(/5h limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i);
    if (fiveHourMatch) {
      const percentLeft = parseFloat(fiveHourMatch[1]);
      const resetsAt = fiveHourMatch[2].trim();
      const resetData = this.parseResetTime(resetsAt);
      usage.fiveHour = {
        percentLeft,
        resetsAt,
        label: '5h limit',
        // Normalized fields for consistent display
        percentUsed: 100 - percentLeft,
        resetsIn: resetData?.text || null,
        resetsInSeconds: resetData?.seconds || null,
      };
    }

    // Parse Weekly limit: "Weekly limit:   [░░...] XX% left (resets HH:MM)"
    const weeklyMatch = clean.match(/Weekly limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i);
    if (weeklyMatch) {
      const percentLeft = parseFloat(weeklyMatch[1]);
      const resetsAt = weeklyMatch[2].trim();
      const resetData = this.parseResetTime(resetsAt);
      usage.weekly = {
        percentLeft,
        resetsAt,
        label: 'Weekly limit',
        // Normalized fields for consistent display
        percentUsed: 100 - percentLeft,
        resetsIn: resetData?.text || null,
        resetsInSeconds: resetData?.seconds || null,
      };
    }

    // Parse model-specific limit sections (e.g. "GPT-5.3-Codex-Spark limit:")
    // These appear after the main limits with their own 5h/Weekly entries
    // The header line may have box-drawing chars and trailing whitespace:
    //   │ GPT-5.3-Codex-Spark limit:                    │
    const modelHeaderRegex = /([\w][\w.-]+)\s+limit:\s*[│╮╯]?/gi;
    const limitRegex = /5h limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i;
    const weeklyLimitRegex = /Weekly limit:\s*\[.*?\]\s*(\d+)%\s*left\s*\(resets\s*([^)]+)\)/i;

    const modelLimits = [];
    let headerMatch;
    while ((headerMatch = modelHeaderRegex.exec(clean)) !== null) {
      const name = headerMatch[1];
      // Skip the known non-model headers (5h, Weekly are limit types, not model names)
      if (/^(5h|Weekly)$/i.test(name)) continue;

      // Extract the section after this header until the next model header or end of box
      const sectionStart = headerMatch.index + headerMatch[0].length;
      // Look for the next model-name header or end of box
      // Only match model-name headers (contain a dash), not "5h limit" or "Weekly limit"
      const remaining = clean.substring(sectionStart);
      const nextHeader = remaining.search(/[\w][\w.-]*-[\w.-]+\s+limit:/i);
      const endBox = remaining.indexOf('╰');
      let sectionEnd = remaining.length;
      if (nextHeader > 0 && (endBox < 0 || nextHeader < endBox)) sectionEnd = nextHeader;
      else if (endBox > 0) sectionEnd = endBox;
      const content = remaining.substring(0, sectionEnd);

      const entry = { name };
      const fh = content.match(limitRegex);
      if (fh) {
        const percentLeft = parseFloat(fh[1]);
        const resetsAt = fh[2].trim();
        const resetData = this.parseResetTime(resetsAt);
        entry.fiveHour = {
          percentLeft, resetsAt, label: '5h limit',
          percentUsed: 100 - percentLeft,
          resetsIn: resetData?.text || null,
          resetsInSeconds: resetData?.seconds || null,
        };
      }
      const wk = content.match(weeklyLimitRegex);
      if (wk) {
        const percentLeft = parseFloat(wk[1]);
        const resetsAt = wk[2].trim();
        const resetData = this.parseResetTime(resetsAt);
        entry.weekly = {
          percentLeft, resetsAt, label: 'Weekly limit',
          percentUsed: 100 - percentLeft,
          resetsIn: resetData?.text || null,
          resetsInSeconds: resetData?.seconds || null,
        };
      }
      if (entry.fiveHour || entry.weekly) {
        modelLimits.push(entry);
      }
    }
    if (modelLimits.length > 0) {
      usage.modelLimits = modelLimits;
    }

    // Extract model info
    const modelMatch = clean.match(/Model:\s*(gpt-[\w.-]+)/i);
    if (modelMatch) {
      usage.model = modelMatch[1].trim();
    }

    // Extract account info
    const accountMatch = clean.match(/Account:\s*(\S+@\S+)/i);
    if (accountMatch) {
      usage.account = accountMatch[1].trim();
    }

    return usage;
  }
}

module.exports = { CodexAgent };
