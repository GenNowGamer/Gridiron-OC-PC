"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const Contracts = require("../ocr/shared/contracts.js");
const Matcher = require("../ocr/shared/textCatalogMatcher.js");
const Consensus = require("../ocr/shared/temporalConsensus.js");
const StateValidator = require("../ocr/shared/footballStateValidator.js");
const Lifecycle = require("../ocr/shared/snapLifecycle.js");
const Outcome = require("../ocr/shared/defensiveOutcomeInference.js");
const Projection = require("../ocr/shared/learningProjection.js");
const Adjustment = require("../ocr/shared/learnedAdjustment.js");
const ExactEngine = require("../ocr/shared/exactPlayRecommendation.js");
const Confidence = require("../ocr/shared/confidenceCalibration.js");
const DefenseCore = require("../shared/defenseRecommendationCore.js");
const HudText = require("../ocr/shared/hudTextNormalize.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS", name);
  } catch (error) {
    console.error("FAIL", name);
    throw error;
  }
}

test("normalizes profile and clamps ROI bounds", () => {
  const profile = Contracts.normalizeProfile({
    id: "1080p",
    frame: { width: 1920, height: 1080 },
    regions: {
      formation: { x: 0.9, y: 0.9, width: 0.4, height: 0.4, normalized: true },
    },
  });
  assert.equal(profile.regions.formation.rect.x, 1728);
  assert.equal(profile.regions.formation.rect.width, 192);
  assert.equal(Contracts.validateProfile(profile).valid, true);
});

const catalog = [
  { id: "dal-gun-trips-stick", team: "DAL", formation: "Gun", set: "Trips", play_name: "Stick" },
  { id: "dal-gun-trips-stack", team: "DAL", formation: "Gun", set: "Trips", play_name: "Stack" },
  { id: "phi-gun-trips-stick", team: "PHI", formation: "Gun", set: "Trips", play_name: "Stick" },
  { id: "dal-gun-empty-verts", team: "DAL", formation: "Gun", set: "Empty", play_name: "Four Verticals", aliases: ["4 Verticals"] },
];

test("normalizes common OCR noise", () => {
  assert.equal(Matcher.normalizeOcrText("  st|ck!! "), "ST CK");
});

test("fuzzy matching is scoped by team formation and set", () => {
  const match = Matcher.matchCatalogText("STICK", catalog, {
    team: "DAL", formation: "Gun", set: "Trips",
  }, { minScore: 0.6, ambiguityMargin: 0.03, requireRawAgreement: false });
  assert.equal(match.match.id, "dal-gun-trips-stick");
  assert.equal(match.scopedCount, 2);
});

test("ambiguous fuzzy matches fail closed", () => {
  const match = Matcher.matchCatalogText("STAC", catalog, {
    team: "DAL", formation: "Gun", set: "Trips",
  }, { minScore: 0.4, ambiguityMargin: 0.5, requireRawAgreement: false });
  assert.equal(match.match, null);
  assert.equal(match.ambiguous, true);
});

test("catalog match rejects raw disagreement", () => {
  const match = Matcher.matchCatalogText("FS FIRE 1", [
    { id: "under", team: "CHI", play_name: "4-3 Under", formation: "4-3", set: "Under" },
    { id: "fire", team: "CHI", play_name: "FS Fire 1", formation: "Nickel", set: "Normal" },
  ], { team: "CHI" }, { minScore: 0.5, ambiguityMargin: 0.02 });
  assert.equal(match.match && match.match.id, "fire");
  const bad = Matcher.matchCatalogText("FS FIRE 1", [
    { id: "under", team: "CHI", play_name: "4-3 Under", formation: "4-3", set: "Under" },
  ], { team: "CHI" }, { minScore: 0.01, ambiguityMargin: 0.02 });
  assert.equal(bad.match, null);
  assert.equal(bad.rejectedForRawDisagreement, true);
});

