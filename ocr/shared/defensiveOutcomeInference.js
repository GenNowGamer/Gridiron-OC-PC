(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironOcrDefensiveOutcomeInference = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function num(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function score(state, side) {
    return num(state && state[side === "home" ? "homeScore" : "awayScore"]);
  }

  // Single-play OCR field deltas beyond this are almost always side/yardline errors.
  // Distance-based yards and coach-entered yardsGained are not capped here.
  var MAX_PLAUSIBLE_PLAY_YARDS = 40;
  // Territory side flips mid-snap usually mean OWN/OPP misreads, not real gains.
  var MAX_SIDE_FLIP_TRUST_YARDS = 12;

  function normalizeFieldSide(state) {
    var side = String(state && (state.fieldSide || state.side || "") || "").toUpperCase();
    if (side === "OWN" || side === "OWN_TERRITORY") return "OWN";
    if (side === "OPP" || side === "OPP_TERRITORY" || side === "RED_ZONE") return "OPP";
    if (side === "MIDFIELD") return "MIDFIELD";
    return "";
  }

  function absoluteFieldYard(state) {
    var side = normalizeFieldSide(state);
    var yardLine = num(state && (state.fieldYardLine != null ? state.fieldYardLine : state.yardLine));
    if (!Number.isFinite(yardLine) || yardLine < 1 || yardLine > 50) return null;
    if (yardLine === 50 || side === "MIDFIELD") return 50;
    if (side === "OWN") return yardLine;
    if (side === "OPP") return 100 - yardLine;
    return null;
  }

  function isPlausiblePlayYardDelta(yards, before, after) {
    if (!Number.isFinite(yards)) return false;
    if (Math.abs(yards) >= MAX_PLAUSIBLE_PLAY_YARDS) return false;
    var beforeSide = normalizeFieldSide(before);
    var afterSide = normalizeFieldSide(after);
    if (beforeSide && afterSide && beforeSide !== afterSide && Math.abs(yards) > MAX_SIDE_FLIP_TRUST_YARDS) {
      return false;
    }
    return true;
  }

  function inferDefensiveOutcome(input, options) {
    var cfg = options || {};
    var source = input || {};
    var before = source.before || source.preState || {};
    var after = source.after || source.postState || {};
    var defenseSide = String(source.defenseSide || cfg.defenseSide || "").toLowerCase();
    var offenseSide = defenseSide === "home" ? "away" : defenseSide === "away" ? "home" : "";
    var result = {
      kind: "unknown",
      confidence: 0,
      learnable: false,
      pointsAllowed: null,
      yardsAllowed: null,
      successfulDefense: null,
      turnover: false,
      firstDownAllowed: null,
      evidence: [],
      driveStart: source.driveStart === true,
    };
    if (source.driveStart === true) {
      result.kind = "drive_start";
      result.confidence = 1;
      result.learnable = false;
      result.evidence.push("drive_start");
      return result;
    }
    var beforePossession = String(before.possession || "").toUpperCase();
    var afterPossession = String(after.possession || "").toUpperCase();
    var possessionChanged = !!(beforePossession && afterPossession && beforePossession !== afterPossession);
    var scoreDelta = offenseSide ? score(after, offenseSide) - score(before, offenseSide) : null;
    if (Number.isFinite(scoreDelta) && scoreDelta > 0) {
      result.kind = scoreDelta === 3 ? "field_goal_allowed" : scoreDelta >= 6 ? "touchdown_allowed" : "score_allowed";
      result.confidence = 0.98;
      result.pointsAllowed = scoreDelta;
      result.successfulDefense = false;
      result.learnable = true;
      result.evidence.push("opponent_score_increased");
      return result;
    }
    if (possessionChanged) {
      result.kind = "turnover_or_drive_end";
      result.confidence = 0.82;
      result.turnover = true;
      result.successfulDefense = true;
      result.learnable = source.driveEnded === true || source.turnoverSignal === true;
      result.evidence.push("possession_changed");
      if (source.turnoverSignal === true) {
        result.kind = "turnover";
        result.confidence = 0.96;
      }
      return result;
    }
    var beforeDown = num(before.down);
    var afterDown = num(after.down);
    var beforeDistance = num(before.yardsToGo != null ? before.yardsToGo : before.yards);
    var afterDistance = num(after.yardsToGo != null ? after.yardsToGo : after.yards);
    var explicitYards = num(source.yardsGained);
    var yards = explicitYards;
    if (yards == null && beforeDistance != null && afterDistance != null && afterDown === beforeDown + 1) {
      yards = beforeDistance - afterDistance;
      result.evidence.push("distance_delta");
    }
    if (yards == null) {
      var beforeAbs = absoluteFieldYard(before);
      var afterAbs = absoluteFieldYard(after);
      if (beforeAbs != null && afterAbs != null) {
        var fieldYards = afterAbs - beforeAbs;
        if (isPlausiblePlayYardDelta(fieldYards, before, after)) {
          yards = fieldYards;
          result.evidence.push("field_position_delta");
        } else {
          result.evidence.push("field_position_delta_rejected");
        }
      }
    }
    result.yardsAllowed = yards;
    if (afterDown === 1 && beforeDown != null && beforeDown !== 1) {
      result.kind = "first_down_allowed";
      result.confidence = explicitYards != null ? 0.94 : (yards != null ? 0.86 : 0.8);
      result.firstDownAllowed = true;
      result.successfulDefense = false;
      result.learnable = true;
      result.evidence.push("down_reset");
    } else if (beforeDown != null && afterDown === beforeDown + 1 && yards != null) {
      result.firstDownAllowed = false;
      result.successfulDefense = yards <= Math.max(3, beforeDistance == null ? 3 : beforeDistance * 0.45);
      result.kind = yards < 0 ? "negative_play" : result.successfulDefense ? "stop" : "gain_allowed";
      result.confidence = explicitYards != null ? 0.93 : 0.78;
      result.learnable = true;
      result.evidence.push("down_advanced");
    } else if (yards != null && beforeDown != null && afterDown != null) {
      result.firstDownAllowed = false;
      result.successfulDefense = yards <= Math.max(3, beforeDistance == null ? 3 : beforeDistance * 0.45);
      result.kind = yards < 0 ? "negative_play" : result.successfulDefense ? "stop" : "gain_allowed";
      result.confidence = 0.72;
      result.learnable = true;
      result.evidence.push("yardage_inferred");
    }
    if (source.sackSignal === true && yards != null && yards < 0) {
      result.kind = "sack";
      result.confidence = 0.98;
      result.successfulDefense = true;
      result.learnable = true;
      result.evidence.push("explicit_sack_signal");
    }
    if (result.confidence < (Number(cfg.minConfidence) || 0.72)) result.learnable = false;
    return result;
  }

  return {
    inferDefensiveOutcome: inferDefensiveOutcome,
    inferOutcome: inferDefensiveOutcome,
    absoluteFieldYard: absoluteFieldYard,
    isPlausiblePlayYardDelta: isPlausiblePlayYardDelta,
    MAX_PLAUSIBLE_PLAY_YARDS: MAX_PLAUSIBLE_PLAY_YARDS,
  };
});
