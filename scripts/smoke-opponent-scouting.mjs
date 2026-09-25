"use strict";

const SCORING_DEFENSE_UNKNOWN = "Unknown";
const MIN_OPPONENT_SCOUTING_OBSERVATIONS = 2;
const OPPONENT_GAME_SCOUTING_WEIGHT = 1.6;
const OPPONENT_SCOUTING_PREDICT_DAMPEN = 0.34;
const MAX_OPPONENT_SCOUTING_BONUS = 3.2;
const DEFENSE_PACKAGE_MATCH_FORMATION_SET = 1;
const DEFENSE_PACKAGE_MATCH_FORMATION = 0.72;
const DEFENSE_PACKAGE_MATCH_FAMILY = 0.48;

function cleanText(value) {
  return String(value ?? "").trim();
}

function buildOpponentScoutingContextKey(situationKey, packageTier, packageValue) {
  return `${cleanText(situationKey)}|${cleanText(packageTier)}|${cleanText(packageValue).toLowerCase()}`;
}

function normalizeDefenseObservationStat(stat) {
  return { observations: Number(stat?.observations) || 0, lastSeenAt: Number(stat?.lastSeenAt) || 0 };
}

function updateDefenseObservationStat(stat) {
  const prev = normalizeDefenseObservationStat(stat);
  return { observations: prev.observations + 1, lastSeenAt: Date.now() };
}

function recordOpponentScoutingObservation(learning, opponent, scoutingSituationKey, context, defense) {
  const opp = cleanText(opponent).toUpperCase();
  if (!opp || !context?.formationSetKey || !context?.family || !scoutingSituationKey || defense === SCORING_DEFENSE_UNKNOWN) {
    return learning;
  }
  const previous = learning?.opponentScouting?.byOpponent?.[opp] || { updatedAt: 0, contexts: {} };
  const tierWrites = [
    ["fs", context.formationSetKey],
    ["fm", context.formationKey],
    ["fam", context.family],
  ];
  const nextContexts = { ...previous.contexts };
  tierWrites.forEach(([tier, value]) => {
    const key = buildOpponentScoutingContextKey(scoutingSituationKey, tier, value);
    const prev = nextContexts[key] || { updatedAt: 0, defenses: {} };
    nextContexts[key] = {
      updatedAt: Date.now(),
      defenses: {
        ...prev.defenses,
        [defense]: updateDefenseObservationStat(prev.defenses?.[defense]),
      },
    };
  });
  return {
    ...learning,
    opponentScouting: {
      byOpponent: {
        ...learning?.opponentScouting?.byOpponent,
        [opp]: { updatedAt: Date.now(), contexts: nextContexts },
      },
    },
  };
}

function normalizeDefenseDistribution(counts) {
  const entries = Object.entries(counts || {}).filter(([, count]) => Number(count) > 0);
  const total = entries.reduce((sum, [, count]) => sum + Number(count), 0);
  if (total <= 0) return { total: 0, entries: [] };
  return {
    total,
    entries: entries.map(([defense, count]) => [defense, Number(count) / total]).sort((a, b) => b[1] - a[1]),
  };
}

function getOpponentScoutingProfile(userLearning, opponent) {
  const code = cleanText(opponent).toUpperCase();
  return userLearning?.opponentScouting?.byOpponent?.[code] || null;
}

function collectOpponentDefenseCountsForPlay(play, situationKey, userLearning, opponent, gameScoutingLog = []) {
  const profile = getOpponentScoutingProfile(userLearning, opponent);
  if (!profile && !gameScoutingLog.length) return { counts: {}, observations: 0 };
  const formationSetKey = play.formationSetKey;
  const formationKey = play.formationKey;
  const family = play.family;
  const tierDefs = [
    ["fs", formationSetKey, 1],
    ["fm", formationKey, 0.78],
    ["fam", family, 0.55],
  ];
  const merged = {};
  let observations = 0;
  if (profile) {
    tierDefs.forEach(([tier, value, weight]) => {
      const context = profile.contexts?.[buildOpponentScoutingContextKey(situationKey, tier, value)];
      if (!context?.defenses) return;
      Object.entries(context.defenses).forEach(([defense, stat]) => {
        const count = (Number(stat?.observations) || 0) * weight;
        if (count <= 0) return;
        merged[defense] = (merged[defense] || 0) + count;
        observations += count;
      });
    });
  }
  gameScoutingLog.forEach((entry) => {
    if (cleanText(entry?.opponent).toUpperCase() !== cleanText(opponent).toUpperCase()) return;
    if (cleanText(entry?.scoutingSituationKey) !== cleanText(situationKey)) return;
    const defense = entry?.defense;
    if (!defense || defense === SCORING_DEFENSE_UNKNOWN) return;
    let matchWeight = 0;
    if (entry.formationSetKey === formationSetKey) matchWeight = 1;
    else if (entry.formationKey === formationKey) matchWeight = 0.78;
    else if (entry.family === family) matchWeight = 0.55;
    else return;
    merged[defense] = (merged[defense] || 0) + OPPONENT_GAME_SCOUTING_WEIGHT * matchWeight;
    observations += OPPONENT_GAME_SCOUTING_WEIGHT * matchWeight;
  });
  return { counts: merged, observations };
}

function coverageMatchupScore(traits, defense) {
  if (defense === SCORING_DEFENSE_UNKNOWN) return 0;
  if (defense === "Cover 3" && traits.cover3Beater) return 2.9;
  if (defense === "Man" && traits.manBeater) return 3;
  return 0;
}

