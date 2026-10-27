(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironOpponentTendency = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MIN_SNAPS = 4;
  var MIN_SHARE = 0.4;
  var MIN_RESULT_ATTEMPTS = 3;
  var SHRINK_ATTEMPTS = 2;
  var MAX_PROFILES = 64;
  var MAX_PLAYS_PER_CELL = 48;
  var CELL_IDS = ["goal_line", "red_zone", "backed_up", "third_long", "third_medium", "third_short", "second_long", "early_down"];
  var SHELLS = ["Blitz", "Man", "Cover 1", "Cover 2", "Cover 3", "Cover 4", "Cover 6", "Cover 9", "Tampa 2"];
  var SHELL_COUNTERS = {
    "Cover 3": ["flood", "quick_game", "boot", "inside_zone", "curl_flat"],
    "Cover 2": ["shot", "verticals", "smash", "levels_dig"],
    "Cover 4": ["inside_zone", "duo_power", "wide_zone", "levels_dig", "curl_flat"],
    "Cover 1": ["man_beat", "quick_game", "snag_spot", "jet"],
    "Man": ["man_beat", "quick_game", "snag_spot", "screen"],
    "Cover 6": ["man_beat", "levels_dig", "quick_game", "counter"],
    "Tampa 2": ["shot", "verticals", "smash", "flood"],
    "Blitz": ["quick_game", "screen", "draw", "inside_zone", "leak"],
    "Cover 9": ["boot", "quick_game", "screen", "curl_flat", "inside_zone"],
  };
  var RUN_FAMILIES = {
    inside_zone: true, split_zone: true, duo_power: true, dive: true, trap: true, iso: true,
    wide_zone: true, jet: true, counter: true, read_option: true, draw: true,
  };
  var PASS_FAMILIES = {
    quick_game: true, curl_flat: true, snag_spot: true, man_beat: true, screen: true, levels_dig: true,
    flood: true, smash: true, boot: true, leak: true, shot: true, verticals: true, rpo: true, redzone_pass: true,
  };
  var SLOT_ROLES = ["run", "pass", "run", "run", "pass", "pass", "either", "pass", "run", "pass", "pass", "run", "pass", "pass", "either"];

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizeContext(value) {
    return clean(value).toLowerCase() === "human" ? "human" : "cpu";
  }

  function profileKey(opponent, context) {
    var team = clean(opponent).toUpperCase();
    if (!team) return "";
    return team + "|" + normalizeContext(context);
  }

  function emptyCell() {
    return { looks: {}, concepts: {}, plays: {} };
  }

  function emptyCells() {
    var cells = {};
    CELL_IDS.forEach(function (id) { cells[id] = emptyCell(); });
    return cells;
  }

  function knownShell(value) {
    var shell = clean(value);
    return SHELLS.indexOf(shell) >= 0 ? shell : "";
  }

  function knownCell(value) {
    var cellId = clean(value);
    return CELL_IDS.indexOf(cellId) >= 0 ? cellId : "";
  }

  function emptyStore() {
    return { byKey: {} };
  }

  function normalizeStat(value) {
    var stat = value || {};
    return {
      attempts: Math.max(0, Number(stat.attempts) || 0),
      successPoints: Number(stat.successPoints) || 0,
      yards: Number(stat.yards) || 0,
    };
  }

  function normalizeCell(value) {
    var source = value || {};
    var looks = {};
    Object.entries(source.looks || {}).forEach(function (entry) {
      var shell = knownShell(entry[0]);
      var snaps = Math.max(0, Number(entry[1] && entry[1].snaps) || 0);
      if (!shell || snaps <= 0) return;
      looks[shell] = { snaps: snaps };
    });
    var concepts = {};
    Object.entries(source.concepts || {}).forEach(function (entry) {
      var family = clean(entry[0]);
      var stat = normalizeStat(entry[1]);
      if (!family || stat.attempts <= 0) return;
      concepts[family] = stat;
    });
    var plays = {};
    Object.entries(source.plays || {}).forEach(function (entry) {
      var playId = clean(entry[0]);
      var stat = normalizeStat(entry[1]);
      if (!playId || stat.attempts <= 0) return;
      plays[playId] = stat;
    });
    var playIds = Object.keys(plays).sort(function (a, b) {
      return plays[b].attempts - plays[a].attempts || a.localeCompare(b);
    }).slice(0, MAX_PLAYS_PER_CELL);
    var trimmedPlays = {};
    playIds.forEach(function (id) { trimmedPlays[id] = plays[id]; });
    return { looks: looks, concepts: concepts, plays: trimmedPlays };
  }

  function normalizeProfile(value, key) {
    var source = value || {};
    var parts = String(key || "").split("|");
    var cells = emptyCells();
    CELL_IDS.forEach(function (id) {
      cells[id] = normalizeCell(source.cells && source.cells[id]);
    });
    return {
      updatedAt: Number(source.updatedAt) || 0,
      opponent: clean(source.opponent).toUpperCase() || parts[0] || "",
      context: normalizeContext(source.context || parts[1]),
      cells: cells,
    };
  }

  function normalizeStore(value) {
    var source = value && value.byKey ? value : emptyStore();
    var entries = Object.entries(source.byKey || {}).map(function (entry) {
      return [entry[0], normalizeProfile(entry[1], entry[0])];
    }).filter(function (entry) {
      return profileKey(entry[1].opponent, entry[1].context) === entry[0];
    }).sort(function (a, b) {
      return (b[1].updatedAt || 0) - (a[1].updatedAt || 0) || a[0].localeCompare(b[0]);
    }).slice(0, MAX_PROFILES);
    return { byKey: Object.fromEntries(entries) };
  }

  function ensureProfile(store, opponent, context) {
    var key = profileKey(opponent, context);
    var next = normalizeStore(store);
    if (!key) return { store: next, key: "" };
    if (!next.byKey[key]) {
      next.byKey[key] = normalizeProfile({
        updatedAt: Date.now(),
        opponent: clean(opponent).toUpperCase(),
        context: normalizeContext(context),
        cells: emptyCells(),
      }, key);
    }
    return { store: next, key: key };
  }

  function profileFor(store, opponent, context) {
    var key = profileKey(opponent, context);
    var next = normalizeStore(store);
    return key && next.byKey[key] ? next.byKey[key] : null;
  }

  function recordLook(store, input) {
    var request = input || {};
    var shell = knownShell(request.shell);
    var cellId = knownCell(request.cellId);
    var ensured = ensureProfile(store, request.opponent, request.context);
    if (!ensured.key || !shell || !cellId) return ensured.store;
    var profile = ensured.store.byKey[ensured.key];
    var looks = profile.cells[cellId].looks;
    var current = looks[shell] || { snaps: 0 };
    looks[shell] = { snaps: current.snaps + 1 };
    profile.updatedAt = Date.now();
    return ensured.store;
  }

  function revertLook(store, input) {
    var request = input || {};
    var shell = knownShell(request.shell);
    var cellId = knownCell(request.cellId);
    var next = normalizeStore(store);
    var key = profileKey(request.opponent, request.context);
    var profile = key ? next.byKey[key] : null;
    if (!profile || !shell || !cellId || !profile.cells[cellId].looks[shell]) return next;
    var snaps = profile.cells[cellId].looks[shell].snaps - 1;
    if (snaps > 0) profile.cells[cellId].looks[shell] = { snaps: snaps };
    else delete profile.cells[cellId].looks[shell];
    profile.updatedAt = Date.now();
    return next;
  }

  function addResult(bucket, id, outcome) {
    var key = clean(id);
    if (!key) return;
    var current = bucket[key] || { attempts: 0, successPoints: 0, yards: 0 };
    current.attempts += 1;
    current.successPoints += Number(outcome && outcome.successPoints) || 0;
    if (Number.isFinite(Number(outcome && outcome.yards))) current.yards += Number(outcome.yards);
    bucket[key] = current;
  }

  function recordOutcome(store, input) {
    var request = input || {};
    var cellId = knownCell(request.cellId);
    var ensured = ensureProfile(store, request.opponent, request.context);
    if (!ensured.key || !cellId || !clean(request.playId) && !clean(request.family)) return ensured.store;
    var cell = ensured.store.byKey[ensured.key].cells[cellId];
    addResult(cell.concepts, request.family, request);
    addResult(cell.plays, request.playId, request);
    cell.plays = normalizeCell(cell).plays;
    ensured.store.byKey[ensured.key].updatedAt = Date.now();
    return ensured.store;
  }

  function readiness(cell) {
    var source = cell || emptyCell();
    var entries = Object.entries(source.looks || {}).map(function (entry) {
      return [entry[0], Number(entry[1] && entry[1].snaps) || 0];
    }).filter(function (entry) {
      return entry[1] > 0;
    }).sort(function (a, b) {
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    });
    var total = entries.reduce(function (sum, entry) { return sum + entry[1]; }, 0);
    var primary = entries[0] || null;
    var share = primary && total ? primary[1] / total : 0;
    return {
      ready: total >= MIN_SNAPS && share >= MIN_SHARE,
      total: total,
      primary: primary ? primary[0] : "",
      primarySnaps: primary ? primary[1] : 0,
      share: share,
      secondary: entries[1] ? entries[1][0] : "",
    };
  }

  function shrunk(stat) {
    var attempts = Number(stat && stat.attempts) || 0;
    if (attempts <= 0) return 0;
    var average = (Number(stat.successPoints) || 0) / attempts;
    var weight = attempts / (attempts + SHRINK_ATTEMPTS);
    if (attempts < MIN_RESULT_ATTEMPTS) weight *= 0.35;
    return average * weight;
  }

  function rankFamilies(shell, conceptStats) {
    var counters = SHELL_COUNTERS[shell] || [];
    var ranked = counters.map(function (family, index) {
      return { family: family, score: Math.max(0, 4 - index) + shrunk(conceptStats && conceptStats[family]) * 2 };
    });
    Object.keys(conceptStats || {}).forEach(function (family) {
      if (counters.indexOf(family) >= 0) return;
      var stat = conceptStats[family];
      if (!stat || stat.attempts < MIN_RESULT_ATTEMPTS) return;
      ranked.push({ family: family, score: shrunk(stat) * 2 });
    });
    return ranked.sort(function (a, b) {
      return b.score - a.score || a.family.localeCompare(b.family);
    });
  }

  function suggestConcepts(cell) {
    var info = readiness(cell);
    if (!info.ready) return null;
    var primaryRank = rankFamilies(info.primary, cell && cell.concepts);
    var concept = primaryRank[0] ? primaryRank[0].family : "";
    if (!concept) return null;
    var backupSource = info.secondary ? rankFamilies(info.secondary, cell && cell.concepts) : primaryRank;
    var backup = "";
    backupSource.some(function (item) {
      if (item.family && item.family !== concept) {
        backup = item.family;
        return true;
      }
      return false;
    });
    return {
      concept: concept,
      backup: backup,
      primary: info.primary,
      secondary: info.secondary,
      total: info.total,
      share: info.share,
    };
  }

  function familiesForRole(shell, role) {
    return (SHELL_COUNTERS[shell] || []).filter(function (family) {
      if (role === "run") return !!RUN_FAMILIES[family];
      if (role === "pass") return !!PASS_FAMILIES[family];
      return true;
    });
  }

  function scriptCellForSlot(profile, slotIndex) {
    var order = slotIndex === 14
      ? ["red_zone", "goal_line", "early_down"]
      : slotIndex === 13
        ? ["third_long", "third_medium", "early_down"]
        : ["early_down"];
    var found = "";
    order.some(function (cellId) {
      if (profile && profile.cells && readiness(profile.cells[cellId]).ready) {
        found = cellId;
        return true;
      }
      return false;
    });
    return found;
  }

  function scriptSlotPlan(profile) {
    var slotFamilies = [];
    var slotCells = [];
    for (var index = 0; index < SLOT_ROLES.length; index += 1) {
      var cellId = scriptCellForSlot(profile, index);
      slotCells.push(cellId);
      if (!cellId) {
        slotFamilies.push(null);
        continue;
      }
      var info = readiness(profile.cells[cellId]);
      var families = familiesForRole(info.primary, SLOT_ROLES[index]);
      slotFamilies.push(families.length ? families : null);
    }
    return { slotFamilies: slotFamilies, slotCells: slotCells };
  }

  function playResultBoost(profile, cellId, playId) {
    var id = knownCell(cellId);
    var play = clean(playId);
    if (!profile || !id || !play || !profile.cells || !profile.cells[id]) return 0;
    var stat = profile.cells[id].plays[play];
    if (!stat || stat.attempts < MIN_RESULT_ATTEMPTS) return 0;
    return shrunk(stat);
  }

  function cellSummary(profile, cellId) {
    var id = knownCell(cellId);
    if (!profile || !id || !profile.cells) return "";
    var info = readiness(profile.cells[id]);
    if (!info.total) return "";
    if (!info.primary) return info.total + " snaps logged";
    var share = Math.round(info.share * 100);
    if (info.ready) return info.primary + " " + share + "% · " + info.total + " snaps";
    return info.total + " snaps · " + info.primary + " " + share + "%";
  }

  return {
    MIN_SNAPS: MIN_SNAPS,
    MIN_SHARE: MIN_SHARE,
    MIN_RESULT_ATTEMPTS: MIN_RESULT_ATTEMPTS,
    CELL_IDS: CELL_IDS.slice(),
    emptyStore: emptyStore,
    normalizeStore: normalizeStore,
    profileKey: profileKey,
    profileFor: profileFor,
    recordLook: recordLook,
    revertLook: revertLook,
    recordOutcome: recordOutcome,
    readiness: readiness,
    suggestConcepts: suggestConcepts,
    scriptSlotPlan: scriptSlotPlan,
    playResultBoost: playResultBoost,
    cellSummary: cellSummary,
  };
});
