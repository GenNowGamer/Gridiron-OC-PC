'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  VersionedConfigStore,
  EventLedger,
  SidecarManager,
  HotkeyManager,
  IntegrationOcrManager,
} = require('..');

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gridiron-ocr-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('config store defaults every feature off and writes atomically', async (t) => {
  const userData = await temporaryDirectory(t);
  const store = new VersionedConfigStore({ userData, randomUUID: () => 'temporary' });
  const initial = await store.load();

  assert.deepEqual(initial.featureFlags, { capture: false, exactCalls: false, learning: false });
  await store.setFeatureFlag('capture', true);

  const persisted = JSON.parse(await fs.readFile(path.join(userData, 'vision-profiles-v1.json'), 'utf8'));
  assert.equal(persisted.featureFlags.capture, true);
  assert.equal((await fs.readdir(userData)).some((name) => name.endsWith('.tmp')), false);
  await assert.rejects(() => store.setFeatureFlag('unknown', true), /Unknown OCR feature flag/);
});

test('event ledger rebuilds, undoes, resets, and exports append-only history', async (t) => {
  const userData = await temporaryDirectory(t);
  let id = 0;
  const ledger = new EventLedger({
    userData,
    now: () => 100 + id,
    randomUUID: () => `event-${++id}`,
  });
  await ledger.initialize();
  const observation = await ledger.recordObservation({ play: 'mesh' });
  await ledger.recordFeedback({ correct: true });
  const undone = await ledger.undo(observation.event.id);

  assert.equal(undone.snapshot.samples.length, 1);
  assert.equal(undone.snapshot.samples[0].type, 'feedback');

  const reset = await ledger.reset('test');
  assert.equal(reset.snapshot.samples.length, 0);
  assert.equal(reset.snapshot.generation, 1);

  const destination = path.join(userData, 'export', 'learning.json');
  const exported = await ledger.exportTo(destination);
  assert.equal(exported.eventCount, 4);
  assert.equal(JSON.parse(await fs.readFile(destination, 'utf8')).events.length, 4);
  assert.equal((await ledger.readEvents()).length, 4);
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.writes = [];
  child.stdin = {
    writable: true,
    write(value) {
      child.writes.push(JSON.parse(value));
    },
  };
  child.kill = () => {};
  return child;
}

test('sidecar manager uses hello, request IDs, cancellation, and timeouts', async () => {
  const child = fakeChild();
  const timers = [];
  const manager = new SidecarManager({
    spawn: () => child,
    command: 'ocr-sidecar',
    randomUUID: () => 'request-1',
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
  });

  const starting = manager.start();
  assert.deepEqual(child.writes[0], { id: '__gridiron_hello__', command: 'hello', params: {} });
  child.stdout.emit('data', '{"id":"__gridiron_hello__","ok":true,"result":{"version":1}}\n');
  await starting;
  assert.equal(manager.getStatus().ready, true);

  const request = manager.request('profile.test', { frame: 'pixels' });
  await Promise.resolve();
  assert.deepEqual(child.writes[1], {
    id: 'request-1',
    command: 'profile.test',
    params: { frame: 'pixels' },
  });
  child.stdout.emit('data', '{"id":"request-1","ok":true,"result":{"play":"mesh"}}\n');
  assert.deepEqual(await request, { play: 'mesh' });

  const timedOut = manager.request('capture.analyze_burst');
  await Promise.resolve();
  const requestTimer = timers.findLast((timer) => timer.delay === 15000 && !timer.cleared);
  requestTimer.callback();
  await assert.rejects(timedOut, { code: 'SIDECAR_TIMEOUT' });
  assert.equal(child.writes.at(-1).command, 'capture.cancel');

  await manager.stop();
});

test('sidecar manager schedules exponential crash restart', async () => {
  const child = fakeChild();
  const timers = [];
  const manager = new SidecarManager({
    spawn: () => child,
    command: 'ocr-sidecar',
    backoffBaseMs: 10,
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeout() {},
  });
  const start = manager.start();
  child.emit('close', 1, null);
  await assert.rejects(start, { code: 'SIDECAR_EXIT' });
  assert.equal(timers.at(-1).delay, 10);
  await manager.stop();
});

test('hotkey manager reports registration failures and reconfiguration', () => {
  const callbacks = new Map();
  const globalShortcut = {
    register(accelerator, callback) {
      if (accelerator === 'Taken') return false;
      callbacks.set(accelerator, callback);
      return true;
    },
    unregister(accelerator) {
      callbacks.delete(accelerator);
    },
  };
  let triggered = 0;
  const manager = new HotkeyManager({ globalShortcut, accelerator: 'Taken', callback: () => triggered++ });

  assert.equal(manager.start().registered, false);
  assert.match(manager.getStatus().error, /Unable to register/);
  assert.equal(manager.configure('Control+Alt+M').registered, true);
  callbacks.get('Control+Alt+M')();
  assert.equal(triggered, 1);
  assert.equal(manager.stop().registered, false);
});

class FakeSidecar extends EventEmitter {
  constructor() {
    super();
    this.ready = false;
    this.requests = [];
    this.onRequest = null;
  }
  async start() {
    this.ready = true;
    return this.getStatus();
  }
  async stop() {
    this.ready = false;
    return this.getStatus();
  }
  getStatus() {
    return { running: this.ready, ready: this.ready };
  }
  async request(method, params) {
    this.requests.push({ method, params });
    if (this.onRequest) this.onRequest();
    if (method === 'obs.configure') return { configured: true };
    if (method === 'engine.warm') {
      return { engine: 'mock', requested: 'auto', cachedBefore: false, warmMs: 1 };
    }
    if (method === 'capture.analyze_burst') {
      return {
        engine: 'mock',
        framesCaptured: 3,
        elapsedMs: 18,
        captureAdapters: ['capture-bridge'],
        fallbackFrames: 0,
        rois: {
          down_distance: { text: '3rd & 6', confidence: 1, agreement: 1, samples: [] },
          field_position: { text: 'OWN 40', confidence: 1, agreement: 1, samples: [] },
          offense_formation_personnel: {
            text: 'Gun - Deuce close - 1 RB 2 TE 2 WR',
            confidence: 1,
            agreement: 1,
            samples: [],
          },
          previous_defense_play: { text: 'Cover 3', confidence: 1, agreement: 1, samples: [] },
        },
      };
    }
    return {};
  }
}

class FakeHotkey extends EventEmitter {
  constructor() {
    super();
    this.accelerator = '';
    this.callback = null;
    this.registered = false;
  }
  start() {
    this.registered = true;
    return this.getStatus();
  }
  stop() {
    this.registered = false;
    return this.getStatus();
  }
  configure(accelerator, callback) {
    this.accelerator = accelerator;
    this.callback = callback;
    return this.start();
  }
  getStatus() {
    return { accelerator: this.accelerator, registered: this.registered };
  }
}

class FakeBridge extends EventEmitter {
  constructor() {
    super();
    this.requests = [];
  }
  async start() {
    return this.getStatus();
  }
  async stop() {
    return this.getStatus();
  }
  getStatus() {
    return { running: true, ready: true };
  }
  async request(method, params) {
    this.requests.push({ method, params });
    if (method === 'preview.frame') {
      return { imageData: 'data:image/png;base64,AA==', width: 16, height: 9 };
    }
    return {};
  }
}

test('integration OCR manager gates capture and returns diagnostics', async (t) => {
  const userData = await temporaryDirectory(t);
  const sidecar = new FakeSidecar();
  const hotkey = new FakeHotkey();
  let now = 100;
  sidecar.onRequest = () => { now += 18; };
  const events = [];
  const manager = new IntegrationOcrManager({
    userData,
    sidecar,
    bridge: new FakeBridge(),
    hotkey,
    now: () => now,
    loadCatalogs: async () => ({
      offensive: [
        { team: 'DAL', formation: 'Gun', set: 'Deuce Close', play_name: 'PA Boot' },
      ],
      defensive: [{ id: 'cover3', team: 'CHI', formation: 'Nickel', set: 'Normal', play_name: 'Cover 3' }],
    }),
  });
  manager.on('event', (event) => events.push(event));
  await manager.initialize();

  await assert.rejects(() => manager.capture(), { code: 'OCR_DISABLED' });
  await manager.saveProfile({
    id: 'profile-1',
    name: 'Test',
    source: { id: 'Game Capture', name: 'Game Capture' },
    obs: { host: '127.0.0.1', port: 4455 },
    regions: [
      { field: 'down_distance', x: 0, y: 0, width: 0.2, height: 0.1 },
      { field: 'field_position', x: 0, y: 0.1, width: 0.2, height: 0.1 },
      { field: 'offense_formation_personnel', x: 0, y: 0.2, width: 0.2, height: 0.1 },
      { field: 'previous_defense_play', x: 0, y: 0.3, width: 0.2, height: 0.1 },
    ],
  });
  await manager.updateConfig({
    enabled: true,
    context: { team: 'CHI', opponent: 'DAL' },
    settleDelayMs: 0,
    adapter: 'capture-bridge',
    freshFrameTimeoutMs: 750,
  });
  await manager._warmEngine();
  const response = await manager.capture({ reason: 'test' });

  assert.equal(response.capture.frameCount, 3);
  assert.equal(response.capture.fields.previous_defense_play.value.id, 'cover3');
  assert.equal(response.capture.fields.offense_formation_personnel.value.formation, 'Gun');
  assert.equal(response.capture.fields.offense_formation_personnel.value.set, 'Deuce Close');
  assert.equal(response.diagnostics.samples, 1);
  assert.equal(response.diagnostics.configuredAdapter, 'capture-bridge');
  assert.deepEqual(response.diagnostics.captureAdapters, ['capture-bridge']);
  const configure = sidecar.requests.findLast((request) => request.method === 'obs.configure');
  assert.equal(configure.params.adapter, 'capture-bridge');
  assert.equal(configure.params.freshFrameTimeoutMs, 750);
  const burst = sidecar.requests.findLast((request) => request.method === 'capture.analyze_burst');
  assert.equal(burst.params.adapter, 'capture-bridge');
  assert.ok(sidecar.requests.some((request) => request.method === 'capture.analyze_burst'));
  assert.ok(events.some((event) => event.type === 'capture:complete'));
  await manager.stop();
});
