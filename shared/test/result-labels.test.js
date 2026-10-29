"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Labels = require("../resultLabels");

function row(success) {
  return {
    opponent: "DAL",
    context: "cpu",
    slotId: "first_med",
    playId: "inside-a",
    family: "inside_zone",
    success: success,
    opponentLook: "Cover 3",
    lookSide: "defense",
  };
}

test("the rate stays hidden until three results", () => {
  let store = Labels.emptyStore();
  store = Labels.recordResult(store, row(true));
  store = Labels.recordResult(store, row(false));
  assert.equal(Labels.rateFor(store, row(true)), null);
  store = Labels.recordResult(store, row(true));
  const rate = Labels.rateFor(store, row(true));
  assert.equal(rate.attempts, 3);
  assert.equal(rate.successes, 2);
  assert.equal(rate.percent, 67);
});

test("a result stores success or failure and not a point score", () => {
  const store = Labels.recordResult(Labels.emptyStore(), Object.assign(row(true), { successPoints: 4.5 }));
  const saved = store.plays["DAL|cpu|first_med|inside-a"];
  assert.equal(saved.success, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, "successPoints"), false);
});

test("a new first down uses the yard line, not the fact that it is 1st down again", () => {
  const grade = Labels.gradeSnap(
    { down: 1, yards: 10, fieldSide: "OWN", fieldYard: 25 },
    { down: 1, yards: 10, fieldSide: "OWN", fieldYard: 35 },
  );
  assert.equal(grade.yardsGained, 10);
  assert.equal(grade.success, true);
});

test("the same play-call screen is not scored as a no-gain failure", () => {
  assert.equal(Labels.gradeSnap(
    { down: 1, yards: 10, fieldSide: "OWN", fieldYard: 25 },
    { down: 1, yards: 10, fieldSide: "OWN", fieldYard: 25 },
  ), null);
});

test("a moved yard line wins when the new distance still says 10", () => {
  const grade = Labels.gradeSnap(
    { down: 1, yards: 10, fieldSide: "OWN", fieldYard: 25 },
    { down: 2, yards: 10, fieldSide: "OWN", fieldYard: 35 },
  );
  assert.equal(grade.yardsGained, 10);
  assert.equal(grade.success, true);
});

test("a short gain on first down still fails when the yard line barely moves", () => {
  const grade = Labels.gradeSnap(
    { down: 1, yards: 10, fieldSide: "OPP", fieldYard: 40 },
    { down: 2, yards: 8, fieldSide: "OPP", fieldYard: 38 },
  );
  assert.equal(grade.yardsGained, 2);
  assert.equal(grade.success, false);
});

test("the reason stays general until the opponent look has a baseline", () => {
  let store = Labels.emptyStore();
  const query = {
    opponent: "DAL",
    context: "cpu",
    slotId: "first_med",
    family: "inside_zone",
    familyLabel: "Inside zone",
    generalReason: "Early-down fit from this playbook.",
    lookSide: "defense",
  };
  assert.equal(Labels.reasonFor(store, query), "Early-down fit from this playbook.");
  store = Labels.recordResult(store, row(true));
  store = Labels.recordResult(store, row(true));
  store = Labels.recordResult(store, row(false));
  assert.match(Labels.reasonFor(store, query), /Cover 3 on 3 of 3/);
  assert.match(Labels.reasonFor(store, query), /Inside zone is 2 of 3/);
});
