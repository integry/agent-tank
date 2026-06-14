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
});
