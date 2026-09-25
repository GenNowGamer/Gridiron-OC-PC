'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { VersionedConfigStore } = require('./config-store');
const { EventLedger, buildLearningSnapshot } = require('./event-ledger');
const { SidecarManager } = require('./sidecar-manager');
const { BridgeManager } = require('./bridge-manager');
const { HotkeyManager } = require('./hotkey-manager');
const Matcher = require('../shared/textCatalogMatcher');
const HudText = require('../shared/hudTextNormalize');
const StateValidator = require('../shared/footballStateValidator');
const Outcome = require('../shared/defensiveOutcomeInference');
const SnapLifecycle = require('../shared/snapLifecycle');
const Confidence = require('../shared/confidenceCalibration');
const Penalties = require('../../shared/penaltyCatalog');
const { OcrDebugPack } = require('./debug-pack');

const REQUIRED_FIELDS = new Set([
  'down_distance',
  'field_position',
  'offense_formation_personnel',
]);
const CATALOG_FIELDS = new Set([
  'offense_formation_personnel',
  'offense_formation',
  'offense_personnel',
  'previous_offense_play',
  'previous_defense_play',
]);
const MULTILINE_FIELDS = new Set([
  'offense_formation_personnel',
  'previous_offense_play',
  'previous_defense_play',
]);
const REMOVED_OCR_FIELDS = new Set(['quarter_clock', 'scores', 'quarter', 'game_clock']);
const MAX_DIAGNOSTIC_SAMPLES = 200;

function normalizePresentation(value) {
  return clean(value).toLowerCase().replace(/\s+/g, ' ');
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function contextKey(context = {}) {
  return [context.team, context.opponent, context.role || context.hostRole]
    .map((value) => clean(value).toLowerCase()).join('|');
}

function snapSpot(state = {}) {
  return JSON.stringify([state.down, state.yardsToGo, state.goalToGo === true,
    state.fieldSide || state.side, state.fieldYardLine ?? state.yardLine]);
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function percentile(values, p) {
  if (!values.length) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * p) - 1)];
}

function defaultRoiPsm(fieldId) {
  return MULTILINE_FIELDS.has(clean(fieldId)) ? 6 : 7;
}

function defaultRoiWhitelist(fieldId) {
  const id = clean(fieldId);
  // down_distance: no char whitelist. Restricting to digits/ordinals biased
  // Tesseract toward bare digit soup ("34", "2010"). Grammar+catalog post-parse
  // is the deterministic gate instead.
  if (id === 'down_distance') return '';
  if (id === 'field_position') return 'OWNOPPownopp0123456789^vV ';
  return '';
}

function sidecarRoi(region) {
  const fieldId = clean(region.field || region.id);
  const preprocessing = region.preprocessing || region.preprocess || {};
  const threshold = preprocessing.threshold === 'global' ? 'binary' : (preprocessing.threshold || 'none');
  const explicitPsm = Number(region.ocr && region.ocr.psm);
  // Down/field HUD glyphs are tiny — never let scale sit below 3 for those ROIs.
  let scale = Number(preprocessing.scale);
  if (!Number.isFinite(scale) || scale < 1) scale = 1;
  if (fieldId === 'down_distance' || fieldId === 'field_position') {
    scale = Math.max(scale, 3);
  }
  return {
    id: fieldId,
    x: Number(region.x),
    y: Number(region.y),
    width: Number(region.width),
    height: Number(region.height),
    preprocess: {
      grayscale: preprocessing.grayscale !== false,
      scale: Math.max(1, Math.min(6, scale)),
      invert: preprocessing.invert === true,
      threshold,
      thresholdValue: Number(preprocessing.thresholdValue) || 128,
      blur: Number(preprocessing.blur) || 1,
      morphology: preprocessing.morphology || 'none',
      kernel: Number(preprocessing.kernel) || 3,
    },
    ocr: {
      language: clean(region.ocr && region.ocr.language) || 'eng',
      psm: Number.isFinite(explicitPsm) && explicitPsm > 0 ? explicitPsm : defaultRoiPsm(fieldId),
      // Always re-apply curated HUD whitelists so older saved profiles cannot
      // permanently strip digits / bias down_distance toward digit soup.
      whitelist: (fieldId === 'down_distance' || fieldId === 'field_position')
        ? defaultRoiWhitelist(fieldId)
        : (clean(region.ocr && region.ocr.whitelist) || defaultRoiWhitelist(fieldId)),
      ...(region.ocr && region.ocr.mockText != null ? {
        mockText: clean(region.ocr.mockText),
        mockConfidence: Number(region.ocr.mockConfidence),
      } : {}),
    },
  };
}

function sidecarProfile(profile, options = {}) {
  const regions = Array.isArray(profile && profile.regions) ? profile.regions : [];
  const rois = regions
    .filter((region) => {
      const id = clean(region.field || region.id);
      return id && id !== 'calibration_anchor' && !REMOVED_OCR_FIELDS.has(id);
    })
    .map(sidecarRoi);
  const anchors = Array.isArray(profile && profile.anchors) && profile.anchors.length
    ? profile.anchors.map((anchor, index) => ({
      id: clean(anchor.id) || `anchor_${index + 1}`,
      x: Number(anchor.x),
      y: Number(anchor.y),
      width: Number(anchor.width),
      height: Number(anchor.height),
      ...(clean(anchor.templateImageBase64) ? { templateImageBase64: clean(anchor.templateImageBase64) } : {}),
    }))
    : regions
      .filter((region) => clean(region.field || region.id) === 'calibration_anchor')
      .map((region, index) => ({
        id: `anchor_${index + 1}`,
        x: Number(region.x),
        y: Number(region.y),
        width: Number(region.width),
        height: Number(region.height),
      }));
  const payload = {
    name: clean(profile && profile.name) || 'Madden presentation',
    presentation: clean(profile && profile.presentation),
    rois,
    anchors,
  };
  // Full-frame reference images are huge and must stay off the capture hot path.
  if (options.includeReference === true) {
    const referenceImage = clean(
      profile && profile.reference && (profile.reference.dataUrl || profile.reference.imageData || profile.reference.imageBase64),
    );
    if (referenceImage) payload.referenceImageBase64 = referenceImage;
  }
  return payload;
}

function parseDownDistance(value) {
  // Prefer the shared HUD parser — the legacy regex missed yards on labels like
  // "1st & 10" because `\b` does not match before `&`.
  const parsed = HudText.parseDownDistanceText(value);
  if (parsed && parsed.ok) {
    return {
      down: parsed.down,
      yardsToGo: parsed.goalToGo ? null : parsed.yardsToGo,
      goalToGo: parsed.goalToGo === true,
    };
  }
  const raw = clean(value);
  const down = Number(raw.match(/\b([1-4])(?:st|nd|rd|th)?\b/i)?.[1]);
  const distanceToken = raw.match(/(?:and|&)\s*(\d{1,2}|goal)\b/i)?.[1];
  return {
    down: Number.isFinite(down) ? down : null,
    yardsToGo: distanceToken && distanceToken.toLowerCase() !== 'goal' ? Number(distanceToken) : null,
    goalToGo: Boolean(distanceToken && distanceToken.toLowerCase() === 'goal'),
  };
}

function scoreboardState(scoreboard = {}) {
  const quarter = Number(scoreboard.quarter);
  const userScore = Number(scoreboard.userScore);
  const oppScore = Number(scoreboard.oppScore);
  return {
    quarter: Number.isFinite(quarter) && quarter >= 1 ? quarter : null,
    clockSeconds: null,
    homeScore: Number.isFinite(userScore) ? userScore : null,
    awayScore: Number.isFinite(oppScore) ? oppScore : null,
  };
}

function pickScoreboardNumber(candidates, fallback, options = {}) {
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (!Number.isFinite(value)) continue;
    if (options.min != null && value < options.min) continue;
    if (options.max != null && value > options.max) continue;
    return value;
  }
  return fallback;
}

function resolveScoreboard(primary = {}, secondary = {}, tertiary = {}) {
  return {
    quarter: pickScoreboardNumber(
      [primary.quarter, secondary.quarter, tertiary.quarter],
      1,
      { min: 1, max: 5 },
    ),
    userScore: pickScoreboardNumber(
      [primary.userScore, secondary.userScore, tertiary.userScore],
      0,
      { min: 0, max: 99 },
    ),
    oppScore: pickScoreboardNumber(
      [primary.oppScore, secondary.oppScore, tertiary.oppScore],
      0,
      { min: 0, max: 99 },
    ),
  };
}

function acceptedState(fields, scoreboard = {}) {
  const downField = fields.down_distance;
  const downDistance = downField && (downField.accepted || downField.value)
    ? parseDownDistance(downField.value)
    : { down: null, yardsToGo: null, goalToGo: false };
  const field = fields.field_position && fields.field_position.accepted
    ? fields.field_position.value
    : null;
  const fieldSide = clean(field && (field.side || field.Side));
  const rawYard = field && (field.yardLine != null ? field.yardLine : field.yard_line);
  const fieldYardLine = rawYard == null || rawYard === '' ? NaN : Number(rawYard);
  return {
    ...downDistance,
    ...scoreboardState(scoreboard),
    fieldSide: fieldSide || null,
    fieldYardLine: Number.isFinite(fieldYardLine) && fieldYardLine >= 1 && fieldYardLine <= 50
      ? fieldYardLine
      : null,
    side: fieldSide || null,
    yardLine: Number.isFinite(fieldYardLine) && fieldYardLine >= 1 && fieldYardLine <= 50
      ? fieldYardLine
      : null,
  };
}

function parseFormationPersonnelText(rawText) {
  return HudText.parseFormationPersonnelText(rawText);
}

function formationPersonnelFromValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      formation: clean(value.formation),
      set: clean(value.set),
      personnel: clean(value.personnel),
      label: clean(value.label || value.raw || [value.formation, value.set].filter(Boolean).join(' - ')),
    };
  }
  return parseFormationPersonnelText(value);
}

/** True when a and b differ by exactly one digit character (e.g. "0 6 TRAP" vs "5 6 TRAP"). */
function nearMissDigitSwap(a, b) {
  const left = clean(a).toUpperCase();
  const right = clean(b).toUpperCase();
  if (!left || !right || left === right || left.length !== right.length) return false;
  let diffs = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] === right[i]) continue;
    if (!/[0-9]/.test(left[i]) || !/[0-9]/.test(right[i])) return false;
    diffs += 1;
    if (diffs > 1) return false;
  }
  return diffs === 1;
}

