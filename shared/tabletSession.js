(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironTabletSession = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function nameKey(value) {
    return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function createSession() {
    return {
      ocBoard: {},
      dcBoard: {},
      scriptIds: [],
      scriptIndex: 0,
      pending: null,
      lastSpot: null,
      highlighted: [],
      lastCaptureText: "",
      shell: "",
      offenseFormation: "",
      slotHistory: {},
      callStyle: "default",
    };
  }

  function findByName(plays, name) {
    var key = nameKey(name);
    if (!key) return null;
    var list = Array.isArray(plays) ? plays : [];
    var index;
    for (index = 0; index < list.length; index += 1) {
      if (nameKey(list[index] && list[index].play_name) === key) return list[index];
    }
    return null;
  }

  function shellFromName(name) {
    var text = clean(name).toUpperCase();
    if (!text) return "";
    if (text.indexOf("TAMPA") >= 0) return "Tampa 2";
    if (text.indexOf("COVER9") >= 0 || text.indexOf("COVER 9") >= 0) return "Cover 9";
    if (text.indexOf("COVER6") >= 0 || text.indexOf("COVER 6") >= 0) return "Cover 6";
    if (text.indexOf("COVER4") >= 0 || text.indexOf("COVER 4") >= 0) return "Cover 4";
    if (text.indexOf("COVER3") >= 0 || text.indexOf("COVER 3") >= 0) return "Cover 3";
    if (text.indexOf("COVER2") >= 0 || text.indexOf("COVER 2") >= 0) return "Cover 2";
    if (text.indexOf("COVER1") >= 0 || text.indexOf("COVER 1") >= 0) return "Cover 1";
    if (text.indexOf("BLITZ") >= 0) return "Blitz";
    if (text.indexOf("MAN") >= 0) return "Man";
    return "";
  }

  function startGame(session, input) {
    var Board = input.board;
    var Opening = input.opening;
    var current = session || createSession();
    var offense = input.offensePlays || [];
    var defense = input.defensePlays || [];
    var options = {
      familyOf: input.familyOf,
      identityFamilies: input.identityFamilies || {},
      random: input.random || Math.random,
    };
    var filled = Opening && Opening.fillOpeningScript ? Opening.fillOpeningScript({
      plays: offense,
      familyOf: input.familyOf,
      cooldownIds: input.cooldownIds || [],
      ignoreLearning: true,
      random: options.random,
      setupPayoff: input.setupPayoff || {},
    }) : { playIds: [] };
    current.callStyle = Board.normalizeCallStyle ? Board.normalizeCallStyle("default") : "default";
    current.ocBoard = Board.dealBoard(offense, "oc", {
      familyOf: input.situationFamiliesOf || input.familyOf,
      identityFamilies: options.identityFamilies,
      random: options.random,
      style: current.callStyle,
    });
    current.dcBoard = Board.dealBoard(defense, "dc", options);
    current.slotHistory = {};
    rememberDealt(current.slotHistory, current.ocBoard);
    rememberDealt(current.slotHistory, current.dcBoard);
    current.scriptIds = filled.playIds || [];
    current.scriptIndex = 0;
    current.pending = null;
    current.lastSpot = null;
    current.highlighted = [];
    current.lastCaptureText = "";
    current.shell = "";
    current.offenseFormation = "";
    return current;
  }

  function rememberDealt(history, board) {
    Object.keys(board || {}).forEach(function (slotId) {
      var play = board[slotId];
      if (play && play.id) history[slotId] = [play.id];
    });
  }

  function boardFor(session, side) {
    return clean(side).toLowerCase() === "dc" ? session.dcBoard : session.ocBoard;
  }

  function confirmSlot(session, slotId, input) {
    var Board = input.board;
    var side = clean(input.side).toLowerCase() === "dc" ? "dc" : "oc";
    var board = boardFor(session, side);
    var current = board[slotId];
    if (!current || !current.id) return session;
    var plays = side === "dc" ? input.defensePlays : input.offensePlays;
    if (!session.slotHistory) session.slotHistory = {};
    var nextBoard = Board.replaceSlot(board, slotId, plays || [], {
      familyOf: side === "oc" && input.situationFamiliesOf ? input.situationFamiliesOf : input.familyOf,
      identityFamilies: input.identityFamilies || {},
      random: input.random || Math.random,
      history: session.slotHistory,
      style: input.style || session.callStyle || "default",
    });
    if (side === "dc") session.dcBoard = nextBoard;
    else session.ocBoard = nextBoard;
    session.pending = { kind: "slot", playId: current.id, slotId: slotId, side: side, spot: copySpot(session.lastSpot) };
    return session;
  }

  function applyCallStyle(session, style, input) {
    var Board = input.board;
    var current = session || createSession();
    var nextStyle = Board.normalizeCallStyle ? Board.normalizeCallStyle(style) : "default";
    current.callStyle = nextStyle;
    if (!current.ocBoard) current.ocBoard = {};
    if (!current.slotHistory) current.slotHistory = {};
    var offense = input.offensePlays || [];
    var exclude = new Set();
    var goal = current.ocBoard.goal_line;
    if (goal && goal.id) exclude.add(goal.id);
    var options = {
      familyOf: input.situationFamiliesOf || input.familyOf,
      identityFamilies: input.identityFamilies || {},
      random: input.random || Math.random,
      style: nextStyle,
    };
    if (Board.slotsFor) {
      Board.slotsFor("oc").forEach(function (slot) {
        if (slot.id === "goal_line") return;
        var play = Board.dealSlot(offense, slot.id, Object.assign({}, options, { excludeIds: Array.from(exclude) }));
        if (play && play.id) {
          current.ocBoard[slot.id] = play;
          exclude.add(play.id);
          current.slotHistory[slot.id] = [play.id];
        }
      });
    }
    return current;
  }

  function confirmScript(session) {
    var id = session.scriptIds[session.scriptIndex];
    if (!id) return session;
    session.pending = { kind: "script", playId: id, slotId: "opening_script", side: "oc", spot: copySpot(session.lastSpot) };
    session.scriptIndex += 1;
    return session;
  }

  function copySpot(spot) {
    if (!spot) return null;
    var down = Number(spot.down);
    var yards = Number(spot.yards);
    var fieldYard = Number(spot.fieldYard);
    var fieldSide = clean(spot.fieldSide).toUpperCase();
    if (!Number.isFinite(down) || down < 1 || !fieldSide || !Number.isFinite(fieldYard)) return null;
    return {
      down: down,
      yards: Number.isFinite(yards) ? yards : null,
      goalToGo: spot.goalToGo === true,
      fieldSide: fieldSide,
      fieldYard: fieldYard,
    };
  }

  function spotsMatch(before, after) {
    if (!before || !after) return false;
    if (Number(before.down) !== Number(after.down)) return false;
    if (Number(before.yards) !== Number(after.yards)) return false;
    if (clean(before.fieldSide).toUpperCase() !== clean(after.fieldSide).toUpperCase()) return false;
    var beforeYard = Number(before.fieldYard);
    var afterYard = Number(after.fieldYard);
    return Number.isFinite(beforeYard) && beforeYard === afterYard;
  }

  function sheetFreeze(session) {
    return {
      scriptIds: Array.isArray(session.scriptIds) ? session.scriptIds.slice() : [],
      scriptIndex: session.scriptIndex,
      ocBoard: session.ocBoard,
      dcBoard: session.dcBoard,
    };
  }

  function restoreSheet(session, frozen) {
    session.scriptIds = frozen.scriptIds.slice();
    session.scriptIndex = frozen.scriptIndex;
    session.ocBoard = frozen.ocBoard;
    session.dcBoard = frozen.dcBoard;
  }

  function ingest(session, event, input) {
    var Labels = input.labels;
    var Board = input.board;
    var side = clean(event && event.side).toLowerCase() === "dc" ? "dc" : "oc";
    var userBook = side === "dc" ? input.defensePlays : input.offensePlays;
    var named = findByName(userBook, side === "dc" ? event.previousDefenseName : event.previousOffenseName);
    var opponentName = side === "dc" ? event.previousOffenseName : event.previousDefenseName;
    var shell = shellFromName(opponentName);
    var look = shell || clean(opponentName);
    var down = Number(event && event.down);
    var yards = Number(event && event.yards);
    var fieldSide = clean(event && event.fieldSide).toUpperCase();
    var fieldYard = Number(event && event.fieldYard);
    var downReady = event && event.downKnown === true && Number.isFinite(down) && Number.isFinite(yards) && yards > 0;
    var fieldReady = event && (event.fieldKnown === true || (fieldSide && Number.isFinite(fieldYard)));
    var frozen = sheetFreeze(session);
    var spot = {
      down: downReady ? down : 0,
      yards: downReady ? yards : null,
      goalToGo: downReady && event.goalToGo === true,
      fieldSide: fieldReady ? fieldSide : (downReady && session.lastSpot && session.lastSpot.fieldSide) || "",
      fieldYard: fieldReady ? fieldYard : (downReady && session.lastSpot ? session.lastSpot.fieldYard : null),
    };
    if (shell) session.shell = shell;
    if (clean(event.offenseFormation)) session.offenseFormation = clean(event.offenseFormation);
    if (downReady || fieldReady || shell) {
      session.highlighted = Board.highlightedSlots(side, {
        down: spot.down,
        yards: spot.yards,
        goalToGo: spot.goalToGo,
        fieldSide: spot.fieldSide,
        fieldYard: spot.fieldYard,
        shell: session.shell,
        offenseFormation: session.offenseFormation,
      });
    }
    if (!downReady) {
      session.lastCaptureText = "Not logged";
      restoreSheet(session, frozen);
      return { session: session, store: input.store, logged: false };
    }
    var pending = session.pending;
    var beforeSpot = (pending && pending.spot) || session.lastSpot;
    if (fieldReady && spotsMatch(beforeSpot, spot)) {
      restoreSheet(session, frozen);
      return { session: session, store: input.store, logged: false, unchanged: true };
    }
    var grade = fieldReady ? Labels.gradeSnap(beforeSpot, spot) : null;
    var play = null;
    var disagreed = false;
    if (named && pending && named.id !== pending.playId) {
      play = named;
      disagreed = true;
    } else if (pending && (!named || named.id === pending.playId)) {
      play = (userBook || []).filter(function (item) { return item && item.id === pending.playId; })[0] || named;
    } else if (named) {
      play = named;
    }
    if (fieldReady) {
      session.lastSpot = {
        down: down,
        yards: yards,
        goalToGo: event.goalToGo === true,
        fieldSide: fieldSide,
        fieldYard: fieldYard,
      };
    }
    if (!fieldReady || !play || !grade) {
      if (disagreed) session.pending = null;
      session.lastCaptureText = "Not logged";
      restoreSheet(session, frozen);
      return { session: session, store: input.store, logged: false, disagreed: disagreed };
    }
    session.pending = null;
    var family = input.familyOf ? input.familyOf(play) : play.family;
    var slotId = pending && pending.slotId && !disagreed ? pending.slotId : matchedSlot(Board, side, spot);
    var store = Labels.recordResult(input.store, {
      opponent: input.opponent,
      context: input.context,
      slotId: slotId || (side === "dc" ? "d_first_10" : "first_med"),
      playId: play.id,
      family: family,
      success: grade.success === true,
      opponentLook: look,
      lookSide: side === "dc" ? "offense" : "defense",
    });
    var gain = Math.round(grade.yardsGained);
    session.lastCaptureText = "Logged · " + [clean(play.formation), clean(play.set), clean(play.play_name)].filter(Boolean).join(" · ") + " · " + (gain > 0 ? "+" : "") + gain + " · " + (grade.success ? "success" : "failure");
    restoreSheet(session, frozen);
    return { session: session, store: store, logged: true, disagreed: disagreed };
  }

  function matchedSlot(Board, side, spot) {
    var ids = Board.highlightedSlots(side, spot);
    var preferred = ids.filter(function (id) {
      return id.indexOf("beater") < 0 && id.indexOf("vs_") < 0 && id !== "shot" && id !== "quick_game" && id !== "play_action" && id !== "d_blitz" && id !== "d_zone" && id !== "d_man";
    });
    return preferred[0] || ids[0] || "";
  }

  return {
    createSession: createSession,
    startGame: startGame,
    applyCallStyle: applyCallStyle,
    confirmSlot: confirmSlot,
    confirmScript: confirmScript,
    ingest: ingest,
    findByName: findByName,
    shellFromName: shellFromName,
  };
});
