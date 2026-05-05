const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GEMINI_DIR = '.gemini';
const OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9' + 'e3aqf6av3hmdib135j.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = 'GOCSPX-4uHgMPm-1o7Sk-' + 'geV6Cu5clXFsxl';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal';
const REFRESH_SKEW_MS = 60 * 1000;
const VALID_GEMINI_MODES = new Set(['pty', 'direct', 'fallback']);

function getGeminiHomeDir() {
  return path.join(os.homedir(), GEMINI_DIR);
}

function getOAuthCredsPath() {
  return path.join(getGeminiHomeDir(), 'oauth_creds.json');
}

function getGoogleAccountsPath() {
  return path.join(getGeminiHomeDir(), 'google_accounts.json');
}

function normalizeGeminiMode(mode) {
  const normalized = typeof mode === 'string' ? mode.toLowerCase() : 'fallback';
  return VALID_GEMINI_MODES.has(normalized) ? normalized : 'fallback';
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function formatDurationFromSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '0m';
  }

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${Math.max(1, minutes)}m`;
}

function parseResetTime(resetTime) {
  if (!resetTime) {
    return { resetsIn: null, resetsInSeconds: null };
  }

  const resetAtMs = Date.parse(resetTime);
  if (!Number.isFinite(resetAtMs)) {
    return { resetsIn: null, resetsInSeconds: null };
  }

  const resetsInSeconds = Math.max(0, Math.round((resetAtMs - Date.now()) / 1000));
  return {
    resetsIn: formatDurationFromSeconds(resetsInSeconds),
    resetsInSeconds,
  };
}

function buildModelEntry(bucket) {
  if (!bucket || !bucket.modelId || bucket.remainingFraction == null) {
    return null;
  }

  const usageLeft = Number((bucket.remainingFraction * 100).toFixed(1));
  const percentUsed = Number((100 - usageLeft).toFixed(1));
  const { resetsIn, resetsInSeconds } = parseResetTime(bucket.resetTime);

  return {
    model: bucket.modelId,
    usageLeft,
    percentUsed,
    resetsIn,
    resetsInSeconds,
  };
}

function buildUsageFromQuota(quotaResponse) {
  const seenModels = new Set();
  const models = [];

  for (const bucket of quotaResponse?.buckets || []) {
    const entry = buildModelEntry(bucket);
    if (!entry || seenModels.has(entry.model)) {
      continue;
    }
    seenModels.add(entry.model);
    models.push(entry);
  }

  return { models };
}

class GeminiDirectQuotaClient {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.now = options.now || Date.now;
  }

  _readOAuthCredentials() {
    const creds = readJsonIfExists(getOAuthCredsPath());
    if (!creds) {
      throw new Error(`Gemini OAuth credentials not found at ${getOAuthCredsPath()}`);
    }
    return creds;
  }

  _readActiveAccountEmail() {
    const accounts = readJsonIfExists(getGoogleAccountsPath());
    return accounts?.active || null;
  }

  async _getAccessToken() {
    const creds = this._readOAuthCredentials();
    const expiryDate = Number(creds.expiry_date);
    const accessToken = creds.access_token;

    if (accessToken && Number.isFinite(expiryDate) && expiryDate - REFRESH_SKEW_MS > this.now()) {
      return accessToken;
    }

    if (!creds.refresh_token) {
      throw new Error('Gemini OAuth credentials are missing a refresh token');
    }

    const body = new URLSearchParams({
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    });

    const response = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to refresh Gemini OAuth token (${response.status}): ${text || response.statusText}`);
    }

    const refreshed = await response.json();
    const updatedCreds = {
      ...creds,
      access_token: refreshed.access_token,
      expiry_date: refreshed.expires_in ? this.now() + (refreshed.expires_in * 1000) : creds.expiry_date,
      token_type: refreshed.token_type || creds.token_type,
      scope: refreshed.scope || creds.scope,
    };

    fs.writeFileSync(getOAuthCredsPath(), JSON.stringify(updatedCreds, null, 2));
    return updatedCreds.access_token;
  }

  async _post(method, token, payload) {
    const response = await this.fetchImpl(`${CODE_ASSIST_ENDPOINT}:${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini ${method} request failed (${response.status}): ${text || response.statusText}`);
    }

    return response.json();
  }

  async fetchQuotaUsage() {
    const token = await this._getAccessToken();
    const configuredProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;

    const loadResponse = await this._post('loadCodeAssist', token, {
      cloudaicompanionProject: configuredProject,
      metadata: {
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI',
        duetProject: configuredProject,
      },
      mode: 'HEALTH_CHECK',
    });

    const project = loadResponse?.cloudaicompanionProject || configuredProject;
    if (!project) {
      throw new Error('Gemini Code Assist project ID is unavailable');
    }

    const quotaResponse = await this._post('retrieveUserQuota', token, { project });
    const usage = buildUsageFromQuota(quotaResponse);

    return {
      usage,
      metadata: {
        email: this._readActiveAccountEmail(),
        authMethod: 'OAuth',
        tier: loadResponse?.paidTier?.name || loadResponse?.currentTier?.name,
        project,
      },
    };
  }
}

module.exports = {
  GeminiDirectQuotaClient,
  buildModelEntry,
  buildUsageFromQuota,
  formatDurationFromSeconds,
  normalizeGeminiMode,
};
