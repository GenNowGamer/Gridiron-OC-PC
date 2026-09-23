(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironOcrLearningProjection = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value) { return String(value == null ? "" : value).trim(); }
  function key(value) { return clean(value).toUpperCase(); }

  function emptyLearningSnapshot() {
    return {
      version: 1,
      opponentTendency: { observations: 0, byContext: {} },
      defensiveEffectiveness: {
        observations: 0,
        byPlay: {},
        byPackage: {},
        byFormation: {},
        global: { observations: 0, successes: 0, failures: 0, unknowns: 0, yardsAllowed: 0, pointsAllowed: 0, turnovers: 0 },
      },
      // Rolling OCR stop/fail memory for next-sheet package leans.
      recentMatchups: [],
      appliedEventIds: {},
    };
  }

  function inferCoverageFamilyFromDefense(defense) {
    var blob = [
      defense && defense.set,
      defense && defense.playName,
      defense && defense.play_name,
      defense && defense.packageKey,
      defense && defense.coverageFamily,
    ].map(clean).filter(Boolean).join(" ");
    if (!blob) return "";
    if (/\bblitz\b/i.test(blob) || /\bpressure\b/i.test(blob)) return "blitz";
    if (/cover\s*1\b|\bman free\b/i.test(blob)) return "cover1";
    if (/cover\s*2\b|\btampa\b|\btwo man\b/i.test(blob)) return "cover2";
    if (/cover\s*3\b|\bsky\b|\bcloud\b|\bbuzz\b/i.test(blob)) return "cover3";
    if (/cover\s*4\b|\bquarters\b|\bpalms\b/i.test(blob)) return "cover4";
    if (/\bprevent\b/i.test(blob)) return "prevent";
    if (/\bmatch\b/i.test(blob)) return "match";
    if (/\bman\b/i.test(blob)) return "man";
    if (/\bzone\b/i.test(blob)) return "zone";
    return clean(defense && defense.coverageFamily).toLowerCase();
  }

  function buildMatchupRecord(event) {
    var e = event || {};
    var offense = e.offense || {};
    var defense = e.defense || {};
    var outcome = e.outcome || {};
    if (outcome.learnable !== true) return null;
    if (outcome.successfulDefense !== true && outcome.successfulDefense !== false) return null;
    var coverageFamily = clean(defense.coverageFamily).toLowerCase()
      || inferCoverageFamilyFromDefense(defense);
    return {
      at: Number(e.at) || Date.now(),
      offensePlayKey: key(offense.playId || offense.playName || ""),
      offenseFormation: key(offense.formation || ""),
      offenseSet: key(offense.set || ""),
      defensePlayId: clean(defense.playId || defense.id),
      defenseFormation: key(defense.formationKey || defense.formation || ""),
      defenseSet: key(defense.set || ""),
      defensePackageKey: key(defense.packageKey || [defense.formation, defense.set].filter(Boolean).join("|")),
      coverageFamily: coverageFamily,
      successfulDefense: outcome.successfulDefense === true,
      yardsAllowed: Number.isFinite(Number(outcome.yardsAllowed)) ? Number(outcome.yardsAllowed) : null,
    };
  }

  function cloneMap(value) { return Object.assign({}, value || {}); }

  function tendencyContextKey(event, options) {
    var e = event || {};
    var situation = e.situation || {};
    var offense = e.offense || {};
    var mode = clean(options && options.mode).toLowerCase() || "exact";
    var opponent = key(e.opponent || offense.team) || "*";
    var down = clean(situation.down || "*");
    var distance = clean(situation.distanceBucket || situation.distBucket || "*").toLowerCase() || "*";
    var formation = key(offense.formation || "*") || "*";
    var set = key(offense.set || "*") || "*";
    if (mode === "global") return ["*", "*", "*", "*", "*"].join("|");
    if (mode === "formation") return [opponent, "*", "*", formation, "*"].join("|");
    return [opponent, down, distance, formation, set].join("|");
  }

  function updateCountStat(previous, event) {
    var stat = Object.assign({ observations: 0, lastSeenAt: 0 }, previous || {});
    stat.observations += 1;
    stat.lastSeenAt = Number(event.at) || Date.now();
    return stat;
  }

  function updateEffectivenessStat(previous, event) {
    var outcome = event.outcome || {};
    var stat = Object.assign({
      observations: 0,
      successes: 0,
      failures: 0,
      unknowns: 0,
      yardsAllowed: 0,
      pointsAllowed: 0,
      turnovers: 0,
      lastSeenAt: 0,
    }, previous || {});
    stat.observations += 1;
    if (outcome.successfulDefense === true) stat.successes += 1;
    else if (outcome.successfulDefense === false) stat.failures += 1;
    else stat.unknowns += 1;
    if (Number.isFinite(Number(outcome.yardsAllowed))) stat.yardsAllowed += Number(outcome.yardsAllowed);
    if (Number.isFinite(Number(outcome.pointsAllowed))) stat.pointsAllowed += Number(outcome.pointsAllowed);
    if (outcome.turnover === true) stat.turnovers += 1;
    stat.lastSeenAt = Number(event.at) || Date.now();
    return stat;
  }

  function bumpTendencyContext(next, contextKey, offensePlayKey, event) {
    var context = Object.assign({ observations: 0, plays: {} }, next.opponentTendency.byContext[contextKey] || {});
    context.plays = cloneMap(context.plays);
    context.observations += 1;
    if (offensePlayKey && offensePlayKey !== "UNKNOWN") {
      context.plays[offensePlayKey] = updateCountStat(context.plays[offensePlayKey], event);
    }
    next.opponentTendency.byContext[contextKey] = context;
  }

  function appendLearningEvent(snapshot, event) {
    var current = snapshot || emptyLearningSnapshot();
    var e = event || {};
    var eventId = clean(e.id || e.eventId || (e.snap && e.snap.id));
    if (!eventId) return { snapshot: current, appended: false, reason: "event_id_required" };
    if (current.appliedEventIds && current.appliedEventIds[eventId]) {
      return { snapshot: current, appended: false, duplicate: true };
    }
    var previousGlobal = current.defensiveEffectiveness && current.defensiveEffectiveness.global;
    var previousMatchups = Array.isArray(current.recentMatchups) ? current.recentMatchups.slice() : [];
    var next = {
      version: 1,
      opponentTendency: {
        observations: Number(current.opponentTendency && current.opponentTendency.observations) || 0,
        byContext: cloneMap(current.opponentTendency && current.opponentTendency.byContext),
      },
      defensiveEffectiveness: {
        observations: Number(current.defensiveEffectiveness && current.defensiveEffectiveness.observations) || 0,
        byPlay: cloneMap(current.defensiveEffectiveness && current.defensiveEffectiveness.byPlay),
        byPackage: cloneMap(current.defensiveEffectiveness && current.defensiveEffectiveness.byPackage),
        byFormation: cloneMap(current.defensiveEffectiveness && current.defensiveEffectiveness.byFormation),
        global: Object.assign({
          observations: 0,
          successes: 0,
          failures: 0,
          unknowns: 0,
          yardsAllowed: 0,
          pointsAllowed: 0,
          turnovers: 0,
        }, previousGlobal || {}),
      },
      recentMatchups: previousMatchups,
      appliedEventIds: cloneMap(current.appliedEventIds),
    };
    var offense = e.offense || {};
    var offensePlayKey = key(offense.playId || offense.playName || "");
    if (!offensePlayKey || offensePlayKey === "UNKNOWN") offensePlayKey = "";
    var exactKey = tendencyContextKey(e, { mode: "exact" });
    var formationKey = tendencyContextKey(e, { mode: "formation" });
    var globalKey = tendencyContextKey(e, { mode: "global" });
    bumpTendencyContext(next, exactKey, offensePlayKey, e);
    bumpTendencyContext(next, formationKey, offensePlayKey, e);
    bumpTendencyContext(next, globalKey, offensePlayKey, e);
    next.opponentTendency.observations += 1;

    var defense = e.defense || {};
    var outcome = e.outcome || {};
    if (outcome.learnable === true) {
      var playId = clean(defense.playId || defense.id);
      var packageKey = key(defense.packageKey || [defense.formation, defense.set].filter(Boolean).join("|"));
      var formationOnly = key(defense.formationKey || defense.formation);
      if (playId) next.defensiveEffectiveness.byPlay[playId] =
        updateEffectivenessStat(next.defensiveEffectiveness.byPlay[playId], e);
      if (packageKey) next.defensiveEffectiveness.byPackage[packageKey] =
        updateEffectivenessStat(next.defensiveEffectiveness.byPackage[packageKey], e);
      if (formationOnly) next.defensiveEffectiveness.byFormation[formationOnly] =
        updateEffectivenessStat(next.defensiveEffectiveness.byFormation[formationOnly], e);
      next.defensiveEffectiveness.global = updateEffectivenessStat(next.defensiveEffectiveness.global, e);
      if (playId || packageKey || formationOnly) next.defensiveEffectiveness.observations += 1;
      var matchup = buildMatchupRecord(e);
      if (matchup) {
        next.recentMatchups = previousMatchups.concat([matchup]).slice(-24);
      }
    }
    next.appliedEventIds[eventId] = true;
    return {
      snapshot: next,
      appended: true,
      tendencyContextKey: exactKey,
      tendencyKeys: { exact: exactKey, formation: formationKey, global: globalKey },
    };
  }

  function projectEvents(events, initial) {
    return (Array.isArray(events) ? events : []).reduce(function (snapshot, event) {
      return appendLearningEvent(snapshot, event).snapshot;
    }, initial || emptyLearningSnapshot());
  }

  return {
    emptyLearningSnapshot: emptyLearningSnapshot,
    tendencyContextKey: tendencyContextKey,
    inferCoverageFamilyFromDefense: inferCoverageFamilyFromDefense,
    buildMatchupRecord: buildMatchupRecord,
    appendLearningEvent: appendLearningEvent,
    appendEventProjection: appendLearningEvent,
    projectEvents: projectEvents,
  };
});
