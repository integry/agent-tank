// Signals that should trigger a graceful shutdown so agent PTY processes are
// cleaned up instead of leaking as orphans. SIGINT and SIGHUP matter for
// detached/background runs that have no TTY (where the stdin Ctrl+C watcher
// below does not apply). SIGKILL is intentionally absent — it cannot be caught.
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'];

function installShutdownHandlers({ shutdown, processObj = process, stdin = process.stdin }) {
  const signalHandlers = SHUTDOWN_SIGNALS.map(signal => {
    const handler = () => shutdown(signal);
    processObj.on(signal, handler);
    return [signal, handler];
  });

  const onStdinData = (chunk) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''));
    if (data.includes(0x03)) {
      shutdown('CTRL+C');
    }
  };

  const shouldWatchStdin = stdin && stdin.isTTY && typeof stdin.on === 'function';
  if (shouldWatchStdin) {
    stdin.on('data', onStdinData);
    if (typeof stdin.resume === 'function') {
      stdin.resume();
    }
  }

  return () => {
    for (const [signal, handler] of signalHandlers) {
      processObj.off(signal, handler);
    }

    if (shouldWatchStdin) {
      stdin.off('data', onStdinData);
      if (typeof stdin.pause === 'function') {
        stdin.pause();
      }
    }
  };
}

module.exports = { installShutdownHandlers };
