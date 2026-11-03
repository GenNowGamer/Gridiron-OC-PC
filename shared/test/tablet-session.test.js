"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Board = require("../situationBoard");
const Labels = require("../resultLabels");
const Opening = require("../openingScript");
const Session = require("../tabletSession");

function play(id, family, type, formation) {
  return { id: id, play_name: id, family: family, type: type || "PASS", formation: formation || "Gun", set: "Base" };
}

function offense() {
  return [
    play("inside-a", "inside_zone", "RUN", "Singleback"),
    play("inside-b", "inside_zone", "RUN", "Singleback"),
    play("inside-c", "inside_zone", "RUN", "I Form"),
    play("quick-a", "quick_game", "PASS"),
    play("quick-b", "quick_game", "PASS"),
    play("shot-a", "shot", "PASS"),
    play("boot-a", "boot", "PA", "Singleback"),
    play("screen-a", "screen", "PASS"),
    play("flood-a", "flood", "PASS"),
    play("man-a", "man_beat", "PASS"),
    play("dive-a", "dive", "RUN"),
    play("curl-a", "curl_flat", "PASS"),
    play("smash-a", "smash", "PASS"),
    play("rpo-a", "rpo", "RPO"),
    play("levels-a", "levels_dig", "PASS"),
    play("snag-a", "snag_spot", "PASS"),
    play("jet-a", "jet", "RUN"),
    play("leak-a", "leak", "PASS"),
    play("vertical-a", "verticals", "PASS"),
    play("draw-a", "draw", "RUN"),
    play("counter-a", "counter", "RUN"),
    play("iso-a", "iso", "RUN"),
    play("duo-a", "duo_power", "RUN"),
  ];
}

function deps(extra) {
  return Object.assign({
    board: Board,
    opening: Opening,
    labels: Labels,
    offensePlays: offense(),
    defensePlays: [],
    familyOf: function (item) { return item.family; },
    random: function () { return 0; },
    opponent: "DAL",
    context: "cpu",
    store: Labels.emptyStore(),
  }, extra || {});
}

test("a later play-call style replaces the earlier one and leaves goal line", () => {
  const input = deps({ random: function () { return 0; } });
  let session = Session.startGame(Session.createSession(), input);
  const goalId = session.ocBoard.goal_line && session.ocBoard.goal_line.id;
  session = Session.applyCallStyle(session, "run_heavy", input);
  assert.equal(session.callStyle, "run_heavy");
  assert.equal(session.ocBoard.first_med.type, "RUN");
  assert.equal(session.ocBoard.goal_line && session.ocBoard.goal_line.id, goalId);
  const runId = session.ocBoard.first_med.id;
  session = Session.applyCallStyle(session, "pass_heavy", input);
  assert.equal(session.callStyle, "pass_heavy");
  assert.equal(session.ocBoard.first_med.type, "PASS");
  assert.notEqual(session.ocBoard.first_med.id, runId);
  assert.equal(session.ocBoard.goal_line.id, goalId);
  session = Session.applyCallStyle(session, "kill_clock", input);
  assert.equal(session.callStyle, "kill_clock");
  assert.equal(session.ocBoard.first_med.type, "RUN");
  assert.equal(session.ocBoard.goal_line.id, goalId);
  session = Session.confirmSlot(session, "first_med", input);
  assert.equal(session.ocBoard.first_med.type, "RUN");
  assert.equal(session.ocBoard.goal_line.id, goalId);
});

test("a situational card cycles the plays that fit it before repeating", () => {
  const plays = [0, 1, 2, 3].map(function (index) {
    return { id: "iz-" + index, play_name: "iz-" + index, family: "inside_zone", type: "RUN", formation: "I Form", set: "Pro" };
  });
  // random near 1 keeps Fisher-Yates order stable for the assertion
  const input = deps({ offensePlays: plays, random: function () { return 0.999; } });
  let session = Session.startGame(Session.createSession(), input);
  const seen = [session.ocBoard.first_med.id];
  [1, 2, 3].forEach(function () {
    session = Session.confirmSlot(session, "first_med", input);
    seen.push(session.ocBoard.first_med.id);
  });
  assert.equal(new Set(seen).size, 4);
  assert.deepEqual(seen.slice().sort(), ["iz-0", "iz-1", "iz-2", "iz-3"]);
  session = Session.confirmSlot(session, "first_med", input);
  assert.ok(seen.includes(session.ocBoard.first_med.id));
});

