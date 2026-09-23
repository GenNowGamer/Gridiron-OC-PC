'use strict';

const { EventEmitter } = require('node:events');

function makeError(message, code, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

class SidecarManager extends EventEmitter {
  constructor(options = {}) {
    super();
    if (typeof options.spawn !== 'function') throw new TypeError('spawn dependency is required');
    if (!options.command) throw new TypeError('sidecar command is required');
    this.spawn = options.spawn;
    this.command = options.command;
    this.args = options.args || [];
    this.spawnOptions = options.spawnOptions || {};
    this.randomUUID = options.randomUUID || require('node:crypto').randomUUID;
    this.setTimer = options.setTimeout || setTimeout;
    this.clearTimer = options.clearTimeout || clearTimeout;
    this.helloTimeoutMs = options.helloTimeoutMs || 5000;
    this.helloRequestId = '__gridiron_hello__';
    this.requestTimeoutMs = options.requestTimeoutMs || 15000;
    this.processLabel = options.processLabel || 'Sidecar';
    this.backoffBaseMs = options.backoffBaseMs || 250;
    this.backoffMaxMs = options.backoffMaxMs || 10000;
    this.process = null;
    this.ready = false;
    this.desired = false;
    this.stopping = false;
    this.crashCount = 0;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.restartTimer = null;
    this.helloTimer = null;
    this._startPromise = null;
    this._resolveStart = null;
    this._rejectStart = null;
  }

  getStatus() {
    return {
      running: Boolean(this.process),
      ready: this.ready,
      desired: this.desired,
      crashCount: this.crashCount,
      pendingRequests: this.pending.size,
    };
  }

  start() {
    this.desired = true;
    this.stopping = false;
    if (this.ready) return Promise.resolve(this.getStatus());
    if (this._startPromise) return this._startPromise;

    this._startPromise = new Promise((resolve, reject) => {
      this._resolveStart = resolve;
      this._rejectStart = reject;
    });
    this._launch();
    return this._startPromise;
  }

  _launch() {
    if (!this.desired || this.process) return;
    let child;
    try {
      child = this.spawn(this.command, this.args.slice(), {
        stdio: ['pipe', 'pipe', 'pipe'],
        ...this.spawnOptions,
      });
    } catch (error) {
      this._handleExit(null, error);
      return;
    }

    this.process = child;
    this.ready = false;
    this.stdoutBuffer = '';
    child.stdout.on('data', (chunk) => this._consumeStdout(chunk));
    if (child.stderr && child.stderr.on) {
      child.stderr.on('data', (chunk) => this.emit('stderr', String(chunk)));
    }
    child.once('error', (error) => this._handleExit(child, error));
    child.once('close', (code, signal) => {
      this._handleExit(child, makeError(
        `${this.processLabel} exited (${code === null ? signal : code})`,
        'SIDECAR_EXIT',
        { code, signal },
      ));
    });
    this.helloTimer = this.setTimer(() => {
      const error = makeError(`${this.processLabel} hello timed out`, 'SIDECAR_HELLO_TIMEOUT');
      if (child.kill) child.kill();
      this._handleExit(child, error);
    }, this.helloTimeoutMs);
    this._send({ id: this.helloRequestId, command: 'hello', params: {} });
    this.emit('spawn', { command: this.command, args: this.args.slice() });
  }

  _consumeStdout(chunk) {
    this.stdoutBuffer += String(chunk);
    let newline;
    while ((newline = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        this._handleMessage(JSON.parse(line));
      } catch (error) {
        this.emit('protocolError', makeError(
          `Invalid sidecar JSONL: ${error.message}`,
          'SIDECAR_PROTOCOL',
          { line },
        ));
      }
    }
  }

  _handleMessage(message) {
    if (message && String(message.id) === this.helloRequestId && message.ok === true) {
      this.ready = true;
      this.crashCount = 0;
      this.clearTimer(this.helloTimer);
      this.helloTimer = null;
      if (this._resolveStart) this._resolveStart(this.getStatus());
      this._clearStartPromise();
      this.emit('ready', message.result || message);
      return;
    }
    if (message && message.id && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      this.clearTimer(entry.timer);
      if (message.ok === false || message.error) {
        const errBody = message.error || {};
        const baseMessage = errBody.message || String(message.error);
        const detailReason = errBody.details && (
          errBody.details.reason
          || errBody.details.message
          || errBody.details.code
        );
        const fullMessage = detailReason && !String(baseMessage).includes(String(detailReason))
          ? `${baseMessage}: ${detailReason}`
          : baseMessage;
        entry.reject(makeError(
          fullMessage,
          errBody.code || 'SIDECAR_ERROR',
          errBody,
        ));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    this.emit('message', message);
  }

  async request(method, params = {}, options = {}) {
    if (!method) throw new TypeError('method is required');
    await this.start();
    if (!this.process || !this.ready) throw makeError('Sidecar is not ready', 'SIDECAR_NOT_READY');
    const id = options.id || this.randomUUID();
    const timeoutMs = options.timeoutMs || this.requestTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = this.setTimer(() => {
        this.pending.delete(id);
        if (method === 'capture.analyze_burst') {
          try {
            this._send({
              id: `cancel-${id}`,
              command: 'capture.cancel',
              params: { requestId: id },
            });
          } catch (_) {}
        }
        reject(makeError(`Sidecar request timed out: ${method}`, 'SIDECAR_TIMEOUT', { id, method }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this._send({ id, command: method, params });
      } catch (error) {
        this.pending.delete(id);
        this.clearTimer(timer);
        reject(error);
      }
    });
  }

  cancel(id, reason = 'cancelled') {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    this.clearTimer(entry.timer);
    this._send({
      id: `cancel-${id}`,
      command: 'capture.cancel',
      params: { requestId: id },
    });
    entry.reject(makeError(`Sidecar request ${reason}`, 'SIDECAR_CANCELLED', { id }));
    return true;
  }

  _send(message) {
    if (!this.process || !this.process.stdin || !this.process.stdin.writable) {
      throw makeError('Sidecar stdin is unavailable', 'SIDECAR_NOT_RUNNING');
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _handleExit(child, error) {
    if (child && this.process !== child) return;
    this.clearTimer(this.helloTimer);
    this.helloTimer = null;
    this.process = null;
    this.ready = false;
    this.stdoutBuffer = '';

    for (const [id, entry] of this.pending) {
      this.clearTimer(entry.timer);
      entry.reject(makeError(error.message, error.code || 'SIDECAR_CRASH', { id }));
    }
    this.pending.clear();

    if (this._rejectStart) this._rejectStart(error);
    this._clearStartPromise();
    this.emit('exit', error);
    if (this.desired && !this.stopping) this._scheduleRestart();
  }

  _scheduleRestart() {
    if (this.restartTimer) return;
    const delay = Math.min(this.backoffMaxMs, this.backoffBaseMs * (2 ** this.crashCount));
    this.crashCount += 1;
    this.emit('restartScheduled', { delay, crashCount: this.crashCount });
    this.restartTimer = this.setTimer(() => {
      this.restartTimer = null;
      if (!this._startPromise) {
        this._startPromise = new Promise((resolve, reject) => {
          this._resolveStart = resolve;
          this._rejectStart = reject;
        });
        this._startPromise.catch(() => {});
      }
      this._launch();
    }, delay);
  }

  async stop() {
    this.desired = false;
    this.stopping = true;
    this.clearTimer(this.restartTimer);
    this.clearTimer(this.helloTimer);
    this.restartTimer = null;
    this.helloTimer = null;
    const child = this.process;
    if (child) {
      try {
        this._send({ id: '__gridiron_shutdown__', command: 'shutdown', params: {} });
      } catch (_) {
        // Process may already be exiting.
      }
      if (child.kill) child.kill();
    }
    this._handleExit(child, makeError('Sidecar stopped', 'SIDECAR_STOPPED'));
    this.stopping = false;
    return this.getStatus();
  }

  _clearStartPromise() {
    this._startPromise = null;
    this._resolveStart = null;
    this._rejectStart = null;
  }
}

module.exports = {
  SidecarManager,
  makeError,
};
