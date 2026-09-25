'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { IntegrationOcrManager } = require('../integration-manager');
const { buildLearningSnapshot } = require('../event-ledger');
const Hud = require('../../shared/hudTextNormalize');
const fixtures = require('./fixtures/chi-phi-corrections.json');
const withIds = rows => rows.map(play => ({ ...play,
  id: play.id || [play.team, play.formation, play.set, play.play_name || play.playName]
    .map(value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')).filter(Boolean).join('|'),
}));
const catalogs = { offensive: withIds(require('../../../plays.json')), defensive: withIds(require('../../../defensive_plays.json')) };
function manager() {
  return new IntegrationOcrManager({ userData: 'unused-in-memory', sidecar: new EventEmitter(), hotkey: new EventEmitter(),
    loadCatalogs: async () => catalogs });
}
const key = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

for (const fixture of fixtures) {
  test(`CHI–PHI corrected ${fixture.field}: ${fixture.roi.text}`, async () => {
    const fields = await manager()._resolveFields({ [fixture.field]: { ...fixture.roi } }, { team: 'CHI', opponent: 'PHI', role: 'dc' });
    const field = fields[fixture.field];
    assert.equal(field.accepted, true);
    const label = field.value && typeof field.value === 'object' ? field.value.play_name || field.value.label : field.value;
    assert.equal(key(label), key(fixture.expected));
    if (fixture.expected && fixture.field.startsWith('previous_')) assert.ok(field.value.id);
  });
}

test('word repairs preserve intact ZERO, LOOP and LB names and unrelated unknown text', () => {
  assert.equal(Hud.repairPreviousPlayOcrText('ZERO BLITZ'), 'ZERO BLITZ');
  assert.equal(Hud.repairPreviousPlayOcrText('LOOP HOT BLITZ 3'), 'LOOP HOT BLITZ 3');
  assert.equal(Hud.stripNoisyPreviousPlayPrefix('LB CROSS 3 SHOW 2'), 'LB CROSS 3 SHOW 2');
  assert.equal(Hud.isGarbagePreviousPlayOcr('MTN FLOOD'), false);
  assert.equal(Hud.parseFieldPositionText("Y'3'B").ok, false, 'Y is not enough evidence for a side');
  assert.equal(Hud.parseFieldPositionText("Y'3'B", { sideHint: 'OPP' }).ok, false);
});

test('impossible personnel totals stay reviewable without guessing a formation', async () => {
  for (const raw of ['IRBIATEIWR', 'RBIZTEILWR', '1RB - 3TE 3WR']) {
    const fields = await manager()._resolveFields({ offense_formation_personnel: { text: raw, confidence: 0.99, agreement: 1 } },
      { team: 'CHI', opponent: 'PHI', role: 'dc' });
    assert.equal(fields.offense_formation_personnel.accepted, false, raw);
    assert.ok(fields.offense_formation_personnel.acceptanceReasons.includes('invalid_personnel_total'));
  }
  assert.equal(Hud.hasValidPersonnelCounts('1RB - 1TE 3WR'), true);
  assert.equal(Hud.hasValidPersonnelCounts('2RB - 2TE 1WR'), true);
  assert.equal(Hud.hasValidPersonnelCounts('Gun - Trips'), true);
});

test('append-only correction replaces one capture, survives rebuild, and undo never revives its old value', () => {
  const sample = (id, type, captureId, playId) => ({ id, type, payload: { captureId,
    learningEvent: playId ? { id: captureId, defense: { playId }, verification: { learningEligible: false } } : null } });
  const events = [sample('a', 'snap', 'screen1', 'old'), sample('b', 'snap', 'screen2', 'other'),
    sample('c', 'snap_correction', 'screen1', 'fixed')];
  assert.deepEqual(buildLearningSnapshot(events).samples.map(e => e.id), ['b', 'c']);
  events.push({ id: 'd', type: 'undo', payload: { eventId: 'c' } });
  assert.deepEqual(buildLearningSnapshot(events).samples.map(e => e.id), ['b']);
  events.push(sample('e', 'snap_correction', 'screen2', null));
  assert.equal(buildLearningSnapshot(events).samples.length, 0);
});
