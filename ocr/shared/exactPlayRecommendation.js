(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("../../shared/defenseRecommendationCore.js"),
      require("./learnedAdjustment.js")
    );
  } else {
    root.GridironOcrExactPlayRecommendation = factory(
      root.GridironDefenseRecommendationCore,
      root.GridironOcrLearnedAdjustment
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (DefenseRecommendationCore, LearnedAdjustment) {
  "use strict";

  function requireCore(core) {
    if (!core ||
        typeof core.defensivePlayTraitsOf !== "function" ||
        typeof core.scoreDefensivePlayCore !== "function" ||
        typeof core.pickTopDefensiveRecommendationsCore !== "function") {
      throw new Error("DefenseRecommendationCore exports are required");
    }
    return core;
  }

  function countKeyed(map, key) {
    if (!key) return 0;
    return Number(map[key]) || 0;
  }

  function buildRecentShellMemory(plays, recentPlayIds, exposurePlayIds, core) {
    var byId = Object.create(null);
    (Array.isArray(plays) ? plays : []).forEach(function (play) {
      if (play && play.id) byId[String(play.id)] = play;
    });

    var recentSets = Object.create(null);
    var recentForms = Object.create(null);
    var exposureSets = Object.create(null);
    var exposureForms = Object.create(null);

    function absorb(list, setMap, formMap) {
      (Array.isArray(list) ? list : []).forEach(function (id) {
        var play = byId[String(id)];
        if (!play) return;
        var traits = core.defensivePlayTraitsOf(play);
        var setKey = traits.formationSetKey || "";
        var formKey = traits.formation || "";
        if (setKey) setMap[setKey] = (setMap[setKey] || 0) + 1;
        if (formKey) formMap[formKey] = (formMap[formKey] || 0) + 1;
      });
    }

    absorb(recentPlayIds, recentSets, recentForms);
    absorb(exposurePlayIds, exposureSets, exposureForms);
    return {
      recentSets: recentSets,
      recentForms: recentForms,
      exposureSets: exposureSets,
      exposureForms: exposureForms,
    };
  }

  function varietyAdjustment(traits, memory) {
    if (!traits || !memory) return 0;
    var setKey = traits.formationSetKey || "";
    var formKey = traits.formation || "";
    var confirmedSet = countKeyed(memory.recentSets, setKey);
    var confirmedForm = countKeyed(memory.recentForms, formKey);
    var shownSet = countKeyed(memory.exposureSets, setKey);
    var shownForm = countKeyed(memory.exposureForms, formKey);
    var tax = 0;
    // Confirmed shells/forms get a strong tax so Exact Calls rotate across snaps.
    tax += Math.min(confirmedSet * 3.25, 9.5);
    tax += Math.min(confirmedForm * 1.75, 5.5);
    // Merely shown (not confirmed) shells still soften so the same top-3 does not stick.
    tax += Math.min(shownSet * 1.6, 6.5);
    tax += Math.min(shownForm * 0.85, 3.5);
    if (confirmedSet >= 1 && shownSet >= 1) tax += 1.25;
    return -tax;
  }

  function explorationAdjustment(traits, memory) {
    if (!traits || !memory) return 0;
    var setKey = traits.formationSetKey || "";
    var formKey = traits.formation || "";
    var confirmedSet = countKeyed(memory.recentSets, setKey);
    var confirmedForm = countKeyed(memory.recentForms, formKey);
    var shownSet = countKeyed(memory.exposureSets, setKey);
    var shownForm = countKeyed(memory.exposureForms, formKey);
    var bonus = 0;
    if (confirmedSet === 0 && shownSet === 0) bonus += 1.35;
    else if (confirmedSet === 0 && shownSet <= 1) bonus += 0.7;
    if (confirmedForm === 0 && shownForm === 0) bonus += 0.85;
    else if (confirmedForm === 0 && shownForm <= 1) bonus += 0.4;
    return Math.min(bonus, 2.2);
  }

  function computeExactPlayRecommendations(params) {
    var input = params || {};
    var core = requireCore(input.core || DefenseRecommendationCore);
    var plays = Array.isArray(input.plays) ? input.plays : [];
    var recentPlayIds = Array.isArray(input.recentPlayIds) ? input.recentPlayIds : [];
    var exposurePlayIds = Array.isArray(input.exposurePlayIds) ? input.exposurePlayIds : [];
    var recent = {};
    recentPlayIds.forEach(function (id) {
      recent[String(id)] = true;
    });
    var shellMemory = buildRecentShellMemory(plays, recentPlayIds, exposurePlayIds, core);
    var yardsRaw = input.yards != null ? Number(input.yards)
      : (input.yardsToGo != null ? Number(input.yardsToGo) : NaN);
    var yardsKnown = Number.isFinite(yardsRaw) && yardsRaw > 0;
    var userScore = Number(input.userScore);
    var oppScore = Number(input.oppScore);
    var quarter = Number(input.quarter);
    var scoreDiff = Number.isFinite(Number(input.scoreDiff))
      ? Number(input.scoreDiff)
      : (Number.isFinite(userScore) && Number.isFinite(oppScore) ? userScore - oppScore : null);
    var context = {
      down: Number(input.down) || 1,
      // Do not invent 3rd & 10 when OCR distance is missing — that unlocked Prevent.
      yards: yardsKnown ? yardsRaw : null,
      goalToGo: input.goalToGo === true,
      fieldPosition: input.fieldPosition || null,
      distBucket: input.distBucket || core.distToBucket(yardsKnown ? yardsRaw : NaN),
      fieldPositionBucket: input.fieldPositionBucket ||
        core.buildFieldPositionBucket(input.fieldPosition || null, input.goalToGo === true),
      offenseShowing: core.normalizeOffenseShowing(input.offenseShowing),
      quarter: Number.isFinite(quarter) && quarter >= 1 ? quarter : null,
      userScore: Number.isFinite(userScore) ? userScore : null,
      oppScore: Number.isFinite(oppScore) ? oppScore : null,
      scoreDiff: scoreDiff,
    };
    if (typeof core.buildDefensiveSituationPlan === "function") {
      context.situationPlan = core.buildDefensiveSituationPlan(context);
    }
    var liveTendencyContext = {
      opponent: input.opponent || input.selectedOpponent || "",
      down: context.down,
      distBucket: context.distBucket,
      offenseFormation: context.offenseShowing && context.offenseShowing.formation,
      offenseSet: context.offenseShowing && context.offenseShowing.set,
    };
    var scored = [];
    plays.forEach(function (play) {
      if (!play || !play.id) return;
      var traits = core.defensivePlayTraitsOf(play);
      if (core.shouldExcludeDefensivePlay(play, context, traits)) return;
      var baseScore = core.scoreDefensivePlayCore(play, context, traits);
      baseScore += core.scoreOffenseShowingBias(play, traits, context.offenseShowing);
      var recencyAdjustment = recent[String(play.id)] ? -6.5 : 0;
      var shellAdjustment = varietyAdjustment(traits, shellMemory);
      var exploreAdjustment = explorationAdjustment(traits, shellMemory);
      var learningAdjustment = LearnedAdjustment &&
        typeof LearnedAdjustment.adjustmentForPlay === "function"
        ? LearnedAdjustment.adjustmentForPlay(play, input.learningSnapshot, input.learningOptions)
        : 0;
      var tendencyAdjustment = LearnedAdjustment &&
        typeof LearnedAdjustment.tendencyCounterAdjustment === "function"
        ? LearnedAdjustment.tendencyCounterAdjustment(
          play,
          input.learningSnapshot,
          liveTendencyContext,
          Object.assign({}, input.learningOptions || {}, { traits: traits, minObservations: 2 })
        )
        : 0;
      var total = baseScore + recencyAdjustment + shellAdjustment + exploreAdjustment +
        learningAdjustment + tendencyAdjustment;
      scored.push({
        play: play,
        traits: traits,
        family: core.defensiveFamilyOf(play),
        why: core.buildDefensiveWhy(play, context, traits),
        baseScore: baseScore,
        recencyAdjustment: recencyAdjustment,
        shellAdjustment: shellAdjustment,
        exploreAdjustment: exploreAdjustment,
        learningAdjustment: learningAdjustment,
        tendencyAdjustment: tendencyAdjustment,
        _score: total,
        score: total,
      });
    });
    var selectionMemory = typeof core.buildDefensiveSelectionMemory === "function"
      ? core.buildDefensiveSelectionMemory({
        plays: plays,
        recentPlayIds: recentPlayIds,
        exposurePlayIds: exposurePlayIds,
        sheetSize: Number.isFinite(Number(input.limit)) ? Number(input.limit) : 3,
        policy: input.selectionPolicy,
      })
      : { recentGameCalls: [], recommendationExposureHistory: [], policy: null };
    var picked = core.pickTopDefensiveRecommendationsCore({
      scored: scored,
      limit: Number.isFinite(Number(input.limit)) ? Number(input.limit) : 3,
      scoreKey: "_score",
      nearScoreWindow: 3.5,
      recentGameCalls: input.recentGameCalls || selectionMemory.recentGameCalls,
      recommendationExposureHistory: input.recommendationExposureHistory || selectionMemory.recommendationExposureHistory,
      policy: selectionMemory.policy || undefined,
      rng: input.rng,
    });
    return {
      context: context,
      recommendations: picked.map(function (item) {
        return Object.assign({}, item.play, {
          _score: item._score,
          score: item.score,
          _baseScore: item.baseScore,
          _learningAdjustment: item.learningAdjustment,
          _tendencyAdjustment: item.tendencyAdjustment,
          _recencyAdjustment: item.recencyAdjustment,
          _shellAdjustment: item.shellAdjustment,
          _exploreAdjustment: item.exploreAdjustment,
          _why: item.why,
          why: item.why,
          traits: item.traits,
        });
      }),
      scored: scored.slice().sort(function (a, b) { return b._score - a._score; }),
      scoredCount: scored.length,
    };
  }

  function createExactPlayRecommendationEngine(core, defaults) {
    var resolvedCore = requireCore(core || DefenseRecommendationCore);
    return {
      recommend: function (params) {
        return computeExactPlayRecommendations(Object.assign({}, defaults || {}, params || {}, {
          core: resolvedCore,
        }));
      },
    };
  }

  return {
    computeExactPlayRecommendations: computeExactPlayRecommendations,
    recommendExactDefensivePlays: computeExactPlayRecommendations,
    createExactPlayRecommendationEngine: createExactPlayRecommendationEngine,
  };
});
