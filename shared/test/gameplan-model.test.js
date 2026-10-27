"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Gameplan = require("../gameplanModel");
const Core = require("../recommendationCore");

test("goal line beats red zone, and red zone beats an early down", () => {
  assert.equal(Gameplan.resolveOffenseCell({
    situationBucket: "first_long",
    fieldPositionBucket: "red_zone",
  }), "red_zone");
  assert.equal(Gameplan.resolveOffenseCell({
    situationBucket: "goal_to_go_mid",
    fieldPositionBucket: "red_zone",
  }), "goal_line");
  assert.equal(Gameplan.resolveOffenseCell({
    situationBucket: "first_long",
    fieldPositionBucket: "own_territory",
  }), "early_down");
  assert.equal(Gameplan.resolveOffenseCell({
    situationBucket: "third_very_long",
    fieldPositionBucket: "plus_territory",
  }), "third_long");
  assert.equal(Gameplan.resolveOffenseCell({
    situationBucket: "fourth_short",
    fieldPositionBucket: "midfield",
  }), "third_short");
});

test("a missing pin is unavailable and an empty id is not", () => {
  const plays = [{ id: "chi|gun|trips|mesh" }];
  assert.equal(Gameplan.resolvePlayId("chi|gun|trips|mesh", plays).unavailable, false);
  assert.equal(Gameplan.resolvePlayId("chi|gun|trips|gone", plays).unavailable, true);
  assert.equal(Gameplan.resolvePlayId("", plays).unavailable, false);
});

test("a locked run on 3rd and 10 or more is bypassed", () => {
  assert.equal(Gameplan.shouldBypassLockedRun({ locked: true, type: "RUN", down: 3, yards: 10 }), true);
  assert.equal(Gameplan.shouldBypassLockedRun({ locked: true, type: "RPO", down: 4, yards: 12 }), true);
  assert.equal(Gameplan.shouldBypassLockedRun({ locked: true, type: "PASS", down: 3, yards: 12 }), false);
  assert.equal(Gameplan.shouldBypassLockedRun({ locked: true, type: "RUN", down: 3, yards: 9 }), false);
  assert.equal(Gameplan.shouldBypassLockedRun({ locked: false, type: "RUN", down: 3, yards: 15 }), false);
});

test("plan score is its own capped part and stays zero when omitted", () => {
  const capped = Core.combineRecommendationScore({ plan: 100, situation: 1 });
  assert.equal(capped.parts.plan, 6);
  const untouched = Core.combineRecommendationScore({ situation: 1 });
  assert.equal(untouched.parts.plan, 0);
  assert.equal(untouched.score, capped.score - 6);
});

test("concept and pin adjustments cap at 6", () => {
  const cell = { concept: "flood", backup: "quick_game", pinnedPlayId: "p1", locked: false, note: "" };
  assert.equal(Gameplan.planAdjustment({ id: "p1" }, cell, function () { return "flood"; }), 6);
  assert.equal(Gameplan.planAdjustment({ id: "p2" }, cell, function () { return "flood"; }), 4);
  assert.equal(Gameplan.planAdjustment({ id: "p3" }, cell, function () { return "quick_game"; }), 2);
  assert.equal(Gameplan.planAdjustment({ id: "p4" }, cell, function () { return "shot"; }), 0);
});
