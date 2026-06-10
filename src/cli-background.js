const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  filterBackgroundArgs,
  findAgentTankProcesses,
} = require('./process-utils.js');

const BACKGROUND_STARTUP_GRACE_MS = 750;

function createBackgroundLogPath({
  env = process.env,
  tmpdir = os.tmpdir,
  pid = process.pid,
  now = Date.now,
} = {}) {
  return env.AGENT_TANK_BACKGROUND_LOG ||
    path.join(tmpdir(), `agent-tank-${pid}-${now()}.log`);
}

function writeBackgroundStartMessage({ pid, logPath, stdout = process.stdout }) {
  stdout.write(`Agent Tank started in the background with PID ${pid}\n`);
  stdout.write(`Background log: ${logPath}\n`);
}

function writeBackgroundStartFailure({ message, logPath, stderr = process.stderr }) {
  stderr.write(`Failed to start Agent Tank in the background: ${message}\n`);
  stderr.write(`Background log: ${logPath}\n`);
}

function openBackgroundLog(logPath, openSync = fs.openSync) {
  return openSync(logPath, 'a');
}

function closeBackgroundLog(logFd, closeSync = fs.closeSync) {
  try {
    closeSync(logFd);
  } catch (_err) {
    // The child owns the duplicated descriptor after spawn; parent close failures are non-fatal.
  }
}

function getBackgroundStartupGraceMs(env = process.env) {
  const parsed = Number.parseInt(env.AGENT_TANK_BACKGROUND_GRACE_MS, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : BACKGROUND_STARTUP_GRACE_MS;
}

function waitForBackgroundStartup(child, graceMs, setTimer = setTimeout, clearTimer = clearTimeout) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      callback(value);
    };

    const onError = (err) => finish(reject, err);
    const onExit = (code, signal) => {
      const detail = signal ? `signal ${signal}` : `exit code ${code}`;
      finish(reject, new Error(`child exited during startup (${detail})`));
    };
    const timer = setTimer(() => finish(resolve), graceMs);

    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function spawnBackgroundProcess({
  argv = process.argv,
  env = process.env,
  execPath = process.execPath,
  spawnFn = spawn,
  stdout = process.stdout,
  stderr = process.stderr,
  openSync = fs.openSync,
  closeSync = fs.closeSync,
  startupGraceMs,
} = {}) {
  const resolvedStartupGraceMs = startupGraceMs ?? getBackgroundStartupGraceMs(env);
  const logPath = createBackgroundLogPath({ env });
  let logFd;

  try {
    logFd = openBackgroundLog(logPath, openSync);
  } catch (err) {
    writeBackgroundStartFailure({ message: err.message, logPath, stderr });
    return false;
  }

  const childArgs = [
    argv[1],
    ...filterBackgroundArgs(argv.slice(2)),
  ];
  const childEnv = {
    ...env,
    AGENT_TANK_BACKGROUND_CHILD: '1',
  };
  delete childEnv.AGENT_TANK_BACKGROUND;

  let child;
  try {
    child = spawnFn(execPath, childArgs, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: childEnv,
    });
  } catch (err) {
    closeBackgroundLog(logFd, closeSync);
    writeBackgroundStartFailure({ message: err.message, logPath, stderr });
    return false;
  }

  closeBackgroundLog(logFd, closeSync);

  try {
    await waitForBackgroundStartup(child, resolvedStartupGraceMs);
  } catch (err) {
    writeBackgroundStartFailure({ message: err.message, logPath, stderr });
    return false;
  }

  if (!child.pid) {
    // Extremely defensive: normal spawn failures are reported via the error event above.
    writeBackgroundStartFailure({ message: 'child process PID was not assigned', logPath, stderr });
    return false;
  }

  child.unref();
  writeBackgroundStartMessage({ pid: child.pid, logPath, stdout });
  return true;
}

function warnAboutRunningProcesses({
  findProcesses = findAgentTankProcesses,
  stderr = process.stderr,
} = {}) {
  const running = findProcesses();
  if (running.length === 0) {
    return;
  }

  const lines = running
    .map(entry => `  PID ${entry.pid}: ${entry.command}`)
    .join('\n');

  stderr.write('Warning: other Agent Tank process(es) already running:\n');
  stderr.write(`${lines}\n`);
  stderr.write('If this instance uses the same port, startup will fail; choose a different --port or stop the other process.\n');
  stderr.write('Tip: start Agent Tank in the background with agent-tank --background\n');
}

module.exports = {
  BACKGROUND_STARTUP_GRACE_MS,
  createBackgroundLogPath,
  getBackgroundStartupGraceMs,
  spawnBackgroundProcess,
  waitForBackgroundStartup,
  warnAboutRunningProcesses,
};
