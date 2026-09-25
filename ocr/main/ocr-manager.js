'use strict';

/**
 * QUARANTINED — do not use in production.
 *
 * Legacy OcrManager issues a nonexistent sidecar command (`ocr`). The live
 * path is IntegrationOcrManager (`capture.analyze_burst` / `profile.test`).
 * This module remains only so historical unit fixtures that import store /
 * ledger helpers via the OCR main barrel do not break. captureNow always
 * rejects with OCR_QUARANTINED.
 */

const { EventEmitter } = require('node:events');
const { VersionedConfigStore } = require('./config-store');
const { EventLedger } = require('./event-ledger');
const { SidecarManager } = require('./sidecar-manager');
const { HotkeyManager } = require('./hotkey-manager');

function ipcValue(value) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code, details: value.details };
  }
  if (Buffer.isBuffer(value)) return { type: 'Buffer', data: Array.from(value) };
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

class OcrManager extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.userData && !options.store) throw new TypeError('userData or store is required');
    this.quarantined = true;
    this.now = options.now || (() => Date.now());
    this.capture = options.capture || null;
    this.store = options.store || new VersionedConfigStore({
      userData: options.userData,
      fs: options.fs,
      path: options.path,
      randomUUID: options.randomUUID,
    });
    this.ledger = options.ledger || new EventLedger({
      userData: options.userData,
      fs: options.fs,
      path: options.path,
      now: this.now,
      randomUUID: options.randomUUID,
    });
    this.sidecar = options.sidecar || (options.sidecarOptions
      ? new SidecarManager(options.sidecarOptions)
      : null);
    this.hotkey = options.hotkey || (options.globalShortcut
      ? new HotkeyManager({ globalShortcut: options.globalShortcut })
      : null);
    this.initialized = false;
    this.busy = false;
    this.lastCapture = null;
    this._wireEvents();
  }

  _wireEvents() {
    if (this.sidecar && this.sidecar.on) {
      for (const name of ['ready', 'exit', 'protocolError', 'restartScheduled', 'stderr']) {
        this.sidecar.on(name, (value) => this._emitSafe(`sidecar:${name}`, value));
      }
    }
    if (this.hotkey && this.hotkey.on) {
      for (const name of ['registered', 'registrationFailed', 'callbackError']) {
        this.hotkey.on(name, (value) => this._emitSafe(`hotkey:${name}`, value));
      }
    }
  }

  async initialize() {
    const [state, snapshot] = await Promise.all([this.store.load(), this.ledger.initialize()]);
    this.initialized = true;
    if (this.hotkey) {
      this.hotkey.accelerator = state.config.hotkey;
      this.hotkey.callback = () => {
        this.captureNow({ source: 'hotkey' }).catch((error) => this._emitSafe('capture:error', error));
      };
    }
    await this._syncServices(state);
    const result = { status: this.getStatus(), learning: snapshot, quarantined: true };
    this._emitSafe('initialized', result);
    return ipcValue(result);
  }

  getStatus() {
    const state = this.store.get();
    return ipcValue({
      initialized: this.initialized,
      busy: this.busy,
      quarantined: true,
      featureFlags: state.featureFlags,
      hotkey: this.hotkey ? this.hotkey.getStatus() : { available: false },
      sidecar: this.sidecar ? this.sidecar.getStatus() : { available: false },
      lastCapture: this.lastCapture,
    });
  }

  async setFeatureFlag(name, enabled) {
    const state = await this.store.setFeatureFlag(name, enabled);
    await this._syncServices(state);
    const result = { featureFlags: state.featureFlags, status: this.getStatus() };
    this._emitSafe('config:changed', result);
    return ipcValue(result);
  }

  async setHotkey(accelerator) {
    const state = await this.store.update({ config: { hotkey: accelerator } });
    let status = { available: false };
    if (this.hotkey) {
      this.hotkey.accelerator = state.config.hotkey;
      if (state.featureFlags.enabled && state.featureFlags.capture) {
        status = this.hotkey.configure(state.config.hotkey, () => {
          this.captureNow({ source: 'hotkey' }).catch((error) => this._emitSafe('capture:error', error));
        });
      } else {
        status = this.hotkey.getStatus();
      }
    }
    const result = { config: state.config, hotkey: status };
    this._emitSafe('config:changed', result);
    return ipcValue(result);
  }

  async _syncServices(state = this.store.get()) {
    const active = state.featureFlags.enabled;
    const captureActive = active && state.featureFlags.capture;
    if (this.hotkey) {
      if (captureActive) this.hotkey.start();
      else this.hotkey.stop();
    }
    if (this.sidecar) {
      if (active) await this.sidecar.start();
      else await this.sidecar.stop();
    }
  }

  async captureNow() {
    throw Object.assign(
      new Error('Legacy OcrManager is quarantined; use IntegrationOcrManager (capture.analyze_burst).'),
      { code: 'OCR_QUARANTINED' },
    );
  }

  async submitFeedback(payload) {
    if (!this.store.get().featureFlags.learning) {
      throw Object.assign(new Error('OCR learning is disabled'), { code: 'LEARNING_DISABLED' });
    }
    const result = await this.ledger.recordFeedback(ipcValue(payload));
    this._emitSafe('learning:changed', result.snapshot);
    return ipcValue(result);
  }

  async undoLearning(eventId) {
    const result = await this.ledger.undo(eventId);
    this._emitSafe('learning:changed', result.snapshot);
    return ipcValue(result);
  }

  async resetLearning(reason) {
    const result = await this.ledger.reset(reason);
    this._emitSafe('learning:changed', result.snapshot);
    return ipcValue(result);
  }

  exportLearning(destination) {
    return this.ledger.exportTo(destination).then(ipcValue);
  }

  getLearningSnapshot() {
    return this.ledger.getSnapshot().then(ipcValue);
  }

  async handle(method, args = {}) {
    const methods = {
      getStatus: () => this.getStatus(),
      setFeatureFlag: () => this.setFeatureFlag(args.name, args.enabled),
      setHotkey: () => this.setHotkey(args.accelerator),
      captureNow: () => this.captureNow(args),
      submitFeedback: () => this.submitFeedback(args.payload),
      undoLearning: () => this.undoLearning(args.eventId),
      resetLearning: () => this.resetLearning(args.reason),
      exportLearning: () => this.exportLearning(args.destination),
      getLearningSnapshot: () => this.getLearningSnapshot(),
    };
    if (!methods[method]) throw Object.assign(new Error(`Unknown OCR method: ${method}`), { code: 'OCR_METHOD_NOT_FOUND' });
    return ipcValue(await methods[method]());
  }

  async stop() {
    if (this.hotkey) this.hotkey.stop();
    if (this.sidecar) await this.sidecar.stop();
    this.initialized = false;
    return this.getStatus();
  }

  _emitSafe(type, payload) {
    this.emit('event', { type, payload: ipcValue(payload), at: this.now() });
  }
}

module.exports = {
  OcrManager,
  ipcValue,
  QUARANTINED: true,
};
