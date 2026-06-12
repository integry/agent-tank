const { execFile } = require('node:child_process');
const path = require('node:path');

const BACKGROUND_ARG_RE = /^--(?:no-)?background$/;
const AGENT_TANK_BIN_RE = /(^|[\\/])bin[\\/]agent-tank\.js$/;
const PROCESS_SCAN_TIMEOUT_MS = 2000;
const WINDOWS_PROCESS_SCAN_TIMEOUT_MS = 8000;
const PROCESS_SCAN_MAX_BUFFER = 8 * 1024 * 1024;
const WINDOWS_PROCESS_SCAN_MAX_BUFFER = 32 * 1024 * 1024;
// This covers common Node flags that take a separate value; unknown flags may
// still be heuristic misses, but process warnings are best-effort only.
const NODE_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '--conditions',
  '-e',
  '--eval',
  '--experimental-loader',
  '--import',
  '--loader',
  '-r',
  '--require',
]);

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
  const tokens = [];
  const tokenRe = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match;

  while ((match = tokenRe.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }

  return tokens;
}

function commandBasename(token) {
  return path.basename(token.replace(/^"|"$/g, '').replace(/\\/g, '/')).toLowerCase();
}

function isAgentTankExecutable(token) {
  const executable = commandBasename(token);
  return executable === 'agent-tank' ||
    executable === 'agent-tank.cmd' ||
    executable === 'agent-tank.ps1';
}

function isAgentTankNodeScript(token) {
  const scriptPath = token.replace(/^"|"$/g, '');
  return AGENT_TANK_BIN_RE.test(scriptPath) || isAgentTankExecutable(scriptPath);
}

function isNodeInterpreter(token) {
  return /^(?:node|nodejs|node\d*)(?:\.exe)?$/.test(commandBasename(token));
}

function findNodeScriptToken(tokens) {
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (NODE_OPTIONS_WITH_VALUE.has(token)) {
      index += 1;
      continue;
    }

    if (token.startsWith('--') && NODE_OPTIONS_WITH_VALUE.has(token.split('=')[0])) {
      continue;
    }

    if (token.startsWith('-')) {
      continue;
    }

    return token;
  }

  return null;
}

function isAgentTankCommand(command) {
  const tokens = commandTokens(command);
  if (tokens.length === 0) {
    return false;
  }

  if (isAgentTankExecutable(tokens[0])) {
    return true;
  }

  if (!isNodeInterpreter(tokens[0])) {
    return false;
  }

  const scriptToken = findNodeScriptToken(tokens);
  return Boolean(scriptToken && isAgentTankNodeScript(scriptToken));
}

function getProcessScanCommand(platform, scanTimeoutMs) {
  const timeout = scanTimeoutMs ?? (
    platform === 'win32' ? WINDOWS_PROCESS_SCAN_TIMEOUT_MS : PROCESS_SCAN_TIMEOUT_MS
  );

  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
      ],
      options: {
        encoding: 'utf8',
        maxBuffer: WINDOWS_PROCESS_SCAN_MAX_BUFFER,
        timeout,
      },
      parse: parseWindowsProcessList,
    };
  }

  return {
    file: 'ps',
    args: ['-eo', 'pid=,args='],
    options: {
      encoding: 'utf8',
      maxBuffer: PROCESS_SCAN_MAX_BUFFER,
      timeout,
    },
    parse: parseProcessList,
  };
}

function filterAgentTankProcesses(processes, currentPid) {
  return processes
    .filter(entry => entry.pid !== currentPid)
    .filter(entry => isAgentTankCommand(entry.command));
}

function execFilePromise(execFileFn, file, args, options) {
  return new Promise((resolve, reject) => {
    execFileFn(file, args, options, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(stdout);
    });
  });
}

async function findAgentTankProcessesAsync({
  currentPid = process.pid,
  execFileFn = execFile,
  platform = process.platform,
  scanTimeoutMs,
} = {}) {
  const command = getProcessScanCommand(platform, scanTimeoutMs);

  try {
    const output = await execFilePromise(execFileFn, command.file, command.args, command.options);
    return filterAgentTankProcesses(command.parse(output), currentPid);
  } catch (_err) {
    return [];
  }
}

module.exports = {
  filterBackgroundArgs,
  findAgentTankProcessesAsync,
  isAgentTankCommand,
  isTruthyEnv,
  parseProcessList,
  parseWindowsProcessList,
  PROCESS_SCAN_MAX_BUFFER,
  PROCESS_SCAN_TIMEOUT_MS,
  WINDOWS_PROCESS_SCAN_MAX_BUFFER,
  WINDOWS_PROCESS_SCAN_TIMEOUT_MS,
};