test("HUD down/distance uses grammar + catalog, fails closed on digit soup", () => {
  const fullwidth = HudText.sanitizeHudText("２ＮＤ　＆　７");
  assert.equal(fullwidth, "2ND & 7");
  const fullwidthParsed = HudText.parseDownDistanceText(fullwidth);
  assert.equal(fullwidthParsed.ok, true);
  assert.equal(fullwidthParsed.down, 2);
  assert.equal(fullwidthParsed.yardsToGo, 7);

  // PP-OCR quote wrapping on outlined HUD glyphs.
  const quoted = HudText.parseDownDistanceText("'1'ST'&''1''0'");
  assert.equal(quoted.ok, true);
  assert.equal(quoted.down, 1);
  assert.equal(quoted.yardsToGo, 10);
  assert.equal(quoted.label, "1st & 10");

  const quotedField = HudText.parseFieldPositionText("'2''6'", { sideHint: "OWN" });
  assert.equal(quotedField.ok, true);
  assert.equal(quotedField.yardLine, 26);
  assert.equal(quotedField.label, "OWN 26");

  // Trailing HUD pipe "|" OCR'd as 1: "261" / "281" → 26 / 28.
  const pipeBleed = HudText.parseFieldPositionText("'2''6''1'", { sideHint: "OPP" });
  assert.equal(pipeBleed.ok, true);
  assert.equal(pipeBleed.yardLine, 26);
  assert.equal(pipeBleed.label, "OPP 26");
  const pipeBleedOwn = HudText.parseFieldPositionText("'2''8''1'", { sideHint: "OWN" });
  assert.equal(pipeBleedOwn.yardLine, 28);
  // Must NOT strip ones digit of real 21/31/41 yardlines.
  const yard21 = HudText.parseFieldPositionText("v'2''1'", { sideHint: "OWN" });
  assert.equal(yard21.yardLine, 21);
  assert.equal(yard21.label, "OWN 21");
  const yard31 = HudText.parseFieldPositionText("'3''1'", { sideHint: "OPP" });
  assert.equal(yard31.yardLine, 31);

  const inchesTypo = HudText.parseDownDistanceText("'3'RD'&'INGHES");
  assert.equal(inchesTypo.ok, true);
  assert.equal(inchesTypo.down, 3);
  assert.equal(inchesTypo.yardsToGo, 1);

  const personnelGlued = HudText.parseFormationPersonnelText("RBITEIAWR");
  assert.equal(personnelGlued.formation, "1RB");
  assert.match(personnelGlued.label, /1TE 3WR/);

  const personnelQuoted = HudText.parseFormationPersonnelText("'1'RBI'2'TEI'2'WR");
  assert.equal(personnelQuoted.formation, "1RB");
  assert.match(personnelQuoted.label, /2TE 2WR/);

  const zeroTe = HudText.parseFormationPersonnelText("'2'RBIOTEI'3'WR");
  assert.equal(zeroTe.formation, "2RB");
  assert.match(zeroTe.label, /0TE 3WR/);

  const playRepair = HudText.repairPreviousPlayOcrText("COVERBCLOUD");
  assert.equal(playRepair, "COVER 3 CLOUD");
  assert.equal(HudText.repairPreviousPlayOcrText("SAMBLITZS"), "SAM BLITZ 3");
  assert.equal(HudText.repairPreviousPlayOcrText("WSBLITZA"), "WS BLITZ 3");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERGWILLE"), "COVER 6 WILLE");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERCLOUDSTR"), "COVER 3 CLOUD STR");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERBUZZMABLE"), "COVER 3 BUZZ MABLE");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERILBBLITZ"), "COVER 1 LB BLITZ");
  assert.equal(HudText.repairPreviousPlayOcrText("IDOUBLETE"), "1 DOUBLE TE");
  assert.equal(HudText.repairPreviousPlayOcrText("ZEDUO"), "26 DUO");
  // Bridge export 2026-09-22: Cover 4 digit confusable A, Cover 1 Hole, dropped I, HB glue.
  assert.equal(HudText.repairPreviousPlayOcrText("COVERAQUARTERS"), "COVER 4 QUARTERS");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERAPRESS"), "COVER 4 PRESS");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERIHOLE"), "COVER 1 HOLE");
  assert.equal(HudText.repairPreviousPlayOcrText("NSIDEZONE"), "INSIDE ZONE");
  assert.equal(HudText.repairPreviousPlayOcrText("HBDIVE"), "HB DIVE");
  assert.equal(HudText.repairPreviousPlayOcrText("HBDIE"), "HB DIVE");
  const ampersandAsG = HudText.parseDownDistanceText("'2'NDG'3'");
  assert.equal(ampersandAsG.ok, true);
  assert.equal(ampersandAsG.label, "2nd & 3");
  assert.equal(HudText.parseDownDistanceText("'2'NDGOAL").label, "2nd & Goal");
  assert.equal(HudText.parseDownDistanceText("TSTG'1'O").label, "1st & 10");
  assert.equal(HudText.parseDownDistanceText("TST'8''2''0'").label, "1st & 20");
  assert.equal(HudText.parseDownDistanceText("'3'R'0''8''7'").label, "3rd & 7");
  assert.equal(HudText.parseDownDistanceText("'1'STGGOAL").label, "1st & Goal");
  assert.equal(HudText.parseDownDistanceText("'2'ND'8''1''0'").label, "2nd & 10");
  assert.equal(HudText.parseDownDistanceText("'4'TH'8''1'O").label, "4th & 10");
  assert.equal(HudText.parseDownDistanceText("'2'NDGS").label, "2nd & 5");
  assert.equal(HudText.parseDownDistanceText("ATHA'7'").label, "4th & 7");
  assert.equal(HudText.parseFieldPositionText("A'3'B").label, "OPP 38");
  assert.equal(HudText.parseFieldPositionText("A'1'S").label, "OPP 15");
  assert.equal(HudText.repairPreviousPlayOcrText("YLEADREADTIN"), "Y LEAD READ OPTION");
  assert.equal(HudText.repairPreviousPlayOcrText("HBSLISGREEN"), "HB SLIP SCREEN");
  assert.equal(HudText.repairPreviousPlayOcrText("EZONE"), "INSIDE ZONE");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERROBERPRESS"), "COVER 1 ROBBER PRESS");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERGWLLE"), "COVER 6 WILLE");
  assert.equal(HudText.repairPreviousPlayOcrText("BENCHDGCURL"), "BENCH DIG CURL");
  assert.equal(HudText.repairPreviousPlayOcrText("CLOSEPASAL"), "CLOSE PA SAIL");
  assert.equal(HudText.repairPreviousPlayOcrText("CURLCOMBO"), "CURL COMBO");
  assert.equal(HudText.repairPreviousPlayOcrText("FTMTNSTACKSALEMY-OUT"), "SFT MTN STACK SALEM Y-OUT");
  assert.equal(HudText.repairPreviousPlayOcrText("SAILDI"), "SAIL DIG");
  assert.equal(HudText.repairPreviousPlayOcrText("SLOTBITZS"), "SLOT BLITZ 3");
  assert.equal(HudText.parseDownDistanceText("3RD8").label, "3rd & 8");
  assert.equal(HudText.parseFieldPositionText("AT'3'", { sideHint: "OPP" }).label, "OPP 13");
  assert.equal(HudText.parseFieldPositionText("A'7''4'", { sideHint: "OPP" }).label, "OPP 14");
  assert.equal(HudText.parseFieldPositionText("A'3'A", { sideHint: "OPP" }).label, "OPP 34");
  assert.equal(HudText.parseFieldPositionText("IT'7'", { sideHint: "OWN" }).label, "OWN 11");
  assert.equal(HudText.parseFieldPositionText("v'4''7'", { sideHint: "OWN" }).label, "OWN 47");
  assert.equal(HudText.repairPreviousPlayOcrText("LEVELS"), "LEVELS");
  assert.equal(HudText.repairPreviousPlayOcrText("DRVESTUTTERFLAT"), "DRIVE STUTTER FLAT");
  assert.equal(HudText.repairPreviousPlayOcrText("OUTSEZONE"), "OUTSIDE ZONE");
  assert.equal(HudText.repairPreviousPlayOcrText("OLBFIREMAN"), "OLB FIRE MAN");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERHOLE"), "COVER 1 HOLE");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERBUZMABLE"), "COVER 3 BUZZ MABLE");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERGWLLIE"), "COVER 6 WILLIE");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERZNVERT"), "COVER 2 INVERT");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERIROBBER"), "COVER 1 ROBBER");
  assert.equal(HudText.repairPreviousPlayOcrText("ICONTANPRESS"), "1 CONTAIN PRESS");
  assert.equal(HudText.repairPreviousPlayOcrText("NCKELBUTZL"), "NICKEL BLITZ 1");
  assert.equal(HudText.repairPreviousPlayOcrText("SAWBITZI"), "SAW BLITZ 1");
  assert.equal(HudText.repairPreviousPlayOcrText("JETPULLSHALLOW"), "JET PULL SHALLOW");
  assert.equal(HudText.repairPreviousPlayOcrText("YEROSSPOST"), "Y CROSS POST");
  assert.equal(HudText.repairPreviousPlayOcrText("EMPTYFLODSWITCH"), "EMPTY FLOOD SWITCH");
  assert.equal(HudText.repairPreviousPlayOcrText("BRACKETSITCHLLE"), "BRACKET SWITCH WILLIE");
  assert.equal(HudText.repairPreviousPlayOcrText("SMASHDRVE"), "SMASH DRIVE");
  assert.equal(HudText.repairPreviousPlayOcrText("OVERSTORMBRAVE"), "OVER STORM BRAVE");
  assert.equal(HudText.repairPreviousPlayOcrText("OUTXDIG"), "OUT X DIG");
  assert.equal(HudText.repairPreviousPlayOcrText("LDOUBLESLOT"), "1 DOUBLE SLOT");
  // Bridge export 2026-09-22 Q3/Q4: GOAL OCR + more glued plays.
  assert.equal(HudText.parseDownDistanceText("'1'ST'&'BOAL").label, "1st & Goal");
  assert.equal(HudText.parseDownDistanceText("'1'ST'&'BOAL").ok, true);
  assert.equal(HudText.parseDownDistanceText("'3'RD'&'G'0'AL").label, "3rd & Goal");
  assert.equal(HudText.parseDownDistanceText("'2''0''&''6''0'AL").label, "2nd & Goal");
  assert.equal(HudText.parseDownDistanceText("'4'TH'&'BOAL").label, "4th & Goal");
  assert.equal(HudText.repairPreviousPlayOcrText("COVBUZZMATCH"), "COVER 3 BUZZ MATCH");
  assert.equal(HudText.repairPreviousPlayOcrText("HBSLIPSCREEN"), "HB SLIP SCREEN");
  assert.equal(HudText.repairPreviousPlayOcrText("HBLEAD"), "HB LEAD");
  assert.equal(HudText.repairPreviousPlayOcrText("NSDEZONESPLIT"), "INSIDE ZONE SPLIT");
  assert.equal(HudText.repairPreviousPlayOcrText("LDOUBLESLOT"), "1 DOUBLE SLOT");
  assert.equal(HudText.repairPreviousPlayOcrText("GLMAN"), "GL MAN");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERDROPFELD"), "COVER 4 DROP FIELD");
  assert.equal(HudText.repairPreviousPlayOcrText("MTNEMPTYVERTICAL"), "MTN EMPTY VERTICAL");
  assert.equal(HudText.repairPreviousPlayOcrText("DOUBLEBRACKETSWITCH"), "DOUBLE BRACKET SWITCH");
  assert.equal(HudText.repairPreviousPlayOcrText("PASHOTPOST"), "PA SHOT POST");
  assert.equal(HudText.repairPreviousPlayOcrText("WRCROSS"), "WR CROSS");
  assert.equal(HudText.repairPreviousPlayOcrText("YSTIEK"), "Y STICK");
  assert.equal(HudText.repairPreviousPlayOcrText("ZSPOT"), "Z SPOT");
  assert.equal(HudText.repairPreviousPlayOcrText("MTNZONE"), "MTN ZONE");
  assert.equal(HudText.repairPreviousPlayOcrText("GUBASE"), "60 BASE");
  assert.equal(HudText.repairPreviousPlayOcrText("LROBERPRESS"), "1 ROBBER PRESS");
  assert.equal(HudText.repairPreviousPlayOcrText("LCNTANPRESS"), "1 CONTAIN PRESS");
  assert.equal(HudText.repairPreviousPlayOcrText("INVERTHARDFLAT"), "1 INVERT HARD FLAT");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERSHOW"), "COVER 3 SHOW");
  assert.equal(HudText.repairPreviousPlayOcrText("OLBFREMAN"), "OLB FIRE MAN");
  assert.equal(HudText.repairPreviousPlayOcrText("COVERIROBBERRESS"), "COVER 1 ROBBER PRESS");
  assert.equal(HudText.repairPreviousPlayOcrText("TAMPAZCONTAIN"), "TAMPA 2 CONTAIN");
  assert.equal(HudText.isGarbagePreviousPlayOcr("'9''0''0'"), true);

  // ¥ down-arrow + trailing pipe 451 (must not become invalid 51).
  const mnfOwn = HudText.parseFieldPositionText("'2'B", { sideHint: "OWN" });
  assert.equal(mnfOwn.ok, true);
  assert.equal(mnfOwn.side, "OWN");
  assert.equal(mnfOwn.yardLine, 28);
  const mnfOppDigit = HudText.parseFieldPositionText("A'3'", { sideHint: "OPP" });
  assert.equal(mnfOppDigit.ok, true);
  assert.equal(mnfOppDigit.yardLine, 43);
  assert.equal(mnfOppDigit.side, "OPP");
  const mnfTriangle = HudText.parseFieldPositionText("▲'5'");
  assert.equal(mnfTriangle.ok, true);
  assert.equal(mnfTriangle.side, "OPP");
  assert.equal(mnfTriangle.yardLine, 5);
  const yenOwn = HudText.parseFieldPositionText("¥35");
  assert.equal(yenOwn.ok, true);
  assert.equal(yenOwn.side, "OWN");
  assert.equal(yenOwn.yardLine, 35);

  const pipe451 = HudText.parseFieldPositionText("'4''5''1'", { sideHint: "OWN" });
  assert.equal(pipe451.ok, true);
  assert.equal(pipe451.yardLine, 45);

  const irbite = HudText.parseFormationPersonnelText("IRBITEIAWR");
  assert.equal(irbite.formation, "1RB");
  assert.match(irbite.label, /1TE 3WR/);

  const teA = HudText.parseFormationPersonnelText("IRBIATEIIWR");
  assert.equal(teA.label, "1RB - 3TE 1WR");
  const teI = HudText.parseFormationPersonnelText("'2'RBIITEIZWR");
  assert.equal(teI.formation, "2RB");
  assert.match(teI.label, /1TE 2WR/);

  const mghes = HudText.parseDownDistanceText("'4'TH'&'MGHES");
  assert.equal(mghes.ok, true);
  assert.equal(mghes.down, 4);
  assert.equal(mghes.yardsToGo, 1);

  const eightD = HudText.parseDownDistanceText("38D & GOAL");
  assert.equal(eightD.ok, true);
  assert.equal(eightD.down, 3);
  assert.equal(eightD.goalToGo, true);

  const mZero = HudText.parseDownDistanceText("'2'M'0''&''4'");
  assert.equal(mZero.ok, true);
  assert.equal(mZero.down, 2);
  assert.equal(mZero.yardsToGo, 4);

  const down = HudText.parseDownDistanceText("2ND&2O");
  assert.equal(down.down, 2);
  assert.equal(down.yardsToGo, 20);
  assert.equal(down.label, "2nd & 20");
  assert.equal(down.ok, true);

  const ten = HudText.parseDownDistanceText("2nd & 10");
  assert.equal(ten.down, 2);
  assert.equal(ten.yardsToGo, 10);

  const spaced = HudText.parseDownDistanceText("2ND & 1 0");
  assert.equal(spaced.yardsToGo, 10);
  assert.equal(spaced.label, "2nd & 10");

  const oh = HudText.parseDownDistanceText("1st & 1O");
  assert.equal(oh.down, 1);
  assert.equal(oh.yardsToGo, 10);

  const third = HudText.parseDownDistanceText("3rd & 4");
  assert.equal(third.down, 3);
  assert.equal(third.yardsToGo, 4);

  const glued = HudText.parseDownDistanceText("3RD4");
  assert.equal(glued.down, 3);
  assert.equal(glued.yardsToGo, 4);
  assert.equal(glued.ok, true);

  // Confusable glyphs: 3→S, 4→A. Ordinal suffix RD forces down=3.
  const confusable = HudText.parseDownDistanceText("SRD & A");
  assert.equal(confusable.down, 3);
  assert.equal(confusable.yardsToGo, 4);
  assert.equal(confusable.label, "3rd & 4");
  assert.equal(confusable.ok, true);

  const confusableFirst = HudText.parseDownDistanceText("IST & IO");
  assert.equal(confusableFirst.down, 1);
  assert.equal(confusableFirst.yardsToGo, 10);

  // Ornament + truncated ordinal: "1s™ &10" → 1st & 10
  const trademark = HudText.parseDownDistanceText("1s™ &10");
  assert.equal(trademark.down, 1);
  assert.equal(trademark.yardsToGo, 10);
  assert.equal(trademark.label, "1st & 10");
  assert.equal(trademark.ok, true);

  // Session misreads: D→0/O in ordinals, bare TH, Inches short-yardage.
  const twoN0 = HudText.parseDownDistanceText("2N0 & 6");
  assert.equal(twoN0.down, 2);
  assert.equal(twoN0.yardsToGo, 6);
  assert.equal(twoN0.ok, true);

  const sro = HudText.parseDownDistanceText("SRO & 18");
  assert.equal(sro.down, 3);
  assert.equal(sro.yardsToGo, 18);
  assert.equal(sro.ok, true);

  const inches = HudText.parseDownDistanceText("TH & INCHES");
  assert.equal(inches.down, 4);
  assert.equal(inches.yardsToGo, 1);
  assert.equal(inches.label, "4th & 1");
  assert.equal(inches.ok, true);

  const gluedInches = HudText.parseDownDistanceText("'3'RDINCHES");
  assert.equal(gluedInches.ok, true);
  assert.equal(gluedInches.down, 3);
  assert.equal(gluedInches.yardsToGo, 1);
  assert.equal(gluedInches.label, "3rd & 1");

  const soup380 = HudText.parseDownDistanceText("380 &5");
  assert.equal(soup380.ok, true);
  assert.equal(soup380.down, 3);
  assert.equal(soup380.yardsToGo, 5);

  const soup44 = HudText.parseDownDistanceText("44 &6");
  assert.equal(soup44.ok, true);
  assert.equal(soup44.down, 4);
  assert.equal(soup44.yardsToGo, 6);

  // Bare digit blobs are ambiguous — never invent structure.
  for (const soup of ["34", "2010", "110", "1010", "20805", "20841"]) {
    const parsed = HudText.parseDownDistanceText(soup);
    assert.equal(parsed.ok, false, `${soup} must fail closed`);
    assert.equal(parsed.down, null);
  }

  const repeatedDownDigit = HudText.parseDownDistanceText("'1'S'1''&''2''0'");
  assert.equal(repeatedDownDigit.ok, true);
  assert.equal(repeatedDownDigit.down, 1);
  assert.equal(repeatedDownDigit.yardsToGo, 20);
  assert.equal(repeatedDownDigit.label, "1st & 20");

  const collapsedNd = HudText.parseDownDistanceText("'2''0''8''1''7'");
  assert.equal(collapsedNd.ok, true);
  assert.equal(collapsedNd.down, 2);
  assert.equal(collapsedNd.yardsToGo, 17);
  assert.equal(collapsedNd.label, "2nd & 17");

  const unexplainedYard = HudText.parseDownDistanceText("'3'RD'&'百");
  assert.equal(unexplainedYard.ok, false);
  assert.equal(unexplainedYard.down, null);

  const clockOnly = HudText.parseQuarterClockText("3:00");
  assert.equal(clockOnly.quarter, null);
  assert.equal(clockOnly.clock, "3:00");

  const first = HudText.parseQuarterClockText("1st 3:00");
  assert.equal(first.quarter, 1);
  assert.equal(first.clock, "3:00");
});

