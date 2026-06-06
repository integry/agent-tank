const {
  filterBackgroundArgs,
  findAgentTankProcesses,
  isAgentTankCommand,
  parseProcessList,
} = require('../../src/process-utils.js');

describe('process-utils', () => {
  describe('filterBackgroundArgs', () => {
    it('removes background and no-background flags from child argv', () => {
      expect(filterBackgroundArgs([
        '--port', '3456',
        '--background',
        '--no-background',
        '--background=true',
        '--no-background=false',
        '--claude',
      ])).toEqual(['--port', '3456', '--claude']);
    });
  });

  describe('parseProcessList', () => {
    it('parses ps output into pid and command entries', () => {
      expect(parseProcessList(`
        101 node /usr/local/bin/agent-tank --port 3456
        202 /bin/sh -c something else
      `)).toEqual([
        { pid: 101, command: 'node /usr/local/bin/agent-tank --port 3456' },
        { pid: 202, command: '/bin/sh -c something else' },
      ]);
    });
  });

  describe('isAgentTankCommand', () => {
    it('matches installed and source-tree Agent Tank commands', () => {
      expect(isAgentTankCommand('agent-tank --port 3456')).toBe(true);
      expect(isAgentTankCommand('node /repo/bin/agent-tank.js --codex')).toBe(true);
    });

    it('does not match unrelated commands', () => {
      expect(isAgentTankCommand('node /repo/test/unit/cli.test.js')).toBe(false);
      expect(isAgentTankCommand('agent-tanker --port 3456')).toBe(false);
    });
  });

  describe('findAgentTankProcesses', () => {
    it('excludes the current process and finds other Agent Tank-like commands', () => {
      const execFile = jest.fn(() => `
        100 node /repo/bin/agent-tank.js --port 3456
        200 node /repo/bin/agent-tank.js --port 4567
        300 agent-tank --codex
        400 node other.js
      `);

      expect(findAgentTankProcesses({ currentPid: 200, execFile })).toEqual([
        { pid: 100, command: 'node /repo/bin/agent-tank.js --port 3456' },
        { pid: 300, command: 'agent-tank --codex' },
      ]);
      expect(execFile).toHaveBeenCalledWith('ps', ['-eo', 'pid=,args='], expect.any(Object));
    });

    it('returns an empty list when process discovery fails', () => {
      const execFile = jest.fn(() => {
        throw new Error('ps failed');
      });

      expect(findAgentTankProcesses({ execFile })).toEqual([]);
    });
  });
});
