"use strict";

const SCORING_DEFENSE_UNKNOWN = "Unknown";
const DEFENSE_TENDENCY_SESSION_DAMPEN = 0.42;
const DEFENSE_TENDENCY_HISTORY_DAMPEN = 0.28;
const MAX_DEFENSE_TENDENCY_BONUS = 1.75;
const DEFENSE_PACKAGE_MATCH_FORMATION_SET = 1;
const DEFENSE_PACKAGE_MATCH_FORMATION = 0.72;
const DEFENSE_PACKAGE_MATCH_FAMILY = 0.48;

function coverageMatchupScore(traits, defense) {
  const t = traits;
  if (defense === SCORING_DEFENSE_UNKNOWN || defense === "Unknown") return 0;
  let score = 0;
  if (defense === "Cover 3" && t.cover3Beater) score += 2.9;
  if (defense === "Man" && t.manBeater) score += 3;
  return Math.max(0, score);
}

function defensePackageMatchStrength(play, context) {
  if (!context) return 0;
  if (context.formationSetKey && play.formationSetKey === context.formationSetKey) return DEFENSE_PACKAGE_MATCH_FORMATION_SET;
  if (context.formationKey && play.formationKey === context.formationKey) return DEFENSE_PACKAGE_MATCH_FORMATION;
  if (context.family && play.family === context.family) return DEFENSE_PACKAGE_MATCH_FAMILY;
  return 0;
}

function defenseTendencyHistoryMatch(play, userLearning, defense) {
  const history = userLearning?.defenseTendency?.byDefense?.[defense];
  if (!history) return { match: 0, observations: 0 };
  const formationSetObs = history.formationSets?.[play.formationSetKey]?.observations || 0;
  const formationObs = history.formations?.[play.formationKey]?.observations || 0;
  const familyObs = history.families?.[play.family]?.observations || 0;
  if (formationSetObs > 0) return { match: DEFENSE_PACKAGE_MATCH_FORMATION_SET, observations: formationSetObs };
  if (formationObs > 0) return { match: DEFENSE_PACKAGE_MATCH_FORMATION, observations: formationObs };
  if (familyObs > 0) return { match: DEFENSE_PACKAGE_MATCH_FAMILY, observations: familyObs };
  return { match: 0, observations: 0 };
}

function defenseTendencyAdjustment(play, ctx, traits, userLearning, activeTendency) {
  const defense = ctx.lastDefenseShown;
  if (defense === SCORING_DEFENSE_UNKNOWN || !play?.id) return 0;
  const beatScore = coverageMatchupScore(traits, defense);
  if (beatScore <= 0) return 0;
  let bonus = 0;
  if (activeTendency?.defense === defense) {
    const sessionMatch = defensePackageMatchStrength(play, activeTendency);
    if (sessionMatch > 0) bonus += beatScore * DEFENSE_TENDENCY_SESSION_DAMPEN * sessionMatch;
  }
  const historyMatch = defenseTendencyHistoryMatch(play, userLearning, defense);
  if (historyMatch.match > 0) {
    const reliability = Math.min(historyMatch.observations / 2, 1);
    bonus += beatScore * DEFENSE_TENDENCY_HISTORY_DAMPEN * historyMatch.match * reliability;
  }
  return Math.max(0, Math.min(bonus, MAX_DEFENSE_TENDENCY_BONUS));
}

function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
    return;
  }
  console.log("PASS", name);
}

const cover3Beater = {
  id: "flood-a",
  family: "flood",
  formationKey: "gun trips",
  formationSetKey: "gun trips|trips",
};
const unrelatedBeater = {
  id: "flood-b",
  family: "flood",
  formationKey: "i form",
  formationSetKey: "i form|pro",
};
const nonBeater = {
  id: "run-a",
  family: "inside_zone",
  formationKey: "gun trips",
  formationSetKey: "gun trips|trips",
};

const activeTendency = {
  defense: "Cover 3",
  formationSetKey: "gun trips|trips",
  formationKey: "gun trips",
  family: "flood",
};

const userLearning = {
  defenseTendency: {
    byDefense: {
      "Cover 3": {
        formationSets: { "gun trips|trips": { observations: 2 } },
        formations: {},
        families: {},
        plays: {},
      },
    },
  },
};

const ctx = { lastDefenseShown: "Cover 3" };
const floodTraits = { cover3Beater: true };
const runTraits = { cover3Beater: false };

const matchedBonus = defenseTendencyAdjustment(cover3Beater, ctx, floodTraits, userLearning, activeTendency);
const unmatchedBonus = defenseTendencyAdjustment(unrelatedBeater, ctx, floodTraits, userLearning, activeTendency);
const nonBeaterBonus = defenseTendencyAdjustment(nonBeater, ctx, runTraits, userLearning, activeTendency);
const unknownBonus = defenseTendencyAdjustment(cover3Beater, { lastDefenseShown: SCORING_DEFENSE_UNKNOWN }, floodTraits, userLearning, activeTendency);

assert("matched package gets tendency bonus", matchedBonus > 0);
assert("matched package beats unrelated package", matchedBonus > unmatchedBonus);
assert("non-beater gets zero bonus", nonBeaterBonus === 0);
assert("unknown defense gets zero bonus", unknownBonus === 0);
assert("bonus stays capped", matchedBonus <= MAX_DEFENSE_TENDENCY_BONUS);

if (process.exitCode) process.exit(process.exitCode);
console.log("OK defense tendency smoke");