test("down_distance ROI uses no char whitelist", () => {
  const { defaultRoiWhitelist, sidecarProfile, parseDownDistance } = require("../ocr/main/integration-manager.js");
  assert.equal(defaultRoiWhitelist("down_distance"), "");
  const fromLabel = parseDownDistance("1st & 10");
  assert.equal(fromLabel.down, 1);
  assert.equal(fromLabel.yardsToGo, 10);
  assert.equal(fromLabel.goalToGo, false);
  const profile = sidecarProfile({
    id: "test",
    name: "test",
    regions: [{
      field: "down_distance",
      x: 0, y: 0, width: 0.2, height: 0.1,
      ocr: { whitelist: "0123456789STNDRDTH&" },
    }],
  });
  assert.equal(profile.rois[0].ocr.whitelist, "");
});

test("field position prefers last digit group and strips pre-arrow bleed", () => {
  const own = HudText.parseFieldPositionText("35", { sideHint: "OWN" });
  assert.equal(own.side, "OWN");
  assert.equal(own.yardLine, 35);
  assert.equal(own.label, "OWN 35");
  assert.equal(own.ok, true);

  const spaced = HudText.parseFieldPositionText("4 5", { sideHint: "OWN" });
  assert.equal(spaced.yardLine, 5);
  assert.equal(spaced.side, "OWN");

  const preArrow = HudText.parseFieldPositionText("4v5");
  assert.equal(preArrow.side, "OWN");
  assert.equal(preArrow.yardLine, 5);

  // Bare midfield hash stays valid — do not invent "5" from "45".
  const midfield = HudText.parseFieldPositionText("45", { sideHint: "OWN" });
  assert.equal(midfield.yardLine, 45);

  const opp = HudText.parseFieldPositionText("v 28");
  assert.equal(opp.side, "OWN");
  assert.equal(opp.yardLine, 28);

  const up = HudText.parseFieldPositionText("^ 42");
  assert.equal(up.side, "OPP");
  assert.equal(up.yardLine, 42);

  const gluedDown = HudText.parseFieldPositionText("v35");
  assert.equal(gluedDown.side, "OWN");
  assert.equal(gluedDown.yardLine, 35);
  assert.equal(gluedDown.label, "OWN 35");
  assert.equal(gluedDown.ok, true);

  const gluedUp = HudText.parseFieldPositionText("^42");
  assert.equal(gluedUp.side, "OPP");
  assert.equal(gluedUp.yardLine, 42);
  assert.equal(gluedUp.label, "OPP 42");
});

