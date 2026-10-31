(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironSituationBoard = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var OC_SLOTS = [
    { id: "first_med", label: "1st & med", side: "oc", families: ["inside_zone", "split_zone", "duo_power", "quick_game", "boot", "dive", "iso", "wide_zone", "counter", "rpo", "screen", "read_option", "trap"] },
    { id: "second_med", label: "2nd & med", side: "oc", families: ["inside_zone", "duo_power", "quick_game", "curl_flat", "counter", "smash", "snag_spot"] },
    { id: "second_long", label: "2nd & long", side: "oc", families: ["quick_game", "levels_dig", "curl_flat", "flood", "draw", "screen", "counter", "shot", "verticals"] },
    { id: "third_med", label: "3rd & med", side: "oc", families: ["quick_game", "curl_flat", "snag_spot", "levels_dig", "smash"] },
    { id: "third_long", label: "3rd & long", side: "oc", families: ["quick_game", "levels_dig", "curl_flat", "snag_spot", "flood", "shot", "verticals", "screen", "man_beat"] },
    { id: "fourth_short", label: "4th & short", side: "oc", families: ["duo_power", "inside_zone", "dive", "iso", "rpo", "quick_game"] },
    { id: "backed_up", label: "Backed up", side: "oc", families: ["quick_game", "inside_zone", "duo_power", "dive"] },
    { id: "red_zone", label: "Red zone", side: "oc", families: ["duo_power", "inside_zone", "smash", "snag_spot", "boot", "rpo", "redzone_pass", "quick_game", "shot", "verticals", "man_beat", "curl_flat"] },
    { id: "goal_line", label: "Goal line", side: "oc", families: ["duo_power", "dive", "iso", "inside_zone", "rpo", "redzone_pass", "quick_game", "shot", "verticals"] },
    { id: "blitz_beater", label: "Blitz beater", side: "oc", families: ["quick_game", "screen", "draw", "man_beat"] },
    { id: "man_beater", label: "Man beater", side: "oc", families: ["man_beat", "screen", "snag_spot"] },
    { id: "cover3_beater", label: "Cover 3 beater", side: "oc", families: ["flood", "curl_flat", "quick_game", "snag_spot", "levels_dig", "boot"] },
    { id: "shot", label: "Shot", side: "oc", families: ["shot", "verticals", "hail_mary"] },
    { id: "quick_game", label: "Quick game", side: "oc", families: ["quick_game", "curl_flat", "snag_spot"] },
    { id: "play_action", label: "PA / motion", side: "oc", families: ["boot", "flood", "leak", "jet", "wheel"], types: ["PA"] },
  ];

  var PRIMARY_FAMILY = ["hail_mary", "rpo", "redzone_pass", "screen", "read_option", "trap", "smash", "man_beat", "snag_spot", "verticals", "levels_dig", "flood", "shot", "curl_flat", "wheel", "quick_game", "boot", "leak", "jet", "counter", "duo_power", "split_zone", "wide_zone", "draw", "dive", "iso", "inside_zone"];

  var DC_SLOTS = [
    { id: "d_first_10", label: "1st & 10", side: "dc", prefer: ["nickel", "four_three", "three_four"] },
    { id: "d_second_long", label: "2nd & long", side: "dc", prefer: ["nickel", "four_three", "dime"] },
    { id: "d_third_short", label: "3rd & short", side: "dc", prefer: ["forty_six", "four_three", "goal_line"], allowGoalLine: true },
    { id: "d_third_med", label: "3rd & med", side: "dc", prefer: ["nickel", "four_three", "three_three_five"] },
    { id: "d_third_long", label: "3rd & long", side: "dc", prefer: ["nickel", "dime", "dollar", "three_three_five"] },
    { id: "d_backed_up", label: "Backed up", side: "dc", prefer: ["four_three", "nickel", "forty_six"] },
    { id: "d_red_zone", label: "Red zone", side: "dc", prefer: ["nickel", "four_three", "forty_six"] },
    { id: "d_goal_line", label: "Goal line", side: "dc", prefer: ["goal_line", "forty_six", "four_three"], allowGoalLine: true },
    { id: "d_vs_gun", label: "vs Gun", side: "dc", packages: ["nickel", "dime", "dollar", "three_three_five"] },
    { id: "d_vs_bunch", label: "vs Bunch", side: "dc", packages: ["nickel", "dime"] },
    { id: "d_vs_heavy", label: "vs Heavy", side: "dc", packages: ["goal_line", "forty_six", "four_three", "three_four"], allowGoalLine: true },
    { id: "d_vs_empty", label: "vs Empty", side: "dc", packages: ["dime", "dollar", "nickel", "three_three_five"] },
    { id: "d_blitz", label: "Blitz", side: "dc", types: ["BLITZ"] },
    { id: "d_zone", label: "Zone", side: "dc", types: ["ZONE", "MATCH"] },
    { id: "d_man", label: "Man", side: "dc", types: ["MAN"] },
  ];

  var GENERAL_REASONS = {
    first_med: "Early-down fit from this playbook.",
    second_med: "Stays on schedule on 2nd and medium.",
    second_long: "A chain-mover when the down is long.",
    third_med: "Works the sticks on 3rd and medium.",
    third_long: "A 3rd-and-long answer from this book.",
    fourth_short: "Short-yardage fit.",
    backed_up: "Protects the end of the field.",
    red_zone: "Compressed-field fit.",
    goal_line: "Goal-line fit.",
    blitz_beater: "Hot answer against pressure.",
    man_beater: "Built to beat man coverage.",
    cover3_beater: "Built to stress Cover 3.",
    shot: "Vertical shot from this book.",
    quick_game: "Quick game from this book.",
    play_action: "Play-action or motion from this book.",
    d_first_10: "Early-down defensive fit.",
    d_second_long: "Fits a long 2nd down.",
    d_third_short: "Fits 3rd and short.",
    d_third_med: "Fits 3rd and medium.",
    d_third_long: "Fits 3rd and long.",
    d_backed_up: "Pressure fit when the offense is backed up.",
    d_red_zone: "Red-zone defensive fit.",
    d_goal_line: "Goal-line defensive fit.",
    d_vs_gun: "Fits a gun look.",
    d_vs_bunch: "Fits a bunch look.",
    d_vs_heavy: "Fits a heavy look.",
    d_vs_empty: "Fits an empty look.",
    d_blitz: "Pressure call from this book.",
    d_zone: "Zone call from this book.",
    d_man: "Man call from this book.",
  };

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function slotsFor(side) {
    return (clean(side).toLowerCase() === "dc" ? DC_SLOTS : OC_SLOTS).map(function (slot) {
      return Object.assign({}, slot);
    });
  }

  function slotById(slotId) {
    var id = clean(slotId);
    return OC_SLOTS.concat(DC_SLOTS).filter(function (slot) { return slot.id === id; })[0] || null;
  }

  function generalReason(slotId) {
    return GENERAL_REASONS[clean(slotId)] || "Fits this situation.";
  }

  function familiesOfPlay(play, familyOf) {
    if (typeof familyOf === "function") {
      var value = familyOf(play);
      if (Array.isArray(value)) {
        return value.map(clean).filter(Boolean);
      }
      var one = clean(value);
      if (one) return [one];
    }
    var stored = clean(play && (play.family || play.fam));
    return stored ? [stored] : [];
  }

  function textOf(play) {
    return clean(play && play.play_name).toLowerCase();
  }

  function conceptList(play) {
    var concepts = play && play.concepts;
    if (!Array.isArray(concepts)) return [];
    return concepts.map(function (value) { return clean(value).toLowerCase(); }).filter(Boolean);
  }

  function hasTerm(name, concepts, needle) {
    if (name.indexOf(needle) >= 0) return true;
    return concepts.some(function (value) { return value.indexOf(needle) >= 0; });
  }

  function hasAny(name, concepts, needles) {
    return needles.some(function (needle) { return hasTerm(name, concepts, needle); });
  }

  function isHailMaryFormation(play) {
    return (clean(play && play.formation) + " " + clean(play && play.set)).toLowerCase().indexOf("hail mary") >= 0;
  }

  function isScreenPlay(name, concepts) {
    var combined = name + " " + concepts.join(" ");
    var marked = ["screen", "bubble", "tunnel", "smoke", "jailbreak", "slip screen"].some(function (marker) {
      return combined.indexOf(marker) >= 0;
    });
    if (!marked) return false;
    if (name.indexOf("fake screen") >= 0 || name.indexOf("fk screen") >= 0) return false;
    return true;
  }

  function conceptTags(play) {
    if (!play) return ["quick_game"];
    if (isHailMaryFormation(play)) return ["hail_mary"];
    var name = textOf(play);
    var concepts = conceptList(play);
    var tags = {};
    function add(tag) { tags[tag] = true; }
    function has() {
      return hasAny(name, concepts, Array.prototype.slice.call(arguments));
    }
    var type = clean(play.type).toUpperCase();
    if (type === "RPO" || has("rpo")) add("rpo");
    if (has("redzone")) add("redzone_pass");
    if (isScreenPlay(name, concepts)) add("screen");
    if (has("jet", "end around", "reverse", "touch pass", "double pass", "dbl pass", "orbit")) add("jet");
    if (has("boot", "sprint", "waggle", "escape", "slide")) add("boot");
    if (has("leak")) add("leak");
    if (type === "RUN") {
      if (has("read option", "speed option", "read opt", "triple option", "tr option") || (has("option") && !has("rpo"))) add("read_option");
      if (has("trap", "shovel")) add("trap");
      if (has("counter", "misdirection", "cross buck", "cntr")) add("counter");
      if (has("duo", "power", "wrap")) add("duo_power");
      if (has("split")) add("split_zone");
      if (has("inside", "cutback")) add("inside_zone");
      if (has("dive", "plunge", "direct snap", "tush")) add("dive");
      if (has("draw", "delay", "sluggo")) add("draw");
      if (has("iso", "punch", "slam", "sting", "sneak", "base", "blast", "lead", "wham", "gut", "belly")) add("iso");
      if (!tags.inside_zone && !tags.read_option && has("stretch", "slash", "bounce", "off tackle", "off-tackle", "toss", "wide", "pitch", "sweep", "flip", "end around")) add("wide_zone");
      if (!tags.inside_zone && !tags.wide_zone && !tags.split_zone && has("zone")) add("inside_zone");
      var runKnown = ["read_option", "trap", "counter", "duo_power", "split_zone", "inside_zone", "wide_zone", "dive", "draw", "iso", "jet", "screen", "rpo"];
      if (!runKnown.some(function (tag) { return tags[tag]; })) add("inside_zone");
    } else {
      if (has("smash")) add("smash");
      if (has("mesh", "shallow", "drag", "whip", "trail", "angle", "zig", "rub", "texas", "shake", "pivot", "return", "replace", "chase", "boomerang")) add("man_beat");
      if (has("snag", "spot")) add("snag_spot");
      if (has("stick", "spacing", "slants", "slant", "bench", "hitch", "choice", "comeback", "scat", "attack", "stop", "shock", "omaha", "buc", "frisco", "dixie", "ernie", "corndog", "willie", "mike", "will")) add("quick_game");
      if (has("flood", "sail", "hoss", "flag", "salem", "poco", "divide", "arches", "seattle")) add("flood");
      if (has("four vertical", "four vert", "verticals", "vertical") || /\bverts?\b/.test(name)) add("verticals");
      if (has("dig", "levels", "drive", "hi lo", "hilo", "double in", "dbl ins") || /\bins\b/.test(name) || /(^|\s)in(\s|$)/.test(name) || has("diag", "middle", "clear")) add("levels_dig");
      if (has("curl", "swirl", "hook")) add("curl_flat");
      if (has("dagger", "deep", "post", "shot", "over", "seam", "scissors", "fade", "fork", "mills", "skinny", "sluggo", "g down") || /\bgos?\b/.test(name)) add("shot");
      if (has("corner") && !tags.smash && !tags.snag_spot && !tags.flood) add("shot");
      if (has("wheel", "wheel switch") && !tags.man_beat && !tags.flood && !tags.quick_game && !tags.snag_spot) add("wheel");
      if (has("cross") && !tags.man_beat && !tags.shot && !tags.levels_dig) add(has("inside", "shallow") ? "man_beat" : "shot");
      if (has("out", "under", "flat", "swing", "lookie", "pop") || /\bopt\b/.test(name)) add("quick_game");
      if (has("wrap")) add("duo_power");
      if (has("stretch")) add("wide_zone");
      if (has("cntr", "counter")) add("counter");
      var passKnown = ["screen", "smash", "man_beat", "snag_spot", "quick_game", "flood", "curl_flat", "levels_dig", "verticals", "shot", "wheel", "boot", "leak", "jet", "rpo", "redzone_pass", "wide_zone", "duo_power", "counter"];
      if (!passKnown.some(function (tag) { return tags[tag]; })) add("quick_game");
    }
    return Object.keys(tags);
  }

  function primaryFamily(play) {
    var tags = conceptTags(play);
    var index;
    for (index = 0; index < PRIMARY_FAMILY.length; index += 1) {
      if (tags.indexOf(PRIMARY_FAMILY[index]) >= 0) return PRIMARY_FAMILY[index];
    }
    return tags[0] || "quick_game";
  }

  function defensePackage(play) {
    var formation = clean(play && play.formation).toUpperCase();
    if (formation === "NICKEL") return "nickel";
    if (formation === "DIME") return "dime";
    if (formation === "DOLLAR") return "dollar";
    if (formation === "4-3") return "four_three";
    if (formation === "3-4") return "three_four";
    if (formation === "46") return "forty_six";
    if (formation === "3-3-5") return "three_three_five";
    if (formation === "GOAL LINE") return "goal_line";
    if (formation === "PREVENT") return "prevent";
    return "";
  }

  function isOffenseGoalLinePlay(play) {
    var text = (clean(play && play.formation) + " " + clean(play && play.set)).toLowerCase();
    return text.indexOf("goal line") >= 0;
  }

  function offenseFits(play, slot, familyOf) {
    if (!play) return false;
    if (isOffenseGoalLinePlay(play)) return slot.id === "goal_line";
    var type = clean(play.type).toUpperCase();
    if (slot.types && slot.types.indexOf(type) >= 0) return true;
    var families = familiesOfPlay(play, familyOf);
    return families.some(function (fam) {
      return !!(slot.families && slot.families.indexOf(fam) >= 0);
    });
  }

  function defenseFits(play, slot) {
    if (!play) return false;
    var type = clean(play.type).toUpperCase();
    var pkg = defensePackage(play);
    if (pkg === "prevent" || type === "RETURN" || type === "OTHER") return false;
    if (/SPECIAL/.test(clean(play.formation).toUpperCase())) return false;
    if (pkg === "goal_line" && slot.allowGoalLine !== true) return false;
    if (slot.types && slot.types.indexOf(type) < 0) return false;
    if (slot.packages && slot.packages.indexOf(pkg) < 0) return false;
    return true;
  }

  function fits(play, slot, familyOf) {
    if (!slot || !play || !play.id) return false;
    return slot.side === "dc" ? defenseFits(play, slot) : offenseFits(play, slot, familyOf);
  }

  function weightOf(play, slot) {
    var weight = 1;
    if (slot.side === "dc" && slot.prefer && slot.prefer.indexOf(defensePackage(play)) >= 0) weight += 1;
    return weight;
  }

  function pickWeighted(items, weightFn, random) {
    var total = 0;
    var weights = items.map(function (item) {
      var weight = Math.max(0.001, Number(weightFn(item)) || 1);
      total += weight;
      return weight;
    });
    var cursor = (typeof random === "function" ? random() : Math.random()) * total;
    var index;
    for (index = 0; index < items.length; index += 1) {
      cursor -= weights[index];
      if (cursor <= 0) return items[index];
    }
    return items[items.length - 1];
  }

  function eligiblePlays(plays, slot, options, exclude) {
    var familyOf = options && options.familyOf;
    return (Array.isArray(plays) ? plays : []).filter(function (play) {
      return fits(play, slot, familyOf) && (!exclude || !exclude.has(play.id));
    });
  }

  function dealSlot(plays, slotId, options) {
    var slot = slotById(slotId);
    if (!slot) return null;
    var exclude = new Set((options && options.excludeIds) || []);
    var pool = eligiblePlays(plays, slot, options, exclude);
    if (!pool.length) return null;
    var chosen = pickWeighted(pool, function (play) {
      return weightOf(play, slot);
    }, options && options.random);
    return chosen || null;
  }

  function dealBoard(plays, side, options) {
    var board = {};
    var exclude = new Set((options && options.excludeIds) || []);
    slotsFor(side).forEach(function (slot) {
      var play = dealSlot(plays, slot.id, Object.assign({}, options, { excludeIds: Array.from(exclude) }));
      board[slot.id] = play || null;
      if (play && play.id) exclude.add(play.id);
    });
    return board;
  }

  function fittingPlays(plays, slot, options) {
    var familyOf = options && options.familyOf;
    return (Array.isArray(plays) ? plays : []).filter(function (play) {
      return play && play.id && fits(play, slot, familyOf);
    });
  }

  function replaceSlot(board, slotId, plays, options) {
    var slot = slotById(slotId);
    var current = board && board[slotId];
    var next = Object.assign({}, board || {});
    if (!slot) return next;
    var others = new Set();
    Object.keys(board || {}).forEach(function (id) {
      if (id === slotId) return;
      var sitting = board[id];
      if (sitting && sitting.id) others.add(sitting.id);
    });
    var history = options && options.history;
    var seenList = history && Array.isArray(history[slotId]) ? history[slotId].slice() : [];
    var currentId = current && current.id;
    if (currentId && seenList.indexOf(currentId) < 0) seenList.push(currentId);
    var seen = new Set(seenList);
    var fitting = fittingPlays(plays, slot, options);
    var unseen = fitting.filter(function (play) {
      return play.id !== currentId && !seen.has(play.id);
    });
    var pool = unseen.filter(function (play) { return !others.has(play.id); });
    var reset = false;
    if (!pool.length) pool = unseen.slice();
    if (!pool.length) {
      reset = true;
      pool = fitting.filter(function (play) {
        return play.id !== currentId && !others.has(play.id);
      });
      if (!pool.length) pool = fitting.filter(function (play) { return play.id !== currentId; });
      if (!pool.length) pool = fitting.slice();
    }
    var play = pool.length ? pickWeighted(pool, function (item) {
      return weightOf(item, slot);
    }, options && options.random) : null;
    next[slotId] = play || current || null;
    if (history && play && play.id) {
      var cycle = reset ? [] : seenList.slice();
      if (cycle.indexOf(play.id) < 0) cycle.push(play.id);
      history[slotId] = cycle;
    }
    return next;
  }

  function num(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function isGoalLine(situation) {
    var yards = num(situation && situation.yards);
    var yardLine = num(situation && situation.fieldYard);
    var side = clean(situation && situation.fieldSide).toUpperCase();
    if (situation && situation.goalToGo === true && yards != null && yards <= 3) return true;
    return side === "OPP" && yardLine != null && yardLine <= 3 && yards != null && yards <= 3;
  }

  function isRedZone(situation) {
    if (isGoalLine(situation)) return false;
    var yardLine = num(situation && situation.fieldYard);
    return clean(situation && situation.fieldSide).toUpperCase() === "OPP" && yardLine != null && yardLine <= 20;
  }

  function isBackedUp(situation) {
    var yardLine = num(situation && situation.fieldYard);
    return clean(situation && situation.fieldSide).toUpperCase() === "OWN" && yardLine != null && yardLine <= 10;
  }

  function highlightedSlots(side, situation) {
    var spot = situation || {};
    var down = num(spot.down) || 0;
    var yards = num(spot.yards);
    var ids = [];
    var dc = clean(side).toLowerCase() === "dc";
    if (dc) {
      if (down === 1 && (yards == null || yards >= 7)) ids.push("d_first_10");
      if (down === 2 && (yards == null || yards >= 7)) ids.push("d_second_long");
      if (down === 3 && yards != null && yards <= 3) ids.push("d_third_short");
      if (down === 3 && yards != null && yards >= 4 && yards <= 6) ids.push("d_third_med");
      if (down === 3 && (yards == null || yards >= 7)) ids.push("d_third_long");
      if (isBackedUp(spot)) ids.push("d_backed_up");
      if (isRedZone(spot)) ids.push("d_red_zone");
      if (isGoalLine(spot)) ids.push("d_goal_line");
      var formation = clean(spot.offenseFormation).toUpperCase();
      if (formation.indexOf("GUN") >= 0) ids.push("d_vs_gun");
      if (formation.indexOf("BUNCH") >= 0) ids.push("d_vs_bunch");
      if (formation.indexOf("HEAVY") >= 0) ids.push("d_vs_heavy");
      if (formation.indexOf("EMPTY") >= 0) ids.push("d_vs_empty");
      return ids;
    }
    if (down === 1) ids.push("first_med");
    if (down === 2 && yards != null && yards <= 6) ids.push("second_med");
    if (down === 2 && (yards == null || yards >= 7)) ids.push("second_long");
    if (down === 3 && yards != null && yards <= 6) ids.push("third_med");
    if (down === 3 && (yards == null || yards >= 7)) ids.push("third_long");
    if (down >= 4 && yards != null && yards <= 3) ids.push("fourth_short");
    if (isBackedUp(spot)) ids.push("backed_up");
    if (isRedZone(spot)) ids.push("red_zone");
    if (isGoalLine(spot)) ids.push("goal_line");
    var shell = clean(spot.shell);
    if (shell === "Blitz") ids.push("blitz_beater");
    if (shell === "Man" || shell === "Cover 1") ids.push("man_beater");
    if (shell === "Cover 3") ids.push("cover3_beater");
    return ids;
  }

  return {
    OC_SLOTS: OC_SLOTS,
    DC_SLOTS: DC_SLOTS,
    slotsFor: slotsFor,
    slotById: slotById,
    generalReason: generalReason,
    fits: fits,
    conceptTags: conceptTags,
    primaryFamily: primaryFamily,
    dealSlot: dealSlot,
    dealBoard: dealBoard,
    replaceSlot: replaceSlot,
    highlightedSlots: highlightedSlots,
  };
});
