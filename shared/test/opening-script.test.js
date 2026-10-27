"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Opening = require("../openingScript");

function play(id, type, family, formation) {
  return { id: id, play_name: id, type: type, family: family, formation: formation || "Gun", set: "Base", concepts: [] };
}

function book() {
  return [
    play("inside-a", "RUN", "inside_zone", "Singleback"),
    play("inside-b", "RUN", "inside_zone", "Singleback"),
    play("edge-a", "RUN", "wide_zone", "Gun"),
    play("quick-a", "PASS", "quick_game", "Gun"),
    play("quick-b", "PASS", "quick_game", "Gun"),
    play("boot-a", "PA", "boot", "Singleback"),
    play("flood-a", "PASS", "flood", "Gun"),
    play("screen-a", "PASS", "screen", "Gun"),
    play("mesh-a", "PASS", "levels_dig", "Gun"),
    play("shot-a", "PASS", "shot", "Gun"),
    play("counter-a", "RUN", "counter", "Gun"),
    play("smash-a", "PASS", "smash", "Gun"),
    play("rpo-a", "RPO", "rpo", "Gun"),
    play("dive-a", "RUN", "dive", "Singleback"),
    play("curl-a", "PASS", "curl_flat", "Gun"),
    play("extra-a", "PASS", "man_beat", "Gun"),
    play("extra-b", "PASS", "shot", "Gun"),
    play("extra-c", "RUN", "wide_zone", "Gun"),
  ];
}

test("a tendency family list narrows the slot before the random pick", () => {
  const result = Opening.fillOpeningScript({
    plays: book(),
    familyOf: function (item) { return item.family; },
    cooldownIds: [],
    shell: null,
    setupPayoff: { inside_zone: ["boot"] },
    random: function () { return 0; },
    slotFamilies: [null, ["curl_flat"], null, null, null, null, null, null, null, null, null, null, null, null, null],
  });
  assert.equal(result.playIds[1], "curl-a");
});

test("fill returns 15 plays and does not record cooldown history", () => {
  const history = [];
  const result = Opening.fillOpeningScript({
    plays: book(),
    familyOf: function (item) { return item.family; },
    cooldownIds: [],
    shell: null,
    setupPayoff: { inside_zone: ["boot", "flood", "shot"] },
    random: function () { return 0; },
  });
  assert.equal(result.playIds.length, 15);
  assert.equal(history.length, 0);
  assert.equal(result.usedShell, false);
  assert.equal(new Set(result.playIds).size, 15);
});

test("cooldown ids are skipped before the any-play fallback", () => {
  const plays = book();
  const cooled = plays.filter(function (item) { return item.family === "inside_zone"; }).map(function (item) { return item.id; });
  const result = Opening.fillOpeningScript({
    plays: plays,
    familyOf: function (item) { return item.family; },
    cooldownIds: cooled,
    shell: null,
    setupPayoff: { inside_zone: ["boot"] },
    random: function () { return 0; },
  });
  assert.equal(result.playIds.includes("inside-a"), false);
  assert.equal(result.playIds.includes("inside-b"), false);
  assert.equal(result.playIds.length, 15);
});

test("fewer than six shell observations leaves the shell unused", () => {
  const thin = Opening.openingScriptOpponentShell({
    contexts: {
      "kc|down1|long|own_territory|normal|fam|inside_zone": {
        defenses: { "Cover 3": { observations: 5 } },
      },
    },
  });
  assert.equal(thin, null);
  const ready = Opening.openingScriptOpponentShell({
    contexts: {
      "kc|down1|long|own_territory|normal|fam|inside_zone": {
        defenses: { "Cover 3": { observations: 6 } },
      },
    },
  });
  assert.equal(ready.observations, 6);
});

test("a shell score picks the higher play inside the slot family", () => {
  const plays = [play("quick-low", "PASS", "quick_game"), play("quick-high", "PASS", "quick_game")];
  const shell = { observations: 8, distribution: { total: 8, entries: [["Cover 3", 1]] } };
  const result = Opening.fillOpeningScript({
    plays: plays.concat(book().slice(2)),
    familyOf: function (item) { return item.family; },
    cooldownIds: [],
    shell: shell,
    setupPayoff: {},
    random: function () { return 0; },
    playScore: function (item) { return item.id === "quick-high" ? 5 : 0; },
  });
  assert.equal(result.usedShell, true);
  assert.equal(result.playIds[1], "quick-high");
});

test("locked script slots stay put when the rest of the script is filled", () => {
  const result = Opening.fillOpeningScript({
    plays: book(),
    familyOf: function (item) { return item.family; },
    cooldownIds: [],
    shell: null,
    setupPayoff: { inside_zone: ["boot", "flood", "shot"] },
    random: function () { return 0; },
    existingPlayIds: [null, null, null, null, "screen-a"],
    lockedIndexes: [4],
  });
  assert.equal(result.playIds[4], "screen-a");
  assert.equal(result.playIds.filter(function (id) { return id === "screen-a"; }).length, 1);
});
