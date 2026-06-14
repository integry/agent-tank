const { EventEmitter } = require('node:events');
const {
  createBackgroundLogPath,
  getBackgroundStartupGraceMs,
  redactProcessCommand,
  spawnBackgroundProcess,
  warnAboutRunningProcesses,
} = require('../../src/cli-background.js');

function streamBuffer({ isTTY = false } = {}) {
  let value = '';
  return {
    stream: {
      isTTY,
      write(chunk) {
        value += chunk;
      },
    },
    text() {
      return value;
    },
  };
}

const DEFAULT_CHILD_PID = 1234;
const USE_DEFAULT_CHILD_PID = Symbol('USE_DEFAULT_CHILD_PID');

function childProcessStub(pid) {
  const child = new EventEmitter();
  child.pid = pid === USE_DEFAULT_CHILD_PID ? DEFAULT_CHILD_PID : pid;
  child.unref = jest.fn();
  return child;
}

describe('cli-background', () => {
  describe('createBackgroundLogPath', () => {
    it('uses AGENT_TANK_BACKGROUND_LOG when provided', () => {
      expect(createBackgroundLogPath({
        env: { AGENT_TANK_BACKGROUND_LOG: '/tmp/custom.log' },
      })).toBe('/tmp/custom.log');
    });
  });

  describe('getBackgroundStartupGraceMs', () => {
    it('uses AGENT_TANK_BACKGROUND_GRACE_MS when it is a non-negative integer', () => {
      expect(getBackgroundStartupGraceMs({ AGENT_TANK_BACKGROUND_GRACE_MS: '5000' })).toBe(5000);
    });
  });

  describe('spawnBackgroundProcess', () => {
    it('spawns a detached child, marks child env, filters background args, and prints PID plus log', async () => {
      const stdout = streamBuffer();
      const stderr = streamBuffer();
      const child = childProcessStub(4242);
      const spawnFn = jest.fn(() => child);

      const started = await spawnBackgroundProcess({
        argv: ['node', '/repo/bin/agent-tank.js', '--background', '--port', '4567'],
        env: {
          AGENT_TANK_BACKGROUND: '1',
          AGENT_TANK_BACKGROUND_LOG: '/tmp/agent.log',
          AGENT_TANK_BACKGROUND_GRACE_MS: '5000',
        },
        execPath: '/usr/bin/node',
        spawnFn,
        stdout: stdout.stream,
        stderr: stderr.stream,
        openSync: jest.fn(() => 10),
        closeSync: jest.fn(),
        startupGraceMs: 1,
      });

      expect(started).toBe(true);
      expect(spawnFn).toHaveBeenCalledWith('/usr/bin/node', [
        '/repo/bin/agent-tank.js',
        '--port',
        '4567',
      ], expect.objectContaining({
        detached: true,
        stdio: ['ignore', 10, 10],
        env: expect.objectContaining({ AGENT_TANK_BACKGROUND_CHILD: '1' }),
        windowsHide: true,
      }));
      expect(spawnFn.mock.calls[0][2].env.AGENT_TANK_BACKGROUND).toBeUndefined();
      expect(spawnFn.mock.calls[0][2].env.AGENT_TANK_BACKGROUND_LOG).toBeUndefined();
      expect(spawnFn.mock.calls[0][2].env.AGENT_TANK_BACKGROUND_GRACE_MS).toBeUndefined();
      expect(child.unref).toHaveBeenCalledTimes(1);
      expect(stdout.text()).toContain('PID 4242');
      expect(stdout.text()).toContain('/tmp/agent.log');
      expect(stderr.text()).toBe('');
      expect(() => child.emit('error', new Error('late spawn error'))).not.toThrow();
    });

    it('reports spawn errors instead of printing success', async () => {
      const stdout = streamBuffer();
      const stderr = streamBuffer();
      const child = childProcessStub(USE_DEFAULT_CHILD_PID);
      const spawnFn = jest.fn(() => child);
      const promise = spawnBackgroundProcess({
        argv: ['node', '/repo/bin/agent-tank.js', '--background'],
        env: { AGENT_TANK_BACKGROUND_LOG: '/tmp/agent.log' },
        spawnFn,
        stdout: stdout.stream,
        stderr: stderr.stream,
        openSync: jest.fn(() => 11),
        closeSync: jest.fn(),
        startupGraceMs: 1000,
      });

      child.emit('error', new Error('spawn failed'));

      await expect(promise).resolves.toBe(false);
      expect(stdout.text()).toBe('');
      expect(stderr.text()).toContain('spawn failed');
      expect(stderr.text()).toContain('/tmp/agent.log');
      expect(child.unref).not.toHaveBeenCalled();
    });

    it('reports early child exits before claiming startup success', async () => {
      const stderr = streamBuffer();
      const child = childProcessStub(USE_DEFAULT_CHILD_PID);
      const promise = spawnBackgroundProcess({
        argv: ['node', '/repo/bin/agent-tank.js', '--background'],
        env: { AGENT_TANK_BACKGROUND_LOG: '/tmp/agent.log' },
        spawnFn: jest.fn(() => child),
        stderr: stderr.stream,
        openSync: jest.fn(() => 12),
        closeSync: jest.fn(),
        startupGraceMs: 1000,
      });

      child.emit('exit', 1, null);

      await expect(promise).resolves.toBe(false);
      expect(stderr.text()).toContain('child exited during startup');
      expect(child.unref).not.toHaveBeenCalled();
    });

    it('does not print success when the child has no PID', async () => {
      const stdout = streamBuffer();
      const stderr = streamBuffer();
      const child = childProcessStub(undefined);

      await expect(spawnBackgroundProcess({
        argv: ['node', '/repo/bin/agent-tank.js', '--background'],
        env: { AGENT_TANK_BACKGROUND_LOG: '/tmp/agent.log' },
        spawnFn: jest.fn(() => child),
        stdout: stdout.stream,
        stderr: stderr.stream,
        openSync: jest.fn(() => 13),
        closeSync: jest.fn(),
        startupGraceMs: 1,
      })).resolves.toBe(false);

      expect(stdout.text()).toBe('');
      expect(stderr.text()).toContain('PID was not assigned');
      expect(child.unref).not.toHaveBeenCalled();
    });
  });

  describe('warnAboutRunningProcesses', () => {
    it('redacts credential flags before writing process commands', () => {
      expect(redactProcessCommand('agent-tank --auth-pass secret --auth-token=token --port 3456'))
        .toBe('agent-tank --auth-pass [redacted] --auth-token=[redacted] --port 3456');
      expect(redactProcessCommand('agent-tank --auth-pass "quoted secret" --auth-token \'quoted-token\''))
        .toBe('agent-tank --auth-pass [redacted] --auth-token [redacted]');
    });

    it('writes process commands, port hint, and background tip to stderr', async () => {
      const stderr = streamBuffer();

      await warnAboutRunningProcesses({
        findProcesses: async () => [
          { pid: 100, command: 'node /repo/bin/agent-tank.js --auth-pass secret --port 3456' },
        ],
        stderr: stderr.stream,
      });

      expect(stderr.text()).toContain('PID 100: node /repo/bin/agent-tank.js --auth-pass [redacted] --port 3456');
      expect(stderr.text()).not.toContain('secret');
      expect(stderr.text()).toContain('same port');
      expect(stderr.text()).toContain('agent-tank --background');
    });

    it('includes kill instructions listing every discovered PID', async () => {
      const stderr = streamBuffer();

      await warnAboutRunningProcesses({
        findProcesses: async () => [
          { pid: 100, command: 'node /repo/bin/agent-tank.js' },
          { pid: 205, command: 'node /repo/bin/agent-tank.js --port 8080' },
        ],
        stderr: stderr.stream,
      });

      expect(stderr.text()).toContain('kill 100 205');
      expect(stderr.text()).toContain('kill -9 100 205');
    });

    it('emits a bold red warning header on an interactive terminal', async () => {
      const stderr = streamBuffer({ isTTY: true });

      await warnAboutRunningProcesses({
        findProcesses: async () => [
          { pid: 100, command: 'node /repo/bin/agent-tank.js' },
        ],
        stderr: stderr.stream,
      });

      // \x1b[1m\x1b[31m ... \x1b[0m around the warning header
      expect(stderr.text()).toContain('\x1b[1m\x1b[31mWarning: other Agent Tank process(es) already running:\x1b[0m');
    });

    it('omits ANSI color when stderr is not a TTY', async () => {
      const stderr = streamBuffer({ isTTY: false });

      await warnAboutRunningProcesses({
        findProcesses: async () => [
          { pid: 100, command: 'node /repo/bin/agent-tank.js' },
        ],
        stderr: stderr.stream,
      });

      expect(stderr.text()).toContain('Warning: other Agent Tank process(es) already running:');
      expect(stderr.text()).not.toContain('\x1b[');
    });

    it('does not warn when process discovery fails', async () => {
      const stderr = streamBuffer();

      await warnAboutRunningProcesses({
        findProcesses: async () => {
          throw new Error('scan failed');
        },
        stderr: stderr.stream,
      });

      expect(stderr.text()).toBe('');
    });
  });
});
