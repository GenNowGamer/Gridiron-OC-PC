"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Board = require("../situationBoard");

function play(id, family, type) {
  return { id: id, play_name: id, family: family, type: type || "PASS", formation: "Gun", set: "Trips" };
}

function book() {
  return [
    play("inside-a", "inside_zone", "RUN"),
    play("inside-b", "inside_zone", "RUN"),
    play("quick-a", "quick_game", "PASS"),
    play("shot-a", "hail_mary", "PASS"),
    play("boot-a", "boot", "PA"),
  ];
}

test("replacing one slot leaves the other cards in place", () => {
  const options = {
    familyOf: function (item) { return item.family; },
    random: function () { return 0; },
  };
  const board = Board.dealBoard(book(), "oc", options);
  const before = board.shot && board.shot.id;
  const replaced = Board.replaceSlot(board, "first_med", book(), options);
  assert.notEqual(replaced.first_med.id, board.first_med.id);
  assert.equal(replaced.shot.id, before);
  assert.equal(Board.fits(replaced.first_med, Board.slotById("first_med"), options.familyOf), true);
});

test("the play just confirmed is not dealt back into that slot", () => {
  const options = {
    familyOf: function (item) { return item.family; },
    random: function () { return 0; },
  };
  const board = Board.dealBoard(book(), "oc", options);
  const confirmed = board.first_med.id;
  const replaced = Board.replaceSlot(board, "first_med", book(), options);
  assert.notEqual(replaced.first_med.id, confirmed);
});

test("a goal line formation play stays on the goal line card", () => {
  const options = {
    familyOf: function (item) { return item.family; },
    random: function () { return 0; },
  };
  const plays = [
    { id: "gl-sprint", play_name: "PA Sprint HB Flat", family: "boot", type: "PA", formation: "Goal Line", set: "Normal" },
  ].concat(book());
  const board = Board.dealBoard(plays, "oc", options);
  Object.keys(board).forEach(function (slot) {
    const card = board[slot];
    if (!card) return;
    const goalLine = String(card.formation || "").toLowerCase().indexOf("goal line") >= 0;
    assert.equal(goalLine, slot === "goal_line");
  });
  assert.equal(board.goal_line.id, "gl-sprint");
  assert.equal(Board.fits(plays[0], Board.slotById("first_med"), options.familyOf), false);
  assert.equal(Board.fits(plays[0], Board.slotById("goal_line"), options.familyOf), true);
});

test("a slot shows every other fitting play before it repeats one", () => {
  const options = {
    familyOf: function (item) { return item.family; },
    random: function () { return 0; },
    history: { first_med: ["inside-a"] },
  };
  const plays = [
    play("inside-a", "inside_zone", "RUN"),
    play("inside-b", "inside_zone", "RUN"),
    play("inside-c", "inside_zone", "RUN"),
    play("inside-d", "inside_zone", "RUN"),
    play("shot-a", "shot", "PASS"),
  ];
  let board = {
    first_med: plays[0],
    shot: plays[4],
  };
  const shown = ["inside-a"];
  [1, 2, 3].forEach(function () {
    board = Board.replaceSlot(board, "first_med", plays, options);
    shown.push(board.first_med.id);
  });
  assert.deepEqual(shown.slice(1), ["inside-b", "inside-c", "inside-d"]);
  board = Board.replaceSlot(board, "first_med", plays, options);
  assert.equal(board.first_med.id, "inside-a");
  assert.equal(new Set(shown).size, 4);
});

test("a play sitting on another card waits while this slot still has an unseen play", () => {
  const options = {
    familyOf: function (item) { return item.family; },
    random: function () { return 0; },
    history: { first_med: ["inside-a"] },
  };
  const plays = [
    play("inside-a", "inside_zone", "RUN"),
    play("inside-b", "inside_zone", "RUN"),
    play("inside-c", "inside_zone", "RUN"),
  ];
  const board = {
    first_med: plays[0],
    second_med: plays[1],
  };
  const replaced = Board.replaceSlot(board, "first_med", plays, options);
  assert.equal(replaced.first_med.id, "inside-c");
  assert.equal(replaced.second_med.id, "inside-b");
});

test("a team identity concept is not more likely to fill a situational card", () => {
  const plays = [
    play("inside-a", "inside_zone", "RUN"),
    play("inside-b", "inside_zone", "RUN"),
  ];
  const chosen = Board.dealSlot(plays, "first_med", {
    familyOf: function (item) { return item.family; },
    random: function () { return 0.5; },
    identityFamilies: { inside_zone: 3 },
  });
  assert.equal(chosen.id, "inside-a");
});

test("quick game is not filed as a man beater and inside zone is not filed as a blitz beater", () => {
  const quick = { id: "stick", play_name: "STICK", type: "PASS", formation: "Gun", set: "Trips", concepts: ["Stick", "Quick Game"] };
  const inside = { id: "iz", play_name: "INSIDE ZONE", type: "RUN", formation: "Gun", set: "Trips", concepts: ["Inside Zone"] };
  const tags = function (item) { return Board.conceptTags(item); };
  assert.equal(Board.fits(quick, Board.slotById("quick_game"), tags), true);
  assert.equal(Board.fits(quick, Board.slotById("man_beater"), tags), false);
  assert.equal(Board.fits(quick, Board.slotById("cover3_beater"), tags), true);
  assert.equal(Board.fits(inside, Board.slotById("first_med"), tags), true);
  assert.equal(Board.fits(inside, Board.slotById("blitz_beater"), tags), false);
});

test("read option, trap, and hail mary each fit a situational card", () => {
  const tags = function (item) { return Board.conceptTags(item); };
  const read = { id: "read", play_name: "READ OPTION", type: "RUN", formation: "Gun", set: "Trips", concepts: ["Run"] };
  const trap = { id: "trap", play_name: "0 1 TRAP", type: "RUN", formation: "Gun", set: "Tight", concepts: ["Run"] };
  const hail = { id: "hail", play_name: "HAIL MARY", type: "PASS", formation: "Hail Mary", set: "Hail Mary", concepts: ["Pass"] };
  assert.equal(Board.fits(read, Board.slotById("first_med"), tags), true);
  assert.equal(Board.fits(trap, Board.slotById("first_med"), tags), true);
  assert.equal(Board.fits(hail, Board.slotById("shot"), tags), true);
  assert.equal(Board.fits(hail, Board.slotById("first_med"), tags), false);
  assert.equal(Board.primaryFamily(hail), "hail_mary");
});

test("a mesh play is not stolen by a later wheel or spot word", () => {
  const play = { id: "mesh", play_name: "MTN MESH SPOT", type: "PASS", formation: "Gun", set: "Tight Y Off", concepts: ["Mesh"] };
  const tags = Board.conceptTags(play);
  assert.equal(tags.includes("man_beat"), true);
  assert.equal(tags.includes("wheel"), false);
  assert.equal(Board.fits(play, Board.slotById("man_beater"), function () { return tags; }), true);
});

test("a success rate on the play does not change the deal", () => {
  const plain = book();
  const rated = book().map(function (item) {
    return Object.assign({}, item, { successRate: item.id === "inside-b" ? 100 : 0 });
  });
  const options = {
    familyOf: function (item) { return item.family; },
    random: function () { return 0; },
    successRates: { "inside-b": 100 },
  };
  const left = Board.dealSlot(plain, "first_med", options);
  const right = Board.dealSlot(rated, "first_med", options);
  assert.equal(left.id, right.id);
  assert.equal(left.id, "inside-a");
});
