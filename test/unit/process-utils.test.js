const {
  filterBackgroundArgs,
  findAgentTankProcesses,
  findAgentTankProcessesAsync,
  isAgentTankCommand,
  parseProcessList,
  parseWindowsProcessList,
  PROCESS_SCAN_TIMEOUT_MS,
  WINDOWS_PROCESS_SCAN_TIMEOUT_MS,
} = require('../../src/process-utils.js');

describe('process-utils', () => {
  function asyncExecFile(output) {
    return jest.fn((_file, _args, _options, callback) => {
      callback(null, output);
    });
  }

  describe('filterBackgroundArgs', () => {
    it('removes background and no-background flags from child argv', () => {
      expect(filterBackgroundArgs([
        '--port', '3456',
        '--background',
        '--no-background',
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

  describe('parseWindowsProcessList', () => {
    it('parses powershell JSON into pid and command entries', () => {
      expect(parseWindowsProcessList(JSON.stringify([
        { ProcessId: 101, CommandLine: 'node C:\\repo\\bin\\agent-tank.js --port 3456' },
        { ProcessId: 202, CommandLine: null },
      ]))).toEqual([
        { pid: 101, command: 'node C:\\repo\\bin\\agent-tank.js --port 3456' },
      ]);
    });
  });

  describe('isAgentTankCommand', () => {
    it('matches installed and source-tree Agent Tank commands', () => {
      expect(isAgentTankCommand('agent-tank --port 3456')).toBe(true);
      expect(isAgentTankCommand('C:\\Users\\me\\AppData\\Roaming\\npm\\agent-tank.cmd --port 3456')).toBe(true);
      expect(isAgentTankCommand('node /usr/local/bin/agent-tank --port 3456')).toBe(true);
      expect(isAgentTankCommand('node /repo/bin/agent-tank.js --codex')).toBe(true);
      expect(isAgentTankCommand('node.exe C:\\repo\\bin\\agent-tank.js --codex')).toBe(true);
      expect(isAgentTankCommand('nodejs /repo/bin/agent-tank.js --codex')).toBe(true);
      expect(isAgentTankCommand('node18 /repo/bin/agent-tank.js --codex')).toBe(true);
    });

    it('matches quoted Agent Tank paths containing spaces', () => {
      expect(isAgentTankCommand('node "C:\\Program Files\\agent tank\\bin\\agent-tank.js" --codex')).toBe(true);
    });

    it('does not match unrelated commands', () => {
      expect(isAgentTankCommand('node /repo/test/unit/cli.test.js')).toBe(false);
      expect(isAgentTankCommand('agent-tanker --port 3456')).toBe(false);
      expect(isAgentTankCommand('vim /repo/bin/agent-tank.js')).toBe(false);
      expect(isAgentTankCommand('less /usr/local/bin/agent-tank')).toBe(false);
      expect(isAgentTankCommand('node build.js --out dist/agent-tank')).toBe(false);
      expect(isAgentTankCommand('node tool.js /tmp/agent-tank')).toBe(false);
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
      expect(execFile.mock.calls[0][2]).toEqual(expect.objectContaining({
        timeout: PROCESS_SCAN_TIMEOUT_MS,
      }));
    });

    it('returns an empty list when process discovery fails', () => {
      const execFile = jest.fn(() => {
        throw new Error('ps failed');
      });

      expect(findAgentTankProcesses({ execFile })).toEqual([]);
    });

    it('uses powershell process discovery on Windows', () => {
      const execFile = jest.fn(() => JSON.stringify([
        { ProcessId: 100, CommandLine: 'node C:\\repo\\bin\\agent-tank.js --port 3456' },
        { ProcessId: 200, CommandLine: 'vim C:\\repo\\bin\\agent-tank.js' },
      ]));

      expect(findAgentTankProcesses({ currentPid: 999, execFile, platform: 'win32' })).toEqual([
        { pid: 100, command: 'node C:\\repo\\bin\\agent-tank.js --port 3456' },
      ]);
      expect(execFile).toHaveBeenCalledWith('powershell.exe', expect.any(Array), expect.any(Object));
      expect(execFile.mock.calls[0][2]).toEqual(expect.objectContaining({
        timeout: WINDOWS_PROCESS_SCAN_TIMEOUT_MS,
      }));
    });
  });

  describe('findAgentTankProcessesAsync', () => {
    it('finds Agent Tank processes without using a synchronous exec API', async () => {
      const execFileFn = asyncExecFile(`
        100 node /repo/bin/agent-tank.js --port 3456
        200 node other.js
      `);

      await expect(findAgentTankProcessesAsync({
        currentPid: 999,
        execFileFn,
      })).resolves.toEqual([
        { pid: 100, command: 'node /repo/bin/agent-tank.js --port 3456' },
      ]);
      expect(execFileFn).toHaveBeenCalledWith('ps', ['-eo', 'pid=,args='], expect.objectContaining({
        timeout: PROCESS_SCAN_TIMEOUT_MS,
      }), expect.any(Function));
    });

    it('uses the larger Windows timeout for async discovery', async () => {
      const execFileFn = asyncExecFile(JSON.stringify([
        { ProcessId: 100, CommandLine: 'node C:\\repo\\bin\\agent-tank.js --port 3456' },
      ]));

      await expect(findAgentTankProcessesAsync({
        currentPid: 999,
        execFileFn,
        platform: 'win32',
      })).resolves.toEqual([
        { pid: 100, command: 'node C:\\repo\\bin\\agent-tank.js --port 3456' },
      ]);
      expect(execFileFn).toHaveBeenCalledWith('powershell.exe', expect.any(Array), expect.objectContaining({
        timeout: WINDOWS_PROCESS_SCAN_TIMEOUT_MS,
      }), expect.any(Function));
    });
  });
});
