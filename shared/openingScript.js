(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironOpeningScript = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCRIPT_LENGTH = 15;
  var SHELL_MIN_OBSERVATIONS = 6;
  var SHELL_SCORE_WINDOW = 0.35;

  function cleanText(value) {
    return String(value == null ? "" : value).trim();
  }

  function isEarlyDownScriptSituation(situationKey) {
    var parts = String(situationKey || "").split("|");
    if (parts.length < 5) return false;
    var down = parts[1];
    var bucket = parts[2];
    if (parts[3] === "goal_to_go" || parts[4] === "goal") return false;
    if (bucket !== "long" && bucket !== "medium") return false;
    return down === "down1" || down === "down2";
  }

  function normalizeDefenseDistribution(counts) {
    var entries = Object.entries(counts || {}).filter(function (entry) {
      return Number(entry[1]) > 0;
    });
    var total = entries.reduce(function (sum, entry) {
      return sum + Number(entry[1]);
    }, 0);
    if (total <= 0) return { total: 0, entries: [] };
    return {
      total: total,
      entries: entries.map(function (entry) {
        return [entry[0], Number(entry[1]) / total];
      }).sort(function (a, b) {
        return b[1] - a[1];
      }),
    };
  }

  function openingScriptOpponentShell(profile) {
    var counts = {};
    var observations = 0;
    Object.entries((profile && profile.contexts) || {}).forEach(function (entry) {
      var key = entry[0];
      var context = entry[1];
      var parts = String(key).split("|");
      var famIndex = parts.indexOf("fam");
      if (famIndex < 5) return;
      if (!isEarlyDownScriptSituation(parts.slice(0, famIndex).join("|"))) return;
      Object.entries((context && context.defenses) || {}).forEach(function (defenseEntry) {
        var count = Number(defenseEntry[1] && defenseEntry[1].observations) || 0;
        if (count <= 0) return;
        counts[defenseEntry[0]] = (counts[defenseEntry[0]] || 0) + count;
        observations += count;
      });
    });
    if (observations < SHELL_MIN_OBSERVATIONS) return null;
    var distribution = normalizeDefenseDistribution(counts);
    if (!distribution.total) return null;
    return { observations: observations, distribution: distribution };
  }

  function openingScriptPlayScore(play, shell, deps) {
    var helpers = deps || {};
    if (!play || !shell || !shell.distribution || !shell.distribution.entries || !shell.distribution.entries.length) return 0;
    var coverageMatchupScore = helpers.coverageMatchupScore || function () { return 0; };
    var coverageLearning = helpers.coverageLearning || function () { return 0; };
    var personalLearningFromSituation = helpers.personalLearningFromSituation || function () { return 0; };
    var teamKey = cleanText(helpers.teamKey).toLowerCase() || "unknown";
    var situations = helpers.learningSituations || {};
    var score = 0;
    shell.distribution.entries.forEach(function (entry) {
      var defense = entry[0];
      var weight = entry[1];
      score += weight * (Number(coverageMatchupScore(play, defense)) || 0);
      score += weight * (Number(coverageLearning(play, defense)) || 0);
    });
    var situationTotal = 0;
    var situationSamples = 0;
    Object.entries(situations).forEach(function (entry) {
      var key = entry[0];
      if (!key.startsWith(teamKey + "|") || !isEarlyDownScriptSituation(key)) return;
      var bonus = personalLearningFromSituation(play, entry[1]);
      if (!bonus) return;
      situationTotal += bonus;
      situationSamples += 1;
    });
    if (situationSamples) score += situationTotal / situationSamples;
    if (helpers.globalLearning) score += (Number(personalLearningFromSituation(play, helpers.globalLearning)) || 0) * 0.25;
    return score;
  }

  function isGoalLinePlay(play) {
    var text = (cleanText(play && play.formation) + " " + cleanText(play && play.set)).toLowerCase();
    return text.indexOf("goal line") >= 0;
  }

  function shuffleList(items, random) {
    var list = (Array.isArray(items) ? items : []).slice();
    var rand = typeof random === "function" ? random : Math.random;
    var index;
    for (index = list.length - 1; index > 0; index -= 1) {
      var swapAt = Math.floor(rand() * (index + 1));
      var temp = list[index];
      list[index] = list[swapAt];
      list[swapAt] = temp;
    }
    return list;
  }

  function deferIdsToBack(plays, deferIds) {
    if (!deferIds || !deferIds.length) return plays;
    var defer = new Set(deferIds.filter(Boolean));
    if (!defer.size) return plays;
    var front = [];
    var back = [];
    plays.forEach(function (play) {
      if (play && defer.has(play.id)) back.push(play);
      else front.push(play);
    });
    return front.concat(back);
  }

  function fillOpeningScript(params) {
    var options = params || {};
    var teamPlays = (Array.isArray(options.plays) ? options.plays : []).filter(function (play) {
      return play && play.id && !isGoalLinePlay(play);
    });
    var familyOf = options.familyOf || function () { return ""; };
    var cooldownList = (options.cooldownIds || options.deferIds || []).filter(Boolean);
    var cooldownIds = new Set(cooldownList);
    var shell = options.shell || null;
    var setupPayoff = options.setupPayoff || {};
    var random = options.random || Math.random;
    var existing = Array.isArray(options.existingPlayIds) ? options.existingPlayIds : [];
    var locked = new Set((options.lockedIndexes || []).map(function (value) {
      return Number(value);
    }).filter(function (value) {
      return value >= 0 && value < SCRIPT_LENGTH;
    }));
    var byId = new Map(teamPlays.map(function (play) {
      return [play && play.id, play];
    }));
    var usedIds = new Set();
    var selected = new Array(SCRIPT_LENGTH).fill(null);
    var scoreDeps = options.scoreDeps || {};
    var slotFamilies = Array.isArray(options.slotFamilies) ? options.slotFamilies : [];
    var scoringSlot = 0;
    var dealOrder = deferIdsToBack(shuffleList(teamPlays, random), cooldownList);
    var deckOrder = new Map();
    dealOrder.forEach(function (play, index) {
      if (play && play.id) deckOrder.set(play.id, index);
    });

    locked.forEach(function (index) {
      var play = byId.get(existing[index]);
      if (!play) return;
      selected[index] = play;
      usedIds.add(play.id);
    });

    function playScore(play) {
      if (options.ignoreLearning === true) return 0;
      var base = typeof options.playScore === "function" ? options.playScore(play, shell) : openingScriptPlayScore(play, shell, scoreDeps);
      if (typeof options.tendencyPlayScore === "function") base += Number(options.tendencyPlayScore(play, scoringSlot)) || 0;
      return base;
    }

    function deckRank(play) {
      if (!play || !play.id || !deckOrder.has(play.id)) return Number.MAX_SAFE_INTEGER;
      return deckOrder.get(play.id);
    }

    function pickByDeck(pool) {
      if (!pool || !pool.length) return null;
      var ordered = pool.slice().sort(function (a, b) {
        return deckRank(a) - deckRank(b) || cleanText(a.play_name).localeCompare(cleanText(b.play_name));
      });
      return ordered[0] || null;
    }

    function chooseFrom(candidatePool, allowCooldown, allowReuse) {
      if (!candidatePool || !candidatePool.length) return null;
      var fresh = candidatePool.filter(function (play) {
        return play && play.id && !usedIds.has(play.id) && !cooldownIds.has(play.id);
      });
      var deferred = candidatePool.filter(function (play) {
        return play && play.id && !usedIds.has(play.id) && cooldownIds.has(play.id);
      });
      var unused = candidatePool.filter(function (play) {
        return play && play.id && !usedIds.has(play.id);
      });
      var available = fresh.length ? fresh : [];
      if (!available.length && allowCooldown) available = deferred.length ? deferred : unused;
      if (!available.length && allowReuse) {
        available = candidatePool.filter(function (play) {
          return play && play.id;
        });
      }
      if (!available.length) return null;
      var pool = available;
      if (options.ignoreLearning !== true && shell && shell.distribution && shell.distribution.entries && shell.distribution.entries.length && available.length > 1) {
        var ranked = available.map(function (play) {
          return { play: play, score: playScore(play) };
        }).sort(function (a, b) {
          return b.score - a.score || deckRank(a.play) - deckRank(b.play) || cleanText(a.play.play_name).localeCompare(cleanText(b.play.play_name));
        });
        var best = ranked[0].score;
        pool = ranked.filter(function (item) {
          return item.score >= best - SHELL_SCORE_WINDOW;
        }).map(function (item) {
          return item.play;
        });
      }
      var chosen = pickByDeck(pool);
      if (!chosen) return null;
      usedIds.add(chosen.id);
      return chosen;
    }

    function pickPlay(candidatePool) {
      return chooseFrom(candidatePool, false, false);
    }

    function pickDeferred(candidatePool) {
      return chooseFrom(candidatePool, true, false);
    }

    function pickAny(candidatePool) {
      return chooseFrom(candidatePool, true, true);
    }

    function isFam(play, families) {
      return families.indexOf(familyOf(play)) >= 0;
    }

    var runs = teamPlays.filter(function (play) { return play.type === "RUN" || play.type === "RPO"; });
    var passes = teamPlays.filter(function (play) { return play.type === "PASS" || play.type === "PA"; });
    var insideRuns = runs.filter(function (play) { return isFam(play, ["inside_zone", "split_zone", "duo_power", "dive", "trap", "iso"]); });
    var edgeRuns = runs.filter(function (play) { return isFam(play, ["wide_zone", "jet", "counter", "read_option"]); });
    var rhythmPasses = passes.filter(function (play) { return isFam(play, ["quick_game", "curl_flat", "snag_spot", "man_beat"]); });
    var constraintPlays = teamPlays.filter(function (play) { return isFam(play, ["counter", "trap", "draw", "screen", "jet", "rpo"]); });
    var intermediatePasses = passes.filter(function (play) { return isFam(play, ["levels_dig", "mesh", "smash", "flood"]); });
    var deepShots = passes.filter(function (play) { return isFam(play, ["shot", "verticals", "flood", "levels_dig"]); });
    var screens = teamPlays.filter(function (play) {
      return isFam(play, ["screen", "leak"]) || (Array.isArray(play.concepts) && play.concepts.some(function (concept) {
        return String(concept).toLowerCase().indexOf("screen") >= 0;
      }));
    });
    var moneyDownPasses = passes.filter(function (play) { return isFam(play, ["quick_game", "man_beat", "levels_dig", "curl_flat", "snag_spot", "mesh"]); });
    var redzoneFinishers = teamPlays.filter(function (play) { return isFam(play, ["duo_power", "inside_zone", "smash", "snag_spot", "boot", "rpo"]); });

    function payoffPlays(basePlay) {
      if (!basePlay) return passes;
      var targetFams = setupPayoff[familyOf(basePlay)] || ["boot", "flood", "shot"];
      var paCandidates = passes.filter(function (play) {
        return (play.type === "PA" || isFam(play, ["boot", "flood", "leak", "shot"])) && targetFams.indexOf(familyOf(play)) >= 0;
      });
      if (!paCandidates.length) {
        paCandidates = passes.filter(function (play) {
          return play.type === "PA" || isFam(play, ["boot", "flood", "leak", "shot"]);
        });
      }
      if (basePlay.formation) {
        var sameForm = paCandidates.filter(function (play) { return play.formation === basePlay.formation; });
        if (sameForm.length) paCandidates = sameForm;
      }
      return paCandidates.length ? paCandidates : passes;
    }

    function selectAnchorFormations(plays) {
      var counts = {};
      (plays || []).forEach(function (play) {
        if (!play || isGoalLinePlay(play)) return;
        var form = cleanText(play.formation);
        var set = cleanText(play.set);
        var key = form + " | " + set;
        if (!counts[key]) counts[key] = { key: key, formation: form, set: set, run: 0, pass: 0, pa: 0, total: 0 };
        var t = cleanText(play.type).toUpperCase();
        if (t === "RUN" || t === "RPO") counts[key].run += 1;
        else if (t === "PA") counts[key].pa += 1;
        else if (t === "PASS") counts[key].pass += 1;
        counts[key].total += 1;
      });
      var entries = Object.keys(counts).map(function (k) { return counts[k]; });
      if (!entries.length) return [];
      var sorted = entries.sort(function (a, b) {
        var aScore = (a.total < 2 ? -10 : 0) + (a.run >= 1 && (a.pass >= 1 || a.pa >= 1) ? 5 : 0) + a.total * 0.5;
        var bScore = (b.total < 2 ? -10 : 0) + (b.run >= 1 && (b.pass >= 1 || b.pa >= 1) ? 5 : 0) + b.total * 0.5;
        return bScore - aScore;
      });
      var anchors = [];
      for (var i = 0; i < sorted.length && anchors.length < 4; i += 1) {
        if (sorted[i].total >= 2) anchors.push(sorted[i].key);
      }
      return anchors;
    }

    var anchors = selectAnchorFormations(teamPlays);
    var anchorSet = new Set(anchors);

    function place(index, primary, secondary) {
      if (selected[index]) return selected[index];
      scoringSlot = index;
      var preferred = Array.isArray(slotFamilies[index]) ? slotFamilies[index] : null;
      var biased = primary;
      if (preferred && preferred.length && primary && primary.length) {
        var narrowed = primary.filter(function (play) {
          return preferred.indexOf(familyOf(play)) >= 0;
        });
        if (narrowed.length) {
          biased = narrowed.slice().sort(function (a, b) {
            return preferred.indexOf(familyOf(a)) - preferred.indexOf(familyOf(b)) || cleanText(a.play_name).localeCompare(cleanText(b.play_name));
          });
        }
      }
      if (anchorSet.size && biased && biased.length) {
        var anchorMatches = biased.filter(function (play) {
          return anchorSet.has(cleanText(play.formation) + " | " + cleanText(play.set));
        });
        if (anchorMatches.length) {
          var anchorPick = pickPlay(anchorMatches);
          if (anchorPick) {
            selected[index] = anchorPick;
            return selected[index];
          }
        }
      }
      var play = pickPlay(biased && biased.length ? biased : secondary)
        || pickPlay(secondary)
        || pickDeferred(biased && biased.length ? biased : secondary)
        || pickDeferred(secondary)
        || pickAny(teamPlays);
      if (play) selected[index] = play;
      return selected[index];
    }

    var slot1 = place(0, insideRuns.length ? insideRuns : runs, teamPlays);
    place(1, rhythmPasses.length ? rhythmPasses : passes, teamPlays);
    place(2, edgeRuns.length ? edgeRuns : runs, teamPlays);
    var slot4 = place(3, insideRuns.length ? insideRuns : runs, teamPlays);
    var setupBase1 = slot4 || slot1;
    place(4, payoffPlays(setupBase1), passes);
    place(5, rhythmPasses.length ? rhythmPasses : passes, teamPlays);
    var slot7 = place(6, constraintPlays.length ? constraintPlays : teamPlays, teamPlays);
    place(7, intermediatePasses.length ? intermediatePasses : passes, teamPlays);
    var slot9 = place(8, insideRuns.length ? insideRuns : runs, teamPlays);
    var setupBase2 = slot9 || slot7 || slot4;
    place(9, payoffPlays(setupBase2), passes);
    place(10, screens.length ? screens : rhythmPasses, passes);
    place(11, edgeRuns.length ? edgeRuns : runs, teamPlays);
    place(12, deepShots.length ? deepShots : passes, teamPlays);
    place(13, moneyDownPasses.length ? moneyDownPasses : passes, teamPlays);
    place(14, redzoneFinishers.length ? redzoneFinishers : teamPlays, teamPlays);

    for (var hole = 0; hole < SCRIPT_LENGTH; hole += 1) {
      if (selected[hole]) continue;
      var fallback = pickAny(teamPlays);
      if (!fallback) break;
      selected[hole] = fallback;
    }

    return {
      playIds: selected.filter(Boolean).map(function (play) { return play.id; }).slice(0, SCRIPT_LENGTH),
      usedShell: !!(shell && shell.distribution && shell.distribution.entries && shell.distribution.entries.length),
    };
  }

  return {
    SCRIPT_LENGTH: SCRIPT_LENGTH,
    SHELL_MIN_OBSERVATIONS: SHELL_MIN_OBSERVATIONS,
    isEarlyDownScriptSituation: isEarlyDownScriptSituation,
    openingScriptOpponentShell: openingScriptOpponentShell,
    openingScriptPlayScore: openingScriptPlayScore,
    shuffleList: shuffleList,
    fillOpeningScript: fillOpeningScript,
  };
});
