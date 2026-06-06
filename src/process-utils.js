const { execFileSync } = require('node:child_process');

const BACKGROUND_ARG_RE = /^--(?:no-)?background(?:=.*)?$/;
const AGENT_TANK_COMMAND_RE = /(^|[\\/])agent-tank(?:\.js)?(?:\s|$)|(^|[\\/])bin[\\/]agent-tank\.js(?:\s|$)/;

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

function isAgentTankCommand(command) {
  return AGENT_TANK_COMMAND_RE.test(command);
}

function findAgentTankProcesses({
  currentPid = process.pid,
  execFile = execFileSync,
} = {}) {
  let output;

  try {
    output = execFile('ps', ['-eo', 'pid=,args='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_err) {
    return [];
  }

  return parseProcessList(output)
    .filter(entry => entry.pid !== currentPid)
    .filter(entry => isAgentTankCommand(entry.command));
}

module.exports = {
  filterBackgroundArgs,
  findAgentTankProcesses,
  isAgentTankCommand,
  isTruthyEnv,
  parseProcessList,
};
