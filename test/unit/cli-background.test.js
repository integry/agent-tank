const { EventEmitter } = require('node:events');
const {
  createBackgroundLogPath,
  getBackgroundStartupGraceMs,
  spawnBackgroundProcess,
  warnAboutRunningProcesses,
} = require('../../src/cli-background.js');

function streamBuffer() {
  let value = '';
  return {
    stream: {
      write(chunk) {
        value += chunk;
      },
    },
    text() {
      return value;
    },
  };
}

function childProcessStub(pid) {
  const child = new EventEmitter();
  child.pid = arguments.length === 0 ? 1234 : pid;
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
        env: { AGENT_TANK_BACKGROUND: '1', AGENT_TANK_BACKGROUND_LOG: '/tmp/agent.log' },
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
      }));
      expect(spawnFn.mock.calls[0][2].env.AGENT_TANK_BACKGROUND).toBeUndefined();
      expect(child.unref).toHaveBeenCalledTimes(1);
      expect(stdout.text()).toContain('PID 4242');
      expect(stdout.text()).toContain('/tmp/agent.log');
      expect(stderr.text()).toBe('');
    });

    it('reports spawn errors instead of printing success', async () => {
      const stdout = streamBuffer();
      const stderr = streamBuffer();
      const child = childProcessStub();
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
      const child = childProcessStub();
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
    it('writes process commands, port hint, and background tip to stderr', () => {
      const stderr = streamBuffer();

      warnAboutRunningProcesses({
        findProcesses: () => [
          { pid: 100, command: 'node /repo/bin/agent-tank.js --port 3456' },
        ],
        stderr: stderr.stream,
      });

      expect(stderr.text()).toContain('PID 100: node /repo/bin/agent-tank.js --port 3456');
      expect(stderr.text()).toContain('same port');
      expect(stderr.text()).toContain('agent-tank --background');
    });
  });
});
