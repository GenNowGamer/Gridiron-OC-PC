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
  assert.equal(Hud.repairPreviousPlayOcrText('ENGAGEHT'), 'ENGAGE EIGHT');
  assert.equal(Hud.repairPreviousPlayOcrText('NCHBLITZO'), 'PINCH BLITZ 0');
  assert.equal(Hud.repairPreviousPlayOcrText('HAEROBLAST'), 'HAMMER 0 BLAST');
  assert.equal(Hud.repairPreviousPlayOcrText('GOVERG'), 'COVER 6');
  assert.equal(Hud.repairPreviousPlayOcrText('MTNSHOKHBTON'), 'MTN SHOCK HB OPTION');
  assert.equal(Hud.isGarbagePreviousPlayOcr('cwb'), true);
  assert.equal(Hud.isGarbagePreviousPlayOcr('callw'), true);
  assert.equal(Hud.isGarbagePreviousPlayOcr('cyalwbl'), true);
  assert.equal(Hud.parseFieldPositionText("A'7'").label, 'OPP 1');
  assert.equal(Hud.parseFieldPositionText("▲'1'S").label, 'OPP 15');
  assert.equal(Hud.parseFieldPositionText('▲S').label, 'OPP 5');
  assert.equal(Hud.parseFieldPositionText("-3B", { sideHint: 'OWN' }).label, 'OWN 38');
  assert.equal(Hud.repairPersonnelOcrConfusions("RBITER"), '1RB - 1TE 3WR');
  assert.equal(Hud.repairPersonnelOcrConfusions("RYTITEIWR"), '1RB - 1TE 3WR');
  assert.equal(Hud.repairPersonnelOcrConfusions("ITEIR"), '1RB - 1TE 3WR');
  assert.equal(Hud.repairPersonnelOcrConfusions("RITEIR"), '1RB - 1TE 3WR');
  assert.equal(Hud.repairPersonnelOcrConfusions("ITER"), '1RB - 1TE 3WR');
  assert.equal(Hud.repairPersonnelOcrConfusions("aR"), '1RB - 1TE 3WR');
  assert.equal(Hud.parseDownDistanceText("4&1").label, '4th & 1');
  assert.equal(Hud.parseDownDistanceText("2ND&2O").label, '2nd & 20');
  assert.equal(Hud.parseDownDistanceText("'2'ND'9''7'").label, '2nd & 7');
  assert.equal(Hud.parseDownDistanceText('2ND97').label, '2nd & 7');
  assert.equal(Hud.parseDownDistanceText('2ND910').label, '2nd & 10');
  assert.equal(Hud.parseDownDistanceText('2ND & 97').label, '2nd & 7');
  assert.equal(Hud.parseDownDistanceText('2ND9').label, '2nd & 9');
  assert.equal(Hud.parseDownDistanceText('2ND19').label, '2nd & 19');
  assert.equal(Hud.parseDownDistanceText("'2'ND'&'INCHES'1'").label, '2nd & 1');
  assert.equal(Hud.parseDownDistanceText("'2'WD'&''8''1'").label, '2nd & 8');
  assert.equal(Hud.parseDownDistanceText("'3'D'&''8''1'").label, '3rd & 8');
  assert.equal(Hud.parseDownDistanceText("'2'ND'&''1''0''1'").label, '2nd & 10');
  assert.equal(Hud.parseDownDistanceText('2ND & 21').label, '2nd & 21');
  assert.equal(Hud.parseDownDistanceText("'3'RD'&''1''1'").label, '3rd & 11');
  assert.equal(Hud.parseDownDistanceText("'2''0''0''&''1''1'").label, '2nd & 11');
  assert.equal(Hud.parseDownDistanceText("'1''3''0''&''3'").label, '3rd & 3');
  assert.equal(Hud.parseDownDistanceText("'1''2''1''0''&''3'").label, '2nd & 3');
  assert.equal(Hud.parseDownDistanceText('30&7').label, '3rd & 7');
  assert.equal(Hud.hasDownDistanceEvidence("'2''0''0''&''1''1'"), true);
  assert.equal(Hud.hasDownDistanceEvidence('2ND & 21'), true);
  assert.equal(Hud.hasDownDistanceEvidence('TSTA'), false);
  assert.equal(Hud.parseFieldPositionText("Y'3'B").ok, false, 'Y is not enough evidence for a side');
  assert.equal(Hud.parseFieldPositionText("Y'3'B", { sideHint: 'OPP' }).ok, false);
});

test('Sunday Night outlined ordinals accept when the letters were read as zeros', async () => {
  const fields = await manager()._resolveFields({
    down_distance: { text: "'2''0''0''&''1''1'", confidence: 0.8, agreement: 1 },
  }, { team: 'CHI', opponent: 'PIT', role: 'oc' });
  assert.equal(fields.down_distance.value, '2nd & 11');
  assert.equal(fields.down_distance.accepted, true);
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

test('stable defensive personnel counts survive OCR separator noise', async () => {
  const fields = await manager()._resolveFields({
    offense_formation_personnel: {
      text: 'Gun - Tight Y Off 1RB]1TE|3WR',
      confidence: 0.8261,
      agreement: 1,
      samples: [],
    },
  }, { team: 'CHI', opponent: 'ATL', role: 'dc' });
  assert.equal(fields.offense_formation_personnel.accepted, true);
  assert.equal(fields.offense_formation_personnel.value.formation, 'Gun');
  assert.equal(fields.offense_formation_personnel.value.set, 'Tight Y Off');
  assert.ok(fields.offense_formation_personnel.acceptanceReasons.includes('structured_hud_accept'));
});

test('glued ordinal plus GOAL OCR is valid down-distance evidence', async () => {
  const fields = await manager()._resolveFields({
    down_distance: { text: "'3'RDGGOAL", confidence: 0.8539, agreement: 1, samples: [] },
    field_position: { text: '▲15', confidence: 0.95, agreement: 1, samples: [] },
  }, { team: 'CHI', opponent: 'PHI', role: 'dc' });
  assert.equal(fields.down_distance.value, '3rd & Goal');
  assert.equal(fields.down_distance.accepted, true);
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
