/**
 * Unit tests for JsonRpcClient
 *
 * Tests the JSON-RPC 2.0 client implementation for subprocess communication.
 * These tests use mocked child_process to avoid actual subprocess spawning.
 */

const { EventEmitter } = require('events');

// Mock child_process.spawn
const mockStdin = {
  write: jest.fn(),
  end: jest.fn(),
};

const mockStdout = new EventEmitter();
mockStdout.setEncoding = jest.fn();

const mockStderr = new EventEmitter();
mockStderr.setEncoding = jest.fn();

const mockProcess = new EventEmitter();
mockProcess.stdin = mockStdin;
mockProcess.stdout = mockStdout;
mockProcess.stderr = mockStderr;
mockProcess.kill = jest.fn();
mockProcess.killed = false;

jest.mock('child_process', () => ({
  spawn: jest.fn(() => mockProcess),
}));

const { spawn } = require('child_process');
const { JsonRpcClient, JsonRpcError } = require('../../src/json-rpc-client.js');

describe('JsonRpcClient', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    mockProcess.killed = false;
    mockStdin.write.mockClear();
    mockStdin.end.mockClear();
    mockProcess.kill.mockClear();

    // Remove all listeners from mock emitters
    mockStdout.removeAllListeners();
    mockStderr.removeAllListeners();
    mockProcess.removeAllListeners();

    client = new JsonRpcClient('test-command', ['arg1', 'arg2'], {
      cwd: '/tmp',
      timeout: 5000,
    });
  });

  afterEach(() => {
    if (client) {
      client.stop();
    }
  });

  describe('constructor', () => {
    it('initializes with correct defaults', () => {
      const defaultClient = new JsonRpcClient('cmd');
      expect(defaultClient.command).toBe('cmd');
      expect(defaultClient.args).toEqual([]);
      expect(defaultClient.options.timeout).toBe(30000);
      expect(defaultClient.isConnected).toBe(false);
    });

    it('accepts custom options', () => {
      expect(client.command).toBe('test-command');
      expect(client.args).toEqual(['arg1', 'arg2']);
      expect(client.options.cwd).toBe('/tmp');
      expect(client.options.timeout).toBe(5000);
    });
  });

  describe('start', () => {
    it('spawns the subprocess with correct arguments', async () => {
      const startPromise = client.start();

      // Allow the setTimeout to execute
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(spawn).toHaveBeenCalledWith('test-command', ['arg1', 'arg2'], {
        cwd: '/tmp',
        env: expect.any(Object),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      expect(client.isConnected).toBe(true);
      await startPromise;
    });

    it('sets up stdout data handler', async () => {
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      expect(mockStdout.setEncoding).toHaveBeenCalledWith('utf8');
      expect(mockStdout.listenerCount('data')).toBe(1);
    });

    it('sets up stderr data handler', async () => {
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      expect(mockStderr.setEncoding).toHaveBeenCalledWith('utf8');
      expect(mockStderr.listenerCount('data')).toBe(1);
    });

    it('emits stderr events', async () => {
      const stderrHandler = jest.fn();
      client.on('stderr', stderrHandler);

      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      mockStderr.emit('data', 'error message');
      expect(stderrHandler).toHaveBeenCalledWith('error message');
    });

    it('emits error events from the process', async () => {
      // Listen for error events
      const errorHandler = jest.fn();
      client.on('error', errorHandler);

      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      // Emit error after connection is established
      mockProcess.emit('error', new Error('connection lost'));

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(errorHandler.mock.calls[0][0].message).toBe('connection lost');
    });
  });

  describe('call', () => {
    beforeEach(async () => {
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;
    });

    it('sends a JSON-RPC request', async () => {
      const callPromise = client.call('test.method', { param1: 'value1' });

      // Simulate response
      setImmediate(() => {
        mockStdout.emit('data', JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { success: true },
        }) + '\n');
      });

      const result = await callPromise;
      expect(result).toEqual({ success: true });

      expect(mockStdin.write).toHaveBeenCalledWith(expect.stringContaining('"method":"test.method"'));
      expect(mockStdin.write).toHaveBeenCalledWith(expect.stringContaining('"params":{"param1":"value1"}'));
    });

    it('increments request ID for each call', async () => {
      // First call
      const call1 = client.call('method1');
      setImmediate(() => {
        mockStdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'r1' }) + '\n');
      });
      await call1;

      // Second call
      const call2 = client.call('method2');
      setImmediate(() => {
        mockStdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: 2, result: 'r2' }) + '\n');
      });
      await call2;

      const calls = mockStdin.write.mock.calls;
      expect(calls[0][0]).toContain('"id":1');
      expect(calls[1][0]).toContain('"id":2');
    });

    it('handles JSON-RPC error responses', async () => {
      const callPromise = client.call('error.method');

      setImmediate(() => {
        mockStdout.emit('data', JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32600,
            message: 'Invalid Request',
            data: { details: 'test' },
          },
        }) + '\n');
      });

      await expect(callPromise).rejects.toThrow(JsonRpcError);
      await expect(callPromise).rejects.toThrow('Invalid Request');
    });

    it('throws error when not connected', async () => {
      client.stop();
      await expect(client.call('test.method')).rejects.toThrow('Client is not connected');
    });

    it('times out if no response received', async () => {
      // Use a very short timeout for testing
      const shortTimeoutClient = new JsonRpcClient('cmd', [], { timeout: 100 });
      const startPromise = shortTimeoutClient.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      await expect(shortTimeoutClient.call('slow.method')).rejects.toThrow('timed out');

      shortTimeoutClient.stop();
    });
  });

  describe('notify', () => {
    beforeEach(async () => {
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;
    });

    it('sends a JSON-RPC notification (no id)', () => {
      client.notify('notification.method', { data: 'test' });

      expect(mockStdin.write).toHaveBeenCalledWith(expect.stringContaining('"method":"notification.method"'));
      expect(mockStdin.write).toHaveBeenCalledWith(expect.not.stringContaining('"id"'));
    });

    it('throws error when not connected', () => {
      client.stop();
      expect(() => client.notify('test.method')).toThrow('Client is not connected');
    });
  });

  describe('message parsing', () => {
    beforeEach(async () => {
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;
    });

    it('handles line-delimited JSON messages', async () => {
      const callPromise = client.call('test.method');

      setImmediate(() => {
        mockStdout.emit('data', '{"jsonrpc":"2.0","id":1,"result":"success"}\n');
      });

      const result = await callPromise;
      expect(result).toBe('success');
    });

    it('handles multiple messages in one chunk', async () => {
      const call1 = client.call('method1');
      const call2 = client.call('method2');

      setImmediate(() => {
        mockStdout.emit('data',
          '{"jsonrpc":"2.0","id":1,"result":"r1"}\n{"jsonrpc":"2.0","id":2,"result":"r2"}\n'
        );
      });

      const [r1, r2] = await Promise.all([call1, call2]);
      expect(r1).toBe('r1');
      expect(r2).toBe('r2');
    });

    it('handles split messages across chunks', async () => {
      const callPromise = client.call('test.method');

      setImmediate(() => {
        mockStdout.emit('data', '{"jsonrpc":"2.0",');
      });

      setTimeout(() => {
        mockStdout.emit('data', '"id":1,"result":"success"}\n');
      }, 50);

      const result = await callPromise;
      expect(result).toBe('success');
    });

    it('emits notification events', async () => {
      const notificationHandler = jest.fn();
      client.on('notification', notificationHandler);

      mockStdout.emit('data', JSON.stringify({
        jsonrpc: '2.0',
        method: 'server.notification',
        params: { event: 'test' },
      }) + '\n');

      expect(notificationHandler).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        method: 'server.notification',
        params: { event: 'test' },
      });
    });

    it('emits raw events for non-JSON output', async () => {
      const rawHandler = jest.fn();
      client.on('raw', rawHandler);

      mockStdout.emit('data', 'Not JSON output\n');

      expect(rawHandler).toHaveBeenCalledWith('Not JSON output');
    });
  });

  describe('stop', () => {
    beforeEach(async () => {
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;
    });

    it('kills the subprocess', () => {
      client.stop();

      expect(mockStdin.end).toHaveBeenCalled();
      expect(mockProcess.kill).toHaveBeenCalled();
      expect(client.isConnected).toBe(false);
    });

    it('rejects pending requests', async () => {
      const callPromise = client.call('test.method');

      // Stop before response
      setImmediate(() => {
        client.stop();
      });

      await expect(callPromise).rejects.toThrow('Client stopped');
    });

    it('can be called multiple times safely', () => {
      client.stop();
      client.stop();
      client.stop();

      // Should not throw
      expect(mockProcess.kill).toHaveBeenCalledTimes(1);
    });
  });

  describe('connected getter', () => {
    it('returns false before start', () => {
      expect(client.connected).toBe(false);
    });

    it('returns true after successful start', async () => {
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      expect(client.connected).toBe(true);
    });

    it('returns false after stop', async () => {
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      client.stop();
      expect(client.connected).toBe(false);
    });
  });

  describe('process exit handling', () => {
    beforeEach(async () => {
      const startPromise = client.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;
    });

    it('rejects pending requests on process exit', async () => {
      const callPromise = client.call('test.method');

      setImmediate(() => {
        mockProcess.emit('exit', 1, null);
      });

      await expect(callPromise).rejects.toThrow('Process exited with code 1');
    });

    it('emits exit event', async () => {
      const exitHandler = jest.fn();
      client.on('exit', exitHandler);

      mockProcess.emit('exit', 0, 'SIGTERM');

      expect(exitHandler).toHaveBeenCalledWith({ code: 0, signal: 'SIGTERM' });
    });

    it('marks client as disconnected on exit', () => {
      mockProcess.emit('exit', 0, null);
      expect(client.isConnected).toBe(false);
    });
  });
});

describe('JsonRpcError', () => {
  it('creates error with code and message', () => {
    const error = new JsonRpcError(-32600, 'Invalid Request');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('JsonRpcError');
    expect(error.code).toBe(-32600);
    expect(error.message).toBe('Invalid Request');
    expect(error.data).toBeNull();
  });

  it('creates error with data', () => {
    const error = new JsonRpcError(-32602, 'Invalid params', { field: 'name' });

    expect(error.code).toBe(-32602);
    expect(error.data).toEqual({ field: 'name' });
  });
});
