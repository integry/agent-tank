/**
 * Shared helper for pingKeepalive functionality.
 * Extracts common PTY-based keepalive logic to reduce code duplication.
 */

const pty = require('node-pty');

/**
 * Spawns a fresh CLI process, sends a command to refresh the session token,
 * then tears down the process cleanly. This is a silent operation that
 * does not affect the main usage/error state.
 *
 * @param {object} config - Configuration for the keepalive ping
 * @param {string} config.name - Agent name for logging
 * @param {string} config.command - CLI command to spawn
 * @param {string[]} config.args - Arguments for the CLI command
 * @param {object} config.env - Environment variables for the process
 * @param {string} config.termName - Terminal name (e.g., 'xterm-color', 'xterm-256color')
 * @param {function} config.isReady - Function to check if CLI is ready for commands
 * @param {function} config.sendCommand - Function to send the keepalive command
 * @param {function} config.isComplete - Function to check if response is complete
 * @param {function} [config.handlePrompts] - Optional function to handle interactive prompts
 * @param {function} [config.respondToTerminalQueries] - Optional function to respond to terminal queries
 * @param {number} [config.timeout=10000] - Timeout in milliseconds
 * @returns {Promise<boolean>} True if the ping succeeded
 */
async function pingKeepalive(config) {
  const {
    name,
    command,
    args,
    env,
    termName,
    isReady,
    sendCommand,
    isComplete,
    handlePrompts,
    respondToTerminalQueries,
    timeout = 10000,
  } = config;

  console.log(`[${name}] pingKeepalive: spawning fresh process for session refresh...`);

  return new Promise((resolve) => {
    let shell = null;
    let output = '';
    let commandsSent = false;
    let completed = false;

    const cleanup = (success) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      if (shell) {
        try { shell.kill(); } catch (_e) { /* Process may already be dead */ }
      }
      console.log(`[${name}] pingKeepalive: ${success ? 'succeeded' : 'failed'}`);
      resolve(success);
    };

    const timer = setTimeout(() => {
      console.log(`[${name}] pingKeepalive: timeout after ${timeout / 1000}s`);
      cleanup(false);
    }, timeout);

    try {
      shell = pty.spawn(command, args, {
        name: termName,
        cols: 120,
        rows: 40,
        cwd: '/tmp',
        env,
      });
    } catch (spawnErr) {
      console.error(`[${name}] pingKeepalive: spawn failed: ${spawnErr.message}`);
      cleanup(false);
      return;
    }

    shell.onData((data) => {
      output += data;

      // Handle interactive prompts if handler provided
      if (handlePrompts) {
        handlePrompts(shell, data, output);
      }

      // Respond to terminal capability queries if handler provided
      if (respondToTerminalQueries) {
        respondToTerminalQueries(data, shell);
      }

      // Wait for CLI to be ready, then send command
      if (!commandsSent && isReady(output)) {
        console.log(`[${name}] pingKeepalive: CLI ready, sending command...`);
        commandsSent = true;
        sendCommand(shell);
      }

      // Check if response is complete
      if (commandsSent && isComplete(output)) {
        console.log(`[${name}] pingKeepalive: response received`);
        setTimeout(() => cleanup(true), 100);
      }
    });

    shell.onExit(({ exitCode }) => {
      console.log(`[${name}] pingKeepalive: process exited with code ${exitCode}`);
      // Consider success if we sent commands (session was refreshed)
      cleanup(commandsSent);
    });
  });
}

module.exports = { pingKeepalive };
