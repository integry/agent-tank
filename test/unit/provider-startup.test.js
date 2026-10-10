jest.mock('node-pty', () => ({ spawn: jest.fn() }));
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgyAgent } = require('../../src/agents/agy');
const { ClaudeAgent } = require('../../src/agents/claude');

test('native Antigravity reads the explicitly selected config through HOME/.gemini', () => {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-account-'));
  const agent = new AgyAgent({ configPath: config });
  try {
    fs.writeFileSync(path.join(config, 'account-marker'), 'selected-account');
    const env = agent.getEnv();
    expect(fs.readFileSync(path.join(env.HOME, '.gemini', 'account-marker'), 'utf8')).toBe('selected-account');
    expect(agent.getEnv().HOME).toBe(env.HOME);
    agent.killProcess();
    expect(fs.existsSync(env.HOME)).toBe(false);
    expect(fs.existsSync(path.join(config, 'account-marker'))).toBe(true);
  } finally {
    agent.killProcess();
    fs.rmSync(config, { recursive: true, force: true });
  }
});

test('default Antigravity keeps the external service HOME', () => {
  const agent = new AgyAgent();
  expect(agent.getEnv().HOME).toBe(process.env.HOME);
});

test.each([
  'Accessing workspace:\n❯ No, exit\nYes, I trust this folder\nEnter to confirm',
  'Accessingworkspace:\n❯No,exit\nYes,Itrustthisfolder\nEntertoconfirm',
])('Claude does not send usage into the new deny-by-default trust menu', screen => {
  jest.useFakeTimers();
  const agent = new ClaudeAgent();
  const shell = { write: jest.fn() };
  agent.shell = shell;
  expect(agent.isReadyForCommands(screen)).toBe(false);
  expect(agent.handleTrustPrompt(shell, screen)).toBe(true);
  jest.advanceTimersByTime(750);
  expect(shell.write).toHaveBeenCalledWith('\x1b[B');
  jest.advanceTimersByTime(250);
  expect(shell.write).toHaveBeenLastCalledWith('\r');
  jest.useRealTimers();
});

test('Claude waits for a slow Fable row instead of truncating at 2.5 seconds', async () => {
  jest.useFakeTimers();
  const agent = new ClaudeAgent();
  const initial = 'Current session\n0% used\nCurrent week (all models)\n19% used\nRefreshing…';
  agent.output = initial;
  try {
    const result = agent._waitForUsageDialogSettlement(initial);
    setTimeout(() => { agent.output += '\nCurrent week (Fable)\n17% used\nUsage credits are off'; }, 4000);
    await jest.advanceTimersByTimeAsync(4050);
    expect(agent.parseOutput(await result).weeklyFable.percent).toBe(17);
  } finally { jest.useRealTimers(); }
});

const { parseApiResponse } = require('../../src/agents/api-response-parser');
test('current OAuth limits reports the Fable allowance even when it is not the binding limit', () => {
  const usage = parseApiResponse({
    five_hour: { utilization: 1 }, seven_day: { utilization: 19 },
    limits: [
      { kind: 'session', percent: 1, resets_at: '2026-10-09T18:10:00Z' },
      { kind: 'weekly_all', percent: 19, is_active: true },
      { kind: 'weekly_scoped', percent: 17, resets_at: '2026-10-14T16:00:00Z', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false },
    ],
  });
  expect(usage.session.percent).toBe(1);
  expect(usage.weeklyAll.percent).toBe(19);
  expect(usage.weeklyFable.percent).toBe(17);
  expect(usage.weeklyFable.resetsAt).toBe('2026-10-14T16:00:00Z');
});

test('limits-only responses retain zero Fable use and do not label other models as Fable', () => {
  const limits = [null, { kind: 'weekly_scoped', percent: 88, scope: { model: { display_name: 'Sonnet' } } }];
  expect(parseApiResponse({ limits }).weeklyFable).toBeNull();
  limits.push({ kind: 'weekly_scoped', percent: 0, scope: { model: { display_name: 'Fable' } } });
  expect(parseApiResponse({ limits }).weeklyFable.percent).toBe(0);
});

const { readRecentFableAllowance } = require('../../src/agents/claude-usage-cache');
test('the CLI cache fills missing Fable only for the same account and a recent sample', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-cache-'));
  const profile = { oauthAccount: { accountUuid: 'selected' }, cachedUsageUtilization: {
    accountUuid: 'selected', fetchedAtMs: 100000,
    utilization: { limits: [{ kind: 'weekly_scoped', percent: 17, scope: { model: { display_name: 'Fable' } } }] },
  } };
  const write = () => fs.writeFileSync(path.join(directory, '.claude.json'), JSON.stringify(profile));
  try {
    write();
    expect(readRecentFableAllowance(directory, 130000)).toEqual(expect.objectContaining({ percent: 17, sampledAt: new Date(100000).toISOString() }));
    expect(readRecentFableAllowance(directory, 160001)).toBeNull();
    expect(readRecentFableAllowance(directory, 99999)).toBeNull();
    profile.cachedUsageUtilization.accountUuid = 'different';
    write();
    expect(readRecentFableAllowance(directory, 130000)).toBeNull();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('PTY refresh uses a fresh structured Fable row and drops it once the sample expires', async () => {
  const { BaseAgent } = require('../../src/agents/base');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pty-cache-'));
  const profile = { oauthAccount: { accountUuid: 'selected' }, cachedUsageUtilization: {
    accountUuid: 'selected', fetchedAtMs: Date.now(),
    utilization: { limits: [{ kind: 'weekly_scoped', percent: 17, scope: { model: { display_name: 'Fable' } } }] },
  } };
  const write = () => fs.writeFileSync(path.join(directory, '.claude.json'), JSON.stringify(profile));
  const agent = new ClaudeAgent({ configPath: directory });
  const cli = jest.spyOn(BaseAgent.prototype, 'runCommand').mockResolvedValue('Current session\n1% used\nCurrent week (all models)\n19% used');
  try {
    write();
    expect(agent.parseOutput(await agent.runCommand()).weeklyFable.percent).toBe(17);
    profile.cachedUsageUtilization.fetchedAtMs -= 61000;
    write();
    expect(agent.parseOutput(await agent.runCommand()).weeklyFable).toBeNull();
  } finally {
    cli.mockRestore();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