test("formation personnel splits set from RB/TE tail", () => {
  const parsed = HudText.parseFormationPersonnelText("Gun - Deuce Close 1RB|2TE|2WR");
  assert.equal(parsed.formation, "Gun");
  assert.equal(parsed.set, "Deuce Close");
  assert.match(parsed.personnel, /1\s*RB/i);
  assert.match(parsed.label, /Deuce Close/);
});

test("formation personnel repairs dropped I Form leading I", () => {
  const pipe = HudText.parseFormationPersonnelText("| Form - Wing 1RB|3TE|1WR");
  assert.equal(pipe.formation, "I Form");
  assert.equal(pipe.set, "Wing");
  assert.match(pipe.personnel, /1\s*RB/i);

  const bare = HudText.parseFormationPersonnelText("Form - Close 1RB|2TE|2WR");
  assert.equal(bare.formation, "I Form");
  assert.equal(bare.set, "Close");
});

test("LV/DEN field position: 4xx bleed, leading O, glued OPP, ambiguous 4X alt", () => {
  const bleed = HudText.parseFieldPositionText("415", { sideHint: "OPP" });
  assert.equal(bleed.ok, true);
  assert.equal(bleed.side, "OPP");
  assert.equal(bleed.yardLine, 15);
  assert.equal(bleed.label, "OPP 15");

  const bleed2 = HudText.parseFieldPositionText("418", { sideHint: "OPP" });
  assert.equal(bleed2.yardLine, 18);
  assert.equal(bleed2.side, "OPP");

  const leadingO = HudText.parseFieldPositionText("o1");
  assert.equal(leadingO.side, "OPP");
  assert.equal(leadingO.yardLine, 1);

  const glued = HudText.parseFieldPositionText("OPP5");
  assert.equal(glued.side, "OPP");
  assert.equal(glued.yardLine, 5);

  // Bare midfield-style 45 with side hint stays 45; ones-digit offered as alt only.
  const mid = HudText.parseFieldPositionText("45", { sideHint: "OWN" });
  assert.equal(mid.yardLine, 45);
  assert.equal(mid.side, "OWN");
  assert.ok(Array.isArray(mid.alternatives));
  assert.equal(mid.alternatives[0].yardLine, 5);

  // Glyph OWN beats a wrong ROI OPP hint (SEA opening drive: v45 → OWN 45).
  const conflict = HudText.parseFieldPositionText("v46", { sideHint: "OPP" });
  assert.equal(conflict.side, "OWN");
  assert.equal(conflict.glyphSide, "OWN");
  assert.equal(conflict.yardLine, 46);
  assert.ok(conflict.alternatives.some((alt) => alt.side === "OPP" && alt.yardLine === 46));

  const ownGlyph = HudText.parseFieldPositionText("v45", { sideHint: "OPP" });
  assert.equal(ownGlyph.side, "OWN");
  assert.equal(ownGlyph.yardLine, 45);
  assert.equal(ownGlyph.label, "OWN 45");
});

test("opening-drive previous play: -- and OCR junk are empty", () => {
  assert.equal(HudText.isEmptyPreviousPlayOcr("--"), true);
  assert.equal(HudText.isEmptyPreviousPlayOcr("- -"), true);
  assert.equal(HudText.isEmptyPreviousPlayOcr(""), true);
  assert.equal(HudText.isEmptyPreviousPlayOcr("GL MAN"), false);
  assert.equal(HudText.isGarbagePreviousPlayOcr("ot 2 ae expense eg a"), true);
  assert.equal(HudText.isGarbagePreviousPlayOcr('2 On DOWNS he +e". aden «am'), true);
  assert.equal(HudText.isGarbagePreviousPlayOcr("1 DOUBLE SLOT"), false);
  assert.equal(HudText.isGarbagePreviousPlayOcr("Cover 3 Sky"), false);
});

test("DEN formation: LRB→1RB and Field Goal package", () => {
  const lrb = HudText.parseFormationPersonnelText("Gun - Tight LRB|1TE|3 WR");
  assert.equal(lrb.formation, "Gun");
  assert.equal(lrb.set, "Tight");
  assert.match(lrb.personnel, /1\s*RB/i);

  const fg = HudText.parseFormationPersonnelText("Field Goal");
  assert.equal(fg.formation, "Field Goal");
  assert.equal(fg.set, "");
  assert.equal(fg.label, "Field Goal");
});

test("GB formation: ORB/0RB→1RB (1 misread as O/0)", () => {
  const orb = HudText.parseFormationPersonnelText("Gun - Flex Trey ORB|1TE|4WR");
  assert.equal(orb.formation, "Gun");
  assert.equal(orb.set, "Flex Trey");
  assert.match(orb.personnel, /1\s*RB/i);
  assert.match(orb.personnel, /1\s*TE/i);

  const zeroRb = HudText.parseFormationPersonnelText("Gun - Bunch Wide 0RB|1TE|3WR");
  assert.match(zeroRb.personnel, /1\s*RB/i);
});

