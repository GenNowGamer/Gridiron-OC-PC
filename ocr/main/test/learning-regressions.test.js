'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { IntegrationOcrManager } = require('../integration-manager');
const { VersionedConfigStore } = require('../config-store');

test('rapid config changes serialize persistence and retain the latest merged state', async () => {
  const store = new VersionedConfigStore({ userData: 'unused-in-memory' });
  let active = 0, peak = 0, persisted;
  store._writeAtomic = async snapshot => {
    active += 1; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    persisted = snapshot; active -= 1;
  };
  await Promise.all([store.setFeatureFlag('capture', true), store.setFeatureFlag('learning', true),
    store.update({ config: { context: { role: 'dc', team: 'CHI', opponent: 'DAL' } } })]);
  assert.equal(peak, 1);
  assert.equal(persisted.featureFlags.capture, true);
  assert.equal(persisted.featureFlags.learning, true);
  assert.equal(persisted.config.context.role, 'dc');
});

function harness() {
  const records = [];
  const state = { featureFlags: { capture: true, learning: true }, activeProfileId: 'p',
    profiles: [{ id: 'p', regions: [] }], config: { context: { role: 'dc', team: 'CHI', opponent: 'DAL', quarter: 1, userScore: 0, oppScore: 0 }, capture: { settleDelayMs: 0 }, obs: {} } };
  const sidecar = new EventEmitter();
  sidecar.getStatus = () => ({ ready: true });
  sidecar.request = async () => ({ rois: {}, framesCaptured: 3, frames: [] });
  const manager = new IntegrationOcrManager({ userData: 'unused-in-memory', sidecar,
    store: { get: () => state }, ledger: { recordSnap: async value => { records.push(value); },
      correctSnap: async value => { records.push({ ...value, correction: true }); }, getSnapshot: async () => ({}) },
    hotkey: Object.assign(new EventEmitter(), { getStatus: () => ({}) }), debugPack: { sessionSummary: () => ({}) },
  });
  manager.engineWarm = { engine: 'test' };
  manager._prepareLiveCapture = async () => ({ source: 'test' });
  manager._appendDecisionTrace = async () => {};
  manager._recordDebugEvent = async () => {};
  let nextFields;
  manager._resolveFields = async () => nextFields;
  const capture = async (down, yards, spot, previous = true, extra = {}) => {
    nextFields = {
      down_distance: { key: 'down_distance', required: true, accepted: true, value: `${down} & ${yards}` },
      field_position: { key: 'field_position', required: true, accepted: true, value: { side: 'OWN', yardLine: spot } },
      offense_formation_personnel: { required: true, accepted: true, value: { formation: 'Gun', set: 'Trips' } },
      previous_defense_play: { accepted: true, value: previous ? { id: 'd1', formation: 'Nickel', set: 'Over', type: 'ZONE', play_name: 'Cover 3' } : null },
    };
    return manager.capture(extra);
  };
  return { manager, records, state, capture, sidecar };
}

test('confirmed DC identity disambiguates same-name formations and penalties cannot teach a stop', async () => {
  const h = harness();
  const exact = { id: 'chi|nickel|dbl|cover3', team: 'CHI', formation: 'Nickel', set: 'Dbl', play_name: 'Cover 3' };
  h.manager.resolvedCatalogs = { defensive: [exact] };
  let current = await h.capture(1, 10, 25, false);
  assert.equal(h.manager.setPendingCall({ captureId: current.capture.id, playId: exact.id }).accepted, true);
  current = await h.capture(2, 5, 30);
  assert.equal(h.records[0].learningEvent.defense.playId, exact.id);
  assert.equal(h.manager.setPendingCall({ captureId: current.capture.id, playId: exact.id, penalty: 'offensive_holding' }).accepted, true);
  await h.capture(2, 15, 20);
  assert.equal(h.records[1].learningEvent.outcome.learnable, false);
  assert.equal(h.records[1].learningEvent.verification.learningEligible, false);
  await h.capture(3, 10, 25);
  assert.equal(h.records[2].learningEvent.outcome.learnable, true, 'penalty is consumed with its own snap');
  assert.equal(h.records[2].learningEvent.outcome.yardsAllowed, 5);
});

test('audible picker IDs with spaces resolve to the same OCR catalog play', async () => {
  const h = harness();
  const audible = { id: 'chi|nickel|2-4-dbl-mug|cover-3', team: 'CHI', play_name: 'Cover 3' };
  h.manager.resolvedCatalogs = { defensive: [audible] };
  const current = await h.capture(1, 10, 25, false);
  assert.equal(h.manager.setPendingCall({ captureId: current.capture.id, playId: 'chi|nickel|2-4 dbl mug|cover 3' }).accepted, true);
  await h.capture(2, 5, 30);
  assert.equal(h.records[0].learningEvent.defense.playId, audible.id);
});