function opponentScoutingPredictionAdjustment(play, ctx, traits, userLearning, gameScoutingLog) {
  const opponent = cleanText(ctx?.selectedOpponent).toUpperCase();
  if (!opponent || !play?.id) return 0;
  if (cleanText(ctx?.lastDefenseShown) !== SCORING_DEFENSE_UNKNOWN) return 0;
  const situationKey = cleanText(ctx?.learningSituationKey);
  if (!situationKey) return 0;
  const { counts, observations } = collectOpponentDefenseCountsForPlay(play, situationKey, userLearning, opponent, gameScoutingLog);
  if (observations < MIN_OPPONENT_SCOUTING_OBSERVATIONS) return 0;
  const distribution = normalizeDefenseDistribution(counts);
  if (!distribution.total) return 0;
  let expectedBeat = 0;
  distribution.entries.forEach(([defense, weight]) => {
    expectedBeat += weight * coverageMatchupScore(traits, defense);
  });
  if (expectedBeat <= 0) return 0;
  const reliability = Math.min(observations / (MIN_OPPONENT_SCOUTING_OBSERVATIONS + 2), 1);
  return Math.max(0, Math.min(expectedBeat * OPPONENT_SCOUTING_PREDICT_DAMPEN * reliability, MAX_OPPONENT_SCOUTING_BONUS));
}

function defenseTendencyHistoryMatch(play, userLearning, defense, opponent, scoutingSituationKey, gameScoutingLog) {
  const opp = cleanText(opponent).toUpperCase();
  if (opp && scoutingSituationKey) {
    const profile = getOpponentScoutingProfile(userLearning, opp);
    const fsKey = buildOpponentScoutingContextKey(scoutingSituationKey, "fs", play.formationSetKey);
    const fsObs = normalizeDefenseObservationStat(profile?.contexts?.[fsKey]?.defenses?.[defense]).observations;
    if (fsObs > 0) return { match: DEFENSE_PACKAGE_MATCH_FORMATION_SET, observations: fsObs };
  }
  const history = userLearning?.defenseTendency?.byDefense?.[defense];
  if (!history) return { match: 0, observations: 0 };
  const formationSetObs = history.formationSets?.[play.formationSetKey]?.observations || 0;
  if (formationSetObs > 0) return { match: DEFENSE_PACKAGE_MATCH_FORMATION_SET, observations: formationSetObs };
  return { match: 0, observations: 0 };
}

function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
    return;
  }
  console.log("PASS", name);
}

const situationKey = "CHI|3|medium|false|midfield";
const context = {
  formationSetKey: "gun trips|trips",
  formationKey: "gun trips",
  family: "flood",
};
const play = {
  id: "flood-a",
  family: "flood",
  formationKey: "gun trips",
  formationSetKey: "gun trips|trips",
};
const traits = { cover3Beater: true, manBeater: false };

let learning = { opponentScouting: { byOpponent: {} }, defenseTendency: { byDefense: {} } };
learning = recordOpponentScoutingObservation(learning, "DAL", situationKey, context, "Cover 3");
learning = recordOpponentScoutingObservation(learning, "DAL", situationKey, context, "Cover 3");

const profile = getOpponentScoutingProfile(learning, "DAL");
const fsKey = buildOpponentScoutingContextKey(situationKey, "fs", context.formationSetKey);
const storedObs = profile?.contexts?.[fsKey]?.defenses?.["Cover 3"]?.observations || 0;

assert("records opponent scouting observations", storedObs === 2);

const counts = collectOpponentDefenseCountsForPlay(play, situationKey, learning, "DAL", []);
assert("collects enough observations for prediction", counts.observations >= MIN_OPPONENT_SCOUTING_OBSERVATIONS);

const ctxPreSnap = {
  selectedOpponent: "DAL",
  learningSituationKey: situationKey,
  lastDefenseShown: SCORING_DEFENSE_UNKNOWN,
};
const predictBonus = opponentScoutingPredictionAdjustment(play, ctxPreSnap, traits, learning, []);
const weakPlay = { ...play, id: "run-a", family: "inside_zone" };
const weakTraits = { cover3Beater: false };
const weakBonus = opponentScoutingPredictionAdjustment(weakPlay, ctxPreSnap, weakTraits, learning, []);

assert("predictive bonus applies pre-snap for beaters", predictBonus > 0);
assert("predictive bonus beats non-beaters", predictBonus > weakBonus);

const ctxReactive = { ...ctxPreSnap, lastDefenseShown: "Cover 3" };
const reactivePredict = opponentScoutingPredictionAdjustment(play, ctxReactive, traits, learning, []);
assert("predictive layer skips when defense is logged", reactivePredict === 0);

const gameLog = [
  {
    opponent: "DAL",
    scoutingSituationKey: situationKey,
    defense: "Cover 3",
    formationSetKey: context.formationSetKey,
    formationKey: context.formationKey,
    family: context.family,
  },
];
const withGameLog = collectOpponentDefenseCountsForPlay(play, situationKey, { opponentScouting: { byOpponent: {} } }, "DAL", gameLog);
assert("current-game log contributes scouting weight", withGameLog.observations >= OPPONENT_GAME_SCOUTING_WEIGHT);

learning.defenseTendency.byDefense = {
  Man: { formationSets: { "gun trips|trips": { observations: 5 } } },
};
const oppMatch = defenseTendencyHistoryMatch(play, learning, "Cover 3", "DAL", situationKey, []);
const legacyOnly = defenseTendencyHistoryMatch(play, { defenseTendency: learning.defenseTendency }, "Man", null, situationKey, []);
assert("opponent scouting history match works", oppMatch.match === DEFENSE_PACKAGE_MATCH_FORMATION_SET);
assert("legacy fallback still works without opponent", legacyOnly.observations === 5);

if (process.exitCode) process.exit(process.exitCode);
console.log("OK opponent scouting smoke");
