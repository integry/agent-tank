/**
 * JsonRpcClient - A utility for JSON-RPC 2.0 subprocess communication
 *
 * This client spawns a subprocess and communicates via JSON-RPC 2.0 protocol
 * over stdin/stdout. It handles message framing and asynchronous responses.
 */

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class JsonRpcClient extends EventEmitter {
  /**
   * Create a new JsonRpcClient
   * @param {string} command - The command to spawn
   * @param {string[]} args - Arguments for the command
   * @param {Object} options - Options for the subprocess
   */
  constructor(command, args = [], options = {}) {
    super();
    this.command = command;
    this.args = args;
    this.options = {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      timeout: options.timeout || 30000,
    };

    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.buffer = '';
    this.isConnected = false;
  }

  /**
   * Start the subprocess and establish JSON-RPC communication
   * @returns {Promise<void>}
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.command, this.args, {
          cwd: this.options.cwd,
          env: this.options.env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.process.on('error', (err) => {
          this.isConnected = false;
          this.emit('error', err);
          if (!this.isConnected) {
            reject(new Error(`Failed to spawn ${this.command}: ${err.message}`));
          }
        });

        this.process.on('exit', (code, signal) => {
          this.isConnected = false;
          this.emit('exit', { code, signal });

          // Reject all pending requests
          for (const [id, { reject: rejectFn }] of this.pendingRequests.entries()) {
            rejectFn(new Error(`Process exited with code ${code} while waiting for response`));
            this.pendingRequests.delete(id);
          }
        });

        this.process.stdout.setEncoding('utf8');
        this.process.stdout.on('data', (data) => {
          this._handleData(data);
        });

        this.process.stderr.setEncoding('utf8');
        this.process.stderr.on('data', (data) => {
          this.emit('stderr', data);
        });

        // Consider connected after process starts successfully
        // Give it a moment to initialize
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.isConnected = true;
            resolve();
          }
        }, 100);
      } catch (err) {
        reject(new Error(`Failed to spawn ${this.command}: ${err.message}`));
      }
    });
  }

  /**
   * Handle incoming data from stdout
   * @param {string} data - Raw data from stdout
   * @private
   */
  _handleData(data) {
    this.buffer += data;

    // Process complete JSON-RPC messages
    // Messages may be line-delimited or concatenated JSON objects
    this._processBuffer();
  }

  /**
   * Process the buffer for complete JSON-RPC messages
   * @private
   */
  _processBuffer() {
    // Try to parse line-delimited JSON
    const lines = this.buffer.split('\n');

    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed);
        this._handleMessage(message);
      } catch {
        // Not valid JSON, might be a partial message or non-JSON output
        // Try to extract JSON from the line
        const jsonMatch = trimmed.match(/\{.*\}/);
        if (jsonMatch) {
          try {
            const message = JSON.parse(jsonMatch[0]);
            this._handleMessage(message);
          } catch {
            // Emit as raw output for debugging
            this.emit('raw', trimmed);
          }
        } else {
          this.emit('raw', trimmed);
        }
      }
    }
  }

  /**
   * Handle a parsed JSON-RPC message
   * @param {Object} message - Parsed JSON-RPC message
   * @private
   */
  _handleMessage(message) {
    // Check if it's a response (has id and result/error)
    if (message.id !== undefined && message.id !== null) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new JsonRpcError(message.error.code, message.error.message, message.error.data));
        } else {
          pending.resolve(message.result);
        }
        return;
      }
    }

    // Check if it's a notification (has method but no id)
    if (message.method && message.id === undefined) {
      this.emit('notification', message);
      return;
    }

    // Emit as unknown message
    this.emit('message', message);
  }

  /**
   * Send a JSON-RPC request and wait for response
   * @param {string} method - The RPC method to call
   * @param {Object} params - Parameters for the method
   * @param {number} timeout - Timeout in milliseconds (optional)
   * @returns {Promise<any>} - The result from the RPC call
   */
  async call(method, params = {}, timeout = null) {
    if (!this.isConnected || !this.process) {
      throw new Error('Client is not connected');
    }

    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeoutMs = timeout || this.options.timeout;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      // Send the request
      const message = JSON.stringify(request) + '\n';
      try {
        this.process.stdin.write(message);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error(`Failed to send request: ${err.message}`));
      }
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   * @param {string} method - The RPC method to call
   * @param {Object} params - Parameters for the method
   */
  notify(method, params = {}) {
    if (!this.isConnected || !this.process) {
      throw new Error('Client is not connected');
    }

    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const message = JSON.stringify(notification) + '\n';
    this.process.stdin.write(message);
  }

  /**
   * Stop the subprocess
   */
  stop() {
    if (this.process) {
      // Clear all pending requests
      for (const [id, { reject, timer }] of this.pendingRequests.entries()) {
        clearTimeout(timer);
        reject(new Error('Client stopped'));
        this.pendingRequests.delete(id);
      }

      try {
        this.process.stdin.end();
      } catch {
        // Ignore errors during cleanup
      }

      try {
        this.process.kill();
      } catch {
        // Ignore errors during cleanup
      }

      this.process = null;
      this.isConnected = false;
    }
  }

  /**
   * Check if the client is connected
   * @returns {boolean}
   */
  get connected() {
    return this.isConnected && this.process && !this.process.killed;
  }
}

/**
 * Custom error class for JSON-RPC errors
 */
class JsonRpcError extends Error {
  constructor(code, message, data = null) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
    this.data = data;
  }
}

module.exports = { JsonRpcClient, JsonRpcError };
