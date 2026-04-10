const { EventEmitter } = require('events');
const { installShutdownHandlers } = require('../../src/shutdown-handler.js');

describe('installShutdownHandlers', () => {
  it('calls shutdown on SIGTERM and removes listeners on cleanup', () => {
    const shutdown = jest.fn();
    const processObj = new EventEmitter();
    processObj.off = processObj.removeListener.bind(processObj);

    const cleanup = installShutdownHandlers({
      shutdown,
      processObj,
      stdin: { isTTY: false },
    });

    processObj.emit('SIGTERM');
    expect(shutdown).toHaveBeenCalledWith('SIGTERM');

    shutdown.mockClear();
    cleanup();
    processObj.emit('SIGTERM');
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('calls shutdown when Ctrl+C is received as raw stdin data', () => {
    const shutdown = jest.fn();
    const stdin = new EventEmitter();
    stdin.isTTY = true;
    stdin.resume = jest.fn();
    stdin.pause = jest.fn();
    stdin.off = stdin.removeListener.bind(stdin);
    const processObj = new EventEmitter();
    processObj.off = processObj.removeListener.bind(processObj);

    const cleanup = installShutdownHandlers({ shutdown, processObj, stdin });

    stdin.emit('data', Buffer.from([0x03]));

    expect(shutdown).toHaveBeenCalledWith('CTRL+C');
    expect(stdin.resume).toHaveBeenCalled();

    cleanup();
    expect(stdin.pause).toHaveBeenCalled();
  });
});