test("field position v00 is yardline garbage, not OWN 0", () => {
  const zero = HudText.parseFieldPositionText("v00");
  assert.equal(zero.ok, false);
  assert.equal(zero.yardLine, null);
  assert.equal(zero.side, null);
  assert.equal(zero.reason, "yardline_zero_garbage");
});

test("missing down null must not become down_out_of_range", () => {
  const result = StateValidator.validateTransition(
    { down: 1, yardsToGo: 10, quarter: 2, homeScore: 0, awayScore: 0 },
    { down: null, yardsToGo: null, quarter: 2, homeScore: 0, awayScore: 0 },
  );
  assert.equal(result.accepted, true);
  assert.equal(result.next.down, null);
  assert.equal(result.reasons.includes("down_out_of_range"), false);
});

test("strip noisy previous-play prefix keeps RPO ZONE READ BUBBLE", () => {
  const stripped = HudText.stripNoisyPreviousPlayPrefix("i BERET ae RPO ZONE READ BUBBLE");
  assert.match(stripped, /RPO ZONE READ BUBBLE/i);
  assert.equal(/BERET/i.test(stripped), false);
});

test("DEN down distance digit-soup 38] &5 → 3rd & 5", () => {
  const parsed = HudText.parseDownDistanceText("38] &5");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.down, 3);
  assert.equal(parsed.yardsToGo, 5);
  assert.equal(parsed.label, "3rd & 5");
});

test("field position text OWN/OPP labels parse for corrections", () => {
  const own = HudText.parseFieldPositionText("OWN 34");
  assert.equal(own.ok, true);
  assert.equal(own.side, "OWN");
  assert.equal(own.yardLine, 34);

  const bare = HudText.parseFieldPositionText("15");
  assert.equal(bare.ok, true);
  assert.equal(bare.side, null);
  assert.equal(bare.yardLine, 15);
});

test("field position bare 50 is midfield without OWN/OPP", () => {
  const bare = HudText.parseFieldPositionText("50");
  assert.equal(bare.ok, true);
  assert.equal(bare.side, "MIDFIELD");
  assert.equal(bare.yardLine, 50);
  assert.equal(bare.label, "MIDFIELD 50");

  const prefixed = HudText.parseFieldPositionText("OWN 50");
  assert.equal(prefixed.ok, true);
  assert.equal(prefixed.side, "MIDFIELD");
  assert.equal(prefixed.yardLine, 50);

  const oppPrefixed = HudText.parseFieldPositionText("OPP 50");
  assert.equal(oppPrefixed.side, "MIDFIELD");
  assert.equal(oppPrefixed.yardLine, 50);
});

test("catalog match accepts identical play names across formations", () => {
  const match = Matcher.matchCatalogText("DBL OUTS", [
    { id: "a", team: "MIN", play_name: "DBL OUTS", formation: "I Form", set: "Close" },
    { id: "b", team: "MIN", play_name: "DBL OUTS", formation: "Strong", set: "Close" },
    { id: "c", team: "MIN", play_name: "DOUBLE SLANTS", formation: "Gun", set: "Normal" },
  ], { team: "MIN" }, { minScore: 0.72, ambiguityMargin: 0.08 });
  assert.ok(match.match);
  assert.equal(match.match.play_name, "DBL OUTS");
  assert.equal(match.ambiguous, false);
});

test("confidence calibration accepts strong HUD parse despite OCR conf 0", () => {
  const rejected = Confidence.calibrateFieldAcceptance({
    value: "2nd & 20",
    ocrConfidence: 0,
    resolverConfidence: 1,
    framesAgree: 1,
  });
  assert.equal(rejected.accepted, false);

  const boosted = Confidence.calibrateFieldAcceptance({
    value: "2nd & 20",
    ocrConfidence: Math.max(0, 0.93),
    resolverConfidence: 1,
    framesAgree: 1,
  });
  assert.equal(boosted.accepted, true);
});

test("temporal consensus requires repeated support", () => {
  const result = Consensus.computeConsensus([
    { value: "Gun", confidence: 0.9, at: 900 },
    { value: "Gun", confidence: 0.95, at: 950 },
    { value: "Gun", confidence: 0.92, at: 990 },
    { value: "Pistol", confidence: 0.4, at: 995 },
  ], { now: 1000, maxAgeMs: 500, minSamples: 3, minConfidence: 0.65 });
  assert.equal(result.stable, true);
  assert.equal(result.value, "Gun");
});

test("temporal consensus withholds unstable values", () => {
  const result = Consensus.computeConsensus([
    { value: "Gun", at: 90 },
    { value: "Pistol", at: 95 },
  ], { now: 100, minSamples: 2, minConfidence: 0.8 });
  assert.equal(result.value, null);
});

test("football validator accepts plausible snap transition", () => {
  const result = StateValidator.validateTransition(
    { quarter: 1, clockSeconds: 600, down: 1, yardsToGo: 10, homeScore: 0, awayScore: 0, possession: "DAL" },
    { quarter: 1, clockSeconds: 565, down: 2, yardsToGo: 6, homeScore: 0, awayScore: 0, possession: "DAL" }
  );
  assert.equal(result.accepted, true);
});

test("football validator rejects clock and score regression", () => {
  const result = StateValidator.validateTransition(
    { quarter: 2, clockSeconds: 400, down: 2, homeScore: 7, awayScore: 3 },
    { quarter: 2, clockSeconds: 500, down: 3, homeScore: 6, awayScore: 3 }
  );
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes("game_clock_increased"));
  assert.ok(result.reasons.includes("home_score_decreased"));
});

test("snap lifecycle completes and deduplicates events", () => {
  let state = Lifecycle.createLifecycleState();
  state = Lifecycle.reduceLifecycle(state, { id: "e1", type: "pre_snap", snapId: "s1", at: 10 }).state;
  state = Lifecycle.reduceLifecycle(state, { id: "e2", type: "snap", at: 20 }).state;
  const duplicate = Lifecycle.reduceLifecycle(state, { id: "e2", type: "snap", at: 20 });
  assert.equal(duplicate.duplicate, true);
  const ended = Lifecycle.reduceLifecycle(state, { id: "e3", type: "end", at: 40, state: { down: 2 } });
  assert.equal(ended.completedSnap.id, "s1");
  assert.equal(ended.state.completedSnaps.length, 1);
});

test("observation attributes to nearest snap window", () => {
  const snap = Lifecycle.attributeToSnap([
    { id: "old", startedAt: 0, snappedAt: 10, endedAt: 20 },
    { id: "new", startedAt: 30, snappedAt: 40, endedAt: 50 },
  ], { at: 42 }, { slackMs: 0 });
  assert.equal(snap.id, "new");
});

test("outcome inference learns conservative stops", () => {
  const result = Outcome.inferDefensiveOutcome({
    before: { down: 1, yardsToGo: 10, possession: "DAL" },
    after: { down: 2, yardsToGo: 9, possession: "DAL" },
    yardsGained: 1,
  });
  assert.equal(result.kind, "stop");
  assert.equal(result.learnable, true);
  assert.equal(result.successfulDefense, true);
});

test("outcome inference does not overclaim possession changes", () => {
  const result = Outcome.inferDefensiveOutcome({
    before: { possession: "DAL" },
    after: { possession: "PHI" },
  });
  assert.equal(result.kind, "turnover_or_drive_end");
  assert.equal(result.learnable, false);
});

test("outcome inference recognizes scored points", () => {
  const result = Outcome.inferDefensiveOutcome({
    defenseSide: "home",
    before: { homeScore: 7, awayScore: 3 },
    after: { homeScore: 7, awayScore: 10 },
  });
  assert.equal(result.kind, "touchdown_allowed");
  assert.equal(result.pointsAllowed, 7);
});

test("outcome inference uses field-position yard deltas", () => {
  const result = Outcome.inferDefensiveOutcome({
    before: { down: 1, yardsToGo: 10, fieldSide: "OWN", fieldYardLine: 30 },
    after: { down: 2, yardsToGo: 6, fieldSide: "OWN", fieldYardLine: 34 },
  });
  assert.equal(result.yardsAllowed, 4);
  assert.equal(result.learnable, true);
  assert.ok(result.evidence.includes("field_position_delta") || result.evidence.includes("down_advanced") || result.evidence.includes("distance_delta"));
});

