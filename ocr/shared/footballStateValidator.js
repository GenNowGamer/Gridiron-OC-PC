(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironOcrFootballStateValidator = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function number(value) {
    // Number(null) === 0 and Number("") === 0 in JS — treat missing OCR as null,
    // not an out-of-range down that wrongly un-accepts sibling HUD fields.
    if (value == null || value === "") return null;
    if (typeof value === "boolean") return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizedState(input) {
    var source = input || {};
    return {
      quarter: number(source.quarter),
      clockSeconds: number(source.clockSeconds != null ? source.clockSeconds : source.clock),
      down: number(source.down),
      yardsToGo: number(source.yardsToGo != null ? source.yardsToGo : source.yards),
      homeScore: number(source.homeScore),
      awayScore: number(source.awayScore),
      possession: String(source.possession || "").trim().toUpperCase(),
      playClock: number(source.playClock),
    };
  }

  function validateState(state) {
    var s = normalizedState(state);
    var reasons = [];
    if (s.quarter != null && (s.quarter < 1 || s.quarter > 5)) reasons.push("quarter_out_of_range");
    if (s.clockSeconds != null && (s.clockSeconds < 0 || s.clockSeconds > 900)) reasons.push("clock_out_of_range");
    if (s.down != null && (s.down < 1 || s.down > 4)) reasons.push("down_out_of_range");
    if (s.yardsToGo != null && (s.yardsToGo < 0 || s.yardsToGo > 99)) reasons.push("distance_out_of_range");
    if (s.homeScore != null && s.homeScore < 0) reasons.push("home_score_negative");
    if (s.awayScore != null && s.awayScore < 0) reasons.push("away_score_negative");
    return { valid: reasons.length === 0, reasons: reasons, state: s };
  }

  function validateTransition(previous, next, options) {
    var cfg = options || {};
    var before = normalizedState(previous);
    var afterCheck = validateState(next);
    var after = afterCheck.state;
    var reasons = afterCheck.reasons.slice();
    var warnings = [];
    var scoreChanged = (after.homeScore != null && before.homeScore != null && after.homeScore !== before.homeScore) ||
      (after.awayScore != null && before.awayScore != null && after.awayScore !== before.awayScore);
    if (after.quarter != null && before.quarter != null) {
      if (after.quarter < before.quarter) reasons.push("quarter_moved_backward");
      if (after.quarter > before.quarter + 1) reasons.push("quarter_skipped");
    }
    if (after.homeScore != null && before.homeScore != null && after.homeScore < before.homeScore) reasons.push("home_score_decreased");
    if (after.awayScore != null && before.awayScore != null && after.awayScore < before.awayScore) reasons.push("away_score_decreased");
    if (after.quarter === before.quarter && after.clockSeconds != null && before.clockSeconds != null &&
        after.clockSeconds > before.clockSeconds + (Number(cfg.clockToleranceSeconds) || 2)) {
      reasons.push("game_clock_increased");
    }
    if (after.quarter != null && before.quarter != null && after.quarter > before.quarter &&
        after.clockSeconds != null && after.clockSeconds < 600) warnings.push("new_quarter_clock_unusual");
    if (after.down != null && before.down != null && after.down > before.down + 1 && !scoreChanged) {
      reasons.push("down_skipped");
    }
    if (after.down === 1 && before.down === 1 && after.possession && before.possession &&
        after.possession === before.possession && !scoreChanged) warnings.push("first_down_repeated");
    if (after.possession && before.possession && after.possession !== before.possession && after.down != null && after.down !== 1) {
      warnings.push("possession_change_without_first_down");
    }
    return {
      accepted: reasons.length === 0,
      valid: reasons.length === 0,
      reasons: reasons,
      warnings: warnings,
      previous: before,
      next: after,
      flags: {
        scoreChanged: scoreChanged,
        possessionChanged: !!(before.possession && after.possession && before.possession !== after.possession),
        quarterChanged: before.quarter != null && after.quarter != null && before.quarter !== after.quarter,
      },
    };
  }

  return {
    normalizeFootballState: normalizedState,
    validateState: validateState,
    validateTransition: validateTransition,
    validateFootballTransition: validateTransition,
  };
});
