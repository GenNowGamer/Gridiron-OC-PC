import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Defense = require("../shared/defenseRecommendationCore.js");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const preventPlay = {
  id: "chi|prevent|base|prevent-cover-3",
  team: "CHI",
  formation: "Prevent",
  set: "Base",
  play_name: "Prevent Cover 3",
  type: "ZONE",
  concepts: ["Prevent", "Cover 3"],
};
const nickelPlay = {
  id: "chi|nickel|over|cover-3-cloud",
  team: "CHI",
  formation: "Nickel",
  set: "Over",
  play_name: "Cover 3 Cloud",
  type: "ZONE",
  concepts: ["Cover 3"],
};

test("prevent excluded on 3rd & 5 midfield even when leading in Q1", () => {
  const ctx = {
    down: 3,
    yards: 5,
    distBucket: "medium",
    fieldPositionBucket: "midfield",
    fieldPosition: { side: "OWN", yardLine: 40 },
    quarter: 1,
    userScore: 14,
    oppScore: 7,
    scoreDiff: 7,
  };
  assert.equal(Defense.isPreventEligibleContext(ctx), false);
  assert.equal(Defense.shouldExcludeDefensivePlay(preventPlay, ctx), true);
  const plan = Defense.buildDefensiveSituationPlan(ctx);
  assert.equal(plan.intent, "money_medium");
  assert.equal(plan.allowPrevent, false);
  assert.ok(plan.discouragePackages.includes("prevent"));
});

test("prevent excluded on 3rd & 12 in Q1 when tied (not a protect-lead shell)", () => {
  const ctx = {
    down: 3,
    yards: 12,
    distBucket: "long",
    quarter: 1,
    userScore: 10,
    oppScore: 10,
    scoreDiff: 0,
  };
  assert.equal(Defense.isPreventEligibleContext(ctx), false);
  assert.equal(Defense.shouldExcludeDefensivePlay(preventPlay, ctx), true);
});

test("prevent allowed on 3rd & 12 in Q4 when defense is leading", () => {
  const ctx = {
    down: 3,
    yards: 12,
    distBucket: "long",
    quarter: 4,
    userScore: 24,
    oppScore: 17,
    scoreDiff: 7,
  };
  assert.equal(Defense.isPreventEligibleContext(ctx), true);
  assert.equal(Defense.shouldExcludeDefensivePlay(preventPlay, ctx), false);
  const plan = Defense.buildDefensiveSituationPlan(ctx);
  assert.equal(plan.allowPrevent, true);
  assert.ok(plan.preferPackages.includes("prevent"));
});

test("missing yards does not invent long-money / prevent eligibility", () => {
  const ctx = {
    down: 3,
    yards: null,
    distBucket: "medium",
    quarter: 4,
    userScore: 21,
    oppScore: 10,
    scoreDiff: 11,
  };
  assert.equal(Defense.isLongMoneyDown(ctx), false);
  assert.equal(Defense.isPreventEligibleContext(ctx), false);
  assert.equal(Defense.shouldExcludeDefensivePlay(preventPlay, ctx), true);
});

test("exact/compute path keeps prevent out of 3rd & 5 top sheet", () => {
  const result = Defense.computeDefensiveRecommendations({
    plays: [preventPlay, nickelPlay],
    down: 3,
    yards: 5,
    fieldPosition: { side: "OWN", yardLine: 45 },
    quarter: 2,
    userScore: 14,
    oppScore: 7,
  });
  const ids = result.recommendations.map((play) => play.id);
  assert.equal(ids.includes(preventPlay.id), false);
  assert.ok(ids.includes(nickelPlay.id));
});

test("hail mary offense showing still unlocks prevent", () => {
  const ctx = {
    down: 1,
    yards: 10,
    distBucket: "medium",
    quarter: 1,
    userScore: 0,
    oppScore: 0,
    scoreDiff: 0,
    offenseShowing: { formation: "HAIL MARY", set: "Base" },
  };
  assert.equal(Defense.isPreventEligibleContext(ctx), true);
  assert.equal(Defense.shouldExcludeDefensivePlay(preventPlay, ctx), false);
});

console.log("OK defense situation smoke");