test("outcome inference rejects implausible field-position side flips", () => {
  const result = Outcome.inferDefensiveOutcome({
    before: { down: 1, fieldSide: "OWN", fieldYardLine: 25 },
    after: { down: 2, fieldSide: "OPP", fieldYardLine: 34 },
  });
  assert.equal(result.yardsAllowed, null);
  assert.ok(result.evidence.includes("field_position_delta_rejected"));
});

test("outcome inference rejects extreme same-side field deltas", () => {
  const result = Outcome.inferDefensiveOutcome({
    before: { down: 2, fieldSide: "OWN", fieldYardLine: 10 },
    after: { down: 3, fieldSide: "OWN", fieldYardLine: 50 },
  });
  assert.equal(result.yardsAllowed, null);
  assert.ok(result.evidence.includes("field_position_delta_rejected"));
});

test("outcome inference prefers distance delta over field when both available", () => {
  const result = Outcome.inferDefensiveOutcome({
    before: { down: 1, yardsToGo: 10, fieldSide: "OWN", fieldYardLine: 30 },
    after: { down: 2, yardsToGo: 7, fieldSide: "OWN", fieldYardLine: 34 },
  });
  assert.equal(result.yardsAllowed, 3);
  assert.ok(result.evidence.includes("distance_delta"));
});

test("outcome inference marks drive starts as non-learnable", () => {
  const result = Outcome.inferDefensiveOutcome({ driveStart: true });
  assert.equal(result.kind, "drive_start");
  assert.equal(result.learnable, false);
});

test("projection skips UNKNOWN offense play keys", () => {
  const snapshot = Projection.appendLearningEvent(null, {
    id: "unknown-off",
    at: 1,
    opponent: "DET",
    situation: { down: 1, distanceBucket: "long" },
    offense: { formation: "Gun", set: "Trips" },
    defense: { playId: "chi|nickel|over|cover-3", formation: "Nickel", set: "Over", packageKey: "Nickel|Over" },
    outcome: { learnable: false },
  }).snapshot;
  const keys = Object.keys(snapshot.opponentTendency.byContext)
    .flatMap((contextKey) => Object.keys(snapshot.opponentTendency.byContext[contextKey].plays || {}));
  assert.equal(keys.includes("UNKNOWN"), false);
});

test("tendency counter adjustment boosts counters for observed offense concepts", () => {
  const events = [1, 2, 3, 4].map((n) => ({
    id: `tend-${n}`,
    at: n,
    opponent: "DET",
    situation: { down: 1, distanceBucket: "long" },
    offense: {
      formation: "Gun",
      set: "Trips",
      playId: "det|gun|trips|four-verticals",
      playName: "FOUR VERTICALS",
    },
    defense: {
      playId: "chi|dime|rush|cover-4-palms",
      formation: "Dime",
      set: "Rush",
      packageKey: "Dime|Rush",
    },
    outcome: { learnable: true, successfulDefense: true },
  }));
  const snapshot = Projection.projectEvents(events);
  const play = {
    id: "chi|dime|rush|cover-4-palms",
    formation: "Dime",
    set: "Rush",
    play_name: "Cover 4 Palms",
    type: "ZONE",
    concepts: ["Cover 4"],
  };
  const traits = DefenseCore.defensivePlayTraitsOf(play);
  const value = Adjustment.tendencyCounterAdjustment(
    play,
    snapshot,
    { opponent: "DET", down: 1, distBucket: "long", offenseFormation: "Gun", offenseSet: "Trips" },
    { traits, minObservations: 2 },
  );
  assert.ok(value > 0);
});

function learnedEvent(id, successfulDefense, playId = "nickel-cover3") {
  return {
    id,
    at: 1000 + Number(id.replace(/\D/g, "")),
    opponent: "DAL",
    situation: { down: 3, distanceBucket: "long" },
    offense: { formation: "Gun", set: "Trips", playId: "stick" },
    defense: {
      playId,
      packageKey: "Nickel|Cover 3 Sky",
      formation: "Nickel",
      set: "Cover 3 Sky",
      playName: "Cover 3 Sky",
    },
    outcome: {
      learnable: true,
      successfulDefense,
      yardsAllowed: successfulDefense ? 2 : 12,
      pointsAllowed: 0,
    },
  };
}

test("projection separates tendency and effectiveness snapshots", () => {
  const snapshot = Projection.projectEvents([learnedEvent("e1", true)]);
  assert.equal(snapshot.opponentTendency.observations, 1);
  assert.equal(snapshot.defensiveEffectiveness.observations, 1);
  assert.equal(snapshot.defensiveEffectiveness.byPlay["nickel-cover3"].successes, 1);
});

test("OCR matchups record coverage family for next-sheet package leans", () => {
  const snapshot = Projection.projectEvents([
    learnedEvent("m1", true),
    learnedEvent("m2", false, "cover2-play"),
  ]);
  assert.equal(snapshot.recentMatchups.length, 2);
  assert.equal(snapshot.recentMatchups[0].coverageFamily, "cover3");
  assert.equal(snapshot.recentMatchups[0].successfulDefense, true);
  assert.equal(snapshot.recentMatchups[1].successfulDefense, false);

  const stay = DefenseCore.packageOutcomeMatchupAdjustment(
    { packageKey: "NICKEL|cover3|base", formation: "NICKEL", coverageFamily: "cover3" },
    [snapshot.recentMatchups[0]],
    { offenseShowing: { formation: "Gun", set: "Trips" } },
  );
  const leave = DefenseCore.packageOutcomeMatchupAdjustment(
    { packageKey: "NICKEL|cover3|base", formation: "NICKEL", coverageFamily: "cover3" },
    [snapshot.recentMatchups[1]],
    { offenseShowing: { formation: "Gun", set: "Trips" } },
  );
  const rotate = DefenseCore.packageOutcomeMatchupAdjustment(
    { packageKey: "NICKEL|cover4|base", formation: "NICKEL", coverageFamily: "cover4" },
    [snapshot.recentMatchups[1]],
    { offenseShowing: { formation: "Gun", set: "Trips" } },
  );
  assert.ok(stay > 0, "success should boost same family");
  assert.ok(leave < 0, "failure should tax same family");
  assert.ok(rotate > 0, "failure should boost other families");
});

test("projection deduplicates append-only event IDs", () => {
  const first = Projection.appendLearningEvent(null, learnedEvent("e1", true));
  const second = Projection.appendLearningEvent(first.snapshot, learnedEvent("e1", false));
  assert.equal(second.duplicate, true);
  assert.equal(second.snapshot.opponentTendency.observations, 1);
});

test("bounded adjustment requires evidence and respects cap", () => {
  assert.equal(Adjustment.boundedLearnedAdjustment({ observations: 2, successes: 2 }), 0);
  const value = Adjustment.boundedLearnedAdjustment({
    observations: 100, successes: 100, failures: 0, yardsAllowed: 0,
  }, { maxAdjustment: 2 });
  assert.ok(value > 0);
  assert.ok(value <= 2);
});

test("hierarchical backoff uses package then formation then global", () => {
  const events = [1, 2, 3, 4, 5].map((n) => learnedEvent(`e${n}`, true, "other-play"));
  const snapshot = Projection.projectEvents(events);
  assert.ok(snapshot.defensiveEffectiveness.byFormation.NICKEL);
  assert.ok(snapshot.defensiveEffectiveness.global.observations >= 5);
  const packageOnly = Adjustment.adjustmentForPlay(
    { id: "unseen-exact", formation: "Nickel", set: "Zone", packageKey: "NICKEL|ZONE" },
    snapshot,
    { minObservations: 3, maxAdjustment: 2.5 },
  );
  assert.ok(packageOnly > 0);
  const globalOnly = Adjustment.adjustmentForPlay(
    { id: "totally-new", formation: "46", set: "Bear" },
    snapshot,
    { minObservations: 3, maxAdjustment: 2.5 },
  );
  assert.ok(globalOnly > 0);
  assert.ok(globalOnly < packageOnly);
});

