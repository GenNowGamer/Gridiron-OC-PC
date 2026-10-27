(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironGameplan = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CELL_IDS = ["goal_line", "red_zone", "backed_up", "third_long", "third_medium", "third_short", "second_long", "early_down"];
  var CELL_LABELS = {
    goal_line: "Goal line",
    red_zone: "Red zone",
    backed_up: "Backed up",
    third_long: "3rd and long",
    third_medium: "3rd and medium",
    third_short: "3rd and short",
    second_long: "2nd and long",
    early_down: "Early down",
  };
  var DISPLAY_ORDER = ["early_down", "second_long", "third_short", "third_medium", "third_long", "backed_up", "red_zone", "goal_line"];
  var CONCEPTS = [
    ["", "None"],
    ["inside_zone", "Inside zone"],
    ["split_zone", "Split zone"],
    ["duo_power", "Duo / power"],
    ["dive", "Dive"],
    ["trap", "Trap"],
    ["iso", "Iso"],
    ["wide_zone", "Wide zone"],
    ["jet", "Jet"],
    ["counter", "Counter"],
    ["read_option", "Read option"],
    ["draw", "Draw"],
    ["rpo", "RPO"],
    ["quick_game", "Quick game"],
    ["curl_flat", "Curl / flat"],
    ["snag_spot", "Snag / spot"],
    ["man_beat", "Mesh / man beater"],
    ["screen", "Screen"],
    ["levels_dig", "Levels / dig"],
    ["flood", "Flood"],
    ["smash", "Smash"],
    ["boot", "Boot"],
    ["leak", "Leak"],
    ["shot", "Shot"],
    ["verticals", "Verticals"],
    ["redzone_pass", "Red zone pass"],
  ];
  var CONCEPT_IDS = {};
  CONCEPTS.forEach(function (entry) { CONCEPT_IDS[entry[0]] = true; });

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function emptyCell() {
    return { concept: "", backup: "", pinnedPlayId: "", note: "", locked: false };
  }

  function emptyOffense() {
    var offense = {};
    CELL_IDS.forEach(function (id) { offense[id] = emptyCell(); });
    return offense;
  }

  function planKey(edition, team, opponent) {
    var ver = clean(edition).toUpperCase() === "M26" ? "M26" : "M27";
    return [ver, clean(team).toUpperCase(), clean(opponent).toUpperCase()].join("|");
  }

  function conceptOrEmpty(value) {
    var key = clean(value);
    return CONCEPT_IDS[key] ? key : "";
  }

  function normalizeCell(value) {
    var cell = value || {};
    return {
      concept: conceptOrEmpty(cell.concept),
      backup: conceptOrEmpty(cell.backup),
      pinnedPlayId: clean(cell.pinnedPlayId),
      note: clean(cell.note).slice(0, 240),
      locked: cell.locked === true,
    };
  }

  function normalizePlan(value) {
    var source = value || {};
    var edition = clean(source.maddenEdition).toUpperCase() === "M26" ? "M26" : "M27";
    var script = source.openingScript || {};
    var playIds = (Array.isArray(script.playIds) ? script.playIds : []).map(clean).filter(Boolean).slice(0, 15);
    var lockedIndexes = [];
    (Array.isArray(script.lockedIndexes) ? script.lockedIndexes : []).forEach(function (index) {
      var number = Number(index);
      if (!Number.isInteger(number) || number < 0 || number >= 15 || lockedIndexes.indexOf(number) >= 0) return;
      lockedIndexes.push(number);
    });
    var offense = emptyOffense();
    CELL_IDS.forEach(function (id) {
      offense[id] = normalizeCell(source.offense && source.offense[id]);
    });
    return {
      version: 1,
      maddenEdition: edition,
      team: clean(source.team).toUpperCase(),
      opponent: clean(source.opponent).toUpperCase(),
      context: "any",
      openingScript: {
        playIds: playIds,
        lockedIndexes: lockedIndexes.sort(function (a, b) { return a - b; }),
        active: script.active === true,
      },
      offense: offense,
    };
  }

  function createPlan(meta) {
    return normalizePlan(meta || {});
  }

  function resolveOffenseCell(input) {
    var situation = clean(input && input.situationBucket);
    var field = clean(input && input.fieldPositionBucket);
    if (situation.indexOf("goal_to_go") === 0 || field === "goal_to_go") return "goal_line";
    if (field === "red_zone" || field === "high_red_zone") return "red_zone";
    if (field === "backed_up") return "backed_up";
    if (situation === "third_long" || situation === "third_very_long" || situation === "fourth_medium_plus") return "third_long";
    if (situation === "third_medium") return "third_medium";
    if (situation === "third_short" || situation === "fourth_short") return "third_short";
    if (situation === "second_long" || situation === "second_very_long") return "second_long";
    return "early_down";
  }

  function cellLabel(cellId) {
    return CELL_LABELS[cellId] || "Early down";
  }

  function resolvePlayId(playId, plays) {
    var id = clean(playId);
    if (!id) return { play: null, unavailable: false };
    var play = (Array.isArray(plays) ? plays : []).find(function (item) {
      return item && item.id === id;
    }) || null;
    return play ? { play: play, unavailable: false } : { play: null, unavailable: true };
  }

  function shouldBypassLockedRun(params) {
    var input = params || {};
    if (input.locked !== true) return false;
    var type = clean(input.type).toUpperCase();
    if (type !== "RUN" && type !== "RPO") return false;
    var down = Number(input.down);
    var yards = Number(input.yards);
    return down >= 3 && Number.isFinite(yards) && yards >= 10;
  }

  function planAdjustment(play, cell, familyOf) {
    if (!play || !cell) return 0;
    var family = familyOf ? familyOf(play) : "";
    var score = 0;
    if (cell.concept && family === cell.concept) score += 4;
    else if (cell.backup && family === cell.backup) score += 2;
    if (cell.pinnedPlayId && play.id === cell.pinnedPlayId) score += 6;
    return Math.min(6, score);
  }

  return {
    CELL_IDS: CELL_IDS.slice(),
    DISPLAY_ORDER: DISPLAY_ORDER.slice(),
    CONCEPTS: CONCEPTS.map(function (entry) { return entry.slice(); }),
    planKey: planKey,
    createPlan: createPlan,
    normalizePlan: normalizePlan,
    emptyCell: emptyCell,
    resolveOffenseCell: resolveOffenseCell,
    cellLabel: cellLabel,
    resolvePlayId: resolvePlayId,
    shouldBypassLockedRun: shouldBypassLockedRun,
    planAdjustment: planAdjustment,
  };
});
