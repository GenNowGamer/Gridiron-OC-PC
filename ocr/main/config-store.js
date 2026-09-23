'use strict';

const REMOVED_OCR_FIELDS = new Set(['quarter_clock', 'scores', 'quarter', 'game_clock']);

const DEFAULT_STATE = Object.freeze({
  version: 1,
  featureFlags: Object.freeze({
    capture: false,
    exactCalls: false,
    learning: false,
  }),
  profiles: Object.freeze([]),
  activeProfileId: '',
  config: Object.freeze({
    hotkey: 'CommandOrControl+Shift+D',
    obs: Object.freeze({ host: '127.0.0.1', port: 4455, password: '' }),
    capture: Object.freeze({
      adapter: 'capture-bridge',
      pluginFallback: false,
      freshFrameTimeoutMs: 1000,
      settleDelayMs: 100,
      frameCount: 3,
      intervalMs: 80,
      sourceId: '',
    }),
    context: Object.freeze({ team: '', opponent: '', role: '', quarter: 1, userScore: 0, oppScore: 0 }),
    retainDebugFrames: false,
  }),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stripRemovedProfileRegions(profiles) {
  return (Array.isArray(profiles) ? profiles : []).map((profile) => {
    const next = clone(profile || {});
    if (Array.isArray(next.regions)) {
      next.regions = next.regions.filter((region) =>
        !REMOVED_OCR_FIELDS.has(String(region && (region.field || region.id) || '').trim()));
    }
    return next;
  });
}

function mergeState(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    ...clone(DEFAULT_STATE),
    ...input,
    version: DEFAULT_STATE.version,
    featureFlags: {
      ...clone(DEFAULT_STATE.featureFlags),
      ...(input.featureFlags || {}),
    },
    profiles: stripRemovedProfileRegions(input.profiles),
    activeProfileId: typeof input.activeProfileId === 'string' ? input.activeProfileId : '',
    config: {
      ...clone(DEFAULT_STATE.config),
      ...(input.config || {}),
      obs: { ...clone(DEFAULT_STATE.config.obs), ...(input.config && input.config.obs || {}) },
      capture: { ...clone(DEFAULT_STATE.config.capture), ...(input.config && input.config.capture || {}) },
      context: { ...clone(DEFAULT_STATE.config.context), ...(input.config && input.config.context || {}) },
    },
  };
}

class VersionedConfigStore {
  constructor(options = {}) {
    if (!options.userData) throw new TypeError('userData is required');
    this.fs = options.fs || require('node:fs/promises');
    this.path = options.path || require('node:path');
    this.userData = options.userData;
    this.fileName = options.fileName || 'vision-profiles-v1.json';
    this.randomUUID = options.randomUUID || require('node:crypto').randomUUID;
    this.migrations = options.migrations || {};
    this.state = clone(DEFAULT_STATE);
    this.loaded = false;
  }

  get filePath() {
    return this.path.join(this.userData, this.fileName);
  }

  async load() {
    try {
      const parsed = JSON.parse(await this.fs.readFile(this.filePath, 'utf8'));
      this.state = this._migrate(parsed);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = clone(DEFAULT_STATE);
      await this._writeAtomic(this.state);
    }
    this.loaded = true;
    return this.get();
  }

  get() {
    return clone(this.state);
  }

  async replace(nextState) {
    this.state = mergeState(nextState);
    await this._writeAtomic(this.state);
    return this.get();
  }

  async update(patch) {
    const current = this.get();
    const next = typeof patch === 'function' ? patch(current) : {
      ...current,
      ...patch,
      featureFlags: { ...current.featureFlags, ...(patch && patch.featureFlags || {}) },
      config: { ...current.config, ...(patch && patch.config || {}) },
    };
    return this.replace(next);
  }

  async setFeatureFlag(name, enabled) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_STATE.featureFlags, name)) {
      throw new RangeError(`Unknown OCR feature flag: ${name}`);
    }
    return this.update({ featureFlags: { [name]: Boolean(enabled) } });
  }

  _migrate(input) {
    let value = input && typeof input === 'object' ? clone(input) : {};
    let version = Number.isInteger(value.version) ? value.version : 0;
    if (version > DEFAULT_STATE.version) {
      throw new Error(`Unsupported OCR config version: ${version}`);
    }
    while (version < DEFAULT_STATE.version) {
      const migrate = this.migrations[version];
      value = migrate ? migrate(value) : { ...value, version: version + 1 };
      version += 1;
    }
    return mergeState(value);
  }

  async _writeAtomic(value) {
    await this.fs.mkdir(this.userData, { recursive: true });
    const tempPath = `${this.filePath}.${this.randomUUID()}.tmp`;
    const json = `${JSON.stringify(value, null, 2)}\n`;
    try {
      await this.fs.writeFile(tempPath, json, { encoding: 'utf8', mode: 0o600 });
      await this.fs.rename(tempPath, this.filePath);
    } catch (error) {
      await this.fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }
}

module.exports = {
  DEFAULT_STATE,
  VersionedConfigStore,
  mergeState,
};
