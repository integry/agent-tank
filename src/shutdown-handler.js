function installShutdownHandlers({ shutdown, processObj = process, stdin = process.stdin }) {
  const onSigterm = () => shutdown('SIGTERM');
  const onStdinData = (chunk) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''));
    if (data.includes(0x03)) {
      shutdown('CTRL+C');
    }
  };

  processObj.on('SIGTERM', onSigterm);

  const shouldWatchStdin = stdin && stdin.isTTY && typeof stdin.on === 'function';
  if (shouldWatchStdin) {
    stdin.on('data', onStdinData);
    if (typeof stdin.resume === 'function') {
      stdin.resume();
    }
  }

  return () => {
    processObj.off('SIGTERM', onSigterm);

    if (shouldWatchStdin) {
      stdin.off('data', onStdinData);
      if (typeof stdin.pause === 'function') {
        stdin.pause();
      }
    }
  };
}

module.exports = { installShutdownHandlers };