function offenseShowingFromFields(fields = {}) {
  const combined = fields.offense_formation_personnel;
  if (combined && combined.value != null && combined.value !== '') {
    return formationPersonnelFromValue(combined.value);
  }
  return {
    formation: clean(fields.offense_formation && fields.offense_formation.value),
    set: clean(fields.offense_personnel && fields.offense_personnel.value),
    personnel: '',
    label: '',
  };
}

function uniqueFormationSetCatalog(entries = [], team) {
  const seen = new Set();
  const teamKey = clean(team).toUpperCase();
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const entryTeam = clean(entry.team).toUpperCase();
    if (teamKey && entryTeam && entryTeam !== teamKey) return false;
    const formation = clean(entry.formation);
    const set = clean(entry.set);
    if (!formation && !set) return false;
    const key = `${formation.toUpperCase()}|${set.toUpperCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((entry) => {
    const formation = clean(entry.formation);
    const set = clean(entry.set);
    const label = [formation, set].filter(Boolean).join(' - ');
    return {
      team: entry.team,
      name: label,
      formation,
      set,
      aliases: [
        label,
        [formation, set].filter(Boolean).join(' '),
        formation,
        set,
      ].filter(Boolean),
    };
  });
}

class IntegrationOcrManager extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.userData) throw new TypeError('userData is required');
    this.userData = options.userData;
    this.now = options.now || (() => Date.now());
    this.store = options.store || new VersionedConfigStore({ userData: this.userData });
    this.ledger = options.ledger || new EventLedger({ userData: this.userData, now: this.now });
    this.sidecar = options.sidecar || new SidecarManager(options.sidecarOptions || {});
    this.bridge = options.bridge || (
      options.bridgeOptions && options.bridgeOptions.command
        ? new BridgeManager(options.bridgeOptions)
        : null
    );
    this._bridgeSourceId = '';
    this.hotkey = options.hotkey || new HotkeyManager({
      globalShortcut: options.globalShortcut,
      accelerator: 'CommandOrControl+Shift+D',
    });
    this.loadCatalogs = options.loadCatalogs || (async () => ({ offensive: [], defensive: [] }));
    this.exportDirectory = options.exportDirectory || (() => this.userData);
    this.initialized = false;
    this.busy = false;
    this.lastCapture = null;
    this.previousAcceptedState = null;
    this.pendingSnap = null;
    this.lastCapturePriorPending = null;
    this.snapLifecycle = SnapLifecycle.createLifecycleState();
    this.lastCapturePriorLifecycle = null;
    this.sessionGeneration = 0;
    this.sessionContextKey = '';
    this.diagnosticSamples = [];
    this.decisionTracePath = path.join(this.userData, 'dc-capture-decisions-v1.jsonl');
    this.engineWarm = null;
    this.engineWarmError = null;
    this._engineWarmPromise = null;
    this.debugPack = options.debugPack || new OcrDebugPack({
      userData: this.userData,
      now: this.now,
    });
    this._wire();
  }

  _wire() {
    this.sidecar.on('ready', (payload) => {
      this.engineWarm = null;
      this.engineWarmError = null;
      this._engineWarmPromise = null;
      if (this.store.get().featureFlags.capture) this._warmEngine(true).catch(() => {});
      this._emit('status', { sidecar: payload, ...this.getStatus() });
    });
    this.sidecar.on('exit', (error) => {
      this.engineWarm = null;
      this.engineWarmError = clean(error && error.message) || 'OCR worker exited';
      this._engineWarmPromise = null;
      this._emit('status', { sidecarError: error.message, ...this.getStatus() });
    });
    if (this.bridge) {
      this.bridge.on('ready', (payload) => {
        this._emit('status', { bridge: payload, ...this.getStatus() });
      });
      this.bridge.on('exit', (error) => {
        this._emit('status', { bridgeError: error.message, ...this.getStatus() });
      });
    }
    this.hotkey.on('registrationFailed', (payload) => this._emit('status', { hotkey: payload }));
  }

  async initialize() {
    await Promise.all([this.store.load(), this.ledger.initialize()]);
    this.initialized = true;
    const state = this.store.get();
    this.hotkey.accelerator = state.config.hotkey;
    this.hotkey.callback = () => this.capture({ reason: 'hotkey' }).catch((error) => {
      this._emit('capture:error', { error: error.message, code: error.code });
    });
    await this._syncRuntime();
    if (state.config.retainDebugFrames === true) {
      await this.debugPack.setEnabled(true);
    }
    return this.getStatus();
  }

  _activeProfile(state = this.store.get()) {
    return state.profiles.find((profile) => profile.id === state.activeProfileId) || null;
  }

  _diagnostics() {
    const durations = this.diagnosticSamples.map((sample) => sample.captureMs);
    const adapters = [...new Set(this.diagnosticSamples.flatMap((sample) => sample.captureAdapters || []))];
    return {
      samples: this.diagnosticSamples.length,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      frameCount: this.diagnosticSamples.reduce((sum, sample) => sum + sample.frameCount, 0),
      duplicateFrames: this.diagnosticSamples.reduce((sum, sample) => sum + sample.duplicateFrames, 0),
      staleFrames: this.diagnosticSamples.reduce((sum, sample) => sum + sample.staleFrames, 0),
      fallbackFrames: this.diagnosticSamples.reduce((sum, sample) => sum + sample.fallbackFrames, 0),
      captureAdapters: adapters,
      configuredAdapter: this.store.get().config.capture.adapter,
    };
  }

  getStatus() {
    const state = this.store.get();
    return clone({
      initialized: this.initialized,
      busy: this.busy,
      config: {
        enabled: state.featureFlags.capture,
        exactCallsEnabled: state.featureFlags.exactCalls,
        learningEnabled: state.featureFlags.learning,
        hotkey: state.config.hotkey,
        activeProfileId: state.activeProfileId,
        obs: { host: state.config.obs.host, port: state.config.obs.port },
        retainDebugFrames: Boolean(state.config.retainDebugFrames),
        ...state.config.capture,
      },
      profiles: state.profiles,
      activeProfile: this._activeProfile(state),
      worker: this.sidecar.getStatus(),
      bridge: this.bridge ? this.bridge.getStatus() : { running: false, ready: false },
      engineReady: Boolean(this.engineWarm && this.engineWarm.engine),
      engineWarm: this.engineWarm,
      engineWarmError: this.engineWarmError,
      retainDebugFrames: Boolean(state.config.retainDebugFrames),
      debugSession: this.debugPack.sessionSummary(),
      hotkey: this.hotkey.getStatus(),
      diagnostics: this._diagnostics(),
      lastCapture: this.lastCapture,
    });
  }

  async _warmEngine(force = false) {
    if (!force && this.engineWarm && this.engineWarm.engine) return this.engineWarm;
    if (!force && this._engineWarmPromise) return this._engineWarmPromise;
    this.engineWarmError = null;
    this._engineWarmPromise = this.sidecar.request('engine.warm', { engine: 'auto' }, { timeoutMs: 90000 })
      .then((result) => {
        this.engineWarm = result;
        this.engineWarmError = null;
        this._emit('status', this.getStatus());
        return result;
      })
      .catch((error) => {
        this.engineWarm = null;
        this.engineWarmError = clean(error && error.message) || 'OCR engine warm-up failed';
        this._engineWarmPromise = null;
        this._emit('status', this.getStatus());
        throw error;
      });
    return this._engineWarmPromise;
  }

  async _syncRuntime() {
    const state = this.store.get();
    if (state.featureFlags.capture) {
      await this.sidecar.start();
      if (state.config.capture.adapter === 'capture-bridge' && this.bridge) {
        await this.bridge.start().catch((error) => {
          this._emit('status', { bridgeError: error.message, ...this.getStatus() });
        });
      }
      this.hotkey.configure(state.config.hotkey, () => {
        this.capture({ reason: 'hotkey' }).catch((error) => {
          this._emit('capture:error', { error: error.message, code: error.code });
        });
      });
      // Warm OCR off the capture path so live bursts reuse a ready engine.
      this._warmEngine(true).catch(() => {});
    } else {
      this.hotkey.stop();
      await this.sidecar.stop();
      if (this.bridge) await this.bridge.stop();
      this._bridgeSourceId = '';
      this.engineWarm = null;
      this.engineWarmError = null;
      this._engineWarmPromise = null;
    }
  }

  async updateConfig(patch = {}) {
    const current = this.store.get();
    const nextFlags = {
      capture: patch.enabled == null ? current.featureFlags.capture : patch.enabled === true,
      exactCalls: patch.exactCallsEnabled == null ? current.featureFlags.exactCalls : patch.exactCallsEnabled === true,
      learning: patch.learningEnabled == null ? current.featureFlags.learning : patch.learningEnabled === true,
    };
    const config = { ...current.config };
    if (patch.hotkey != null) config.hotkey = clean(patch.hotkey) || current.config.hotkey;
    if (patch.context) {
      const role = clean(patch.context.role || patch.context.hostRole || current.config.context.role).toLowerCase();
      config.context = {
        team: clean(patch.context.team).toUpperCase(),
        opponent: clean(patch.context.opponent).toUpperCase(),
        role: role === 'oc' || role === 'dc' ? role : (current.config.context.role || ''),
        quarter: Math.max(1, Math.min(5, Number(patch.context.quarter) || current.config.context.quarter || 1)),
        userScore: Math.max(0, Math.min(99, Number(patch.context.userScore) || 0)),
        oppScore: Math.max(0, Math.min(99, Number(patch.context.oppScore) || 0)),
      };
      this._alignContext(config.context);
    }
    if (patch.burstFrames != null || patch.frameCount != null || patch.settleDelayMs != null
        || patch.intervalMs != null || patch.adapter != null
        || patch.freshFrameTimeoutMs != null || patch.sourceId != null) {
      config.capture = {
        ...current.config.capture,
        adapter: 'capture-bridge',
        pluginFallback: false,
        freshFrameTimeoutMs: Math.max(10, Math.min(
          10000,
          Number(patch.freshFrameTimeoutMs) || current.config.capture.freshFrameTimeoutMs,
        )),
        frameCount: Math.max(1, Math.min(5, Number(patch.burstFrames ?? patch.frameCount) || current.config.capture.frameCount)),
        settleDelayMs: Math.max(0, Math.min(2000, Number(patch.settleDelayMs) || 0)),
        intervalMs: Math.max(0, Math.min(500, Number(patch.intervalMs) || current.config.capture.intervalMs)),
        sourceId: patch.sourceId != null
          ? clean(patch.sourceId)
          : (current.config.capture.sourceId || ''),
      };
    }
    if (patch.retainDebugFrames != null) {
      config.retainDebugFrames = patch.retainDebugFrames === true;
    }
    await this.store.update({ featureFlags: nextFlags, config });
    await this.debugPack.setEnabled(this.store.get().config.retainDebugFrames === true);
    await this._syncRuntime();
    this._emit('status', this.getStatus());
    return this.getStatus();
  }

  async _ensureBridge() {
    if (!this.bridge) {
      throw new Error('Capture Bridge is not packaged or configured for this install.');
    }
    await this.bridge.start();
    return this.bridge;
  }

  async _selectBridgeSource(sourceId) {
    const bridge = await this._ensureBridge();
    const id = clean(sourceId);
    if (!id) throw new Error('Select a capture source first.');
    if (this._bridgeSourceId !== id) {
      await bridge.request('source.select', { sourceId: id });
      this._bridgeSourceId = id;
    }
    return id;
  }

  async _configureCapture() {
    const current = this.store.get();
    const capture = current.config.capture;
    await this._ensureBridge();
    await this.sidecar.start();
    await this.sidecar.request('obs.configure', {
      adapter: 'capture-bridge',
      freshFrameTimeoutMs: capture.freshFrameTimeoutMs,
    });
    return current.config.capture;
  }

  async listSources() {
    const bridge = await this._ensureBridge();
    const result = await bridge.request('sources.list', {});
    const sources = Array.isArray(result.sources) ? result.sources.map((item) => ({
      id: clean(item.id || item.name),
      name: clean(item.label || item.name || item.id),
      kind: clean(item.kind) || 'unknown',
      hint: clean(item.hint),
      available: item.available !== false,
    })).filter((item) => item.id) : [];
    return { sources };
  }

  async captureReference(args = {}) {
    const state = this.store.get();
    const source = clean(
      args.source && (args.source.id || args.source.name) || args.source || state.config.capture.sourceId,
    );
    await this._selectBridgeSource(source);
    const result = await this.bridge.request('preview.frame', { width: Number(args.width) || 960 });
    await this.store.update({
      config: {
        ...state.config,
        capture: { ...state.config.capture, sourceId: source },
      },
    });
    return {
      reference: {
        source,
        dataUrl: result.imageData,
        width: Number(result.width) || 0,
        height: Number(result.height) || 0,
        hash: crypto.createHash('sha256').update(result.imageData || '').digest('hex'),
      },
    };
  }

  async _prepareLiveCapture(args = {}) {
    const state = this.store.get();
    const profile = this._activeProfile(state);
    const source = clean(
      (args.source && (args.source.id || args.source.name))
      || args.source
      || state.config.capture.sourceId
      || (profile && profile.source && (profile.source.id || profile.source.name)),
    );
    await this._configureCapture();
    if (state.config.capture.adapter === 'capture-bridge') {
      await this._selectBridgeSource(source);
      if (source && source !== state.config.capture.sourceId) {
        await this.store.update({
          config: {
            ...state.config,
            capture: { ...state.config.capture, sourceId: source },
          },
        });
      }
    }
    return { state: this.store.get(), profile, source };
  }

  async benchmarkCapture(args = {}) {
    const { state, profile, source } = await this._prepareLiveCapture(args);
    if (!profile) throw new Error('No active OCR profile.');
    const result = await this.sidecar.request('capture.benchmark', {
      source,
      frameCount: state.config.capture.frameCount,
      intervalMs: state.config.capture.intervalMs,
      adapter: state.config.capture.adapter,
      freshFrameTimeoutMs: state.config.capture.freshFrameTimeoutMs,
    });
    this.diagnosticSamples.push({
      captureMs: Number(result.elapsedMs) || 0,
      frameCount: Number(result.framesCaptured) || 0,
      duplicateFrames: Number(result.duplicateFrames) || 0,
      staleFrames: Number(result.staleFrames) || 0,
      fallbackFrames: Number(result.fallbackFrames) || 0,
      captureAdapters: Array.isArray(result.captureAdapters) ? result.captureAdapters : [],
    });
    if (this.diagnosticSamples.length > MAX_DIAGNOSTIC_SAMPLES) this.diagnosticSamples.shift();
    const diagnostics = this._diagnostics();
    this._emit('status', { diagnostics });
    return { sample: result, diagnostics };
  }

  async saveProfile(profile) {
    const normalized = clone(profile || {});
    if (!clean(normalized.id)) normalized.id = crypto.randomUUID();
    if (!clean(normalized.name)) throw new Error('Profile name is required.');
    if (Array.isArray(normalized.regions)) {
      normalized.regions = normalized.regions.filter((region) =>
        !REMOVED_OCR_FIELDS.has(clean(region.field || region.id)));
    }
    const prepared = sidecarProfile(normalized);
    if (!prepared.rois.length || prepared.rois.some((roi) => !roi.id)) throw new Error('At least one labeled ROI is required.');
    const state = this.store.get();
    const profiles = state.profiles.filter((entry) => entry.id !== normalized.id).concat(normalized);
    await this.store.update({ profiles, activeProfileId: normalized.id });
    this._emit('status', this.getStatus());
    return { profile: normalized };
  }

  async testProfile(args = {}) {
    const profile = args.profile || this._activeProfile();
    if (!profile) throw new Error('No OCR profile is active.');
    const state = this.store.get();
    await this.sidecar.start();
    await this._warmEngine();
    const params = {
      profile: sidecarProfile(profile),
      engine: args.engine || 'auto',
      includeImages: args.includeImages !== false,
      adapter: state.config.capture.adapter,
      freshFrameTimeoutMs: state.config.capture.freshFrameTimeoutMs,
    };
    const imagePath = clean(args.imagePath || (args.reference && args.reference.imagePath));
    // Prefer a live Capture Bridge frame over shipping a full 4K reference payload.
    if (imagePath) {
      params.imagePath = imagePath;
    } else if (args.useReferenceImage === true) {
      const imageData = args.reference && (args.reference.dataUrl || args.reference.imageData);
      if (imageData) params.imageBase64 = imageData;
    }
    if (!params.imagePath && !params.imageBase64) {
      const prepared = await this._prepareLiveCapture({
        ...args,
        source: profile.source,
      });
      params.source = prepared.source;
      params.adapter = prepared.state.config.capture.adapter;
      params.freshFrameTimeoutMs = prepared.state.config.capture.freshFrameTimeoutMs;
    }
    const started = this.now();
    const result = await this.sidecar.request('profile.test', params);
    const fields = await this._resolveFields(result.rois, {
      ...(args.context || {}),
      profile,
    });
    const response = {
      fields,
      timing: { totalMs: this.now() - started },
      anchorDrift: result.anchorDrift || null,
      engine: result.engine,
    };
    await this._recordDebugEvent('profile_test', {
      id: `test-${this.now()}`,
      at: this.now(),
      engine: result.engine || (this.engineWarm && this.engineWarm.engine),
      engineWarm: this.engineWarm,
      profileId: profile.id,
      presentation: profile.presentation,
      source: clean(profile.source && (profile.source.id || profile.source.name)),
      role: clean((args.context || {}).role),
      team: clean((args.context || {}).team),
      opponent: clean((args.context || {}).opponent),
      timing: response.timing,
      fields,
      rois: this._roiGeometry(profile),
      notes: 'calibration Test All',
    });
    return response;
  }

  async capture(args = {}) {
    const state = this.store.get();
    if (!state.featureFlags.capture) throw Object.assign(new Error('OCR capture is disabled.'), { code: 'OCR_DISABLED' });
    const profile = this._activeProfile(state);
    if (!profile) throw Object.assign(new Error('No active OCR profile.'), { code: 'OCR_PROFILE_REQUIRED' });
    if (this.busy) throw Object.assign(new Error('OCR capture already in progress.'), { code: 'OCR_BUSY' });
    if (!(this.engineWarm && this.engineWarm.engine)) {
      if (this._engineWarmPromise) {
        throw Object.assign(new Error('OCR engine is still warming up. Wait for Ready, then capture again.'), {
          code: 'OCR_ENGINE_WARMING',
        });
      }
      if (this.engineWarmError) {
        throw Object.assign(new Error(`OCR engine is not ready: ${this.engineWarmError}`), {
          code: 'OCR_ENGINE_NOT_READY',
        });
      }
      this._warmEngine().catch(() => {});
      throw Object.assign(new Error('OCR engine is still warming up. Wait for Ready, then capture again.'), {
        code: 'OCR_ENGINE_WARMING',
      });
    }
    this.busy = true;
    args = { ...state.config.context, ...args };
    this._alignContext(args);
    const generation = this.sessionGeneration;
    const started = this.now();
    this._emit('capture:started', { at: started });
    try {
      const expectedPresentation = normalizePresentation(profile.presentation);
      const providedPresentation = normalizePresentation(args.presentation || args.presentationLabel);
      if (expectedPresentation && providedPresentation && expectedPresentation !== providedPresentation) {
        throw Object.assign(new Error('Presentation label does not match the active OCR profile.'), {
          code: 'OCR_PRESENTATION_MISMATCH',
          expectedPresentation: profile.presentation,
          providedPresentation: args.presentation || args.presentationLabel,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, state.config.capture.settleDelayMs));
      const prepared = await this._prepareLiveCapture(args);
      const source = prepared.source;
      const retainDebug = state.config.retainDebugFrames === true;
      const result = await this.sidecar.request('capture.analyze_burst', {
        source,
        profile: sidecarProfile(profile),
        engine: args.engine || 'auto',
        frameCount: state.config.capture.frameCount,
        intervalMs: state.config.capture.intervalMs,
        adapter: state.config.capture.adapter,
        freshFrameTimeoutMs: state.config.capture.freshFrameTimeoutMs,
        includeImages: retainDebug,
      }, { timeoutMs: 10000 });
      const frameMeta = Array.isArray(result.frames) ? result.frames[0] : null;
      const expectedAspect = Number(profile.reference && profile.reference.aspectRatio);
      const actualAspect = frameMeta && frameMeta.height ? Number(frameMeta.width) / Number(frameMeta.height) : 0;
      if (expectedAspect && actualAspect && Math.abs(actualAspect / expectedAspect - 1) > 0.015) {
        throw Object.assign(new Error('Capture source aspect ratio no longer matches the active OCR profile.'), {
          code: 'OCR_PROFILE_MISMATCH',
          expectedAspect,
          actualAspect,
        });
      }
      if (result.anchorDrift && result.anchorDrift.rejected === true) {
        throw Object.assign(new Error('Calibration anchors indicate material presentation drift.'), {
          code: 'OCR_PRESENTATION_MISMATCH',
          anchorDrift: result.anchorDrift,
        });
      }
      const completed = this.now();
      const fields = await this._resolveFields(result.rois, { ...args, profile });
      this._assertSession(generation);
      const currentState = acceptedState(fields, args);
      const transition = this.previousAcceptedState
        ? StateValidator.validateTransition(this.previousAcceptedState, currentState)
        : { accepted: true, reasons: [], warnings: [] };
      // Live captures are intermittent — missing snaps (e.g. 1st → 3rd) must not
      // discard an otherwise valid HUD read. Hard integrity failures only un-accept
      // the implicated field (empty down must not wipe a good field_position).
      if (!transition.accepted) {
        const hardReasons = (transition.reasons || []).filter((reason) => (
          /out_of_range|score_decreased|quarter_moved_backward/.test(String(reason || ''))
        ));
        if (hardReasons.length) {
          const affectsDown = hardReasons.some((reason) => /^(down_|distance_)/.test(String(reason)));
          const affectsField = hardReasons.some((reason) => /field|yard/.test(String(reason)));
          for (const field of Object.values(fields)) {
            const key = field && field.key;
            const wipe = (key === 'down_distance' && affectsDown)
              || (key === 'field_position' && affectsField);
            if (!wipe) continue;
            field.accepted = false;
            field.acceptanceReasons = [
              ...(Array.isArray(field.acceptanceReasons) ? field.acceptanceReasons : []),
              ...hardReasons.map((reason) => `transition:${reason}`),
            ];
          }
        }
      }
      const capture = {
        id: crypto.randomUUID(),
        at: completed,
        profileId: profile.id,
        presentation: clean(profile.presentation),
        source,
        fields,
        scoreboard: resolveScoreboard(args, state.config.context),
        validation: transition,
        timing: { captureMs: Number(result.elapsedMs) || completed - started, totalMs: completed - started },
        frameCount: Number(result.framesCaptured) || 0,
        engine: result.engine,
        anchorDrift: result.anchorDrift || null,
        rawFramesRetained: retainDebug,
      };
      this.lastCapturePriorPending = clone(this.pendingSnap);
      this.lastCapturePriorLifecycle = clone(this.snapLifecycle);
      capture.learningRecorded = await this._reconcileSnap(capture, args, state, this.lastCapturePriorPending);
      this._assertSession(generation);
      await this._appendDecisionTrace(capture, result);
      await this._recordDebugEvent('capture', {
        id: capture.id,
        at: capture.at,
        engine: capture.engine || (this.engineWarm && this.engineWarm.engine),
        engineWarm: this.engineWarm,
        profileId: capture.profileId,
        presentation: capture.presentation,
        source: capture.source,
        role: clean(args.role || args.hostRole || state.config.context.role),
        team: clean(args.team || state.config.context.team),
        opponent: clean(args.opponent || state.config.context.opponent),
        timing: capture.timing,
        validation: capture.validation,
        frameCount: capture.frameCount,
        duplicateFrames: Number(result.duplicateFrames) || 0,
        staleFrames: Number(result.staleFrames) || 0,
        captureAdapters: result.captureAdapters || [],
        fields,
        rois: this._roiGeometry(profile),
      });
      const hardTransitionFailure = !transition.accepted && (transition.reasons || []).some((reason) => (
        /out_of_range|score_decreased|quarter_moved_backward/.test(String(reason || ''))
      ));
      // Advance baseline on soft transition mismatches so intermittent live
      // captures do not keep failing against a stale prior snap.
      this._assertSession(generation);
      this.previousAcceptedState = hardTransitionFailure
        ? this.previousAcceptedState
        : (fields.down_distance && fields.down_distance.accepted ? currentState : this.previousAcceptedState);
      this.lastCapture = capture;
      this._recordDiagnostics(capture, result);
      const learningSnapshot = state.featureFlags.learning ? await this.ledger.getSnapshot() : null;
      this._assertSession(generation);
      this._emit('capture:complete', { capture, learningSnapshot });
      return { capture, diagnostics: this._diagnostics(), learningSnapshot };
    } finally {
      this.busy = false;
    }
  }

  async _resolveFields(rois = {}, context = {}) {
    const catalogs = await this.loadCatalogs();
    this.resolvedCatalogs = catalogs;
    const fields = {};
    const catalogMatchOpts = {
      minScore: 0.82,
      ambiguityMargin: 0.08,
      requireRawAgreement: true,
      minAgreementSimilarity: 0.82,
      minTokenOverlapRatio: 0.5,
      foldDigits: false,
    };
    // DC: previous offense = opponent, previous defense = user team, upcoming formation = opponent.
    // OC: previous offense = user team, previous defense = opponent (formation ROI is usually empty).
    const role = clean(context.role || context.hostRole || context.coordinatorRole).toLowerCase();
    const isOcRole = role === 'oc' || role === 'offense';
    const offenseCatalogTeam = isOcRole
      ? clean(context.team).toUpperCase()
      : clean(context.opponent).toUpperCase();
    const defenseCatalogTeam = isOcRole
      ? clean(context.opponent).toUpperCase()
      : clean(context.team).toUpperCase();
    const formationCatalogTeam = clean(context.opponent).toUpperCase() || offenseCatalogTeam;
    for (const [key, result] of Object.entries(rois || {})) {
      const rawText = clean(result.text);
      const sanitized = HudText.sanitizeHudText(rawText);
      const ocrConfidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));
      const framesAgree = Math.max(0, Math.min(1, Number(result.agreement == null ? 1 : result.agreement)));
      let value = sanitized || rawText;
      let matchedLabel = '';
      let resolverConfidence = sanitized ? 1 : 0;
      let alternatives = [];
      let rejectedForRawDisagreement = false;

      if (key === 'down_distance' && sanitized) {
        const parsed = HudText.parseDownDistanceText(sanitized);
        value = parsed.ok ? parsed.label : null;
        resolverConfidence = parsed.ok ? 1 : 0;
        if (parsed.ok) matchedLabel = parsed.label;
        else rejectedForRawDisagreement = true;
      } else if (key === 'field_position' && (sanitized || rawText)) {
        const sideHint = clean(result.fieldSide || result.side).toUpperCase();
        const parsed = HudText.parseFieldPositionText(rawText || sanitized, {
          sideHint: sideHint === 'OWN' || sideHint === 'OPP' ? sideHint : '',
        });
        value = parsed.ok
          ? { side: parsed.side, yardLine: parsed.yardLine, label: parsed.label }
          : parsed.label;
        resolverConfidence = parsed.ok
          ? (parsed.side ? 0.98 : 0.85)
          : 0.35;
        if (parsed.ok && parsed.side) matchedLabel = parsed.label;
        if (Array.isArray(parsed.alternatives) && parsed.alternatives.length) {
          alternatives = parsed.alternatives.map((entry) => ({
            value: entry,
            confidence: 0.55,
          }));
        }
        // Stash glyph/hint for accept gating below.
        result._fieldGlyphSide = parsed.glyphSide || (
          typeof HudText.fieldSideFromArrowGlyphs === 'function'
            ? HudText.fieldSideFromArrowGlyphs(rawText || sanitized)
            : null
        );
        result._fieldSideHint = sideHint === 'OWN' || sideHint === 'OPP' ? sideHint : '';
      } else if (CATALOG_FIELDS.has(key) && sanitized) {
        const defensive = key === 'previous_defense_play';
        const previousPlay = key === 'previous_offense_play' || key === 'previous_defense_play';
        let emptyPreviousPlay = false;
        // Drive-start / no prior snap: Madden shows "--". Do not invent a play.
        if (
          previousPlay
          && typeof HudText.isEmptyPreviousPlayOcr === 'function'
          && (HudText.isEmptyPreviousPlayOcr(rawText) || HudText.isEmptyPreviousPlayOcr(sanitized))
        ) {
          value = null;
          matchedLabel = '';
          resolverConfidence = 1;
          emptyPreviousPlay = true;
          alternatives = [];
        }
        const showing = offenseShowingFromFields(fields);
        let catalog = defensive ? catalogs.defensive : catalogs.offensive;
        // Previous-play OCR is from the prior snap — do not hard-filter by the
        // upcoming formation/set currently on the play-call sheet.
        let scope = defensive
          ? (previousPlay
            ? { team: defenseCatalogTeam }
            : { team: defenseCatalogTeam, formation: context.defenseFormation, set: context.defenseSet })
          : (previousPlay
            ? { team: offenseCatalogTeam }
            : {
              team: formationCatalogTeam,
              formation: showing.formation || clean(context.offenseFormation),
              set: showing.set || clean(context.offenseSet),
            });
        if (key === 'offense_formation_personnel') {
          const parsed = parseFormationPersonnelText(rawText);
          const pairs = uniqueFormationSetCatalog(catalogs.offensive, formationCatalogTeam);
          const formationCatalog = [];
          const seenFormations = new Set();
          for (const entry of pairs) {
            const candidate = clean(entry.formation).toUpperCase();
            if (!candidate || seenFormations.has(candidate)) continue;
            seenFormations.add(candidate);
            formationCatalog.push({
              team: entry.team,
              name: entry.formation,
              formation: entry.formation,
            });
          }
          const formationMatch = Matcher.matchCatalogText(
            parsed.formation || sanitized,
            formationCatalog,
            { team: formationCatalogTeam },
            { ...catalogMatchOpts, minScore: 0.78 },
          );
          const matchedFormation = clean(
            formationMatch.match && formationMatch.match.formation,
          ) || parsed.formation;
          const setCatalog = pairs
            .filter((entry) => !matchedFormation
              || clean(entry.formation).toUpperCase() === clean(matchedFormation).toUpperCase())
            .map((entry) => ({
              team: entry.team,
              name: entry.set,
              formation: entry.formation,
              set: entry.set,
              aliases: [entry.set, entry.name].filter(Boolean),
            }));
          const setQuery = parsed.set || parsed.personnel || sanitized;
          const setMatch = Matcher.matchCatalogText(
            setQuery,
            setCatalog,
            { team: formationCatalogTeam, formation: matchedFormation },
            { ...catalogMatchOpts, minScore: 0.78 },
          );
          const matchedSet = clean(setMatch.match && setMatch.match.set) || parsed.set;
          const catalogHit = Boolean(formationMatch.match || setMatch.match);
          value = {
            formation: matchedFormation,
            set: matchedSet,
            personnel: parsed.personnel,
            label: [matchedFormation, matchedSet, parsed.personnel].filter(Boolean).join(' - ')
              || parsed.label
              || sanitized,
          };
          matchedLabel = value.label;
          resolverConfidence = catalogHit
            ? Math.min(1, ((Number(formationMatch.score) || 0) * 0.45) + ((Number(setMatch.score) || 0) * 0.55))
            : 0.35;
          rejectedForRawDisagreement = Boolean(
            formationMatch.rejectedForRawDisagreement || setMatch.rejectedForRawDisagreement,
          );
          alternatives = [
            ...(formationMatch.alternatives || []).slice(0, 2),
            ...(setMatch.alternatives || []).slice(0, 2),
          ].map((entry) => ({
            value: entry.entry,
            confidence: entry.score,
          }));
          // OC HUDs usually omit upcoming formation — treat noise as empty optional.
          const formationNoise = (() => {
            const probe = clean(sanitized || rawText || parsed.formation || parsed.label);
            if (!probe) return true;
            if (probe.length <= 3 && !/\d\s*RB|\bRB\b|\bTE\b|\bWR\b|GUN|FORM|SPREAD|SHOTGUN|PISTOL|KICK|PUNT/i.test(probe)) {
              return true;
            }
            if (/^[^A-Za-z0-9]+$/.test(probe)) return true;
            if (typeof HudText.isGarbagePreviousPlayOcr === 'function'
              && HudText.isGarbagePreviousPlayOcr(probe)) {
              return true;
            }
            return false;
          })();
          if (
            isOcRole
            && !catalogHit
            && (
              !clean(parsed.formation)
              || formationNoise
              || sanitized.length <= 2
            )
          ) {
            value = null;
            matchedLabel = '';
            resolverConfidence = 1;
            rejectedForRawDisagreement = false;
            alternatives = [];
            result._emptyOcFormation = true;
          }
        } else if (key === 'offense_formation') {
          const seen = new Set();
          catalog = catalogs.offensive.filter((entry) => {
            const candidate = clean(entry.formation).toUpperCase();
            if (!candidate || seen.has(candidate)) return false;
            seen.add(candidate);
            return true;
          }).map((entry) => ({ team: entry.team, name: entry.formation, formation: entry.formation }));
          scope = { team: formationCatalogTeam };
        } else if (key === 'offense_personnel') {
          const detectedFormation = showing.formation || clean(context.offenseFormation);
          const seen = new Set();
          catalog = catalogs.offensive.filter((entry) => {
            if (detectedFormation && clean(entry.formation).toUpperCase() !== detectedFormation.toUpperCase()) return false;
            const candidate = clean(entry.set).toUpperCase();
            if (!candidate || seen.has(candidate)) return false;
            seen.add(candidate);
            return true;
          }).map((entry) => ({ team: entry.team, name: entry.set, formation: entry.formation, set: entry.set }));
          scope = { team: formationCatalogTeam, formation: detectedFormation };
        }
        if (key !== 'offense_formation_personnel' && !emptyPreviousPlay) {
          const matchQuery = previousPlay
            && typeof HudText.stripNoisyPreviousPlayPrefix === 'function'
            ? (HudText.stripNoisyPreviousPlayPrefix(sanitized) || sanitized)
            : sanitized;
          let match = Matcher.matchCatalogText(matchQuery, catalog, scope, catalogMatchOpts);
          // Near-miss digit swap for previous plays: "0 6 TRAP" → top alt "5 6 TRAP".
          if (
            previousPlay
            && (!match.match || (Number(match.score) || 0) < 0.9)
            && Array.isArray(match.alternatives)
            && match.alternatives.length
          ) {
            const topAlt = match.alternatives[0];
            const altName = clean(
              topAlt && topAlt.entry && (topAlt.entry.play_name || topAlt.entry.playName || topAlt.entry.name),
            );
            const rawNorm = matchQuery.toUpperCase().replace(/\s+/g, ' ');
            const altNorm = altName.toUpperCase().replace(/\s+/g, ' ');
            if (altName && nearMissDigitSwap(rawNorm, altNorm) && (Number(topAlt.score) || 0) >= 0.55) {
              match = {
                ...match,
                match: topAlt.entry,
                score: Math.max(Number(match.score) || 0, Number(topAlt.score) || 0, 0.9),
                rejectedForRawDisagreement: false,
              };
            }
          }
          rejectedForRawDisagreement = Boolean(match.rejectedForRawDisagreement);
          if (match.match) {
            value = key === 'offense_formation'
              ? match.match.formation
              : key === 'offense_personnel'
                ? match.match.set
                : match.match;
            matchedLabel = key === 'offense_formation' || key === 'offense_personnel'
              ? clean(value)
              : clean(match.match.play_name || match.match.playName || match.match.name);
            resolverConfidence = Number(match.score) || 0;
          } else {
            // Unmatched previous-play OCR: only treat as empty when the crop is
            // "--"/noise. Readable names (MTN FLOOD) stay as reviewable text —
            // do not accepted-empty them away.
            if (
              previousPlay
              && typeof HudText.isGarbagePreviousPlayOcr === 'function'
              && HudText.isGarbagePreviousPlayOcr(sanitized || rawText)
            ) {
              value = null;
              matchedLabel = '';
              emptyPreviousPlay = true;
              resolverConfidence = 1;
              rejectedForRawDisagreement = false;
            } else if (previousPlay) {
              value = matchQuery || sanitized;
              matchedLabel = '';
              resolverConfidence = Math.min(Number(match.score) || 0, 0.4);
            } else {
              value = null;
              matchedLabel = '';
              resolverConfidence = Math.min(Number(match.score) || 0, 0.4);
            }
          }
          alternatives = emptyPreviousPlay
            ? []
            : (match.alternatives || []).map((entry) => ({
              value: entry.entry,
              confidence: entry.score,
            }));
          if (previousPlay) result._playMatchQuery = matchQuery;
        }
        if (previousPlay) result._emptyPreviousPlay = emptyPreviousPlay;
      } else if (
        (key === 'previous_offense_play' || key === 'previous_defense_play')
        && (!sanitized || (typeof HudText.isEmptyPreviousPlayOcr === 'function'
          && HudText.isEmptyPreviousPlayOcr(rawText)))
      ) {
        value = null;
        matchedLabel = '';
        resolverConfidence = 1;
        alternatives = [];
        result._emptyPreviousPlay = true;
      }

      const requireCatalog = CATALOG_FIELDS.has(key)
        && key !== 'offense_formation_personnel';
      // Structured HUD parsers / strong formation hits can validate text even when
      // Tesseract reports a slightly-low or zero confidence.
      let effectiveOcrConfidence = ocrConfidence;
      if ((key === 'down_distance' || key === 'field_position')
        && resolverConfidence >= 0.85
        && framesAgree >= (2 / 3)) {
        effectiveOcrConfidence = Math.max(ocrConfidence, 0.93);
      }
      if (key === 'offense_formation_personnel'
        && value && typeof value === 'object'
        && clean(value.formation)
        && framesAgree >= (2 / 3)
        && (resolverConfidence >= 0.72 || clean(value.set) || clean(value.personnel))) {
        effectiveOcrConfidence = Math.max(ocrConfidence, 0.93);
      }
      const decision = Confidence.calibrateFieldAcceptance({
        value,
        ocrConfidence: effectiveOcrConfidence,
        resolverConfidence,
        framesAgree,
      }, {
        minOcrConfidence: Confidence.DEFAULTS.minOcrConfidence,
        minResolverConfidence: Confidence.DEFAULTS.minResolverConfidence,
        minFrameAgreement: Confidence.DEFAULTS.minFrameAgreement,
        requireCatalog,
      });
      // Formation/personnel can accept parsed structure without a full catalog hit,
      // but catalog play fields must fail closed when raw disagrees.
      let accepted = decision.accepted;
      if ((key === 'previous_offense_play' || key === 'previous_defense_play') && !value) {
        if (result._emptyPreviousPlay) {
          // Drive start / empty "--" slot / garbage crop: accepted-empty is correct.
          accepted = true;
          if (!Array.isArray(decision.reasons)) decision.reasons = [];
          decision.reasons = decision.reasons.filter((reason) => (
            reason !== 'empty_value'
            && reason !== 'ocr_below_threshold'
            && reason !== 'combined_below_threshold'
            && reason !== 'catalog_required'
          ));
          if (!decision.reasons.includes('empty_previous_play')) {
            decision.reasons.push('empty_previous_play');
          }
        } else {
          accepted = false;
        }
      }
      // OC role: upcoming formation is usually absent on the Madden HUD — accept empty.
      if (key === 'offense_formation_personnel' && result._emptyOcFormation && !value) {
        accepted = true;
        if (!Array.isArray(decision.reasons)) decision.reasons = [];
        decision.reasons = decision.reasons.filter((reason) => (
          reason !== 'empty_value'
          && reason !== 'ocr_below_threshold'
          && reason !== 'combined_below_threshold'
          && reason !== 'catalog_required'
        ));
        if (!decision.reasons.includes('empty_oc_formation')) {
          decision.reasons.push('empty_oc_formation');
        }
      }
      // High-confidence catalog play names (GL MAN, 1 DOUBLE SLOT): accept even when
      // Tesseract confidence is middling — same spirit as structured HUD accept.
      if (
        (key === 'previous_offense_play' || key === 'previous_defense_play')
        && value
        && typeof value === 'object'
        && resolverConfidence >= 0.9
        && framesAgree >= (2 / 3)
        && !rejectedForRawDisagreement
      ) {
        const playName = clean(value.play_name || value.playName || value.name).toUpperCase();
        const rawNorm = clean(result._playMatchQuery || sanitized).toUpperCase();
        if (playName && rawNorm && (
          rawNorm === playName
          || rawNorm.replace(/\s+/g, ' ') === playName.replace(/\s+/g, ' ')
          || playName.split(/\s+/).every((tok) => tok.length < 2 || rawNorm.includes(tok))
        )) {
          accepted = true;
          effectiveOcrConfidence = Math.max(effectiveOcrConfidence, 0.93);
          if (!Array.isArray(decision.reasons)) decision.reasons = [];
          decision.reasons = decision.reasons.filter((reason) => (
            reason !== 'ocr_below_threshold' && reason !== 'combined_below_threshold'
          ));
          if (!decision.reasons.includes('strong_catalog_accept')) {
            decision.reasons.push('strong_catalog_accept');
          }
        }
      }
      // Trust deterministic HUD grammar over raw Tesseract confidence.
      if (key === 'down_distance'
        && resolverConfidence >= 0.99
        && framesAgree >= (2 / 3)
        && clean(value)) {
        accepted = true;
        if (!Array.isArray(decision.reasons)) decision.reasons = [];
        decision.reasons = decision.reasons.filter((reason) => (
          reason !== 'ocr_below_threshold'
          && reason !== 'combined_below_threshold'
          && reason !== 'agreement_below_threshold'
        ));
        if (!decision.reasons.includes('structured_hud_accept')) {
          decision.reasons.push('structured_hud_accept');
        }
      }
      // Parsed downs are deterministic even when one burst frame disagrees.
      if (
        key === 'down_distance'
        && resolverConfidence >= 0.99
        && clean(value)
        && /^(?:[1-4](?:st|nd|rd|th))\s*&\s*(?:\d{1,2}|inches)$/i.test(clean(value))
      ) {
        accepted = true;
        if (!Array.isArray(decision.reasons)) decision.reasons = [];
        decision.reasons = decision.reasons.filter((reason) => (
          reason !== 'ocr_below_threshold'
          && reason !== 'combined_below_threshold'
          && reason !== 'agreement_below_threshold'
          && reason !== 'raw_catalog_disagreement'
        ));
        if (!decision.reasons.includes('structured_hud_accept')) {
          decision.reasons.push('structured_hud_accept');
        }
      }
      // Madden upcoming personnel bar ("1RB - 1TE 3WR") is deterministic once repaired.
      if (
        key === 'offense_formation_personnel'
        && value
        && typeof value === 'object'
        && /\b\d\s*RB\b/i.test(clean(value.formation))
        && (
          /\b\d\s*TE\b/i.test(clean(value.set) || clean(value.personnel))
          || /\b\d\s*WR\b/i.test(clean(value.set) || clean(value.personnel))
        )
        && (
          framesAgree >= (2 / 3)
          // Glued personnel bar ("1RB - 1TE 3WR") is one deterministic string.
          // A single disagreeing burst frame should not send it back to review.
          || (
            /^\d\s*RB$/i.test(clean(value.formation))
            && /^\d\s*TE\s+\d\s*WR$/i.test(clean(value.set) || clean(value.personnel))
          )
        )
      ) {
        accepted = true;
        if (!Array.isArray(decision.reasons)) decision.reasons = [];
        decision.reasons = decision.reasons.filter((reason) => (
          reason !== 'ocr_below_threshold' && reason !== 'combined_below_threshold'
        ));
        if (!decision.reasons.includes('structured_hud_accept')) {
          decision.reasons.push('structured_hud_accept');
        }
      }
      if (key === 'field_position' && value && typeof value === 'object') {
        const yardLine = Number(value.yardLine);
        const glyphSide = clean(result._fieldGlyphSide).toUpperCase();
        const hintSide = clean(result._fieldSideHint).toUpperCase();
        // Bare / OWN / OPP "50" is always midfield — promote side so Exact Calls can run.
        if (yardLine === 50 && value.side !== 'MIDFIELD') {
          value = { ...value, side: 'MIDFIELD', label: 'MIDFIELD 50' };
        }
        if (!value.side && Number.isFinite(yardLine) && yardLine !== 50) {
          // Yard-only non-50 stays reviewable until OWN/OPP (TNF arrow or correction).
          accepted = false;
          if (!Array.isArray(decision.reasons)) decision.reasons = [];
          if (!decision.reasons.includes('field_side_missing')) decision.reasons.push('field_side_missing');
        } else if (value.side
          && Number.isFinite(yardLine)
          && resolverConfidence >= 0.85
          && framesAgree >= (2 / 3)) {
          // Trust OCR crop glyph (v/↑) over a conflicting ROI sideHint for accept.
          accepted = true;
          if (!Array.isArray(decision.reasons)) decision.reasons = [];
          decision.reasons = decision.reasons.filter((reason) => (
            reason !== 'ocr_below_threshold'
            && reason !== 'combined_below_threshold'
            && reason !== 'field_side_conflict'
          ));
          if (
            glyphSide
            && hintSide
            && (glyphSide === 'OWN' || glyphSide === 'OPP')
            && (hintSide === 'OWN' || hintSide === 'OPP')
            && glyphSide !== hintSide
          ) {
            if (!decision.reasons.includes('field_side_hint_ignored')) {
              decision.reasons.push('field_side_hint_ignored');
            }
          }
          if (!decision.reasons.includes('structured_hud_accept')) {
            decision.reasons.push('structured_hud_accept');
          }
        }
      }
      if (rejectedForRawDisagreement) accepted = false;
      const profile = context.profile || this._activeProfile();
      const region = Array.isArray(profile && profile.regions)
        ? profile.regions.find((entry) => clean(entry.field || entry.id) === key)
        : null;
      if (key === 'offense_formation_personnel' && !HudText.hasValidPersonnelCounts(value)) {
        accepted = false;
        decision.reasons = [...(decision.reasons || []), 'invalid_personnel_total'];
      }
      fields[key] = {
        key,
        value,
        rawText,
        sanitizedText: sanitized,
        matchedLabel: matchedLabel || '',
        ocrConfidence,
        effectiveOcrConfidence,
        resolverConfidence,
        framesAgree,
        calibratedConfidence: decision.calibratedConfidence,
        source: 'obs_ocr',
        accepted,
        acceptanceReasons: rejectedForRawDisagreement
          ? [...(decision.reasons || []), 'raw_catalog_disagreement']
          : decision.reasons,
        required: REQUIRED_FIELDS.has(key),
        alternatives,
        samples: clone(result.samples || []),
        rawCrop: clean(result.rawCrop),
        processedCrop: clean(result.processedCrop),
        bandSource: clean(result.bandSource) || null,
        bandScore: result.bandScore == null ? null : Number(result.bandScore),
        roi: region ? {
          x: Number(region.x),
          y: Number(region.y),
          width: Number(region.width),
          height: Number(region.height),
        } : null,
        ...(key === 'field_position' && result.fieldSide ? {
          fieldSide: clean(result.fieldSide).toUpperCase(),
          fieldSideDirection: clean(result.fieldSideDirection),
          fieldSideConfidence: Number(result.fieldSideConfidence) || 0,
        } : {}),
      };
    }
    return fields;
  }

  async correctCapture(args = {}) {
    if (this.busy) throw new Error('Wait for the current capture before saving corrections.');
    if (!this.lastCapture || clean(args.captureId) !== this.lastCapture.id) throw new Error('Capture is no longer available for correction.');
    this.busy = true;
    try {
      const corrected = clone(this.lastCapture);
      const generation = this.sessionGeneration;
      const state = this.store.get();
      const context = state.config.context || {};
      const catalogs = await this.loadCatalogs();
      this._assertSession(generation);
      if (this.lastCapture?.id !== corrected.id) throw new Error('Capture changed before corrections were saved.');
      const playNameKey = value => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
      for (const [key, value] of Object.entries(args.corrections || {})) {
        if (!corrected.fields[key]) continue;
        let nextValue = clean(value);
        let accepted = Boolean(nextValue);
        if (key === 'offense_formation_personnel') {
          nextValue = formationPersonnelFromValue(nextValue);
          accepted = Boolean(nextValue.formation || nextValue.set || nextValue.label) && HudText.hasValidPersonnelCounts(nextValue);
        } else if (key === 'field_position') {
          const parsed = HudText.parseFieldPositionText(nextValue);
          if (parsed.ok) {
            nextValue = {
              side: parsed.side || null,
              yardLine: parsed.yardLine,
              label: parsed.label,
            };
            // Midfield 50 needs no OWN/OPP; other yard-only corrections stay reviewable.
            accepted = Boolean(
              Number.isFinite(Number(parsed.yardLine))
              && (parsed.side || Number(parsed.yardLine) === 50),
            );
            if (accepted && Number(parsed.yardLine) === 50) {
              nextValue = { side: 'MIDFIELD', yardLine: 50, label: 'MIDFIELD 50' };
            }
          } else {
            accepted = false;
          }
        } else if (key === 'down_distance') {
          const parsed = HudText.parseDownDistanceText(nextValue);
          if (parsed.ok) {
            nextValue = parsed.label;
            accepted = true;
          } else {
            accepted = false;
          }
        } else if (key === 'previous_offense_play' || key === 'previous_defense_play') {
          // Blank / "--" correction = intentionally empty (opening drive).
          if (
            !nextValue
            || (typeof HudText.isEmptyPreviousPlayOcr === 'function' && HudText.isEmptyPreviousPlayOcr(nextValue))
            || (typeof HudText.isGarbagePreviousPlayOcr === 'function' && HudText.isGarbagePreviousPlayOcr(nextValue))
          ) {
            nextValue = null;
            accepted = true;
          } else {
            const defensive = key === 'previous_defense_play';
            const isOc = clean(context.role).toLowerCase() === 'oc';
            const team = clean(defensive === isOc ? context.opponent : context.team).toUpperCase();
            const catalog = defensive ? catalogs.defensive : catalogs.offensive;
            const matches = catalog.filter(play => clean(play.team).toUpperCase() === team
              && playNameKey(play.play_name || play.playName || play.name) === playNameKey(nextValue));
            const confirmedId = defensive ? this.lastCapturePriorPending?.confirmedPlay?.id : null;
            const priorId = corrected.fields[key].value?.id;
            const resolved = matches.find(play => play.id === confirmedId)
              || matches.find(play => play.id === priorId) || matches[0];
            if (resolved) nextValue = resolved;
            // No-op name save: keep the catalog object so learning IDs stay stable.
            const prior = corrected.fields[key].value;
            if (prior && typeof prior === 'object' && !Array.isArray(prior)) {
              const priorName = clean(prior.play_name || prior.playName || prior.name);
              if (priorName && typeof nextValue === 'string' && priorName.toLowerCase() === nextValue.toLowerCase()) {
                nextValue = prior;
                accepted = true;
              }
            }
          }
        }
        corrected.fields[key] = {
          ...corrected.fields[key],
          value: nextValue,
          accepted,
          source: 'user_correction',
          resolverConfidence: 1,
          ocrConfidence: Math.max(Number(corrected.fields[key].ocrConfidence) || 0, accepted ? 0.95 : 0),
          effectiveOcrConfidence: Math.max(
            Number(corrected.fields[key].effectiveOcrConfidence) || 0,
            accepted ? 0.95 : 0,
          ),
          calibratedConfidence: accepted ? 1 : Number(corrected.fields[key].calibratedConfidence) || 0,
        };
      }
      corrected.correctedAt = this.now();
      const correctedState = acceptedState(corrected.fields, corrected.scoreboard || context);
      corrected.validation = this.lastCapturePriorPending
        ? StateValidator.validateTransition(this.lastCapturePriorPending.state, correctedState)
        : { accepted: true, reasons: [], warnings: [] };
      // Corrections replay from the original baseline and replace that capture's
      // learning atomically. They must never count the same football snap twice.
      this.snapLifecycle = clone(this.lastCapturePriorLifecycle) || SnapLifecycle.createLifecycleState();
      const currentCall = this.pendingSnap?.captureId === corrected.id && snapSpot(this.pendingSnap.state) === snapSpot(correctedState)
        ? { confirmedPlay: this.pendingSnap.confirmedPlay, penalty: this.pendingSnap.penalty } : null;
      corrected.replacesLearning = Boolean(corrected.learningRecorded);
      corrected.learningRecorded = await this._reconcileSnap(
        corrected, context, state, this.lastCapturePriorPending, true,
      );
      if (corrected.replacesLearning && !corrected.learningRecorded) {
        await this.ledger.correctSnap({ captureId: corrected.id, learningEvent: null });
      }
      this._assertSession(generation);
      if (currentCall && this.pendingSnap?.captureId === corrected.id) Object.assign(this.pendingSnap, currentCall);
      if (corrected.fields.down_distance?.accepted && corrected.fields.field_position?.accepted) {
        this.previousAcceptedState = correctedState;
      }
      if (state.featureFlags.learning) corrected.learningSnapshot = await this.ledger.getSnapshot();
      this._assertSession(generation);
      this.lastCapture = corrected;
      await this._appendDecisionTrace(corrected, { correction: true });
      await this._recordDebugEvent('correction', {
        id: corrected.id,
        at: corrected.correctedAt || this.now(),
        engine: corrected.engine || (this.engineWarm && this.engineWarm.engine),
        engineWarm: this.engineWarm,
        profileId: corrected.profileId,
        presentation: corrected.presentation,
        source: corrected.source,
        fields: corrected.fields,
        rois: this._roiGeometry(this._activeProfile()),
        notes: 'user correction',
      });
      this._assertSession(generation);
      this._emit('capture:complete', { capture: corrected });
      return { capture: corrected };
    } finally {
      this.busy = false;
    }
  }

  setPendingCall(args = {}) {
    // A confirmed call belongs only to the latest accepted pre-snap screen.
    // Keep this transient; never persist it across a game or application restart.
    const captureId = clean(args.captureId);
    if (this.busy || !captureId || captureId !== this.lastCapture?.id || !this.pendingSnap) return { accepted: false };
    const pending = this.pendingSnap;
    const catalogs = this.resolvedCatalogs;
    if (!catalogs) return { accepted: false };
    const context = this.store.get().config.context || {};
    if (clean(context.role).toLowerCase() !== 'dc') return { accepted: false };
    if (!this.lastCapture.fields.down_distance?.accepted || !this.lastCapture.fields.field_position?.accepted) return { accepted: false };
    if (snapSpot(pending.state) !== snapSpot(acceptedState(this.lastCapture.fields, this.lastCapture.scoreboard))) return { accepted: false };
    // The general audible picker uses space-separated IDs; OCR catalogs use
    // hyphens. Compare canonical segments so both refer to the same actual play.
    const idKey = value => clean(value).split('|')
      .map(part => part.toLowerCase().replace(/[^a-z0-9]+/g, '-')).join('|');
    const play = catalogs.defensive.find(item => idKey(item.id) === idKey(args.playId)
      && clean(item.team).toUpperCase() === clean(context.team).toUpperCase());
    if (!play) return { accepted: false };
    pending.confirmedPlay = clone(play);
    pending.penalty = Penalties.normalizePenaltyStamp(args.penalty);
    return { accepted: true };
  }

  async _reconcileSnap(capture, args, state, priorPending = this.pendingSnap, updatePending = true) {
    const generation = this.sessionGeneration;
    const fields = capture.fields;
    const scoreboard = resolveScoreboard(
      args || {},
      capture.scoreboard || {},
      state.config.context || {},
    );
    let previousDefense = fields.previous_defense_play && fields.previous_defense_play.accepted
      ? fields.previous_defense_play.value : null;
    const previousOffense = fields.previous_offense_play && fields.previous_offense_play.accepted
      ? fields.previous_offense_play.value : null;
    let learningRecorded = false;
    const priorSnap = priorPending;
    // OCR shows the name, not its formation. A matching confirmed call supplies
    // the exact catalog identity; a different observed name is never overwritten.
    const nameKey = play => clean(play?.play_name || play?.playName || play?.name).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (previousDefense && priorSnap?.confirmedPlay && nameKey(previousDefense)
      && nameKey(previousDefense) === nameKey(priorSnap.confirmedPlay)) {
      previousDefense = priorSnap.confirmedPlay;
    }
    const afterState = acceptedState(fields, scoreboard);
    if (!fields.down_distance?.accepted || !fields.field_position?.accepted) return false;
    // A fresh capture ID is not evidence of a fresh football snap.
    // Repeated screens (including unchanged penalty spots) must not train learning.
    if (priorSnap && snapSpot(priorSnap.state) === snapSpot(afterState)) {
      capture.sameSpot = true;
      return false;
    }
    const driveStart = !previousDefense && !previousOffense
      && Number(afterState.down) === 1
      && (!priorSnap || !priorSnap.state || priorSnap.state.down == null);
    const role = clean(args.role || args.hostRole || state.config.context.role).toLowerCase();
    if (role === 'dc' && state.featureFlags.learning && priorSnap && previousDefense
      && (previousDefense.id || previousDefense.playId)) {
      const after = afterState;
      const outcome = Outcome.inferDefensiveOutcome({
        before: priorSnap.state,
        after,
        defenseSide: args.defenseSide,
        penalty: clean(fields.penalty_result && fields.penalty_result.value),
        driveStart: false,
      });
      const penaltyText = clean(fields.penalty_result && fields.penalty_result.value);
      const penaltyAmbiguous = Penalties.shouldSkipLearningForPenalty(priorSnap.penalty)
        || Boolean(penaltyText && !/^no\s+(?:flag|penalty)$/i.test(penaltyText));
      if (penaltyAmbiguous) {
        outcome.learnable = false;
        outcome.evidence = [...(outcome.evidence || []), 'penalty_or_result_ambiguous'];
      }
      // Mid-drive snaps with accepted previous defense remain eligible even when
      // previous offense OCR missed — package-level effectiveness can still learn.
      const criticalAccepted = Object.values(fields).filter((field) => field.required).every((field) => field.accepted);
      const learningEligible = criticalAccepted && !penaltyAmbiguous && capture.validation.accepted;
      const learningEvent = {
        id: capture.id,
        at: capture.at,
        opponent: clean(args.opponent),
        situation: {
          ...priorSnap.state,
          distanceBucket: (() => {
            const raw = priorSnap.state && priorSnap.state.yardsToGo;
            if (raw == null || raw === '') return null;
            const y = Number(raw);
            if (!Number.isFinite(y) || y <= 0) return null;
            if (y <= 3) return 'short';
            if (y <= 6) return 'medium';
            return 'long';
          })(),
        },
        offense: {
          formation: clean(priorSnap.offenseFormation),
          set: clean(priorSnap.offenseSet),
          playId: previousOffense && (previousOffense.id || previousOffense.playId) || null,
          playName: previousOffense && (previousOffense.play_name || previousOffense.playName) || null,
        },
        defense: {
          playId: previousDefense.id || previousDefense.playId,
          formation: previousDefense.formation,
          set: previousDefense.set,
          packageKey: [previousDefense.formation, previousDefense.set].filter(Boolean).join('|'),
          coverageFamily: previousDefense.coverageFamily
            || previousDefense.type
            || previousDefense.coverage
            || null,
          playName: previousDefense.play_name || previousDefense.playName || previousDefense.name || null,
        },
        outcome: {
          ...outcome,
          learnable: outcome.learnable === true && criticalAccepted && capture.validation.accepted,
        },
        verification: {
          captureId: capture.id,
          criticalAccepted,
          learningEligible,
          source: 'next_play_call_screen',
          lifecyclePhase: this.snapLifecycle && this.snapLifecycle.phase,
          driveStart: false,
        },
      };
      if (capture.replacesLearning) await this.ledger.correctSnap({ learningEvent, captureId: capture.id });
      else await this.ledger.recordSnap({ learningEvent, captureId: capture.id });
      this._assertSession(generation);
      learningRecorded = true;
    }
    // First snap of a drive often has empty previous-play crops — skip learning
    // rather than writing UNKNOWN noise into opponentTendency.
    if (driveStart) {
      capture.driveStart = true;
    }
    if (updatePending) {
      // Advance attribution even when learning is disabled or a play crop is absent.
      // Otherwise the lifecycle keeps the first pre-snap state across later captures.
      if (this.snapLifecycle.currentSnap) {
        const ended = SnapLifecycle.reduceLifecycle(this.snapLifecycle, {
          id: `${capture.id}:end`, type: 'end', at: capture.at, state: afterState,
        });
        if (ended.accepted) this.snapLifecycle = ended.state;
      }
      const ready = SnapLifecycle.reduceLifecycle(this.snapLifecycle, {
        id: `${capture.id}:ready`,
        type: 'pre_snap',
        snapId: capture.id,
        at: capture.at,
        state: afterState,
        offensePlay: (() => {
          const showing = offenseShowingFromFields(fields);
          return {
            formation: showing.formation,
            set: showing.set,
          };
        })(),
      });
      if (ready.accepted) this.snapLifecycle = ready.state;
      const current = this.snapLifecycle.currentSnap;
      const showing = offenseShowingFromFields(fields);
      this.pendingSnap = {
        captureId: (current && current.id) || capture.id,
        state: (current && current.preState) || acceptedState(fields, scoreboard),
        offenseFormation: (current && current.offensePlay && current.offensePlay.formation)
          || showing.formation,
        offenseSet: (current && current.offensePlay && current.offensePlay.set)
          || showing.set,
        lifecyclePhase: this.snapLifecycle.phase,
      };
    }
    return learningRecorded;
  }

  _recordDiagnostics(capture, rawResult) {
    this.diagnosticSamples.push({
      captureMs: capture.timing.captureMs,
      frameCount: capture.frameCount,
      duplicateFrames: Number(rawResult.duplicateFrames) || 0,
      staleFrames: Number(rawResult.staleFrames) || 0,
      fallbackFrames: Number(rawResult.fallbackFrames) || 0,
      captureAdapters: Array.isArray(rawResult.captureAdapters) ? rawResult.captureAdapters : [],
    });
    if (this.diagnosticSamples.length > MAX_DIAGNOSTIC_SAMPLES) this.diagnosticSamples.shift();
  }

  async _appendDecisionTrace(capture, result) {
    const profile = this._activeProfile();
    const rois = this._roiGeometry(profile);
    const trace = {
      version: 2,
      id: capture.id,
      at: capture.at,
      profileId: capture.profileId,
      presentation: capture.presentation || clean(profile && profile.presentation),
      source: capture.source,
      engine: capture.engine || (result && result.engine) || (this.engineWarm && this.engineWarm.engine) || null,
      engineWarm: this.engineWarm ? {
        engine: this.engineWarm.engine,
        preferred: this.engineWarm.preferred === true,
        fallback: this.engineWarm.fallback === true,
        warmMs: this.engineWarm.warmMs,
      } : null,
      correction: Boolean(result && result.correction),
      fields: Object.fromEntries(Object.entries(capture.fields || {}).map(([key, field]) => [key, {
        rawText: field.rawText,
        sanitizedText: field.sanitizedText,
        value: field.value,
        ocrConfidence: field.ocrConfidence,
        resolverConfidence: field.resolverConfidence,
        framesAgree: field.framesAgree,
        accepted: field.accepted,
        acceptanceReasons: field.acceptanceReasons || [],
        source: field.source,
        alternatives: field.alternatives,
        bandSource: field.bandSource || null,
        bandScore: field.bandScore ?? null,
        fieldSide: field.fieldSide || null,
        roi: field.roi || rois[key] || null,
        cropHashes: (field.samples || []).map((sample) => sample.cropHash).filter(Boolean),
        processedCropHashes: (field.samples || []).map((sample) => sample.processedCropHash).filter(Boolean),
      }])),
      validation: capture.validation,
      timing: capture.timing,
      frameHashes: clone((result && result.frameHashes) || []),
      duplicateFrames: Number(result && result.duplicateFrames) || 0,
      staleFrames: Number(result && result.staleFrames) || 0,
      rawFramesRetained: Boolean(capture.rawFramesRetained),
    };
    await fs.mkdir(this.userData, { recursive: true });
    await fs.appendFile(this.decisionTracePath, `${JSON.stringify(trace)}\n`, 'utf8');
  }

  _roiGeometry(profile) {
    const regions = Array.isArray(profile && profile.regions) ? profile.regions : [];
    const out = {};
    for (const region of regions) {
      const key = clean(region.field || region.id);
      if (!key) continue;
      out[key] = {
        x: Number(region.x),
        y: Number(region.y),
        width: Number(region.width),
        height: Number(region.height),
      };
    }
    return out;
  }

  async _recordDebugEvent(kind, payload) {
    if (!this.debugPack || !this.debugPack.enabled) return null;
    try {
      const event = await this.debugPack.recordEvent(kind, payload, { retainCrops: true });
      await this.debugPack.writeSessionSummary({
        engineWarm: this.engineWarm,
        engineWarmError: this.engineWarmError,
        retainDebugFrames: true,
        lastKind: kind,
      });
      return event;
    } catch (_error) {
      return null;
    }
  }

  async exportDiagnosticPack() {
    const state = this.store.get();
    const profile = this._activeProfile(state);
    let decisionLines = [];
    try {
      const raw = await fs.readFile(this.decisionTracePath, 'utf8');
      decisionLines = raw.split(/\r?\n/).filter(Boolean).slice(-80);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const profileSnapshot = profile ? {
      id: profile.id,
      name: profile.name,
      presentation: profile.presentation,
      source: profile.source,
      regions: (profile.regions || []).map((region) => ({
        field: region.field || region.id,
        required: region.required === true,
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        preprocessing: region.preprocessing || region.preprocess || null,
      })),
    } : null;
    const exported = await this.debugPack.exportPack({
      destinationDir: path.join(
        this.exportDirectory(),
        `gridiron-ocr-diagnostic-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}`,
      ),
      decisionLines,
      profileSnapshot,
      sessionSummary: {
        ...this.debugPack.sessionSummary(),
        engineWarm: this.engineWarm,
        engineWarmError: this.engineWarmError,
        retainDebugFrames: Boolean(state.config.retainDebugFrames),
        adapter: state.config.capture.adapter,
        role: state.config.context.role,
        team: state.config.context.team,
        opponent: state.config.context.opponent,
      },
    });
    return exported;
  }

  resetSession(args = {}) {
    this.sessionGeneration += 1;
    this.lastCapture = null;
    this.previousAcceptedState = null;
    this.pendingSnap = null;
    this.lastCapturePriorPending = null;
    this.snapLifecycle = SnapLifecycle.createLifecycleState();
    this.lastCapturePriorLifecycle = null;
    this.sessionContextKey = args.context ? contextKey(args.context) : '';
    this._emit('session:reset', { reason: clean(args.reason) || 'session_reset' });
    return { reset: true };
  }

  _alignContext(context) {
    const key = contextKey(context);
    if (this.sessionContextKey && key !== this.sessionContextKey) {
      this.resetSession({ reason: 'context_changed', context });
    }
    this.sessionContextKey = key;
  }

  _assertSession(generation) {
    if (generation !== this.sessionGeneration) {
      throw Object.assign(new Error('The game or coordinator changed during capture. Capture the current screen again.'), {
        code: 'OCR_SESSION_CHANGED',
      });
    }
  }

  async undoLastSnap() {
    const events = await this.ledger.readEvents();
    const target = buildLearningSnapshot(events).samples.slice().reverse()
      .find(event => event.type === 'snap' || event.type === 'snap_correction');
    if (!target) return { undone: false };
    const result = await this.ledger.undo(target.id);
    if (this.lastCapturePriorLifecycle) {
      this.snapLifecycle = clone(this.lastCapturePriorLifecycle);
    }
    if (this.lastCapturePriorPending) {
      this.pendingSnap = clone(this.lastCapturePriorPending);
    }
    return { undone: true, eventId: target.id, snapshot: result.snapshot };
  }

  async resetOpponent(args = {}) {
    const result = await this.ledger.resetOpponent(args.opponent);
    return { reset: true, snapshot: result.snapshot };
  }

  async exportData() {
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    const destination = path.join(this.exportDirectory(), `gridiron-ocr-export-${stamp}.json`);
    const state = this.store.get();
    const events = await this.ledger.readEvents();
    const snapshot = await this.ledger.getSnapshot();
    let decisions = [];
    try {
      decisions = (await fs.readFile(this.decisionTracePath, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const output = { version: 1, exportedAt: this.now(), profiles: state.profiles, config: {
      ...state.config,
      obs: { ...state.config.obs, password: state.config.obs.password ? '[redacted]' : '' },
    }, events, learning: snapshot, decisions };
    await fs.writeFile(destination, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return { path: destination };
  }

  async deleteData(args = {}) {
    if (args.confirm !== 'DELETE_OCR_DATA') throw new Error('OCR data delete confirmation was not supplied.');
    await this.stop();
    await Promise.all([
      fs.rm(this.store.filePath, { force: true }),
      fs.rm(this.ledger.ledgerPath, { force: true }),
      fs.rm(this.ledger.snapshotPath, { force: true }),
      fs.rm(this.decisionTracePath, { force: true }),
    ]);
    await Promise.all([this.store.load(), this.ledger.initialize()]);
    this.lastCapture = null;
    this.previousAcceptedState = null;
    this.pendingSnap = null;
    this.lastCapturePriorPending = null;
    this.snapLifecycle = SnapLifecycle.createLifecycleState();
    this.lastCapturePriorLifecycle = null;
    this.diagnosticSamples = [];
    this.initialized = true;
    return this.getStatus();
  }

  async stop() {
    this.hotkey.stop();
    await this.sidecar.stop();
    if (this.bridge) await this.bridge.stop();
    this._bridgeSourceId = '';
    this.initialized = false;
  }

  _emit(type, payload) {
    this.emit('event', { type, ...(payload || {}), at: this.now() });
  }
}

module.exports = {
  IntegrationOcrManager,
  sidecarProfile,
  parseDownDistance,
  defaultRoiWhitelist,
};