test('same-screen capture retains pending penalty; cleared penalty permits learning', async () => {
  const h = harness();
  const exact = { id: 'd1', team: 'CHI', play_name: 'Cover 3' };
  h.manager.resolvedCatalogs = { defensive: [exact] };
  let current = await h.capture(1, 10, 25, false);
  h.manager.setPendingCall({ captureId: current.capture.id, playId: 'd1', penalty: 'offensive_holding' });
  current = await h.capture(1, 10, 25);
  assert.equal(h.manager.pendingSnap.penalty.id, 'offensive_holding');
  h.manager.setPendingCall({ captureId: current.capture.id, playId: 'd1', penalty: null });
  await h.capture(2, 5, 30);
  assert.equal(h.records[0].learningEvent.outcome.learnable, true);
  h.manager.resetSession({ reason: 'new_game' });
  assert.equal(h.manager.setPendingCall({ captureId: current.capture.id, playId: 'd1' }).accepted, false);
});

test('manual previous-play correction resolves an ID and replaces existing learning', async () => {
  const h = harness();
  const zero = { team: 'CHI', id: 'zero', play_name: 'Zero Blitz', formation: 'Dollar', set: 'Mug' };
  h.manager.loadCatalogs = async () => ({ offensive: [], defensive: [zero] });
  await h.capture(1, 10, 25, false);
  const current = await h.capture(2, 11, 24);
  await h.manager.correctCapture({ captureId: current.capture.id, corrections: { previous_defense_play: 'ZERO BLITZ' } });
  assert.equal(h.records[1].correction, true);
  assert.equal(h.records[1].learningEvent.defense.playId, 'zero');
  await h.manager.correctCapture({ captureId: current.capture.id, corrections: { previous_defense_play: '' } });
  assert.equal(h.records[2].learningEvent, null, 'clearing a mistaken play removes its learning');
  assert.equal(h.manager.pendingSnap.state.down, 2);
});

test('manual spot correction advances the next baseline and validation', async () => {
  const h = harness();
  await h.capture(1, 10, 25, false);
  const current = await h.capture(3, 5, 30);
  const result = await h.manager.correctCapture({ captureId: current.capture.id,
    corrections: { down_distance: '2nd & 5', field_position: 'OWN 30' } });
  assert.equal(result.capture.validation.accepted, true);
  await h.capture(3, 2, 33);
  assert.equal(h.records.at(-1).learningEvent.situation.down, 2);
  assert.equal(h.records.at(-1).learningEvent.outcome.yardsAllowed, 3);
});

test('same-screen OCR recapture does not invent a defensive stop', async () => {
  const h = harness();
  await h.capture(1, 10, 25, false);
  await h.capture(2, 5, 30);
  await h.capture(2, 5, 30);
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0].learningEvent.outcome.yardsAllowed, 5);
  await h.capture(3, 5, 30);
  assert.equal(h.records.length, 2, 'real zero-yard play still learns when the down advances');
});

test('capture while learning is off still advances the pending baseline', async () => {
  const h = harness();
  h.state.featureFlags.learning = false;
  await h.capture(1, 10, 25, false);
  await h.capture(2, 5, 30);
  h.state.featureFlags.learning = true;
  await h.capture(3, 2, 33);
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0].learningEvent.situation.down, 2);
  assert.equal(h.records[0].learningEvent.outcome.yardsAllowed, 3);
});

test('new game clears OCR quarter/score baseline without deleting learned history', async () => {
  const h = harness();
  await h.capture(1, 10, 25, false, { quarter: 4, userScore: 21, oppScore: 14 });
  h.manager.resetSession({ reason: 'new_game' });
  const next = await h.capture(1, 10, 25, false);
  assert.equal(next.capture.validation.accepted, true);
  assert.equal(h.records.length, 0);
  await h.capture(2, 5, 30);
  assert.equal(h.records.length, 1);
});

test('OC and opponent changes never train a previous DC snap across boundaries', async () => {
  const h = harness();
  await h.capture(1, 10, 25, false);
  await h.capture(2, 5, 30, true, { role: 'oc' });
  assert.equal(h.records.length, 0);
  await h.capture(3, 2, 33, true, { role: 'dc', opponent: 'GB' });
  assert.equal(h.records.length, 0);
  await h.capture(4, 2, 33, true, { role: 'dc', opponent: 'GB' });
  assert.equal(h.records.length, 1);
});

test('in-flight capture from a reset session cannot update the new game', async () => {
  const h = harness();
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  h.sidecar.request = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const pending = h.capture(1, 10, 25, false);
  await ready;
  h.manager.resetSession({ reason: 'new_game' });
  release({ rois: {}, frames: [], framesCaptured: 3 });
  await assert.rejects(pending, { code: 'OCR_SESSION_CHANGED' });
  assert.equal(h.manager.lastCapture, null);
  assert.equal(h.records.length, 0);
});
