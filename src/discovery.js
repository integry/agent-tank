const { execSync } = require('node:child_process');
const logger = require('./logger.js');

async function discoverAgents() {
  const found = [];

  // Check for Claude with version requirement
  if (commandExists('claude')) {
    const version = getClaudeVersion();
    if (version) {
      if (version.major < 2) {
        logger.warn(`Claude Code version ${version.full} detected. Version 2.0+ required for /usage command.`);
        logger.warn('Please update: npm update -g @anthropic-ai/claude-code');
      } else {
        logger.success(`✅ Claude Code version ${version.full} detected`);
        found.push('claude');
      }
    } else {
      // If we can't determine version, add with warning
      logger.warn('Claude found but version unknown. Version 2.0+ required for /usage command.');
      found.push('claude');
    }
  }

  // Check for Antigravity CLI
  if (commandExists('agy')) {
    const version = getAgyVersion();
    if (version) {
      logger.success(`✅ Antigravity CLI version ${version.full} detected`);
    } else {
      logger.success('✅ Antigravity CLI detected (version unknown)');
    }
    found.push('agy');
  }

  // Check for Codex with version info
  if (commandExists('codex')) {
    const version = getCodexVersion();
    if (version) {
      logger.success(`✅ Codex CLI version ${version.full} detected`);
    } else {
      logger.success('✅ Codex CLI detected (version unknown)');
    }
    found.push('codex');
  }

  return found;
}

function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getClaudeVersion() {
  try {
    const output = execSync('claude --version 2>&1', { encoding: 'utf-8' });
    const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
    if (match) {
      return {
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        patch: parseInt(match[3]),
        full: match[0]
      };
    }
  } catch {
    // Version check failed
  }
  return null;
}

function getAgyVersion() {
  try {
    const output = execSync('agy --version 2>&1', { encoding: 'utf-8' });
    const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
    if (match) {
      return {
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        patch: parseInt(match[3]),
        full: match[0]
      };
    }
  } catch {
    // Version check failed
  }
  return null;
}

function getCodexVersion() {
  try {
    const output = execSync('codex --version 2>&1', { encoding: 'utf-8' });
    const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
    if (match) {
      return {
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        patch: parseInt(match[3]),
        full: match[0]
      };
    }
  } catch {
    // Version check failed
  }
  return null;
}

module.exports = { discoverAgents };
