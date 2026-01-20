const { execSync } = require('node:child_process');

async function discoverAgents() {
  const found = [];

  // Check for Claude
  if (commandExists('claude')) {
    found.push('claude');
  }

  // Check for Gemini
  if (commandExists('gemini')) {
    found.push('gemini');
  }

  // Check for Codex
  if (commandExists('codex')) {
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

module.exports = { discoverAgents };
