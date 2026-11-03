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

test("goal line plays stay out of the opening script, including a locked slot", () => {
  const plays = book().concat([
    play("gl-run", "RUN", "inside_zone", "Goal Line"),
    play("gl-pa", "PA", "boot", "Goal Line"),
  ]);
  const result = Opening.fillOpeningScript({
    plays: plays,
    familyOf: function (item) { return item.family; },
    cooldownIds: [],
    shell: null,
    setupPayoff: { inside_zone: ["boot"] },
    random: function () { return 0; },
    existingPlayIds: ["gl-run"],
    lockedIndexes: [0],
  });
  assert.equal(result.playIds.includes("gl-run"), false);
  assert.equal(result.playIds.includes("gl-pa"), false);
  assert.equal(result.playIds.length, 15);
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

test("ignoreLearning does not let a shell score choose the play", () => {
  const plays = [play("quick-low", "PASS", "quick_game"), play("quick-high", "PASS", "quick_game")];
  const shell = { observations: 8, distribution: { total: 8, entries: [["Cover 3", 1]] } };
  const result = Opening.fillOpeningScript({
    plays: plays.concat(book().slice(2)),
    familyOf: function (item) { return item.family; },
    cooldownIds: [],
    shell: shell,
    setupPayoff: {},
    // near-1 keeps Fisher-Yates order so deck walk hits quick-low before quick-high
    random: function () { return 0.999; },
    ignoreLearning: true,
    playScore: function (item) { return item.id === "quick-high" ? 5 : 0; },
  });
  assert.equal(result.playIds[1], "quick-low");
});

test("each auto-fill shuffles a fresh script order", () => {
  const big = [];
  for (let i = 0; i < 40; i += 1) {
    big.push(play("iz-" + i, "RUN", "inside_zone", "Singleback"));
    big.push(play("qg-" + i, "PASS", "quick_game", "Gun"));
    big.push(play("wz-" + i, "RUN", "wide_zone", "Gun"));
    big.push(play("boot-" + i, "PA", "boot", "Singleback"));
    big.push(play("shot-" + i, "PASS", "shot", "Gun"));
    big.push(play("scr-" + i, "PASS", "screen", "Gun"));
    big.push(play("cntr-" + i, "RUN", "counter", "Gun"));
    big.push(play("dig-" + i, "PASS", "levels_dig", "Gun"));
  }
  let cursor = 0;
  const values = [0.11, 0.82, 0.33, 0.91, 0.24, 0.67, 0.48, 0.05, 0.73, 0.56, 0.19, 0.88, 0.41, 0.62, 0.27, 0.94];
  function nextRandom() {
    const value = values[cursor % values.length];
    cursor += 1;
    return value;
  }
  const first = Opening.fillOpeningScript({
    plays: big,
    familyOf: function (item) { return item.family; },
    cooldownIds: [],
    setupPayoff: { inside_zone: ["boot"] },
    random: nextRandom,
  });
  const second = Opening.fillOpeningScript({
    plays: big,
    familyOf: function (item) { return item.family; },
    cooldownIds: [],
    setupPayoff: { inside_zone: ["boot"] },
    random: nextRandom,
  });
  assert.equal(first.playIds.length, 15);
  assert.equal(second.playIds.length, 15);
  assert.equal(new Set(first.playIds).size, 15);
  assert.equal(new Set(second.playIds).size, 15);
  assert.notDeepEqual(first.playIds, second.playIds);
});

test("recent script ids are deferred until fresh fits for a slot run out", () => {
  const plays = book().concat([
    play("inside-c", "RUN", "inside_zone", "Singleback"),
    play("inside-d", "RUN", "inside_zone", "Singleback"),
  ]);
  const cooled = ["inside-a", "inside-b"];
  const result = Opening.fillOpeningScript({
    plays: plays,
    familyOf: function (item) { return item.family; },
    cooldownIds: cooled,
    setupPayoff: { inside_zone: ["boot"] },
    random: function () { return 0.999; },
  });
  assert.equal(result.playIds.includes("inside-a"), false);
  assert.equal(result.playIds.includes("inside-b"), false);
  assert.ok(result.playIds.includes("inside-c") || result.playIds.includes("inside-d") || result.playIds.includes("dive-a"));
  assert.equal(new Set(result.playIds).size, 15);
});

test("opening script clusters into 3-5 anchor formations with complementary plays", () => {
  const multiBook = [];
  const forms = ["Singleback | Wing Close", "Gun | Bunch", "Gun | Trips TE", "I Form | Close"];
  forms.forEach(function (f) {
    var parts = f.split(" | ");
    multiBook.push(
      { id: f + "-run", play_name: "INSIDE ZONE", type: "RUN", family: "inside_zone", formation: parts[0], set: parts[1], concepts: ["Run"] },
      { id: f + "-pa", play_name: "PA BOOT", type: "PA", family: "boot", formation: parts[0], set: parts[1], concepts: ["Pass"] },
      { id: f + "-quick", play_name: "SLANTS", type: "PASS", family: "quick_game", formation: parts[0], set: parts[1], concepts: ["Pass"] },
      { id: f + "-screen", play_name: "SCREEN", type: "PASS", family: "screen", formation: parts[0], set: parts[1], concepts: ["Pass"] }
    );
  });
  const result = Opening.fillOpeningScript({
    plays: multiBook,
    familyOf: function (item) { return item.family; },
    cooldownIds: [],
    setupPayoff: { inside_zone: ["boot"] },
    random: function () { return 0; },
  });
  assert.equal(result.playIds.length, 15);
  const playMap = new Map(multiBook.map(function (p) { return [p.id, p]; }));
  const usedForms = new Set(result.playIds.map(function (id) {
    const p = playMap.get(id);
    return p.formation + " | " + p.set;
  }));
  assert.equal(usedForms.size <= 4, true);
});

