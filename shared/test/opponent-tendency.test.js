"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Tendency = require("../opponentTendency");

function cover3Snaps(count, store) {
  var next = store || Tendency.emptyStore();
  for (var i = 0; i < count; i += 1) {
    next = Tendency.recordLook(next, { opponent: "DAL", context: "cpu", cellId: "early_down", shell: "Cover 3" });
  }
  return next;
}

test("a cell stays unready until four snaps and one look is at least 40 percent", () => {
  var thin = cover3Snaps(3);
  var profile = Tendency.profileFor(thin, "DAL", "cpu");
  assert.equal(Tendency.readiness(profile.cells.early_down).ready, false);
  assert.equal(Tendency.suggestConcepts(profile.cells.early_down), null);

  var ready = cover3Snaps(1, thin);
  profile = Tendency.profileFor(ready, "DAL", "cpu");
  var info = Tendency.readiness(profile.cells.early_down);
  assert.equal(info.ready, true);
  assert.equal(info.primary, "Cover 3");
  assert.equal(info.total, 4);
});

test("an even mix of looks does not count as a tendency", () => {
  var store = Tendency.emptyStore();
  ["Cover 3", "Cover 2", "Cover 4", "Blitz"].forEach(function (shell) {
    store = Tendency.recordLook(store, { opponent: "GB", context: "cpu", cellId: "third_long", shell: shell });
  });
  var cell = Tendency.profileFor(store, "GB", "cpu").cells.third_long;
  assert.equal(Tendency.readiness(cell).ready, false);
});

test("a ready Cover 3 cell suggests flood, and the next look supplies the backup", () => {
  var store = cover3Snaps(3);
  store = Tendency.recordLook(store, { opponent: "DAL", context: "cpu", cellId: "early_down", shell: "Cover 2" });
  var suggestion = Tendency.suggestConcepts(Tendency.profileFor(store, "DAL", "cpu").cells.early_down);
  assert.equal(suggestion.concept, "flood");
  assert.equal(suggestion.backup, "shot");
});

test("repeated failed results can move the concept off the default counter", () => {
  var store = cover3Snaps(4);
  for (var i = 0; i < 3; i += 1) {
    store = Tendency.recordOutcome(store, {
      opponent: "DAL",
      context: "cpu",
      cellId: "early_down",
      family: "flood",
      playId: "flood-" + i,
      successPoints: -2,
      yards: -1,
    });
  }
  var suggestion = Tendency.suggestConcepts(Tendency.profileFor(store, "DAL", "cpu").cells.early_down);
  assert.equal(suggestion.concept, "quick_game");
});

test("a play boost waits for three graded results and can be negative", () => {
  var store = cover3Snaps(4);
  var profile = Tendency.profileFor(store, "DAL", "cpu");
  assert.equal(Tendency.playResultBoost(profile, "early_down", "mesh"), 0);
  store = Tendency.recordOutcome(store, { opponent: "DAL", context: "cpu", cellId: "early_down", family: "man_beat", playId: "mesh", successPoints: -2, yards: 0 });
  store = Tendency.recordOutcome(store, { opponent: "DAL", context: "cpu", cellId: "early_down", family: "man_beat", playId: "mesh", successPoints: -2, yards: 0 });
  assert.equal(Tendency.playResultBoost(Tendency.profileFor(store, "DAL", "cpu"), "early_down", "mesh"), 0);
  store = Tendency.recordOutcome(store, { opponent: "DAL", context: "cpu", cellId: "early_down", family: "man_beat", playId: "mesh", successPoints: -2, yards: 0 });
  assert.ok(Tendency.playResultBoost(Tendency.profileFor(store, "DAL", "cpu"), "early_down", "mesh") < 0);
});

test("cpu and human profiles stay separate, and a corrected look is reversible", () => {
  var store = cover3Snaps(4);
  store = Tendency.recordLook(store, { opponent: "DAL", context: "human", cellId: "early_down", shell: "Cover 2" });
  assert.equal(Tendency.profileFor(store, "DAL", "human").cells.early_down.looks["Cover 3"], undefined);
  assert.equal(Tendency.readiness(Tendency.profileFor(store, "DAL", "cpu").cells.early_down).ready, true);
  store = Tendency.revertLook(store, { opponent: "DAL", context: "cpu", cellId: "early_down", shell: "Cover 3" });
  assert.equal(Tendency.profileFor(store, "DAL", "cpu").cells.early_down.looks["Cover 3"].snaps, 3);
});

test("the opening-script plan uses a ready cell and leaves thin cells unbiased", () => {
  var store = cover3Snaps(4);
  var plan = Tendency.scriptSlotPlan(Tendency.profileFor(store, "DAL", "cpu"));
  assert.equal(plan.slotCells[0], "early_down");
  assert.equal(plan.slotFamilies[0][0], "inside_zone");
  assert.equal(plan.slotFamilies[1][0], "flood");
  assert.equal(plan.slotCells[14], "early_down");
  store = Tendency.recordLook(store, { opponent: "DAL", context: "cpu", cellId: "red_zone", shell: "Cover 1" });
  store = Tendency.recordLook(store, { opponent: "DAL", context: "cpu", cellId: "red_zone", shell: "Cover 1" });
  store = Tendency.recordLook(store, { opponent: "DAL", context: "cpu", cellId: "red_zone", shell: "Cover 1" });
  store = Tendency.recordLook(store, { opponent: "DAL", context: "cpu", cellId: "red_zone", shell: "Cover 1" });
  plan = Tendency.scriptSlotPlan(Tendency.profileFor(store, "DAL", "cpu"));
  assert.equal(plan.slotCells[14], "red_zone");
  assert.equal(plan.slotFamilies[14][0], "man_beat");
});
