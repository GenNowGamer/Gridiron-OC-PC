'use strict';

const { EventEmitter } = require('node:events');

class HotkeyManager extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.globalShortcut) throw new TypeError('globalShortcut dependency is required');
    this.globalShortcut = options.globalShortcut;
    this.accelerator = options.accelerator || 'CommandOrControl+Shift+O';
    this.callback = options.callback || (() => {});
    this.now = options.now || (() => Date.now());
    this.debounceMs = Number(options.debounceMs) || 300;
    this.lastTriggeredAt = 0;
    this.registered = false;
    this.lastError = null;
  }

  start() {
    if (this.registered) return this.getStatus();
    let registered = false;
    try {
      registered = Boolean(this.globalShortcut.register(this.accelerator, () => {
        const triggeredAt = this.now();
        if (triggeredAt - this.lastTriggeredAt < this.debounceMs) {
          this.emit('debounced', { accelerator: this.accelerator, triggeredAt });
          return;
        }
        this.lastTriggeredAt = triggeredAt;
        try {
          this.callback();
          this.emit('triggered', { accelerator: this.accelerator });
        } catch (error) {
          this.emit('callbackError', error);
        }
      }));
    } catch (error) {
      this.lastError = error.message;
      this.emit('registrationFailed', this.getStatus());
      return this.getStatus();
    }
    this.registered = registered;
    this.lastError = registered ? null : `Unable to register ${this.accelerator}`;
    this.emit(registered ? 'registered' : 'registrationFailed', this.getStatus());
    return this.getStatus();
  }

  configure(accelerator, callback = this.callback) {
    if (!accelerator || typeof accelerator !== 'string') {
      throw new TypeError('accelerator is required');
    }
    this.stop();
    this.accelerator = accelerator;
    this.callback = callback;
    return this.start();
  }

  stop() {
    if (this.registered) {
      try {
        this.globalShortcut.unregister(this.accelerator);
      } finally {
        this.registered = false;
      }
    }
    return this.getStatus();
  }

  getStatus() {
    return {
      accelerator: this.accelerator,
      registered: this.registered,
      error: this.lastError,
    };
  }
}

module.exports = { HotkeyManager };
