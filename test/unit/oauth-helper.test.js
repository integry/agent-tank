/**
 * Unit tests for OAuth helper functions
 */

jest.mock('node-pty', () => ({
  spawn: jest.fn()
}), { virtual: true });

const fs = require('fs');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');

const {
  readCredentials,
  isTokenExpired,
  refreshOAuthToken,
  persistRefreshedTokens,
  TOKEN_EXPIRY_BUFFER_MS,
} = require('../../src/agents/oauth-helper.js');

describe('oauth-helper', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('readCredentials', () => {
    it('returns env token when CLAUDE_CODE_OAUTH_TOKEN is set', () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'env-token-123';

      const creds = readCredentials();

      expect(creds).toEqual({
        accessToken: 'env-token-123',
        source: 'env',
      });
    });

    it('returns credentials from file when env var not set', () => {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'oauth-test-'));
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, '.credentials.json'), JSON.stringify({
        claudeAiOauth: {
          accessToken: 'file-token',
          refreshToken: 'file-refresh',
          expiresAt: 9999999999999,
        }
      }));
      process.env.HOME = tmpDir;

      const creds = readCredentials();

      expect(creds.accessToken).toBe('file-token');
      expect(creds.refreshToken).toBe('file-refresh');
      expect(creds.expiresAt).toBe(9999999999999);
      expect(creds.source).toBe('credentials_file');

      fs.rmSync(tmpDir, { recursive: true });
    });

    it('returns null when no credentials found', () => {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      process.env.HOME = '/nonexistent';
      delete process.env.USERPROFILE;

      const creds = readCredentials();

      expect(creds).toBeNull();
    });

    it('returns null when credentials file has no accessToken', () => {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'oauth-test-'));
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, '.credentials.json'), JSON.stringify({
        claudeAiOauth: {}
      }));
      process.env.HOME = tmpDir;

      const creds = readCredentials();

      expect(creds).toBeNull();

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe('isTokenExpired', () => {
    it('returns false when expiresAt is null', () => {
      expect(isTokenExpired(null)).toBe(false);
    });

    it('returns false when token is not expired', () => {
      const futureTime = Date.now() + 60 * 60 * 1000; // 1 hour from now
      expect(isTokenExpired(futureTime)).toBe(false);
    });

    it('returns true when token is expired', () => {
      const pastTime = Date.now() - 1000;
      expect(isTokenExpired(pastTime)).toBe(true);
    });

    it('returns true when token expires within buffer period', () => {
      // Expires in 2 minutes, but buffer is 5 minutes
      const nearFuture = Date.now() + 2 * 60 * 1000;
      expect(isTokenExpired(nearFuture)).toBe(true);
    });

    it('returns false when token expires after buffer period', () => {
      const afterBuffer = Date.now() + TOKEN_EXPIRY_BUFFER_MS + 60000;
      expect(isTokenExpired(afterBuffer)).toBe(false);
    });
  });

  describe('refreshOAuthToken', () => {
    let mockRequest;
    let mockResponse;

    beforeEach(() => {
      mockResponse = new EventEmitter();
      mockResponse.statusCode = 200;
      mockRequest = new EventEmitter();
      mockRequest.write = jest.fn();
      mockRequest.end = jest.fn();
      mockRequest.destroy = jest.fn();

      jest.spyOn(https, 'request').mockImplementation((_opts, callback) => {
        callback(mockResponse);
        return mockRequest;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns new tokens on successful refresh', async () => {
      const responseBody = JSON.stringify({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      });

      const promise = refreshOAuthToken('old-refresh-token');
      mockResponse.emit('data', responseBody);
      mockResponse.emit('end');

      const result = await promise;

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('keeps original refresh token if not returned in response', async () => {
      const responseBody = JSON.stringify({
        access_token: 'new-access-token',
        expires_in: 3600,
      });

      const promise = refreshOAuthToken('original-refresh');
      mockResponse.emit('data', responseBody);
      mockResponse.emit('end');

      const result = await promise;

      expect(result.refreshToken).toBe('original-refresh');
    });

    it('returns null on non-200 status', async () => {
      mockResponse.statusCode = 400;

      const promise = refreshOAuthToken('bad-token');
      mockResponse.emit('data', '{"error":"invalid_grant"}');
      mockResponse.emit('end');

      const result = await promise;

      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      const promise = refreshOAuthToken('some-token');
      mockRequest.emit('error', new Error('ECONNREFUSED'));

      const result = await promise;

      expect(result).toBeNull();
    });

    it('returns null on timeout', async () => {
      const promise = refreshOAuthToken('some-token');
      mockRequest.emit('timeout');

      const result = await promise;

      expect(result).toBeNull();
      expect(mockRequest.destroy).toHaveBeenCalled();
    });

    it('sends correct request body', async () => {
      const responseBody = JSON.stringify({ access_token: 'tok' });

      const promise = refreshOAuthToken('my-refresh-token');
      mockResponse.emit('data', responseBody);
      mockResponse.emit('end');
      await promise;

      const body = JSON.parse(mockRequest.write.mock.calls[0][0]);
      expect(body.grant_type).toBe('refresh_token');
      expect(body.refresh_token).toBe('my-refresh-token');
      expect(body.client_id).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
      expect(body.scope).toContain('user:inference');
    });
  });

  describe('persistRefreshedTokens', () => {
    it('updates credentials file with new tokens', () => {
      const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'oauth-test-'));
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      const credPath = path.join(claudeDir, '.credentials.json');
      fs.writeFileSync(credPath, JSON.stringify({
        claudeAiOauth: {
          accessToken: 'old-token',
          refreshToken: 'old-refresh',
          expiresAt: 1000,
          scopes: ['user:inference'],
        }
      }));

      const origHome = process.env.HOME;
      process.env.HOME = tmpDir;

      persistRefreshedTokens({
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        expiresAt: 9999999999999,
      });

      process.env.HOME = origHome;

      const updated = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      expect(updated.claudeAiOauth.accessToken).toBe('new-token');
      expect(updated.claudeAiOauth.refreshToken).toBe('new-refresh');
      expect(updated.claudeAiOauth.expiresAt).toBe(9999999999999);
      // Preserves other fields
      expect(updated.claudeAiOauth.scopes).toEqual(['user:inference']);

      fs.rmSync(tmpDir, { recursive: true });
    });

    it('throws when credentials file does not exist', () => {
      const origHome = process.env.HOME;
      process.env.HOME = '/nonexistent';

      expect(() => persistRefreshedTokens({
        accessToken: 'x',
        refreshToken: 'y',
        expiresAt: 1,
      })).toThrow();

      process.env.HOME = origHome;
    });
  });
});