test("confidence calibration combines OCR resolver and agreement", () => {
  const Confidence = require("../ocr/shared/confidenceCalibration.js");
  const accepted = Confidence.calibrateFieldAcceptance({
    value: "Gun",
    ocrConfidence: 0.95,
    resolverConfidence: 0.9,
    framesAgree: 1,
  }, { requireCatalog: true });
  assert.equal(accepted.accepted, true);
  assert.ok(accepted.calibratedConfidence >= 0.88);
  const rejected = Confidence.calibrateFieldAcceptance({
    value: "Gun",
    ocrConfidence: 0.5,
    resolverConfidence: 0.9,
    framesAgree: 1,
  }, { requireCatalog: true });
  assert.equal(rejected.accepted, false);
  assert.ok(rejected.reasons.includes("ocr_below_threshold"));
});

test("exact-play engine wraps shared core and applies learning", () => {
  const events = [1, 2, 3, 4, 5].map((n) => learnedEvent(`e${n}`, true));
  const learningSnapshot = Projection.projectEvents(events);
  const plays = [
    { id: "nickel-cover3", team: "DAL", formation: "Nickel", set: "Normal", type: "ZONE", play_name: "Cover 3 Sky", concepts: ["Cover 3"] },
    { id: "dime-cover2", team: "DAL", formation: "Dime", set: "Normal", type: "ZONE", play_name: "Cover 2 Sink", concepts: ["Cover 2"] },
    { id: "nickel-blitz", team: "DAL", formation: "Nickel", set: "Double A", type: "BLITZ", play_name: "Mid Blitz", concepts: ["Blitz"] },
  ];
  const result = ExactEngine.computeExactPlayRecommendations({
    plays,
    down: 3,
    yards: 12,
    learningSnapshot,
    explore: false,
  });
  assert.equal(result.scoredCount, 3);
  assert.ok(result.scored.find((entry) => entry.play.id === "nickel-cover3").learningAdjustment > 0);
  assert.ok(result.recommendations.every((play) => plays.some((source) => source.id === play.id)));
  assert.equal(typeof DefenseCore.pickTopDefensiveRecommendationsCore, "function");
});

test("exact-play engine taxes recent play ids and shells across snaps", () => {
  const plays = [
    { id: "chi|nickel|2-4-load-mug|cover-3-cloud", team: "CHI", formation: "Nickel", set: "2-4 Load Mug", type: "ZONE", play_name: "Cover 3 Cloud", concepts: ["Cover 3"] },
    { id: "chi|nickel|over|cover-3-buzz-mable", team: "CHI", formation: "Nickel", set: "Over", type: "ZONE", play_name: "Cover 3 Buzz Mable", concepts: ["Cover 3"] },
    { id: "chi|nickel|wide|cb-zone-blitz", team: "CHI", formation: "Nickel", set: "Wide", type: "BLITZ", play_name: "CB Zone Blitz", concepts: ["Blitz"] },
    { id: "chi|4-3|over|cover-3-cloud", team: "CHI", formation: "4-3", set: "Over", type: "ZONE", play_name: "Cover 3 Cloud Str", concepts: ["Cover 3"] },
    { id: "chi|4-3|odd-leo|cover-3-match", team: "CHI", formation: "4-3", set: "Odd Leo", type: "MATCH", play_name: "Cover 3 Match", concepts: ["Cover 3", "Match"] },
    { id: "chi|dime|rush|cover-4-palms", team: "CHI", formation: "Dime", set: "Rush", type: "ZONE", play_name: "Cover 4 Palms", concepts: ["Cover 4"] },
  ];
  const baseline = ExactEngine.computeExactPlayRecommendations({
    plays,
    down: 1,
    yards: 10,
    offenseShowing: { formation: "Gun", set: "Empty Bunch Open" },
    recentPlayIds: [],
    exposurePlayIds: [],
  });
  const taxed = ExactEngine.computeExactPlayRecommendations({
    plays,
    down: 1,
    yards: 10,
    offenseShowing: { formation: "Gun", set: "Empty Bunch Open" },
    recentPlayIds: ["chi|nickel|2-4-load-mug|cover-3-cloud"],
    exposurePlayIds: [
      "chi|nickel|2-4-load-mug|cover-3-cloud",
      "chi|nickel|over|cover-3-buzz-mable",
      "chi|nickel|wide|cb-zone-blitz",
    ],
  });
  const cloudId = "chi|nickel|2-4-load-mug|cover-3-cloud";
  const baselineCloud = baseline.scored.find((entry) => entry.play.id === cloudId);
  const taxedCloud = taxed.scored.find((entry) => entry.play.id === cloudId);
  assert.ok(baselineCloud);
  assert.ok(taxedCloud);
  assert.equal(Number(baselineCloud.recencyAdjustment) || 0, 0);
  assert.equal(Number(baselineCloud.shellAdjustment) || 0, 0);
  assert.equal(taxedCloud.recencyAdjustment, -6.5);
  assert.ok(taxedCloud.shellAdjustment < 0);
  assert.ok(taxedCloud._score < baselineCloud._score);
  assert.equal(taxed.recommendations.some((play) => play.id === cloudId), false);
});

test("exact-play sheets rotate instead of repeating the same calls", () => {
  const plays = [
    { id: "chi|nickel|2-4-load-mug|cover-3-cloud", team: "CHI", formation: "Nickel", set: "2-4 Load Mug", type: "ZONE", play_name: "Cover 3 Cloud", concepts: ["Cover 3"] },
    { id: "chi|nickel|over|cover-3-buzz-mable", team: "CHI", formation: "Nickel", set: "Over", type: "ZONE", play_name: "Cover 3 Buzz Mable", concepts: ["Cover 3"] },
    { id: "chi|nickel|wide|cb-zone-blitz", team: "CHI", formation: "Nickel", set: "Wide", type: "BLITZ", play_name: "CB Zone Blitz", concepts: ["Blitz"] },
    { id: "chi|4-3|over|cover-3-cloud", team: "CHI", formation: "4-3", set: "Over", type: "ZONE", play_name: "Cover 3 Cloud Str", concepts: ["Cover 3"] },
    { id: "chi|4-3|odd-leo|cover-3-match", team: "CHI", formation: "4-3", set: "Odd Leo", type: "MATCH", play_name: "Cover 3 Match", concepts: ["Cover 3", "Match"] },
    { id: "chi|dime|rush|cover-4-palms", team: "CHI", formation: "Dime", set: "Rush", type: "ZONE", play_name: "Cover 4 Palms", concepts: ["Cover 4"] },
    { id: "chi|dime|normal|cover-2-sink", team: "CHI", formation: "Dime", set: "Normal", type: "ZONE", play_name: "Cover 2 Sink", concepts: ["Cover 2"] },
    { id: "chi|nickel|double-a|mid-blitz", team: "CHI", formation: "Nickel", set: "Double A", type: "BLITZ", play_name: "Mid Blitz", concepts: ["Blitz"] },
  ];
  const situation = {
    plays,
    down: 1,
    yards: 10,
    offenseShowing: { formation: "Gun", set: "Empty Bunch Open" },
    rng: () => 0,
  };
  let exposurePlayIds = [];
  let exposureSheets = [];
  let recentPlayIds = [];
  const showCounts = {};
  const sheets = [];
  for (let snap = 0; snap < 6; snap += 1) {
    const result = ExactEngine.computeExactPlayRecommendations(Object.assign({}, situation, {
      recentPlayIds,
      exposurePlayIds,
      exposureSheets,
    }));
    const ids = result.recommendations.map((play) => play.id);
    assert.ok(ids.length >= 1, `snap ${snap} returned no calls`);
    ids.forEach((id) => {
      showCounts[id] = (showCounts[id] || 0) + 1;
      assert.ok(showCounts[id] <= 2, `${id} appeared on more than 2 sheets`);
    });
    sheets.push(ids);
    exposureSheets = exposureSheets.concat([ids]);
    exposurePlayIds = exposurePlayIds.concat(ids);
    if (ids[0]) recentPlayIds = recentPlayIds.concat(ids[0]);
  }
  const first = new Set(sheets[0]);
  assert.equal(sheets[1].some((id) => first.has(id)), false);
  assert.ok(Object.keys(showCounts).length >= 4);
});