test("each new game shuffles a fresh situational deck order", () => {
  const plays = [0, 1, 2, 3, 4, 5, 6, 7].map(function (index) {
    return { id: "iz-" + index, play_name: "iz-" + index, family: "inside_zone", type: "RUN", formation: "I Form", set: "Pro" };
  });
  let cursor = 0;
  const values = [0.1, 0.8, 0.3, 0.9, 0.2, 0.7, 0.4, 0.6, 0.15, 0.85, 0.35, 0.95, 0.25, 0.75, 0.45, 0.55];
  const input = deps({
    offensePlays: plays,
    random: function () {
      const value = values[cursor % values.length];
      cursor += 1;
      return value;
    },
  });
  const first = Session.startGame(Session.createSession(), input);
  const second = Session.startGame(Session.createSession(), input);
  assert.ok(first.slotDecks && first.slotDecks.first_med && first.slotDecks.first_med.length >= 4);
  assert.notDeepEqual(first.slotDecks.first_med, second.slotDecks.first_med);
});

test("changing call style keeps slot history instead of restarting the cycle", () => {
  const input = deps({ random: function () { return 0.999; } });
  let session = Session.startGame(Session.createSession(), input);
  const beforeHistory = (session.slotHistory.first_med || []).slice();
  session = Session.confirmSlot(session, "first_med", input);
  const afterConfirm = (session.slotHistory.first_med || []).slice();
  assert.ok(afterConfirm.length >= beforeHistory.length);
  session = Session.applyCallStyle(session, "run_heavy", input);
  assert.ok(session.ocBoard.first_med.type === "RUN" || session.ocBoard.first_med.type === "RPO");
  assert.ok((session.slotHistory.first_med || []).length >= afterConfirm.length);
  assert.ok((session.slotHistory.first_med || []).includes(session.ocBoard.first_med.id));
});

test("a play is not shown on the board more than twice in one game when the pool allows it", () => {
  const plays = Array.from({ length: 24 }, function (_item, index) {
    return { id: "iz-" + index, play_name: "iz-" + index, family: "inside_zone", type: "RUN", formation: "I Form", set: "Pro" };
  });
  const input = deps({ offensePlays: plays, random: function () { return 0.999; } });
  let session = Session.startGame(Session.createSession(), input);
  for (let step = 0; step < 10; step += 1) {
    session = Session.confirmSlot(session, "first_med", input);
  }
  const counts = session.gameShowCounts || {};
  Object.keys(counts).forEach(function (id) {
    assert.ok(Number(counts[id]) <= Board.MAX_GAME_SHOWS, id + " shown " + counts[id] + " times");
  });
});

test("a capture after Ran it leaves the opening script and situational cards unchanged", () => {
  const input = deps();
  let session = Session.startGame(Session.createSession(), input);
  const scriptIds = session.scriptIds.slice();
  const first = scriptIds[0];
  const boardIds = Object.fromEntries(Object.entries(session.ocBoard).map(([slot, card]) => [slot, card && card.id]));
  session = Session.confirmScript(session);
  assert.equal(session.scriptIndex, 1);
  const result = Session.ingest(session, {
    side: "oc",
    downKnown: true,
    down: 2,
    yards: 7,
    fieldSide: "OWN",
    fieldYard: 40,
    previousOffenseName: "shot-a",
  }, Object.assign({}, input, { store: Labels.emptyStore() }));
  assert.equal(result.session.scriptIndex, 1);
  assert.deepEqual(result.session.scriptIds, scriptIds);
  assert.equal(result.session.scriptIds[0], first);
  assert.notEqual(result.session.scriptIds[result.session.scriptIndex], first);
  Object.entries(boardIds).forEach(([slot, id]) => {
    assert.equal(result.session.ocBoard[slot] && result.session.ocBoard[slot].id, id);
  });
});

test("a clear capture after a confirmed card logs that play and leaves the other cards", () => {
  const input = deps();
  let session = Session.startGame(Session.createSession(), input);
  const shot = session.ocBoard.shot && session.ocBoard.shot.id;
  const ran = session.ocBoard.first_med;
  session = Session.confirmSlot(session, "first_med", input);
  const replacement = session.ocBoard.first_med.id;
  assert.notEqual(replacement, ran.id);
  assert.equal(session.ocBoard.shot.id, shot);
  let store = Labels.emptyStore();
  let first = Session.ingest(session, {
    side: "oc",
    downKnown: true,
    down: 1,
    yards: 10,
    fieldSide: "OWN",
    fieldYard: 25,
  }, Object.assign({}, input, { store: store }));
  const second = Session.ingest(first.session, {
    side: "oc",
    downKnown: true,
    down: 2,
    yards: 5,
    fieldSide: "OWN",
    fieldYard: 30,
    previousOffenseName: ran.play_name,
  }, Object.assign({}, input, { store: first.store }));
  assert.equal(second.logged, true);
  assert.match(second.session.lastCaptureText, /Logged/);
  assert.equal(second.session.ocBoard.shot.id, shot);
  assert.equal(second.session.ocBoard.first_med.id, replacement);
});

