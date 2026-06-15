/**
 * Unit tests for BaseAgent.writeDebugOutput
 *
 * The debug dump runs inside setTimeout callbacks, where a thrown
 * exception is unhandled and crashes the whole process. These tests
 * verify the dump never throws, even when the target file is
 * unwritable (e.g. a stale /tmp file owned by another user).
 */

// Mock node-pty to avoid native module issues in unit tests
jest.mock('node-pty', () => ({
  spawn: jest.fn()
}), { virtual: true });

const fs = require('fs');
const os = require('node:os');
const path = require('node:path');
const { BaseAgent } = require('../../src/agents/base.js');

describe('BaseAgent', () => {
  describe('writeDebugOutput', () => {
    let agent;
    let writeFileSyncSpy;

    beforeEach(() => {
      agent = new BaseAgent('claude', 'claude');
      writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync');
    });

    afterEach(() => {
      writeFileSyncSpy.mockRestore();
    });

    it('writes output to a temp file named after the agent and returns the path', () => {
      writeFileSyncSpy.mockImplementation(() => {});

      const result = agent.writeDebugOutput('partial output');

      const expectedPath = path.join(os.tmpdir(), 'claude-output.txt');
      expect(result).toBe(expectedPath);
      expect(writeFileSyncSpy).toHaveBeenCalledWith(expectedPath, 'partial output');
    });

    it('returns null instead of throwing when the write fails with EACCES', () => {
      const eacces = Object.assign(new Error("EACCES: permission denied, open '/tmp/claude-output.txt'"), {
        code: 'EACCES',
        errno: -13,
        syscall: 'open'
      });
      writeFileSyncSpy.mockImplementation(() => {
        throw eacces;
      });

      let result;
      expect(() => {
        result = agent.writeDebugOutput('partial output');
      }).not.toThrow();
      expect(result).toBeNull();
    });

    it('returns null instead of throwing on any other write error', () => {
      writeFileSyncSpy.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      expect(() => agent.writeDebugOutput('partial output')).not.toThrow();
      expect(agent.writeDebugOutput('partial output')).toBeNull();
    });
  });

  describe('killProcess', () => {
    let agent;
    let killSpy;
    let processKillSpy;

    function attachShell(pid = 4321) {
      const shell = { pid, kill: jest.fn() };
      agent.shell = shell;
      agent._disposables = [{ dispose: jest.fn() }];
      return shell;
    }

    beforeEach(() => {
      jest.useFakeTimers();
      agent = new BaseAgent('agy', 'agy');
      // process.kill is used both to signal (-pid) and to probe liveness (pid, 0).
      processKillSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
      processKillSpy.mockRestore();
      if (killSpy) killSpy.mockRestore();
    });

    it('sends SIGTERM to the process group immediately and clears the shell', () => {
      const shell = attachShell(4321);

      agent.killProcess();

      expect(process.kill).toHaveBeenCalledWith(-4321, 'SIGTERM');
      expect(shell.kill).toHaveBeenCalledWith('SIGTERM');
      expect(agent.shell).toBeNull();
    });

    it('escalates to SIGKILL after the grace period if the process is still alive', () => {
      const shell = attachShell(4321);
      // Liveness probe process.kill(pid, 0) returns truthy => still alive.

      agent.killProcess();
      process.kill.mockClear();
      shell.kill.mockClear();

      jest.advanceTimersByTime(BaseAgent.FORCE_KILL_GRACE_MS);

      expect(process.kill).toHaveBeenCalledWith(4321, 0); // liveness probe
      expect(process.kill).toHaveBeenCalledWith(-4321, 'SIGKILL');
      expect(shell.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('does not send SIGKILL if the process already exited within the grace period', () => {
      const shell = attachShell(4321);

      agent.killProcess();
      process.kill.mockClear();
      shell.kill.mockClear();

      // Liveness probe throws => process is gone.
      processKillSpy.mockImplementation((targetPid, sig) => {
        if (sig === 0) { throw new Error('ESRCH'); }
        return true;
      });

      jest.advanceTimersByTime(BaseAgent.FORCE_KILL_GRACE_MS);

      expect(process.kill).not.toHaveBeenCalledWith(-4321, 'SIGKILL');
      expect(shell.kill).not.toHaveBeenCalledWith('SIGKILL');
    });

    it('immediate mode sends SIGKILL synchronously without waiting for a timer', () => {
      const shell = attachShell(4321);

      agent.killProcess({ immediate: true });

      expect(process.kill).toHaveBeenCalledWith(-4321, 'SIGTERM');
      expect(process.kill).toHaveBeenCalledWith(-4321, 'SIGKILL');
      expect(shell.kill).toHaveBeenCalledWith('SIGKILL');
      // No reliance on pending timers.
      expect(jest.getTimerCount()).toBe(0);
    });

    it('is a no-op when there is no shell', () => {
      agent.shell = null;
      expect(() => agent.killProcess()).not.toThrow();
      expect(process.kill).not.toHaveBeenCalled();
    });

    it('never throws when signalling a process that is already dead', () => {
      const shell = attachShell(4321);
      shell.kill.mockImplementation(() => { throw new Error('already dead'); });
      processKillSpy.mockImplementation(() => { throw new Error('ESRCH'); });

      expect(() => agent.killProcess({ immediate: true })).not.toThrow();
      expect(agent.shell).toBeNull();
    });
  });
});
