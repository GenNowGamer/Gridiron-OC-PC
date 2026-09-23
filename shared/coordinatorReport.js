(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.GridironCoordinatorReport = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SETUP_PAYOFF = {
    inside_zone: ["boot", "flood", "shot"],
    split_zone: ["boot", "leak", "flood"],
    duo_power: ["shot", "flood", "leak"],
    wide_zone: ["boot", "flood", "shot"],
    counter: ["leak", "shot", "boot"],
    jet: ["boot", "flood", "leak"],
    trap: ["quick_game", "shot"],
    dive: ["quick_game", "shot"],
    draw: ["boot", "flood", "shot"],
    iso: ["quick_game", "boot", "shot"],
    read_option: ["shot", "quick_game", "flood"],
    smash: ["inside_zone", "shot", "boot"],
    verticals: ["quick_game", "inside_zone"],
    levels_dig: ["shot", "boot", "flood"],
    curl_flat: ["shot", "flood", "boot"],
    snag_spot: ["shot", "boot", "flood"],
    rpo: ["shot", "quick_game"],
  };

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function titleCaseWords(value) {
    return cleanText(value)
      .replace(/[_|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, function (ch) {
        return ch.toUpperCase();
      });
  }

  function formatFamilyLabel(family) {
    return titleCaseWords(family || "unknown");
  }

  function formatSituationBucket(bucket) {
    const raw = cleanText(bucket).toLowerCase();
    if (!raw) return "Unknown spot";
    return titleCaseWords(
      raw
        .replace(/^first_/, "1st_")
        .replace(/^second_/, "2nd_")
        .replace(/^third_/, "3rd_")
        .replace(/^fourth_/, "4th_")
    );
  }

  function formatFormationSet(formationSetKey, formation, setName) {
    if (cleanText(formation) || cleanText(setName)) {
      return [cleanText(formation), cleanText(setName)].filter(Boolean).join(" / ") || "Unknown shell";
    }
    const parts = cleanText(formationSetKey).split("|").filter(Boolean);
    if (!parts.length) return "Unknown shell";
    return parts.map(titleCaseWords).join(" / ");
  }

  function formatSigned(value, digits) {
    const n = toNumber(value, 0);
    const places = Number.isFinite(Number(digits)) ? Number(digits) : 1;
    const text = n.toFixed(places);
    if (n > 0) return "+" + text;
    return text;
  }

  function percentLabel(count, total) {
    if (!total) return "0%";
    return Math.round((count / total) * 100) + "%";
  }

  function identityFamiliesFromProfile(profile) {
    return Object.entries((profile && profile.families) || {})
      .filter(function (entry) {
        return Number(entry[1]) > 0;
      })
      .map(function (entry) {
        return entry[0];
      });
  }

  function normalizeStyleChange(entry) {
    const safe = entry || {};
    return {
      at: Number.isFinite(Number(safe.at)) ? Number(safe.at) : Date.now(),
      fromConfirmIndex: Math.max(0, toNumber(safe.fromConfirmIndex, 0)),
      coordinatorId: cleanText(safe.coordinatorId) || "normal",
      coordinatorLabel: cleanText(safe.coordinatorLabel) || "Normal",
      personalityFamilies: Array.isArray(safe.personalityFamilies) ? safe.personalityFamilies.slice() : [],
      personalityTypes: Array.isArray(safe.personalityTypes) ? safe.personalityTypes.slice() : [],
    };
  }

  function createEmptySessionReport(meta) {
    const safe = meta || {};
    return {
      startedAt: Date.now(),
      team: cleanText(safe.team),
      teamLabel: cleanText(safe.teamLabel) || cleanText(safe.team),
      opponent: cleanText(safe.opponent),
      opponentLabel: cleanText(safe.opponentLabel) || cleanText(safe.opponent) || "Not set",
      identityLabel: cleanText(safe.identityLabel) || "Adaptive",
      identityFamilies: Array.isArray(safe.identityFamilies) ? safe.identityFamilies.slice() : [],
      coordinatorId: cleanText(safe.coordinatorId) || "normal",
      coordinatorLabel: cleanText(safe.coordinatorLabel) || "Normal",
      personalityFamilies: Array.isArray(safe.personalityFamilies) ? safe.personalityFamilies.slice() : [],
      personalityTypes: Array.isArray(safe.personalityTypes) ? safe.personalityTypes.slice() : [],
      styleChanges: Array.isArray(safe.styleChanges) ? safe.styleChanges.map(normalizeStyleChange) : [],
      scoutingEnabled: safe.scoutingEnabled === true,
      confirms: [],
    };
  }

  function cloneSession(session) {
    const safe = session || createEmptySessionReport();
    return {
      ...safe,
      identityFamilies: Array.isArray(safe.identityFamilies) ? safe.identityFamilies.slice() : [],
      personalityFamilies: Array.isArray(safe.personalityFamilies) ? safe.personalityFamilies.slice() : [],
      personalityTypes: Array.isArray(safe.personalityTypes) ? safe.personalityTypes.slice() : [],
      styleChanges: Array.isArray(safe.styleChanges) ? safe.styleChanges.map(normalizeStyleChange) : [],
      confirms: Array.isArray(safe.confirms) ? safe.confirms.map(function (item) {
        return {
          ...item,
          beaterFlags: { ...(item.beaterFlags || {}) },
          penalty: item.penalty ? { ...item.penalty } : null,
          outcome: item.outcome ? { ...item.outcome } : null,
        };
      }) : [],
    };
  }

  /** Mid-game / Halftime style change — keeps confirms; segments personality grading. */
  function recordCoordinatorStyleChange(session, meta) {
    const next = cloneSession(session);
    next.styleChanges.push(normalizeStyleChange({
      ...(meta || {}),
      fromConfirmIndex: next.confirms.length,
      at: Date.now(),
    }));
    return next;
  }

  function formatCoordinatorHistoryLabel(session, snapshot) {
    const labels = [];
    const pushUnique = function (label) {
      const clean = cleanText(label);
      if (!clean) return;
      if (labels[labels.length - 1] === clean) return;
      labels.push(clean);
    };
    pushUnique(session?.coordinatorLabel);
    (Array.isArray(session?.styleChanges) ? session.styleChanges : []).forEach(function (change) {
      pushUnique(change.coordinatorLabel);
    });
    if (labels.length > 1) return labels.join(" → ");
    if (labels.length === 1) return labels[0];
    return cleanText(snapshot?.coordinatorLabel) || "Normal";
  }

  function listCoordinatorStyleSegments(session, confirmCount) {
    const total = Math.max(0, toNumber(confirmCount, 0));
    const initial = {
      coordinatorId: cleanText(session?.coordinatorId) || "normal",
      coordinatorLabel: cleanText(session?.coordinatorLabel) || "Normal",
      personalityFamilies: Array.isArray(session?.personalityFamilies) ? session.personalityFamilies.slice() : [],
      personalityTypes: Array.isArray(session?.personalityTypes) ? session.personalityTypes.slice() : [],
      startIndex: 0,
    };
    const points = [initial];
    (Array.isArray(session?.styleChanges) ? session.styleChanges : []).forEach(function (change) {
      points.push({
        coordinatorId: change.coordinatorId,
        coordinatorLabel: change.coordinatorLabel,
        personalityFamilies: change.personalityFamilies,
        personalityTypes: change.personalityTypes,
        startIndex: Math.max(0, toNumber(change.fromConfirmIndex, 0)),
      });
    });
    points.sort(function (a, b) {
      return a.startIndex - b.startIndex;
    });
    const collapsed = [];
    points.forEach(function (point) {
      const last = collapsed[collapsed.length - 1];
      if (last && last.startIndex === point.startIndex) {
        collapsed[collapsed.length - 1] = point;
        return;
      }
      collapsed.push(point);
    });
    return collapsed.map(function (point, index) {
      const endIndex = index + 1 < collapsed.length ? collapsed[index + 1].startIndex : total;
      return {
        ...point,
        endIndex: Math.max(point.startIndex, endIndex),
      };
    }).filter(function (segment) {
      return total === 0 ? segment.startIndex === 0 : segment.startIndex < total;
    });
  }

  function matchesPersonalityStyle(confirm, style) {
    const families = style?.personalityFamilies || [];
    const types = style?.personalityTypes || [];
    if (families.includes(confirm.family)) return true;
    if (types.includes(confirm.type)) return true;
    return false;
  }

  function normalizeConfirmEntry(entry) {
    const safe = entry || {};
    const penalty = safe.penalty && cleanText(safe.penalty.id)
      ? {
          id: cleanText(safe.penalty.id),
          label: cleanText(safe.penalty.label),
          effect: cleanText(safe.penalty.effect),
          at: Number.isFinite(Number(safe.penalty.at)) ? Number(safe.penalty.at) : Date.now(),
        }
      : null;
    return {
      playId: cleanText(safe.playId),
      playName: cleanText(safe.playName),
      family: cleanText(safe.family) || "unknown",
      type: cleanText(safe.type).toUpperCase() || "PASS",
      formation: cleanText(safe.formation),
      set: cleanText(safe.set),
      formationSetKey: cleanText(safe.formationSetKey),
      rank: Math.max(1, Math.min(3, toNumber(safe.rank, 1))),
      situationBucket: cleanText(safe.situationBucket) || "unknown",
      scriptMatch: safe.scriptMatch === true,
      scriptTag: cleanText(safe.scriptTag),
      topFamily: cleanText(safe.topFamily),
      topPlayName: cleanText(safe.topPlayName),
      beaterFlags: {
        manBeater: safe.beaterFlags?.manBeater === true,
        cover2Beater: safe.beaterFlags?.cover2Beater === true,
        cover3Beater: safe.beaterFlags?.cover3Beater === true,
        cover4Beater: safe.beaterFlags?.cover4Beater === true,
        blitzAnswer: safe.beaterFlags?.blitzAnswer === true,
      },
      penalty: penalty,
      outcome: null,
      at: Date.now(),
    };
  }

  function appendConfirm(session, entry) {
    const next = cloneSession(session);
    const confirm = normalizeConfirmEntry(entry);
    const last = next.confirms[next.confirms.length - 1];
    if (last && !last.outcome) {
      next.confirms[next.confirms.length - 1] = confirm;
    } else {
      next.confirms.push(confirm);
    }
    return next;
  }

  function attachPenalty(session, penalty, playId) {
    const next = cloneSession(session);
    const wantedId = cleanText(playId);
    const stamp = penalty && cleanText(penalty.id)
      ? {
          id: cleanText(penalty.id),
          label: cleanText(penalty.label),
          effect: cleanText(penalty.effect),
          at: Number.isFinite(Number(penalty.at)) ? Number(penalty.at) : Date.now(),
        }
      : null;
    for (let i = next.confirms.length - 1; i >= 0; i -= 1) {
      const confirm = next.confirms[i];
      if (confirm.outcome) continue;
      if (wantedId && confirm.playId && confirm.playId !== wantedId) continue;
      next.confirms[i] = { ...confirm, penalty: stamp };
      break;
    }
    return next;
  }

  function attachOutcome(session, outcome, playId) {
    const next = cloneSession(session);
    const wantedId = cleanText(playId);
    if (!outcome) return next;
    const penaltySkipLearn = outcome.penaltySkipLearn === true;
    const payload = {
      successPoints: toNumber(outcome.successPoints, 0),
      yardsGained: penaltySkipLearn && (outcome.yardsGained === null || outcome.yardsGained === undefined)
        ? null
        : toNumber(outcome.yardsGained, 0),
      firstDownAchieved: outcome.firstDownAchieved === true,
      explosiveGain: outcome.explosiveGain === true,
      negativePlay: outcome.negativePlay === true,
      terminalResult: cleanText(outcome.terminalResult),
      penaltySkipLearn: penaltySkipLearn,
      penaltyVoid: outcome.penaltyVoid === true,
      penaltyId: cleanText(outcome.penaltyId),
      penaltyLabel: cleanText(outcome.penaltyLabel),
    };
    for (let i = next.confirms.length - 1; i >= 0; i -= 1) {
      const confirm = next.confirms[i];
      if (confirm.outcome) continue;
      if (wantedId && confirm.playId && confirm.playId !== wantedId) continue;
      next.confirms[i] = { ...confirm, outcome: payload };
      break;
    }
    return next;
  }

  function matchesIdentity(confirm, session) {
    const families = session.identityFamilies || [];
    return families.includes(confirm.family);
  }

  function matchesPersonality(confirm, session) {
    return matchesPersonalityStyle(confirm, session);
  }

  function playBeatsDefense(confirm, defense) {
    const flags = confirm?.beaterFlags || {};
    const key = cleanText(defense);
    if (key === "Man" || key === "Cover 1") return flags.manBeater === true;
    if (key === "Cover 2" || key === "Tampa 2") return flags.cover2Beater === true;
    if (key === "Cover 3") return flags.cover3Beater === true;
    if (key === "Cover 4" || key === "Cover 6") return flags.cover4Beater === true;
    if (key === "Blitz" || key === "Cover 9") return flags.blitzAnswer === true;
    return false;
  }

  function average(values) {
    if (!values.length) return 0;
    return values.reduce(function (sum, value) {
      return sum + value;
    }, 0) / values.length;
  }

  function groupAverages(rows, keyFn, minSamples) {
    const grouped = {};
    rows.forEach(function (row) {
      const key = keyFn(row);
      if (!key) return;
      if (!grouped[key]) grouped[key] = { key: key, points: [], n: 0 };
      grouped[key].points.push(row.successPoints);
      grouped[key].n += 1;
    });
    return Object.values(grouped)
      .filter(function (item) {
        return item.n >= (minSamples || 1);
      })
      .map(function (item) {
        return {
          key: item.key,
          n: item.n,
          avg: average(item.points),
        };
      })
      .sort(function (a, b) {
        return (b.avg - a.avg) || (b.n - a.n) || a.key.localeCompare(b.key);
      });
  }

  function mostCommon(values) {
    const counts = {};
    values.forEach(function (value) {
      const key = cleanText(value);
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).sort(function (a, b) {
      return (b[1] - a[1]) || a[0].localeCompare(b[0]);
    })[0] || null;
  }

  function buildHeader(session, snapshot) {
    return {
      teamLabel: cleanText(snapshot.teamLabel) || session.teamLabel || session.team || "Team",
      identityLabel: cleanText(snapshot.identityLabel) || session.identityLabel || "Adaptive",
      coordinatorLabel: formatCoordinatorHistoryLabel(session, snapshot),
      opponentLabel: cleanText(snapshot.opponentLabel) || session.opponentLabel || "Not set",
      scoreboardText: cleanText(snapshot.scoreboardText),
    };
  }

  function buildTrust(confirms) {
    if (!confirms.length) {
      return {
        empty: true,
        headline: "No confirmed recommendations this game.",
        detail: "Tap a recommendation circle when you run a play. Trust only scores calls you confirmed.",
        items: [],
      };
    }
    const topCount = confirms.filter(function (item) {
      return item.rank === 1;
    }).length;
    const overrides = confirms.filter(function (item) {
      return item.rank > 1;
    });
    const overridePair = mostCommon(overrides.map(function (item) {
      if (!item.topFamily || item.topFamily === item.family) return "";
      return item.family + "|" + item.topFamily;
    }).filter(Boolean));
    let overrideNote = overrides.length
      ? "You overrode the top rec " + overrides.length + " time" + (overrides.length === 1 ? "" : "s") + "."
      : "You stayed with the top recommendation every time.";
    if (overridePair) {
      const parts = overridePair[0].split("|");
      overrideNote = "Most common override: " + formatFamilyLabel(parts[0]) + " instead of " + formatFamilyLabel(parts[1]) + ".";
    }
    return {
      empty: false,
      headline: "Ran #1 on " + topCount + " of " + confirms.length + " confirms",
      detail: percentLabel(topCount, confirms.length) + " top-rec trust. " + overrideNote,
      items: [],
    };
  }

  function buildIdentity(session, confirms) {
    if (!confirms.length) {
      return {
        empty: true,
        headline: "No identity grade yet.",
        detail: "Identity and coordinator personality are graded from confirmed calls.",
        items: [],
      };
    }
    const identityHits = confirms.filter(function (item) {
      return matchesIdentity(item, session);
    }).length;
    const offIdentity = confirms.filter(function (item) {
      return !matchesIdentity(item, session);
    });
    const breakFam = mostCommon(offIdentity.map(function (item) {
      return item.family;
    }));
    const items = [
      {
        label: session.identityLabel || "Team identity",
        value: percentLabel(identityHits, confirms.length) + " identity fit",
      },
    ];
    const segments = listCoordinatorStyleSegments(session, confirms.length);
    const multiStyle = segments.length > 1;
    segments.forEach(function (segment) {
      const slice = confirms.slice(segment.startIndex, segment.endIndex);
      if (!slice.length) return;
      const personalityActive = (segment.personalityFamilies || []).length > 0 || (segment.personalityTypes || []).length > 0;
      const labelBase = segment.coordinatorLabel || "Coordinator";
      const spanNote = multiStyle
        ? " · confirms " + (segment.startIndex + 1) + "-" + segment.endIndex
        : "";
      if (personalityActive && segment.coordinatorId !== "normal") {
        const personalityHits = slice.filter(function (item) {
          return matchesPersonalityStyle(item, segment);
        }).length;
        items.push({
          label: labelBase + spanNote,
          value: percentLabel(personalityHits, slice.length) + " personality fit",
        });
      } else {
        items.push({
          label: labelBase + spanNote,
          value: "Balanced coordinator — no personality lean to grade",
        });
      }
    });
    let detail = identityHits === confirms.length
      ? "Every confirm stayed inside the team identity families."
      : "Identity families are the concepts this playbook wants to live in.";
    if (multiStyle) {
      detail = "Halftime/style changes graded separately: " + formatCoordinatorHistoryLabel(session, {}) + ". " + detail;
    }
    if (breakFam && breakFam[1] >= 2) {
      detail = (multiStyle ? "Halftime/style changes graded separately. " : "")
        + "Biggest identity break: " + formatFamilyLabel(breakFam[0]) + " (" + breakFam[1] + " confirms).";
    }
    return {
      empty: false,
      headline: percentLabel(identityHits, confirms.length) + " identity fidelity",
      detail: detail,
      items: items,
    };
  }

  function buildSuccess(confirms) {
    const scored = confirms.filter(function (item) {
      if (!item.outcome || item.outcome.penaltySkipLearn === true) return false;
      return Number.isFinite(Number(item.outcome.successPoints));
    }).map(function (item) {
      return {
        family: item.family,
        situationBucket: item.situationBucket,
        successPoints: Number(item.outcome.successPoints),
      };
    });
    if (!scored.length) {
      const penaltyCount = confirms.filter(function (item) {
        return item.penalty || (item.outcome && item.outcome.penaltySkipLearn === true);
      }).length;
      return {
        empty: true,
        headline: "No success points yet.",
        detail: penaltyCount
          ? penaltyCount + " penalty call" + (penaltyCount === 1 ? "" : "s") + " logged and not scored for learning. Confirm a play, then speak the next situation or pick a drive result."
          : "Confirm a play, then speak the next situation or pick a drive result. Gridiron scores schedule success, not Madden yards.",
        items: [],
      };
    }
    const familyStats = groupAverages(scored, function (row) {
      return row.family;
    }, 2);
    const situationStats = groupAverages(scored, function (row) {
      return row.situationBucket;
    }, 2);
    const leaders = familyStats.filter(function (item) {
      return item.avg > 0;
    }).slice(0, 3);
    const laggards = familyStats.filter(function (item) {
      return item.avg < 0;
    }).sort(function (a, b) {
      return a.avg - b.avg;
    }).slice(0, 3);
    const items = [];
    leaders.forEach(function (item) {
      items.push({
        label: "Leader · " + formatFamilyLabel(item.key),
        value: formatSigned(item.avg) + " SP / " + item.n,
      });
    });
    laggards.forEach(function (item) {
      items.push({
        label: "Laggard · " + formatFamilyLabel(item.key),
        value: formatSigned(item.avg) + " SP / " + item.n,
      });
    });
    situationStats.slice(0, 2).forEach(function (item) {
      items.push({
        label: formatSituationBucket(item.key),
        value: formatSigned(item.avg) + " SP",
      });
    });
    const worstSpot = situationStats.slice().sort(function (a, b) {
      return a.avg - b.avg;
    })[0];
    if (worstSpot && worstSpot.avg < 0 && !items.some(function (row) {
      return row.label === formatSituationBucket(worstSpot.key);
    })) {
      items.push({
        label: formatSituationBucket(worstSpot.key),
        value: formatSigned(worstSpot.avg) + " SP",
      });
    }
    const penaltyCount = confirms.filter(function (item) {
      return item.penalty || (item.outcome && item.outcome.penaltySkipLearn === true);
    }).length;
    let detail = scored.length + " scored call" + (scored.length === 1 ? "" : "s") + " from situation-to-situation learning — not a Madden box score.";
    if (penaltyCount) {
      detail += " " + penaltyCount + " penalty call" + (penaltyCount === 1 ? "" : "s") + " not scored.";
    }
    return {
      empty: false,
      headline: formatSigned(average(scored.map(function (row) {
        return row.successPoints;
      }))) + " avg success points",
      detail: detail,
      items: items.slice(0, 8),
    };
  }

  function buildSequence(session, confirms, snapshot) {
    const scriptHits = confirms.filter(function (item) {
      return item.scriptMatch;
    }).length;
    if (confirms.length < 2 && !scriptHits) {
      return {
        empty: true,
        headline: "No sequencing to grade yet.",
        detail: "Setup/payoff and script beats appear after a handful of confirmed calls.",
        items: [],
      };
    }
    let payoffsCashed = 0;
    let setupsWithoutPayoff = 0;
    confirms.forEach(function (confirm, index) {
      if (!index) return;
      const prev = confirms[index - 1];
      const payoffs = SETUP_PAYOFF[prev.family] || [];
      if (!payoffs.length) return;
      if (payoffs.includes(confirm.family)) payoffsCashed += 1;
      else setupsWithoutPayoff += 1;
    });
    const scriptDeckLength = Math.max(0, toNumber(snapshot.scriptDeckLength, 0));
    const items = [
      { label: "Payoffs cashed", value: String(payoffsCashed) },
      { label: "Setups left hanging", value: String(setupsWithoutPayoff) },
    ];
    // Cumulative on-script confirms for the whole game — not live scriptIndex
    // (that resets on New Drive / mode change and falsely read as 0 / deck).
    if (scriptHits || scriptDeckLength) {
      items.push({
        label: "Script beats",
        value: scriptDeckLength
          ? scriptHits + " hits · deck " + scriptDeckLength
          : String(scriptHits),
      });
    }
    let detail = "Gridiron bonuses the payoff family after you establish the run.";
    if (payoffsCashed && setupsWithoutPayoff === 0) {
      detail = "You cashed every setup you created.";
    } else if (setupsWithoutPayoff > payoffsCashed) {
      detail = "You established looks more often than you took the payoff.";
    } else if (payoffsCashed) {
      detail = "You hit " + payoffsCashed + " setup-payoff sequence" + (payoffsCashed === 1 ? "" : "s") + " this game.";
    }
    return {
      empty: false,
      headline: payoffsCashed ? payoffsCashed + " payoff" + (payoffsCashed === 1 ? "" : "s") + " cashed" : "No payoffs cashed",
      detail: detail,
      items: items,
    };
  }

  function buildScouting(session, confirms, defenses) {
    if (session.scoutingEnabled !== true) {
      return {
        empty: true,
        hidden: true,
        headline: "",
        detail: "",
        items: [],
      };
    }
    const logs = Array.isArray(defenses) ? defenses.filter(function (item) {
      return cleanText(item?.defense);
    }) : [];
    if (!logs.length) {
      return {
        empty: true,
        hidden: false,
        headline: "No coverages logged.",
        detail: "Use Last Defense Shown after the snap. Gridiron scouts what Madden showed, not the box score.",
        items: [],
      };
    }
    const diet = {};
    logs.forEach(function (item) {
      const defense = cleanText(item.defense);
      diet[defense] = (diet[defense] || 0) + 1;
    });
    const dietRows = Object.entries(diet).sort(function (a, b) {
      return (b[1] - a[1]) || a[0].localeCompare(b[0]);
    });
    let hits = 0;
    let misses = 0;
    let unmatched = 0;
    logs.forEach(function (item) {
      const playId = cleanText(item.playId);
      const confirm = confirms.slice().reverse().find(function (row) {
        return row.playId && row.playId === playId;
      }) || confirms.slice().reverse().find(function (row) {
        return row.family && row.family === cleanText(item.family);
      });
      if (!confirm) {
        unmatched += 1;
        return;
      }
      if (playBeatsDefense(confirm, item.defense)) hits += 1;
      else misses += 1;
    });
    const matched = hits + misses;
    const items = dietRows.slice(0, 5).map(function (entry) {
      return {
        label: entry[0],
        value: entry[1] + " · " + percentLabel(entry[1], logs.length),
      };
    });
    if (matched > 0) {
      items.push({
        label: "Matchup hits",
        value: hits + " of " + matched + " matched (" + logs.length + " logged)",
      });
    }
    const top = dietRows[0];
    let detail = logs.length + " observation" + (logs.length === 1 ? "" : "s") + " vs " + (session.opponentLabel || "this opponent") + ". Stored for the next time you face them.";
    if (unmatched > 0) {
      detail += " Matchup graded on " + matched + " with a linked confirm (" + unmatched + " unmatched).";
    }
    return {
      empty: false,
      hidden: false,
      headline: top ? top[0] + " was their coverage diet" : "Coverage diet",
      detail: detail,
      items: items,
    };
  }

  function buildVariety(confirms) {
    if (confirms.length < 2) {
      return {
        empty: true,
        headline: "Not enough confirms to grade variety.",
        detail: "Shell diversity needs at least two confirmed calls.",
        items: [],
      };
    }
    const shells = confirms.map(function (item) {
      return formatFormationSet(item.formationSetKey, item.formation, item.set);
    });
    const uniqueShells = new Set(shells);
    const recycled = mostCommon(shells);
    const families = new Set(confirms.map(function (item) {
      return item.family;
    }));
    const items = [
      { label: "Unique shells", value: String(uniqueShells.size) },
      { label: "Families used", value: String(families.size) },
    ];
    let detail = "Gridiron fights repeated formation-set shells harder than repeated play names.";
    if (recycled && recycled[1] >= 3) {
      items.push({
        label: "Most recycled shell",
        value: recycled[0] + " × " + recycled[1],
      });
      detail = recycled[0] + " came back " + recycled[1] + " times. That’s the tell a defense can sit on.";
    } else if (recycled) {
      items.push({
        label: "Most used shell",
        value: recycled[0],
      });
    }
    return {
      empty: false,
      headline: uniqueShells.size + " distinct shell" + (uniqueShells.size === 1 ? "" : "s"),
      detail: detail,
      items: items,
    };
  }

  function buildLearned(confirms) {
    const scored = confirms.filter(function (item) {
      if (!item.outcome || item.outcome.penaltySkipLearn === true) return false;
      return Number.isFinite(Number(item.outcome.successPoints));
    });
    if (!scored.length) {
      return {
        empty: true,
        headline: "Nothing persisted this game.",
        detail: "Confirm plays and keep calling the next situation. Those outcomes softly train the next game.",
        items: [],
      };
    }
    const familyStats = groupAverages(scored.map(function (item) {
      return { family: item.family, situationBucket: item.situationBucket, successPoints: Number(item.outcome.successPoints) };
    }), function (row) {
      return row.family;
    }, 1);
    const items = [];
    familyStats.filter(function (item) {
      return item.avg >= 0.75;
    }).slice(0, 3).forEach(function (item) {
      items.push({
        label: formatFamilyLabel(item.key),
        value: "Upweighted · " + formatSigned(item.avg) + " SP",
      });
    });
    familyStats.filter(function (item) {
      return item.avg <= -0.75;
    }).sort(function (a, b) {
      return a.avg - b.avg;
    }).slice(0, 2).forEach(function (item) {
      items.push({
        label: formatFamilyLabel(item.key),
        value: "Downweighted · " + formatSigned(item.avg) + " SP",
      });
    });
    if (!items.length) {
      const top = familyStats[0];
      if (top) {
        items.push({
          label: formatFamilyLabel(top.key),
          value: formatSigned(top.avg) + " SP carried forward",
        });
      }
    }
    return {
      empty: false,
      headline: "Learned for the next game",
      detail: "Soft personal learning now remembers these family results in the same kinds of spots.",
      items: items.slice(0, 5),
    };
  }

  function buildCoordinatorReport(session, snapshot) {
    const safeSession = cloneSession(session);
    const safeSnapshot = snapshot || {};
    const confirms = safeSession.confirms;
    return {
      header: buildHeader(safeSession, safeSnapshot),
      trust: buildTrust(confirms),
      identity: buildIdentity(safeSession, confirms),
      success: buildSuccess(confirms),
      sequence: buildSequence(safeSession, confirms, safeSnapshot),
      scouting: buildScouting(safeSession, confirms, safeSnapshot.defenses),
      variety: buildVariety(confirms),
      learned: buildLearned(confirms),
      confirmCount: confirms.length,
    };
  }

  return {
    SETUP_PAYOFF,
    createEmptySessionReport,
    appendConfirm,
    attachPenalty,
    attachOutcome,
    recordCoordinatorStyleChange,
    formatCoordinatorHistoryLabel,
    listCoordinatorStyleSegments,
    identityFamiliesFromProfile,
    formatFamilyLabel,
    formatSituationBucket,
    formatFormationSet,
    buildCoordinatorReport,
  };
});