test("a first down back to first down logs the yard-line gain as a success", () => {
  const input = deps();
  let session = Session.startGame(Session.createSession(), input);
  const scriptPlay = session.scriptIds[0];
  session = Session.ingest(session, {
    side: "oc",
    downKnown: true,
    down: 1,
    yards: 10,
    fieldSide: "OWN",
    fieldYard: 25,
  }, input).session;
  session = Session.confirmScript(session);
  const logged = Session.ingest(session, {
    side: "oc",
    downKnown: true,
    down: 1,
    yards: 10,
    fieldSide: "OWN",
    fieldYard: 35,
    previousOffenseName: scriptPlay,
  }, input);
  assert.equal(logged.logged, true);
  assert.match(logged.session.lastCaptureText, /\+10/);
  assert.match(logged.session.lastCaptureText, /success/);
  const repeat = Session.ingest(logged.session, {
    side: "oc",
    downKnown: true,
    down: 1,
    yards: 10,
    fieldSide: "OWN",
    fieldYard: 35,
    previousOffenseName: scriptPlay,
  }, Object.assign({}, input, { store: logged.store }));
  assert.equal(repeat.logged, false);
  assert.match(repeat.session.lastCaptureText, /\+10/);
  assert.match(repeat.session.lastCaptureText, /success/);
});

test("a read of the new spot before the play name still grades from the spot saved at Ran it", () => {
  const input = deps();
  let session = Session.startGame(Session.createSession(), input);
  const scriptPlay = session.scriptIds[0];
  session = Session.ingest(session, {
    side: "oc",
    downKnown: true,
    down: 1,
    yards: 10,
    fieldSide: "OWN",
    fieldYard: 25,
  }, input).session;
  session = Session.confirmScript(session);
  const moved = Session.ingest(session, {
    side: "oc",
    downKnown: true,
    down: 1,
    yards: 10,
    fieldSide: "OWN",
    fieldYard: 35,
  }, input);
  assert.equal(moved.logged, true);
  assert.match(moved.session.lastCaptureText, /\+10 · success/);
  const logged = Session.ingest(moved.session, {
    side: "oc",
    downKnown: true,
    down: 1,
    yards: 10,
    fieldSide: "OWN",
    fieldYard: 35,
    previousOffenseName: scriptPlay,
  }, Object.assign({}, input, { store: moved.store }));
  assert.equal(logged.logged, false);
  assert.match(logged.session.lastCaptureText, /\+10 · success/);
});

test("3rd and long in the red zone highlights those cards and an unaccepted defensive name does not light Cover 3", () => {
  const input = deps();
  const session = Session.startGame(Session.createSession(), input);
  const result = Session.ingest(session, {
    side: "oc",
    downKnown: true,
    down: 3,
    yards: 9,
    fieldSide: "OPP",
    fieldYard: 16,
    previousDefenseName: "",
  }, Object.assign({}, input, { store: Labels.emptyStore() }));
  assert.ok(result.session.highlighted.includes("third_long"));
  assert.ok(result.session.highlighted.includes("red_zone"));
  assert.ok(!result.session.highlighted.includes("cover3_beater"));
});

test("a down read lights that card even when the snap is not logged", () => {
  const input = deps();
  const session = Session.startGame(Session.createSession(), input);
  const result = Session.ingest(session, {
    side: "oc",
    downKnown: true,
    down: 2,
    yards: 11,
    fieldKnown: false,
  }, Object.assign({}, input, { store: Labels.emptyStore() }));
  assert.equal(result.logged, false);
  assert.deepEqual(result.session.highlighted, ["second_long"]);
});

test("a field or coverage read lights those cards without a down", () => {
  const input = deps();
  const session = Session.startGame(Session.createSession(), input);
  const result = Session.ingest(session, {
    side: "oc",
    downKnown: false,
    fieldKnown: true,
    fieldSide: "OPP",
    fieldYard: 12,
    previousDefenseName: "Cover 3",
  }, Object.assign({}, input, { store: Labels.emptyStore() }));
  assert.equal(result.logged, false);
  assert.ok(result.session.highlighted.includes("red_zone"));
  assert.ok(result.session.highlighted.includes("cover3_beater"));
  assert.ok(!result.session.highlighted.includes("first_med"));
  assert.equal(result.session.scriptIndex, 0);
});
