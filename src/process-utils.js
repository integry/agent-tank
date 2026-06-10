const { execFileSync } = require('node:child_process');
const path = require('node:path');

const BACKGROUND_ARG_RE = /^--(?:no-)?background$/;
const AGENT_TANK_BIN_RE = /(^|[\\/])bin[\\/]agent-tank\.js$/;

function isTruthyEnv(value) {
  return value === '1' || value === 'true';
}

function filterBackgroundArgs(args) {
  return args.filter(arg => !BACKGROUND_ARG_RE.test(arg));
}

function parseProcessList(output) {
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        command: match[2],
      };
    })
    .filter(Boolean);
}

function parseWindowsProcessList(output) {
  const parsed = JSON.parse(output || '[]');
  const entries = Array.isArray(parsed) ? parsed : [parsed];

  return entries
    .map(entry => ({
      pid: Number(entry.ProcessId),
      command: entry.CommandLine || '',
    }))
    .filter(entry => Number.isFinite(entry.pid) && entry.command);
}

function commandTokens(command) {
  return command.trim().split(/\s+/).filter(Boolean);
}

function commandBasename(token) {
  return path.basename(token.replace(/^"|"$/g, '')).toLowerCase();
}

function isAgentTankCommand(command) {
  const tokens = commandTokens(command);
  if (tokens.length === 0) {
    return false;
  }

  const executable = commandBasename(tokens[0]);
  if (executable === 'agent-tank' || executable === 'agent-tank.cmd' || executable === 'agent-tank.ps1') {
    return true;
  }

  if (executable !== 'node' && executable !== 'node.exe') {
    return false;
  }

  return tokens.slice(1).some(token => AGENT_TANK_BIN_RE.test(token.replace(/^"|"$/g, '')));
}

function findAgentTankProcesses({
  currentPid = process.pid,
  execFile = execFileSync,
  platform = process.platform,
} = {}) {
  let output;
  let processes;

  try {
    if (platform === 'win32') {
      output = execFile('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
      ], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      processes = parseWindowsProcessList(output);
    } else {
      output = execFile('ps', ['-eo', 'pid=,args='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      processes = parseProcessList(output);
    }
  } catch (_err) {
    return [];
  }

  return processes
    .filter(entry => entry.pid !== currentPid)
    .filter(entry => isAgentTankCommand(entry.command));
}

module.exports = {
  filterBackgroundArgs,
  findAgentTankProcesses,
  isAgentTankCommand,
  isTruthyEnv,
  parseProcessList,
  parseWindowsProcessList,
};
