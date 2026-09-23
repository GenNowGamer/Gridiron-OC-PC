(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironOcrLearnedAdjustment = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function clean(value) { return String(value == null ? "" : value).trim(); }
  function key(value) { return clean(value).toUpperCase(); }

  function boundedLearnedAdjustment(stat, options) {
    var cfg = options || {};
    var observations = Number(stat && stat.observations) || 0;
    var successes = Number(stat && stat.successes) || 0;
    var failures = Number(stat && stat.failures) || 0;
    var known = successes + failures;
    var minObservations = Number.isFinite(Number(cfg.minObservations)) ? Number(cfg.minObservations) : 3;
    var maxAdjustment = Math.abs(Number.isFinite(Number(cfg.maxAdjustment)) ? Number(cfg.maxAdjustment) : 2.5);
    if (observations < minObservations || known < minObservations) return 0;
    var priorStrength = Number.isFinite(Number(cfg.priorStrength)) ? Math.max(0, Number(cfg.priorStrength)) : 4;
    var priorRate = Number.isFinite(Number(cfg.priorRate)) ? clamp(Number(cfg.priorRate), 0, 1) : 0.5;
    var posterior = (successes + priorRate * priorStrength) / (known + priorStrength);
    var centered = (posterior - priorRate) * 2;
    var reliability = clamp((known - minObservations + 1) / (Number(cfg.fullWeightAt) || 10), 0.15, 1);
    var yardsPenalty = 0;
    if (Number.isFinite(Number(stat && stat.yardsAllowed)) && observations > 0) {
      var avgYards = Number(stat.yardsAllowed) / observations;
      var neutralYards = Number.isFinite(Number(cfg.neutralYards)) ? Number(cfg.neutralYards) : 5;
      yardsPenalty = clamp((neutralYards - avgYards) / 10, -0.35, 0.35);
    }
    return clamp((centered + yardsPenalty) * maxAdjustment * reliability, -maxAdjustment, maxAdjustment);
  }

  function packageKeyOf(play) {
    return String(play && (play.packageKey || [play.formation, play.set].filter(Boolean).join("|")) || "")
      .trim()
      .toUpperCase();
  }

  function formationKeyOf(play) {
    return String(play && (play.formationKey || play.formation) || "").trim().toUpperCase();
  }

  /**
   * Hierarchical backoff: exact play → package/formation family → formation → global.
   * Each coarser tier is shrunk so sparse exact evidence stays authoritative when present.
   */
  function adjustmentForPlay(play, snapshot, options) {
    var effectiveness = snapshot && snapshot.defensiveEffectiveness;
    if (!effectiveness || !play) return 0;
    var cfg = options || {};
    var cap = Math.abs(Number.isFinite(Number(cfg.maxAdjustment)) ? Number(cfg.maxAdjustment) : 2.5);
    var playId = String(play.id || play.playId || "").trim();
    var packageKey = packageKeyOf(play);
    var formationKey = formationKeyOf(play);

    var exactWeight = Number.isFinite(Number(cfg.exactWeight)) ? Number(cfg.exactWeight) : 1;
    var packageWeight = Number.isFinite(Number(cfg.packageWeight)) ? Number(cfg.packageWeight) : 0.45;
    var formationWeight = Number.isFinite(Number(cfg.formationWeight)) ? Number(cfg.formationWeight) : 0.25;
    var globalWeight = Number.isFinite(Number(cfg.globalWeight)) ? Number(cfg.globalWeight) : 0.12;

    var exact = playId
      ? boundedLearnedAdjustment(effectiveness.byPlay && effectiveness.byPlay[playId], cfg) * exactWeight
      : 0;
    var packageAdjustment = packageKey
      ? boundedLearnedAdjustment(effectiveness.byPackage && effectiveness.byPackage[packageKey], cfg)
        * packageWeight
      : 0;
    var formationAdjustment = formationKey
      ? boundedLearnedAdjustment(effectiveness.byFormation && effectiveness.byFormation[formationKey], cfg)
        * formationWeight
      : 0;
    var globalAdjustment = boundedLearnedAdjustment(effectiveness.global, cfg) * globalWeight;

    // Prefer the finest tier with signal; coarser tiers only fill residual capacity.
    var total = exact;
    if (Math.abs(exact) < 0.05) total += packageAdjustment;
    else total += packageAdjustment * 0.35;
    if (Math.abs(exact) < 0.05 && Math.abs(packageAdjustment) < 0.05) total += formationAdjustment;
    else total += formationAdjustment * 0.2;
    if (Math.abs(exact) < 0.05 && Math.abs(packageAdjustment) < 0.05 && Math.abs(formationAdjustment) < 0.05) {
      total += globalAdjustment;
    } else {
      total += globalAdjustment * 0.15;
    }
    return clamp(total, -cap, cap);
  }

  function tendencyAdjustment(contextKeyParts, snapshot, options) {
    var tendency = snapshot && snapshot.opponentTendency;
    if (!tendency) return { tier: "none", observations: 0, weight: 0 };
    var cfg = options || {};
    var byContext = tendency.byContext || {};
    var exactKey = String(contextKeyParts && contextKeyParts.exact || "").trim();
    var formationKey = String(contextKeyParts && contextKeyParts.formation || "").trim();
    var globalKey = String(contextKeyParts && contextKeyParts.global || "*|*|*|*|*").trim();
    var exact = exactKey && byContext[exactKey] ? byContext[exactKey].observations : 0;
    var formation = formationKey && byContext[formationKey] ? byContext[formationKey].observations : 0;
    var global = byContext[globalKey] ? byContext[globalKey].observations : Number(tendency.observations) || 0;
    var minObservations = Number.isFinite(Number(cfg.minObservations)) ? Number(cfg.minObservations) : 3;
    if (exact >= minObservations) return { tier: "exact", observations: exact, weight: 1, key: exactKey };
    if (formation >= minObservations) return { tier: "formation", observations: formation, weight: 0.55, key: formationKey };
    if (global >= minObservations) return { tier: "global", observations: global, weight: 0.25, key: globalKey };
    return { tier: "none", observations: 0, weight: 0, key: "" };
  }

  function buildTendencyContextKeys(liveContext) {
    var ctx = liveContext || {};
    var opponent = key(ctx.opponent || "*") || "*";
    var down = clean(ctx.down != null ? ctx.down : "*") || "*";
    var distance = clean(ctx.distBucket || ctx.distanceBucket || "*").toLowerCase() || "*";
    var formation = key(ctx.offenseFormation || ctx.formation || "*") || "*";
    var set = key(ctx.offenseSet || ctx.set || "*") || "*";
    return {
      exact: [opponent, down, distance, formation, set].join("|"),
      formation: [opponent, "*", "*", formation, "*"].join("|"),
      global: ["*", "*", "*", "*", "*"].join("|"),
    };
  }

  function offenseConceptTags(playKey) {
    var blob = key(playKey).replace(/\|/g, " ");
    var tags = [];
    if (/\b(INSIDE.?ZONE|HB ZONE|ZONE WK|MID DRAW|DUO|POWER|ISO|DIVE|COUNTER)\b/.test(blob)) tags.push("run_inside");
    if (/\b(OUTSIDE.?ZONE|SWEEP|TOSS|JET|EDGE)\b/.test(blob)) tags.push("run_outside");
    if (/\b(SCREEN|SLIP SCREEN|BUBBLE)\b/.test(blob)) tags.push("screen");
    if (/\b(FOUR VERT|VERT|GO|POST|CORNER|DEEP)\b/.test(blob)) tags.push("vertical");
    if (/\b(MESH|CROSS|DRAG|SHALLOW)\b/.test(blob)) tags.push("crossers");
    if (/\b(CURL|FLAT|STICK|SNAG|SPOT|SPACING|HITCH)\b/.test(blob)) tags.push("quick");
    if (/\b(SMASH|FLOOD|BOOT|PA |PLAY ACTION)\b/.test(blob)) tags.push("pa_boot");
    if (/\b(EMPTY|TRIPS|BUNCH|SPREAD)\b/.test(blob)) tags.push("spread");
    if (!tags.length && blob && blob !== "UNKNOWN") tags.push("generic_pass");
    return tags;
  }

  function defensiveCounterScore(play, tags, traits) {
    var t = traits || {};
    var score = 0;
    (tags || []).forEach(function (tag) {
      if (tag === "run_inside") {
        if (t.isFourThree || t.isFortySix) score += 1.4;
        if (t.isBlitz) score += 0.7;
        if (t.isDime || t.isDollar || t.isPrevent) score -= 0.8;
      } else if (tag === "run_outside") {
        if (t.isNickel || t.isFourThree) score += 0.9;
        if (t.isBlitz) score += 0.5;
        if (t.isPrevent) score -= 0.6;
      } else if (tag === "screen") {
        if (t.isBlitz) score -= 1.0;
        if (t.isZone || t.isMatch) score += 0.9;
        if (t.isNickel) score += 0.5;
      } else if (tag === "vertical") {
        if (t.isCover4 || /\bcover\s*4\b/i.test(clean(play && play.play_name))) score += 1.3;
        if (t.isPrevent || t.isDime || t.isDollar) score += 1.1;
        if (t.isBlitz) score -= 0.7;
      } else if (tag === "crossers") {
        if (t.isMatch || t.isMan) score += 1.0;
        if (t.isCover2 || /\btampa\b/i.test(clean(play && play.play_name))) score += 0.6;
      } else if (tag === "quick") {
        if (t.isBlitz || t.isMan) score += 1.0;
        if (t.isCover2) score += 0.5;
      } else if (tag === "pa_boot") {
        if (t.isZone || t.isMatch) score += 0.9;
        if (t.isBlitz) score += 0.4;
      } else if (tag === "spread" || tag === "generic_pass") {
        if (t.isNickel || t.isDime || t.isDollar) score += 0.7;
        if (t.isZone || t.isMatch) score += 0.5;
      }
    });
    return score;
  }

  /**
   * Score how well a defensive call counters observed opponent offense tendencies
   * for the live OCR context (opponent / down / distance / formation showing).
   */
  function tendencyCounterAdjustment(play, snapshot, liveContext, options) {
    var tendency = snapshot && snapshot.opponentTendency;
    if (!tendency || !play) return 0;
    var cfg = options || {};
    var keys = buildTendencyContextKeys(liveContext);
    var selected = tendencyAdjustment(keys, snapshot, cfg);
    if (!selected.weight || !selected.key) return 0;
    var context = (tendency.byContext || {})[selected.key];
    if (!context || !context.plays) return 0;
    var entries = Object.keys(context.plays)
      .filter(function (playKey) { return playKey && playKey !== "UNKNOWN"; })
      .map(function (playKey) {
        return {
          playKey: playKey,
          observations: Number(context.plays[playKey] && context.plays[playKey].observations) || 0,
        };
      })
      .filter(function (entry) { return entry.observations > 0; });
    var totalObs = entries.reduce(function (sum, entry) { return sum + entry.observations; }, 0);
    if (totalObs < (Number(cfg.minObservations) || 2)) return 0;
    var traits = options && options.traits || null;
    var expected = 0;
    entries.forEach(function (entry) {
      var weight = entry.observations / totalObs;
      expected += weight * defensiveCounterScore(play, offenseConceptTags(entry.playKey), traits);
    });
    var reliability = clamp(totalObs / (Number(cfg.fullWeightAt) || 8), 0.2, 1);
    var cap = Math.abs(Number.isFinite(Number(cfg.maxTendencyAdjustment)) ? Number(cfg.maxTendencyAdjustment) : 2.0);
    return clamp(expected * selected.weight * reliability, -cap, cap);
  }

  return {
    boundedLearnedAdjustment: boundedLearnedAdjustment,
    adjustmentForPlay: adjustmentForPlay,
    computeLearnedAdjustment: adjustmentForPlay,
    tendencyAdjustment: tendencyAdjustment,
    tendencyCounterAdjustment: tendencyCounterAdjustment,
    buildTendencyContextKeys: buildTendencyContextKeys,
    packageKeyOf: packageKeyOf,
    formationKeyOf: formationKeyOf,
  };
});
