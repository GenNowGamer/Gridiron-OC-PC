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

const goalLinePlay = {
  id: "chi|goal-line|6-2|gl-man",
  team: "CHI",
  formation: "Goal Line",
  set: "6-2",
  play_name: "GL Man",
  type: "BLITZ",
  concepts: ["Man"],
};

function goalCtx(extra) {
  return Object.assign({
    down: 1,
    yards: 10,
    goalToGo: false,
    fieldPosition: { side: "OPP", yardLine: 25 },
  }, extra);
}

test("goal line stays off normal downs, short yardage, and long goal-to-go", () => {
  assert.equal(Defense.shouldExcludeDefensivePlay(goalLinePlay, goalCtx({ down: 1, yards: 10, fieldPosition: { side: "OPP", yardLine: 35 } })), true);
  assert.equal(Defense.shouldExcludeDefensivePlay(goalLinePlay, goalCtx({ down: 2, yards: 10, fieldPosition: { side: "OWN", yardLine: 40 } })), true);
  assert.equal(Defense.shouldExcludeDefensivePlay(goalLinePlay, goalCtx({ down: 2, yards: 3, fieldPosition: { side: "OPP", yardLine: 23 } })), true);
  assert.equal(Defense.shouldExcludeDefensivePlay(goalLinePlay, goalCtx({ down: 3, yards: 1, fieldPosition: { side: "OPP", yardLine: 40 } })), true);
  assert.equal(Defense.shouldExcludeDefensivePlay(goalLinePlay, goalCtx({ down: 4, yards: 1, fieldPosition: { side: "OWN", yardLine: 45 } })), true);
  assert.equal(Defense.shouldExcludeDefensivePlay(goalLinePlay, goalCtx({ down: 1, yards: 9, goalToGo: true, fieldPosition: { side: "OPP", yardLine: 9 } })), true);
  assert.equal(Defense.shouldExcludeDefensivePlay(goalLinePlay, goalCtx({ down: 2, yards: 17, goalToGo: true, fieldPosition: { side: "OPP", yardLine: 17 } })), true);
  const early = Defense.buildDefensiveSituationPlan(goalCtx({ down: 1, yards: 10, fieldPosition: { side: "OPP", yardLine: 30 } }));
  assert.equal(early.preferPackages.includes("goal_line"), false);
  assert.ok(early.discouragePackages.includes("goal_line"));
  const short = Defense.buildDefensiveSituationPlan(goalCtx({ down: 3, yards: 1, fieldPosition: { side: "OPP", yardLine: 28 } }));
  assert.equal(short.preferPackages.includes("goal_line"), false);
});

test("goal line remains available inside the goal line", () => {
  assert.equal(Defense.shouldExcludeDefensivePlay(goalLinePlay, goalCtx({ down: 1, yards: 2, goalToGo: true, fieldPosition: { side: "OPP", yardLine: 2 } })), false);
  assert.equal(Defense.shouldExcludeDefensivePlay(goalLinePlay, goalCtx({ down: 3, yards: 1, goalToGo: true, fieldPosition: { side: "OPP", yardLine: 1 } })), false);
  assert.equal(Defense.shouldExcludeDefensivePlay(goalLinePlay, goalCtx({ down: 4, yards: 1, fieldPosition: { side: "OPP", yardLine: 1 } })), false);
  const plan = Defense.buildDefensiveSituationPlan(goalCtx({ down: 1, yards: 2, goalToGo: true, fieldPosition: { side: "OPP", yardLine: 2 } }));
  assert.equal(plan.preferPackages[0], "goal_line");
  assert.equal(plan.discouragePackages.includes("goal_line"), false);
  const sheet = Defense.computeDefensiveRecommendations({
    plays: [goalLinePlay, nickelPlay],
    down: 1,
    yards: 10,
    goalToGo: false,
    fieldPosition: { side: "OPP", yardLine: 25 },
  });
  assert.equal(sheet.recommendations.some((play) => play.id === goalLinePlay.id), false);
});

test("blitz classification separates zone blitz and man blitz", () => {
  const zBlitzPlay = {
    id: "chi|nickel|over|fire-zone-3",
    team: "CHI",
    formation: "Nickel",
    set: "Over",
    play_name: "Fire Zone 3",
    type: "BLITZ",
    concepts: ["Fire Zone", "Cover 3"],
  };
  const mBlitzPlay = {
    id: "chi|nickel|over|nickel-blitz-man",
    team: "CHI",
    formation: "Nickel",
    set: "Over",
    play_name: "Cover 1 Hole Blitz",
    type: "BLITZ",
    concepts: ["Man", "Cover 1"],
  };
  const zTraits = Defense.defensivePlayTraitsOf(zBlitzPlay);
  const mTraits = Defense.defensivePlayTraitsOf(mBlitzPlay);
  assert.equal(zTraits.isBlitz, true);
  assert.equal(zTraits.isZoneBlitz, true);
  assert.equal(zTraits.isManBlitz, false);
  assert.equal(Defense.coverageFamilyOf(zBlitzPlay, zTraits), "zone_blitz");

  assert.equal(mTraits.isBlitz, true);
  assert.equal(mTraits.isZoneBlitz, false);
  assert.equal(mTraits.isManBlitz, true);
  assert.equal(Defense.coverageFamilyOf(mBlitzPlay, mTraits), "man_blitz");
});

test("medium money down produces blitz recommendations in top 3", () => {
  const blitzPlay = {
    id: "chi|nickel|over|nickel-zone-blitz",
    team: "CHI",
    formation: "Nickel",
    set: "Over",
    play_name: "Zone Blitz 3",
    type: "BLITZ",
    concepts: ["Zone", "Blitz"],
  };
  const covPlay = {
    id: "chi|4-3|over|cover-2-man",
    team: "CHI",
    formation: "4-3",
    set: "Over",
    play_name: "Cover 2 Man",
    type: "MAN",
    concepts: ["Cover 2", "Man"],
  };
  const res = Defense.computeDefensivePackageRecommendations({
    plays: [blitzPlay, covPlay],
    down: 3,
    yards: 5,
    situationChip: "money_medium",
  });
  const blitzRecs = res.recommendations.filter(r => r.pressure === "blitz");
  assert.ok(blitzRecs.length > 0, "Expected at least 1 blitz recommendation on 3rd & 5");
});

console.log("OK defense situation smoke");