test("exact calls keep two plays from the fitting front and read personnel counts", () => {
  const spread = DefenseCore.offenseShowingTraitsOf({ formation: "1RB", set: "1TE 3WR" });
  assert.equal(spread.isSpread, true);
  assert.equal(spread.wrCount, 3);
  const condensed = DefenseCore.offenseShowingTraitsOf({ formation: "1RB", set: "2TE 2WR" });
  assert.equal(condensed.isTight, true);
  assert.equal(condensed.isSpread, false);
  const empty = DefenseCore.offenseShowingTraitsOf({ formation: "1RB", set: "0TE 4WR" });
  assert.equal(empty.isEmpty, true);

  const plays = [
    { id: "n-c3", team: "CHI", formation: "Nickel", set: "Over", type: "ZONE", play_name: "Cover 3 Sky", concepts: ["Cover 3"] },
    { id: "n-c2", team: "CHI", formation: "Nickel", set: "Over", type: "ZONE", play_name: "Cover 2 Man", concepts: ["Cover 2"] },
    { id: "n-c4", team: "CHI", formation: "Nickel", set: "Over", type: "ZONE", play_name: "Cover 4 Drop", concepts: ["Cover 4"] },
    { id: "n-blitz", team: "CHI", formation: "Nickel", set: "Wide", type: "BLITZ", play_name: "Mid Blitz", concepts: ["Blitz"] },
    { id: "n-c6", team: "CHI", formation: "Nickel", set: "Over", type: "ZONE", play_name: "Cover 6", concepts: ["Cover 6"] },
    { id: "n-c1", team: "CHI", formation: "Nickel", set: "Over", type: "MAN", play_name: "Cover 1 Hole", concepts: ["Cover 1"] },
    { id: "base-c3", team: "CHI", formation: "4-3", set: "Over", type: "ZONE", play_name: "Cover 3 Cloud", concepts: ["Cover 3"] },
    { id: "base-c4", team: "CHI", formation: "4-3", set: "Under", type: "ZONE", play_name: "Cover 4 Quarters", concepts: ["Cover 4"] },
    { id: "dime-c4", team: "CHI", formation: "Dime", set: "Rush", type: "ZONE", play_name: "Cover 4 Palms", concepts: ["Cover 4"] },
  ];
  const first = ExactEngine.computeExactPlayRecommendations({
    plays,
    down: 1,
    yards: 10,
    offenseShowing: { formation: "1RB", set: "1TE 3WR" },
    rng: () => 0,
  });
  assert.equal(DefenseCore.inferOffenseTagFromShowing({ formation: "1RB", set: "1TE 3WR" }), "spread");
  assert.equal(DefenseCore.inferOffenseTagFromShowing({ formation: "1RB", set: "2TE 2WR" }), "condensed");
  assert.equal(first.recommendations[0].formation, "Nickel");
  const nickelIds = first.recommendations.filter((play) => play.formation === "Nickel").map((play) => play.id);
  assert.ok(nickelIds.length >= 2, `expected two Nickel calls, got ${first.recommendations.map((play) => play.id).join(",")}`);
  const second = ExactEngine.computeExactPlayRecommendations({
    plays,
    down: 1,
    yards: 10,
    offenseShowing: { formation: "1RB", set: "1TE 3WR" },
    exposureSheets: [first.recommendations.map((play) => play.id)],
    rng: () => 0,
  });
  const firstIds = new Set(first.recommendations.map((play) => play.id));
  assert.equal(second.recommendations.some((play) => firstIds.has(play.id)), false);
  const secondNickel = second.recommendations.filter((play) => play.formation === "Nickel");
  assert.ok(secondNickel.length >= 1, "next sheet should still use the Nickel front");
  assert.equal(second.recommendations[0].formation, "Nickel");

  const carried = ExactEngine.computeExactPlayRecommendations({
    plays,
    down: 1,
    yards: 10,
    offenseShowing: { formation: "1RB", set: "1TE 3WR" },
    exposureSheets: [first.recommendations.map((play) => play.id), second.recommendations.map((play) => play.id)],
    rng: () => 0,
  });
  const seen = new Set(first.recommendations.concat(second.recommendations).map((play) => play.id));
  assert.equal(carried.recommendations.some((play) => seen.has(play.id)), false);
  assert.equal(carried.recommendations[0].formation, "Nickel");

  const tight = ExactEngine.computeExactPlayRecommendations({
    plays,
    down: 1,
    yards: 10,
    offenseShowing: { formation: "1RB", set: "2TE 2WR" },
    rng: () => 0,
  });
  assert.equal(tight.recommendations[0].formation, "4-3");
  assert.ok(tight.recommendations.filter((play) => play.formation === "4-3").length >= 2);
});

test("confidence calibration withholds low-confidence catalog fields", () => {
  const accepted = Confidence.calibrateFieldAcceptance({
    value: "Cover 3",
    ocrConfidence: 0.98,
    resolverConfidence: 0.9,
    framesAgree: 1,
  }, { requireCatalog: true });
  const rejected = Confidence.calibrateFieldAcceptance({
    value: "Cover 3",
    ocrConfidence: 0.5,
    resolverConfidence: 0.9,
    framesAgree: 1,
  }, { requireCatalog: true });
  assert.equal(accepted.accepted, true);
  assert.equal(rejected.accepted, false);
  assert.ok(rejected.reasons.includes("ocr_below_threshold"));
});

test("engine factory supports dependency injection", () => {
  const engine = ExactEngine.createExactPlayRecommendationEngine(DefenseCore, { down: 1, yards: 10 });
  const result = engine.recommend({
    plays: [{ id: "base-cover3", formation: "4-3", set: "Over", type: "ZONE", play_name: "Cover 3", concepts: ["Cover 3"] }],
  });
  assert.equal(result.recommendations[0].id, "base-cover3");
});

test("all domain modules expose browser UMD globals", () => {
  const context = vm.createContext({ console, Date, Math, Set });
  const sources = [
    ["../../PC/shared/defenseRecommendationCore.js", "GridironDefenseRecommendationCore"],
    ["../ocr/shared/contracts.js", "GridironOcrContracts"],
    ["../ocr/shared/confidenceCalibration.js", "GridironOcrConfidenceCalibration"],
    ["../ocr/shared/textCatalogMatcher.js", "GridironOcrTextCatalogMatcher"],
    ["../ocr/shared/hudTextNormalize.js", "GridironOcrHudTextNormalize"],
    ["../ocr/shared/temporalConsensus.js", "GridironOcrTemporalConsensus"],
    ["../ocr/shared/footballStateValidator.js", "GridironOcrFootballStateValidator"],
    ["../ocr/shared/snapLifecycle.js", "GridironOcrSnapLifecycle"],
    ["../ocr/shared/defensiveOutcomeInference.js", "GridironOcrDefensiveOutcomeInference"],
    ["../ocr/shared/learningProjection.js", "GridironOcrLearningProjection"],
    ["../ocr/shared/learnedAdjustment.js", "GridironOcrLearnedAdjustment"],
    ["../ocr/shared/confidenceCalibration.js", "GridironOcrConfidenceCalibration"],
    ["../ocr/shared/exactPlayRecommendation.js", "GridironOcrExactPlayRecommendation"],
  ];
  sources.forEach(([relativePath, globalName]) => {
    const url = new URL(relativePath, import.meta.url);
    vm.runInContext(readFileSync(url, "utf8"), context, { filename: url.pathname });
    assert.equal(typeof context[globalName], "object", `${globalName} was not exported`);
  });
});

console.log(`OK OCR domain smoke (${passed} tests)`);
