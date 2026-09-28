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

    var exposurePlays = Object.create(null);
    (Array.isArray(exposurePlayIds) ? exposurePlayIds : []).forEach(function (id) {
      var key = String(id);
      exposurePlays[key] = (exposurePlays[key] || 0) + 1;
    });

    absorb(recentPlayIds, recentSets, recentForms);
    absorb(exposurePlayIds, exposureSets, exposureForms);
    return {
      recentSets: recentSets,
      recentForms: recentForms,
      exposureSets: exposureSets,
      exposureForms: exposureForms,
      exposurePlays: exposurePlays,
    };
  }

  function varietyAdjustment(traits, memory, playId) {
    if (!traits || !memory) return 0;
    var setKey = traits.formationSetKey || "";
    var formKey = traits.formation || "";
    var confirmedSet = countKeyed(memory.recentSets, setKey);
    var confirmedForm = countKeyed(memory.recentForms, formKey);
    var shownSet = countKeyed(memory.exposureSets, setKey);
    var shownForm = countKeyed(memory.exposureForms, formKey);
    var shownPlay = countKeyed(memory.exposurePlays, playId);
    var tax = 0;
    // Confirmed shells/forms get a strong tax so Exact Calls rotate across snaps.
    tax += Math.min(confirmedSet * 3.25, 9.5);
    tax += Math.min(confirmedForm * 1.75, 5.5);
    // The specific call drops so a sibling in the same front can take the next sheet.
    // The set itself is only softened — exiling the whole front repeats one or two calls.
    tax += Math.min(shownPlay * 4.5, 9);
    tax += Math.min(shownSet * 0.85, 2.5);
    tax += Math.min(shownForm * 0.45, 1.5);
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

  function callMemoryFromPlay(play, core) {
    if (!play || !play.id) return null;
    var traits = core.defensivePlayTraitsOf(play);
    var concept = typeof core.coverageFamilyOf === "function"
      ? core.coverageFamilyOf(play, traits)
      : "";
    return {
      playId: String(play.id),
      formationSetKey: traits.formationSetKey || "",
      conceptKey: concept,
      coverageFamily: concept,
      family: typeof core.defensiveFamilyOf === "function" ? core.defensiveFamilyOf(play) : "",
    };
  }

  function sheetsFromExposure(exposureSheets, exposurePlayIds, sheetSize) {
    if (Array.isArray(exposureSheets) && exposureSheets.length) {
      return exposureSheets.map(function (sheet) {
        return (Array.isArray(sheet) ? sheet : []).map(function (id) { return String(id); }).filter(Boolean);
      }).filter(function (sheet) { return sheet.length; });
    }
    var ids = (Array.isArray(exposurePlayIds) ? exposurePlayIds : []).map(function (id) {
      return String(id);
    }).filter(Boolean);
    var size = Math.max(1, Number(sheetSize) || 3);
    var sheets = [];
    for (var i = 0; i < ids.length; i += size) sheets.push(ids.slice(i, i + size));
    return sheets;
  }

  function preferredFrontsForShowing(showing, core) {
    if (!showing || !core || typeof core.offenseShowingTraitsOf !== "function") return [];
    var traits = core.offenseShowingTraitsOf(showing);
    if (!traits) return [];
    if (traits.isGoalLine) return ["GOAL LINE"];
    if (traits.isHailMary || traits.isEmpty || traits.isQuads) return ["DIME", "DOLLAR"];
    if ((traits.wrCount != null && traits.wrCount >= 3) || traits.isSpread || traits.isTrips || traits.isBunch) {
      return ["NICKEL"];
    }
    if ((traits.teCount != null && traits.teCount >= 2) || traits.isTight || traits.isWing) {
      return ["4-3", "46"];
    }
    return [];
  }

  function buildExactSelectionMemory(plays, recentPlayIds, exposurePlayIds, exposureSheets, core, sheetSize, offenseShowing) {
    var byId = Object.create(null);
    (Array.isArray(plays) ? plays : []).forEach(function (play) {
      if (play && play.id) byId[String(play.id)] = play;
    });
    var recentGameCalls = (Array.isArray(recentPlayIds) ? recentPlayIds : []).map(function (id) {
      return callMemoryFromPlay(byId[String(id)], core) || { playId: String(id) };
    });
    var sheets = sheetsFromExposure(exposureSheets, exposurePlayIds, sheetSize);
    var recommendationExposureHistory = [];
    sheets.forEach(function (sheet, batchIndex) {
      sheet.forEach(function (id, rank) {
        var memory = callMemoryFromPlay(byId[String(id)], core) || { playId: String(id) };
        recommendationExposureHistory.push(Object.assign({}, memory, {
          batchId: batchIndex,
          rank: rank + 1,
        }));
      });
    });
    return {
      recentGameCalls: recentGameCalls,
      recommendationExposureHistory: recommendationExposureHistory,
      // Ban the exact play after it is shown. Do not ban the front, the coverage
      // family, or every zone call — those are the similar plays we still want.
      policy: {
        altSameFormation: true,
        preferredFormations: preferredFrontsForShowing(offenseShowing, core),
        shownPlayBanBatches: 6,
        shownConceptBanBatches: 0,
        shownShellBanBatches: 0,
        shownFamilyBanBatches: 0,
        sessionPlayCap: 2,
        sessionPlayRepeatTax: 14,
        requireUniqueFamilyType: false,
        requireUniqueShell: false,
        requireUniqueConcept: true,
        requireUniqueFormation: false,
        wildcardTemperature: 1.6,
      },
    };
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
      var shellAdjustment = varietyAdjustment(traits, shellMemory, play.id);
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
    var limit = Number.isFinite(Number(input.limit)) ? Number(input.limit) : 3;
    var selectionMemory = buildExactSelectionMemory(
      plays, recentPlayIds, exposurePlayIds, input.exposureSheets, core, limit, context.offenseShowing
    );
    var picked = core.pickTopDefensiveRecommendationsCore({
      scored: scored,
      limit: limit,
      scoreKey: "_score",
      nearScoreWindow: 3.5,
      recentGameCalls: input.recentGameCalls || selectionMemory.recentGameCalls,
      recommendationExposureHistory: input.recommendationExposureHistory || selectionMemory.recommendationExposureHistory,
      policy: input.selectionPolicy || selectionMemory.policy,
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
