const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseApiResponse } = require('./api-response-parser');

// Claude can render its primary quotas before the model allowance arrives.
// Its own structured response cache can fill that row without another request.
// Accept only the current account and the CLI's short-lived (one minute) data.
function readRecentFableAllowance(configPath, now = Date.now()) {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return null;
  const directory = configPath || process.env.CLAUDE_CONFIG_DIR;
  const file = directory ? path.join(directory, '.claude.json') : path.join(os.homedir(), '.claude.json');
  try {
    const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cache = profile.cachedUsageUtilization;
    if (!cache || !Number.isFinite(cache.fetchedAtMs)) return null;
    const age = now - cache.fetchedAtMs;
    if (age < 0 || age > 60000 || !cache.accountUuid || cache.accountUuid !== profile.oauthAccount?.accountUuid) return null;
    const allowance = parseApiResponse(cache.utilization).weeklyFable;
    return allowance ? { ...allowance, sampledAt: new Date(cache.fetchedAtMs).toISOString() } : null;
  } catch {
    return null;
  }
}

module.exports = { readRecentFableAllowance };
