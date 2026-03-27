const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const OAUTH_TOKEN_ENDPOINT = 'https://platform.claude.com/v1/oauth/token';
const OAUTH_CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
// Refresh 5 minutes before actual expiry to avoid race conditions
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Read OAuth credentials from the credentials file.
 * @param {string} credentialsPath
 * @returns {{ accessToken: string, refreshToken?: string, expiresAt?: number }|null}
 */
function readCredentialsFile(credentialsPath) {
  try {
    if (fs.existsSync(credentialsPath)) {
      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      const oauth = credentials.claudeAiOauth;
      if (oauth?.accessToken) {
        return {
          accessToken: oauth.accessToken,
          refreshToken: oauth.refreshToken || null,
          expiresAt: oauth.expiresAt || null,
        };
      }
    }
  } catch (_err) {
    // Fall through
  }
  return null;
}

/**
 * Read OAuth credentials from macOS Keychain.
 * @returns {{ accessToken: string, refreshToken?: string, expiresAt?: number }|null}
 */
function readKeychainCredentials() {
  if (process.platform !== 'darwin') return null;
  try {
    const result = execSync(
      'security find-generic-password -s "claude-code" -w 2>/dev/null',
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (result) {
      const oauth = JSON.parse(result).claudeAiOauth;
      if (oauth?.accessToken) {
        return {
          accessToken: oauth.accessToken,
          refreshToken: oauth.refreshToken || null,
          expiresAt: oauth.expiresAt || null,
        };
      }
    }
  } catch (_err) {
    // Keychain entry not found or error parsing
  }
  return null;
}

/**
 * Read OAuth credentials from Linux secret-tool.
 * @returns {{ accessToken: string, refreshToken?: string, expiresAt?: number }|null}
 */
function readSecretToolCredentials() {
  if (process.platform !== 'linux') return null;
  try {
    const result = execSync(
      'secret-tool lookup service claude-code 2>/dev/null',
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (result) {
      const oauth = JSON.parse(result).claudeAiOauth;
      if (oauth?.accessToken) {
        return {
          accessToken: oauth.accessToken,
          refreshToken: oauth.refreshToken || null,
          expiresAt: oauth.expiresAt || null,
        };
      }
    }
  } catch (_err) {
    // secret-tool not available or entry not found
  }
  return null;
}

/**
 * Read OAuth credentials from all available sources in priority order.
 * @returns {{ accessToken: string, refreshToken?: string, expiresAt?: number, source: string }|null}
 */
function readCredentials() {
  // 1. Environment variable (no refresh possible)
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { accessToken: process.env.CLAUDE_CODE_OAUTH_TOKEN, source: 'env' };
  }

  // 2. Credentials file
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const credentialsPath = path.join(homeDir, '.claude', '.credentials.json');
  const fileCreds = readCredentialsFile(credentialsPath);
  if (fileCreds) return { ...fileCreds, source: 'credentials_file' };

  // 3. macOS Keychain
  const keychainCreds = readKeychainCredentials();
  if (keychainCreds) return { ...keychainCreds, source: 'keychain' };

  // 4. Linux secret-tool
  const secretCreds = readSecretToolCredentials();
  if (secretCreds) return { ...secretCreds, source: 'secret_tool' };

  return null;
}

/**
 * Check if an access token is expired (or about to expire).
 * @param {number|null} expiresAt - Expiry timestamp in milliseconds
 * @returns {boolean}
 */
function isTokenExpired(expiresAt) {
  if (!expiresAt) return false; // No expiry info, assume valid
  return Date.now() >= expiresAt - TOKEN_EXPIRY_BUFFER_MS;
}

/**
 * Refresh the OAuth access token using the refresh token.
 * @param {string} refreshToken
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: number|null }|null>}
 */
function refreshOAuthToken(refreshToken) {
  return new Promise((resolve) => {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
    }).toString();

    const url = new URL(OAUTH_TOKEN_ENDPOINT);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.access_token) {
              resolve({
                accessToken: parsed.access_token,
                refreshToken: parsed.refresh_token || refreshToken,
                expiresAt: parsed.expires_in
                  ? Date.now() + parsed.expires_in * 1000
                  : null,
              });
              return;
            }
          } catch (_err) {
            // Fall through to resolve(null)
          }
        }
        resolve(null);
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });

    req.write(body);
    req.end();
  });
}

/**
 * Persist refreshed tokens back to the credentials file.
 * @param {{ accessToken: string, refreshToken: string, expiresAt: number|null }} tokens
 */
function persistRefreshedTokens(tokens) {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const credentialsPath = path.join(homeDir, '.claude', '.credentials.json');
  const raw = fs.readFileSync(credentialsPath, 'utf8');
  const credentials = JSON.parse(raw);
  credentials.claudeAiOauth = {
    ...credentials.claudeAiOauth,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    ...(tokens.expiresAt && { expiresAt: tokens.expiresAt }),
  };
  fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), 'utf8');
}

module.exports = {
  readCredentials,
  isTokenExpired,
  refreshOAuthToken,
  persistRefreshedTokens,
  OAUTH_TOKEN_ENDPOINT,
  OAUTH_CLIENT_ID,
  TOKEN_EXPIRY_BUFFER_MS,
};
