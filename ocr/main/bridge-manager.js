'use strict';

const { SidecarManager, makeError } = require('./sidecar-manager');

/**
 * Capture Bridge process manager.
 * Same JSONL lifecycle as the OCR sidecar (hello / request / shutdown).
 */
class BridgeManager extends SidecarManager {
  constructor(options = {}) {
    super({
      helloTimeoutMs: options.helloTimeoutMs || 8000,
      requestTimeoutMs: options.requestTimeoutMs || 20000,
      processLabel: options.processLabel || 'Capture Bridge',
      ...options,
    });
  }
}

module.exports = {
  BridgeManager,
  makeError,
};
