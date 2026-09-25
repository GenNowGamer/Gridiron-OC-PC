(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.GridironDefenseRecommendationCore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function getSelectionEngine() {
    if (typeof require === "function") {
      try {
        return require("./selectionEngine");
      } catch (_err) {
        /* browser UMD path */
      }
    }
    return (typeof globalThis !== "undefined" && globalThis.GridironSelectionEngine) || null;
  }

  function upper(value) {
    return cleanText(value).toUpperCase();
  }

  function lower(value) {
    return cleanText(value).toLowerCase();
  }

  const DEFENSIVE_TYPES = ["MAN", "ZONE", "BLITZ", "MATCH", "RETURN", "OTHER"];

  function distToBucket(yards) {
    const n = Number(yards);
    if (!Number.isFinite(n)) return "medium";
    if (n <= 3) return "short";
    if (n <= 6) return "medium";
    return "long";
  }

  function hasKnownFieldPosition(fieldPosition) {
    return Boolean(fieldPosition && fieldPosition.side) && Number.isFinite(Number(fieldPosition.yardLine));
  }

  function buildFieldPositionBucket(fieldPosition, goalToGo) {
    if (goalToGo) return "goal_to_go";
    if (!hasKnownFieldPosition(fieldPosition)) return "unknown";

    const side = fieldPosition.side;
    const yardLine = Number(fieldPosition.yardLine);

    if (side === "MIDFIELD" || yardLine === 50) return "midfield";
    if (side === "OWN") {
      if (yardLine <= 10) return "backed_up";
      if (yardLine <= 25) return "coming_out";
      return "own_territory";
    }
    if (yardLine <= 10) return "high_red_zone";
    if (yardLine <= 20) return "red_zone";
    if (yardLine <= 35) return "plus_territory";
    return "midfield_plus";
  }

  function defensiveFormationKeyOf(play) {
    return upper(play && play.formation);
  }

  function defensiveFormationSetKeyOf(play) {
    const formation = upper(play && play.formation) || "BASE";
    const set = upper(play && play.set) || "BASE";
    return formation + "|" + set;
  }

  function defensiveFamilyOf(play) {
    const type = upper(play && play.type);
    if (type === "BLITZ") return "blitz";
    if (type === "MAN") return "man";
    if (type === "ZONE") return "zone";
    if (type === "MATCH") return "match";
    if (type === "RETURN") return "return";
    return "other";
  }

  function conceptBlob(play) {
    const concepts = Array.isArray(play && play.concepts) ? play.concepts.join(" ") : "";
    return lower([play && play.play_name, play && play.formation, play && play.set, concepts].filter(Boolean).join(" "));
  }

  function defensivePlayTraitsOf(play) {
    const type = upper(play && play.type) || "OTHER";
    const formation = upper(play && play.formation);
    const blob = conceptBlob(play);
    const fam = defensiveFamilyOf(play);

    return {
      type: type,
      fam: fam,
      formation: formation,
      formationSetKey: defensiveFormationSetKeyOf(play),
      isBlitz: type === "BLITZ" || /\bblitz\b/.test(blob),
      isMan: type === "MAN" || /\bman\b/.test(blob),
      isZone: type === "ZONE" || /\bzone\b/.test(blob),
      isMatch: type === "MATCH" || /\bmatch\b/.test(blob),
      isReturn: type === "RETURN" || /\breturn\b/.test(blob),
      isSpecialTeams: formation === "SPECIAL TEAMS" || /\bspecial teams\b/.test(blob),
      isGoalLine: formation === "GOAL LINE" || /\bgoal line\b/.test(blob),
      isPrevent: formation === "PREVENT" || /\bprevent\b/.test(blob),
      isNickel: formation === "NICKEL",
      isDime: formation === "DIME",
      isDollar: formation === "DOLLAR",
      isFourThree: formation === "4-3",
      isThreeThreeFive: formation === "3-3-5",
      isFortySix: formation === "46",
      isCover1: /\bcover\s*1\b|\bc1\b/.test(blob),
      isCover2: /\bcover\s*2\b|\bc2\b/.test(blob),
      isCover3: /\bcover\s*3\b|\bc3\b/.test(blob),
      isCover4: /\bcover\s*4\b|\bquarters\b|\bc4\b/.test(blob),
      isPressure: type === "BLITZ" || /\bpressure|fire|send\b/.test(blob),
      isZeroBlitz: (type === "BLITZ" || /\bblitz|pressure\b/.test(blob)) && /\b(0|zero|smoke)\b/.test(blob),
      isZoneBlitz: (type === "BLITZ" || /\bblitz|pressure|fire\b/.test(blob)) && (
        type === "ZONE" || /\b(zone|fire\s*3|3|2|trap|cloud|sky|buzz|invert|roll)\b/.test(blob)
      ) && !/\b(0|zero|smoke|1|man)\b/.test(blob),
      isManBlitz: (type === "BLITZ" || /\bblitz|pressure\b/.test(blob)) && (
        type === "MAN" || /\b(man|cover\s*1|c1|1|hole|sting|brave|dog)\b/.test(blob) || !/\b(zone|fire\s*3|3|2|trap|cloud|sky|buzz)\b/.test(blob)
      ),
      concepts: Array.isArray(play && play.concepts) ? play.concepts.slice() : [],
    };
  }

  function normalizeScoreDiff(ctx) {
    if (Number.isFinite(Number(ctx && ctx.scoreDiff))) return Number(ctx.scoreDiff);
    const userScore = Number(ctx && ctx.userScore);
    const oppScore = Number(ctx && ctx.oppScore);
    if (Number.isFinite(userScore) && Number.isFinite(oppScore)) return userScore - oppScore;
    return null;
  }

  function yardsKnown(ctx) {
    const yards = Number(ctx && ctx.yards);
    return Number.isFinite(yards) && yards > 0;
  }

  function isLongMoneyDown(ctx) {
    const down = Number(ctx && ctx.down) || 1;
    if (down < 3) return false;
    if (!yardsKnown(ctx)) return false;
    const yards = Number(ctx.yards);
    const bucket = (ctx && ctx.distBucket) || distToBucket(yards);
    return bucket === "long" || yards >= 10;
  }

  /**
   * Prevent is a protect-the-lead / deep-shot shell — not a generic 3rd-down call.
   * Eligible only for Hail Mary looks, or late lead + long yardage (Q4/OT, or
   * clearly long at the end of the half).
   */
  function isPreventEligibleContext(ctx) {
    const offense = offenseShowingTraitsOf(ctx && ctx.offenseShowing);
    if (offense && offense.isHailMary) return true;

    const scoreDiff = normalizeScoreDiff(ctx);
    const leading = Number.isFinite(scoreDiff) && scoreDiff > 0;
    if (!leading) return false;
    if (!yardsKnown(ctx)) return false;

    const yards = Number(ctx.yards);
    const bucket = (ctx && ctx.distBucket) || distToBucket(yards);
    const longEnough = bucket === "long" || yards >= 10;
    if (!longEnough) return false;

    const quarter = Number(ctx && ctx.quarter);
    if (quarter === 4 || quarter === 5) return true;
    // End-of-half deep-ball protect: only when clearly very long.
    if (quarter === 2 && yards >= 15) return true;
    return false;
  }

  function buildGameContextFields(params) {
    const source = params || {};
    const userScore = Number(source.userScore);
    const oppScore = Number(source.oppScore);
    const quarter = Number(source.quarter);
    const scoreDiff = Number.isFinite(Number(source.scoreDiff))
      ? Number(source.scoreDiff)
      : (Number.isFinite(userScore) && Number.isFinite(oppScore) ? userScore - oppScore : null);
    return {
      quarter: Number.isFinite(quarter) && quarter >= 1 ? quarter : null,
      userScore: Number.isFinite(userScore) ? userScore : null,
      oppScore: Number.isFinite(oppScore) ? oppScore : null,
      scoreDiff: scoreDiff,
    };
  }

  /**
   * OC-style situation plan for defense: intent, preferred shells, and hard
   * discouragements (especially Prevent outside protect-lead windows).
   */
  function buildDefensiveSituationPlan(ctx) {
    const down = Number(ctx && ctx.down) || 1;
    const yards = Number(ctx && ctx.yards);
    const bucket = (ctx && ctx.distBucket) || distToBucket(yards);
    const goalToGo = !!(ctx && ctx.goalToGo);
    const fieldBucket = (ctx && ctx.fieldPositionBucket) || "unknown";
    const money = down >= 3;
    const shortSpot = goalToGo || bucket === "short";
    const trueGoalLine = isTrueGoalLineDefenseContext(ctx);
    const redish =
      fieldBucket === "goal_to_go" ||
      fieldBucket === "high_red_zone" ||
      fieldBucket === "red_zone";
    const backedUp = fieldBucket === "backed_up" || fieldBucket === "coming_out";
    const allowPrevent = isPreventEligibleContext(ctx);
    const scoreDiff = normalizeScoreDiff(ctx);
    const protectLead =
      Number.isFinite(scoreDiff) && scoreDiff > 0 &&
      (Number(ctx && ctx.quarter) === 4 || Number(ctx && ctx.quarter) === 5);

    const plan = {
      intent: "balanced",
      allowPrevent: allowPrevent,
      pressureLean: "medium",
      preferPackages: ["nickel", "four_three"],
      discouragePackages: allowPrevent ? [] : ["prevent"],
      preferFamilies: ["zone", "match"],
      discourageFamilies: [],
    };

    if (shortSpot || (redish && bucket === "short")) {
      plan.intent = "stop_short";
      plan.pressureLean = "high";
      plan.preferPackages = ["forty_six", "four_three", "nickel"];
      if (trueGoalLine) plan.preferPackages.unshift("goal_line");
      plan.discouragePackages = ["prevent", "dime", "dollar"];
      plan.preferFamilies = ["blitz", "man", "match", "zone_blitz", "man_blitz"];
      plan.discourageFamilies = ["zone"];
    } else if (money && bucket === "medium") {
      // 3rd/4th & 4-6: contest the sticks — never Prevent.
      plan.intent = "money_medium";
      plan.pressureLean = "medium_high";
      plan.preferPackages = ["nickel", "four_three", "three_three_five"];
      plan.discouragePackages = ["prevent", "goal_line"];
      plan.preferFamilies = ["match", "zone", "man", "blitz", "zone_blitz", "man_blitz"];
    } else if (money && (bucket === "long" || (Number.isFinite(yards) && yards >= 10))) {
      plan.intent = "money_long";
      plan.pressureLean = protectLead ? "low" : "medium";
      plan.preferPackages = ["nickel", "dime", "dollar", "three_three_five"];
      plan.discouragePackages = allowPrevent ? ["goal_line", "forty_six"] : ["prevent", "goal_line", "forty_six"];
      if (allowPrevent) plan.preferPackages.push("prevent");
      plan.preferFamilies = ["zone", "match", "zone_blitz"];
      // In money_long, do not blanket-discourage all blitzes; zone blitzes and disguised pressures are standard NFL calls.
      plan.discourageFamilies = protectLead ? ["blitz", "man_blitz"] : [];
    } else if (down <= 2 && bucket === "long") {
      plan.intent = "early_long";
      plan.pressureLean = "medium";
      plan.preferPackages = ["nickel", "four_three", "dime"];
      plan.discouragePackages = ["prevent", "goal_line"];
      plan.preferFamilies = ["zone", "match", "zone_blitz"];
    } else if (redish) {
      plan.intent = "red_zone";
      plan.pressureLean = "high";
      plan.preferPackages = ["nickel", "four_three", "forty_six"];
      plan.discouragePackages = ["prevent", "dime", "dollar"];
      plan.preferFamilies = ["man", "blitz", "match", "zone_blitz", "man_blitz"];
    } else if (backedUp) {
      plan.intent = "backed_up_pressure";
      plan.pressureLean = "high";
      plan.preferPackages = ["four_three", "nickel", "forty_six"];
      plan.discouragePackages = ["prevent", "dime"];
      plan.preferFamilies = ["blitz", "man", "zone", "zone_blitz", "man_blitz"];
    } else if (protectLead && !money) {
      plan.intent = "protect_lead";
      plan.pressureLean = "low";
      plan.preferPackages = ["nickel", "four_three"];
      plan.discouragePackages = allowPrevent ? [] : ["prevent"];
      plan.preferFamilies = ["zone", "match"];
      plan.discourageFamilies = ["blitz", "man_blitz"];
    }

    if (!allowPrevent && plan.discouragePackages.indexOf("prevent") < 0) {
      plan.discouragePackages.push("prevent");
    }
    if (!trueGoalLine && plan.discouragePackages.indexOf("goal_line") < 0) {
      plan.discouragePackages.push("goal_line");
    }
    return plan;
  }

  function isTrueGoalLineDefenseContext(ctx) {
    const down = Number(ctx && ctx.down) || 1;
    const yards = Number(ctx && ctx.yards);
    const bucket = (ctx && ctx.distBucket) || distToBucket(yards);
    const goalToGo = !!(ctx && ctx.goalToGo);
    const fieldPosition = ctx && ctx.fieldPosition;
    if (goalToGo) {
      if (Number.isFinite(yards) && yards <= 4) return true;
      if (Number.isFinite(yards) && yards <= 6 && down >= 3) return true;
      return false;
    }
    if (!hasKnownFieldPosition(fieldPosition) || upper(fieldPosition.side) !== "OPP") return false;
    const yardLine = Number(fieldPosition.yardLine);
    if (!Number.isFinite(yardLine)) return false;
    if (yardLine <= 2) return bucket === "short" || down >= 3;
    if (yardLine <= 3) return bucket === "short" && down >= 3;
    return false;
  }

  function packageTraitKey(traits) {
    if (!traits) return "";
    if (traits.isPrevent) return "prevent";
    if (traits.isGoalLine) return "goal_line";
    if (traits.isDime) return "dime";
    if (traits.isDollar) return "dollar";
    if (traits.isFortySix) return "forty_six";
    if (traits.isThreeThreeFive) return "three_three_five";
    if (traits.isNickel) return "nickel";
    if (traits.isFourThree) return "four_three";
    return "";
  }

  function scoreDefensivePlanFit(traits, plan) {
    if (!plan || !traits) return 0;
    let score = 0;
    const packageKey = packageTraitKey(traits);
    const family = traits.fam || "";
    if (packageKey && plan.preferPackages && plan.preferPackages.indexOf(packageKey) >= 0) score += 1.8;
    if (packageKey && plan.discouragePackages && plan.discouragePackages.indexOf(packageKey) >= 0) {
      score -= packageKey === "prevent" ? 8.0 : 2.4;
    }
    if (family && plan.preferFamilies && plan.preferFamilies.indexOf(family) >= 0) score += 1.1;
    if (family && plan.discourageFamilies && plan.discourageFamilies.indexOf(family) >= 0) score -= 1.4;
    if (plan.pressureLean === "high" && traits.isBlitz) score += 1.2;
    if (plan.pressureLean === "low" && traits.isBlitz) score -= 1.6;
    if (plan.pressureLean === "low_medium" && traits.isBlitz) score -= 0.9;
    if (plan.pressureLean === "medium_high" && traits.isBlitz) score += 0.55;
    return score;
  }

  function shouldExcludeDefensivePlay(play, ctx, traits) {
    const t = traits || defensivePlayTraitsOf(play);
    if (t.isReturn || t.isSpecialTeams) return true;
    if (t.type === "OTHER" && !t.isPressure) return true;
    if (t.isPrevent && !isPreventEligibleContext(ctx)) return true;
    if (t.isGoalLine && !isTrueGoalLineDefenseContext(ctx)) return true;
    return false;
  }

  function normalizeOffenseShowing(input) {
    if (!input) return null;
    const formation = upper(input.formation);
    const set = upper(input.set) || "BASE";
    if (!formation) return null;
    return {
      formation: formation,
      set: set,
      blob: lower(formation + " " + set),
    };
  }

  function offenseShowingTraitsOf(offenseShowing) {
    const showing = normalizeOffenseShowing(offenseShowing);
    if (!showing) return null;
    const blob = showing.blob;
    function personnelCount(label) {
      const match = blob.match(new RegExp("(\\d+)\\s*" + label + "\\b"));
      return match ? Number(match[1]) : null;
    }
    const rbCount = personnelCount("rb");
    const teCount = personnelCount("te");
    const wrCount = personnelCount("wr");
    const countedEmpty = (wrCount != null && wrCount >= 4) || (teCount === 0 && wrCount != null && wrCount >= 3);
    const countedSpread = !countedEmpty && wrCount != null && wrCount >= 3;
    const countedTight = !countedEmpty && !countedSpread && teCount != null && teCount >= 2;
    return {
      formation: showing.formation,
      set: showing.set,
      blob: blob,
      rbCount: rbCount,
      teCount: teCount,
      wrCount: wrCount,
      isEmpty: countedEmpty || /\bempty\b/.test(blob),
      isTrips: /\btrips\b/.test(blob),
      isBunch: /\bbunch\b/.test(blob),
      isSpread: countedSpread || /\bspread\b|\bwide\b|\bflex\b/.test(blob),
      isQuads: (wrCount != null && wrCount >= 4) || /\bquads\b/.test(blob),
      isTight: countedTight || /\btight|deuce|ace|jumbo|close|pair heavy\b/.test(blob),
      isWing: /\bwing\b/.test(blob),
      isGun: showing.formation === "GUN",
      isPistol: showing.formation === "PISTOL",
      isIForm: showing.formation === "I FORM",
      isSingleback: showing.formation === "SINGLEBACK",
      isStrongWeak: showing.formation === "STRONG" || showing.formation === "WEAK",
      isGoalLine: showing.formation === "GOAL LINE",
      isHailMary: showing.formation === "HAIL MARY",
    };
  }

  function scoreOffenseShowingBias(play, traits, offenseShowing) {
    const o = offenseShowingTraitsOf(offenseShowing);
    if (!o) return 0;
    const t = traits || defensivePlayTraitsOf(play);
    let score = 0;

    if (o.isHailMary) {
      if (t.isPrevent || t.isDime || t.isDollar) score += 4.5;
      if (t.isBlitz) score -= 2.5;
      if (t.isGoalLine) score -= 3.0;
      return score;
    }

    if (o.isGoalLine) {
      if (t.isGoalLine) score += 5.0;
      if (t.isBlitz || t.isMan) score += 1.4;
      if (t.isDime || t.isDollar || t.isPrevent) score -= 3.0;
      return score;
    }

    if (o.isEmpty || o.isQuads) {
      if (t.isDime || t.isDollar) score += 2.6;
      if (t.isNickel) score += 1.6;
      if (t.isZone || t.isMatch) score += 1.0;
      if (t.isFourThree || t.isFortySix) score -= 1.2;
      if (t.isGoalLine) score -= 2.5;
    } else if (o.isTrips || o.isBunch || o.isSpread) {
      if (t.isNickel) score += 4.7;
      if (t.isDime || t.isDollar) score += 1.35;
      if (t.isZone || t.isMatch || t.isMan) score += 0.85;
      if (t.isFourThree && !t.isBlitz) score -= 1.8;
      if (t.isGoalLine) score -= 2.2;
    } else if (o.isTight || o.isWing) {
      if (t.isFourThree || t.isFortySix) score += 1.7;
      if (t.isBlitz || t.isMan) score += 1.0;
      if (t.isNickel) score += 0.65;
      if (t.isDime || t.isDollar) score -= 0.9;
    }

    if (o.isGun) {
      if (t.isNickel) score += 1.15;
      if (t.isZone || t.isMatch) score += 0.75;
      if (t.isDime || t.isDollar) score += 0.6;
      if (t.isBlitz && !o.isEmpty) score += 0.3;
    } else if (o.isPistol) {
      if (t.isNickel) score += 1.05;
      if (t.isFourThree) score += 0.8;
      if (t.isMatch || t.isZone) score += 0.65;
    } else if (o.isIForm || o.isSingleback || o.isStrongWeak) {
      if (t.isFourThree || t.isFortySix) score += 1.4;
      if (t.isBlitz) score += 0.7;
      if (t.isNickel) score += 0.55;
      if (t.isDime || t.isDollar) score -= 0.6;
    }

    return score;
  }

  function buildOpponentOffenseFormationCatalog(plays, teamCode) {
    const code = upper(teamCode);
    const byFormation = {};
    (Array.isArray(plays) ? plays : []).forEach(function (play) {
      if (!play) return;
      if (code && upper(play.team) !== code) return;
      const formation = cleanText(play.formation);
      const set = cleanText(play.set) || "Base";
      if (!formation) return;
      if (!byFormation[formation]) byFormation[formation] = {};
      byFormation[formation][set] = true;
    });
    return Object.keys(byFormation)
      .sort(function (a, b) {
        return a.localeCompare(b);
      })
      .map(function (formation) {
        return {
          formation: formation,
          sets: Object.keys(byFormation[formation]).sort(function (a, b) {
            return a.localeCompare(b);
          }),
        };
      });
  }

  function scoreDefensivePlayCore(play, ctx, traits) {
    const t = traits || defensivePlayTraitsOf(play);
    const down = Number(ctx && ctx.down) || 1;
    const yards = Number(ctx && ctx.yards);
    const bucket = (ctx && ctx.distBucket) || distToBucket(yards);
    const goalToGo = !!(ctx && ctx.goalToGo);
    const fieldBucket = (ctx && ctx.fieldPositionBucket) || "unknown";
    const early = down <= 2;
    const money = down >= 3;
    const longMoney = isLongMoneyDown(ctx);
    const preventOk = isPreventEligibleContext(ctx);
    const shortSpot = goalToGo || bucket === "short";
    const redish =
      fieldBucket === "red_zone" ||
      fieldBucket === "high_red_zone" ||
      fieldBucket === "goal_to_go";
    const backedUp =
      fieldBucket === "backed_up" ||
      fieldBucket === "coming_out";
    const plan = buildDefensiveSituationPlan(ctx);

    let score = 1.5;
    score += scoreDefensivePlanFit(t, plan);

    // Coverage / pressure lean by down & distance.
    if (shortSpot) {
      if (t.isBlitz) score += 3.4;
      if (t.isMan) score += 1.8;
      if (t.isMatch) score += 1.0;
      if (t.isZone) score += 0.4;
    } else if (longMoney) {
      if (t.isZone) score += 3.0;
      if (t.isMatch) score += 2.6;
      if (t.isMan) score += 1.2;
      // In 3rd & long, Zone Blitz is a staple NFL look; only pure Zero/unprotected man blitzes carry heavy risk.
      if (t.isZoneBlitz) score += 1.8;
      else if (t.isZeroBlitz) score -= 2.0;
      else if (t.isBlitz) score += 0.4;
    } else if (money && bucket === "medium") {
      if (t.isMatch) score += 2.2;
      if (t.isZone) score += 2.0;
      if (t.isZoneBlitz) score += 2.6;
      else if (t.isBlitz) score += 2.2;
      if (t.isMan) score += 1.5;
      if (t.isPrevent) score -= 6.0;
    } else if (early && bucket === "short") {
      if (t.isBlitz) score += 2.6;
      if (t.isMan) score += 1.4;
      if (t.isZone) score += 1.0;
      if (t.isMatch) score += 1.1;
    } else {
      // Early medium / long — realistic NFL pressure rate (safe Zone Blitz ~2.2, Man Blitz ~1.5, raw Cover 0 cooled).
      if (t.isZone) score += 2.4;
      if (t.isMatch) score += 2.1;
      if (t.isMan) score += 1.3;
      if (t.isZoneBlitz) score += 2.2;
      else if (t.isZeroBlitz) score -= 0.6;
      else if (t.isBlitz) score += 1.4;
    }

    // Package fit.
    if (t.isNickel) {
      score += 2.0;
      if (bucket !== "short" && !t.isBlitz) score += 0.8;
      // In early downs, do not heavily penalize nickel blitzes (e.g. slot corners / nickel over pressures)
      if (t.isZeroBlitz && early && !shortSpot) score -= 0.6;
    }
    if (t.isFourThree) {
      score += early ? 2.4 : 1.2;
      if (bucket === "long" && money) score -= 1.2;
      if (shortSpot) score += 0.8;
    }
    if (t.isThreeThreeFive) {
      score += 1.4;
      if (bucket === "medium" || bucket === "long") score += 1.0;
    }
    if (t.isDime || t.isDollar) {
      if (longMoney) score += 3.6;
      else if (money && bucket === "medium") score += 1.2;
      else if (early && bucket === "long") score += 1.2;
      else score -= 1.6;
    }
    if (t.isFortySix) {
      if (shortSpot) score += 2.8;
      else if (early && bucket === "medium") score += 1.2;
      else score -= 1.4;
    }
    if (t.isGoalLine) {
      score += isTrueGoalLineDefenseContext(ctx) ? 4.5 : -8;
    }
    if (t.isPrevent) {
      score += preventOk ? 4.0 : -12;
    }

    // Field geography.
    if (backedUp && t.isBlitz) score += 1.4;
    if (backedUp && (t.isZone || t.isMatch)) score += 0.6;
    if (redish) {
      if (t.isBlitz || t.isMan) score += 1.2;
      if (t.isGoalLine && isTrueGoalLineDefenseContext(ctx)) score += 1.5;
      if ((t.isDime || t.isDollar || t.isPrevent) && !longMoney) score -= 2.0;
    }
    if ((fieldBucket === "plus_territory" || fieldBucket === "midfield_plus") && (t.isZone || t.isMatch)) {
      score += 0.8;
    }

    // Concept nudges.
    if (t.isCover3 && (bucket === "long" || longMoney)) score += 0.7;
    if (t.isCover2 && (bucket === "medium" || bucket === "short")) score += 0.5;
    if (t.isCover1 && shortSpot) score += 0.6;
    if (t.isCover4 && longMoney) score += 0.8;

    return score;
  }

  function buildDefensiveWhy(play, ctx, traits) {
    const t = traits || defensivePlayTraitsOf(play);
    const down = Number(ctx && ctx.down) || 1;
    const yards = Number(ctx && ctx.yards);
    const bucket = (ctx && ctx.distBucket) || distToBucket(yards);
    const goalToGo = !!(ctx && ctx.goalToGo);
    const offense = offenseShowingTraitsOf(ctx && ctx.offenseShowing);
    const plan = buildDefensiveSituationPlan(ctx);
    const parts = [];

    if (goalToGo || bucket === "short") {
      parts.push(t.isBlitz ? "Pressure the short-yardage snap." : "Tighten the box for short yardage.");
    } else if (down >= 3 && bucket === "medium") {
      parts.push(t.isBlitz ? "Pressure a convertible money down." : "Contest the sticks on medium money.");
    } else if (down >= 3 && bucket === "long") {
      parts.push(t.isZone || t.isMatch ? "Cover the sticks on a long money down." : "Answer a likely pass on long yardage.");
    } else if (down >= 3) {
      parts.push("Money-down answer that fits this distance.");
    } else if (plan.intent === "protect_lead") {
      parts.push("Protect-the-lead coverage call.");
    } else {
      parts.push("Balanced early-down defensive call.");
    }

    if (offense) {
      if (offense.isEmpty || offense.isQuads) parts.push("Answers empty/pass-heavy personnel.");
      else if (offense.wrCount != null && offense.wrCount >= 3) parts.push("Matches 3-wide personnel.");
      else if (offense.isGoalLine) parts.push("Matches goal-line offense look.");
      else if (offense.isHailMary) parts.push("Protects vs Hail Mary.");
      else if (offense.isTight || offense.isWing) parts.push("Fits condensed/run-lean look.");
      else if (offense.isGun || offense.isTrips || offense.isBunch) parts.push("Fits the offense package on the field.");
    } else if (t.isPrevent && plan.allowPrevent) {
      parts.push("Prevent shell to protect the lead vs deep ball.");
    } else if (t.isNickel) {
      parts.push("Nickel package matches modern personnel.");
    } else if (t.isDime || t.isDollar) {
      parts.push("Extra DB package for pass likelihood.");
    } else if (t.isGoalLine) {
      parts.push("Goal-line shell for a compressed field.");
    } else if (t.isFourThree) {
      parts.push("Base 4-3 front.");
    }

    return parts.slice(0, 2).join(" ");
  }

  function pickTopDefensiveRecommendationsCore(params) {
    const SelectionEngine = getSelectionEngine();
    if (SelectionEngine && typeof SelectionEngine.selectDiversitySlate === "function") {
      const scored = Array.isArray(params && params.scored) ? params.scored : [];
      const limit = Number.isFinite(Number(params && params.limit)) ? Number(params.limit) : 3;
      const scoreKey = (params && params.scoreKey) || "_score";
      const result = SelectionEngine.selectDiversitySlate({
        scored: scored.map(function (item) {
          const play = item.play || item;
          return Object.assign({}, item, {
            play: play,
            compositeParts: item.compositeParts || {
              base: Number(item[scoreKey]) || Number(item.score) || 0,
              defense: 0,
              team: 0,
              success: 0,
            },
            family: item.family || defensiveFamilyOf(play),
            coverageFamily: coverageFamilyOf(play, item.traits || defensivePlayTraitsOf(play)),
          });
        }),
        familyOf: function (play) { return defensiveFamilyOf(play); },
        formationSetKeyOf: defensiveFormationSetKeyOf,
        normalizedConceptKey: function (play) {
          return coverageFamilyOf(play, defensivePlayTraitsOf(play));
        },
        scoreKey: scoreKey,
        limit: limit,
        recentGameCalls: params && params.recentGameCalls,
        recommendationExposureHistory: params && params.recommendationExposureHistory,
        driveRecommendationExposure: params && params.driveRecommendationExposure,
        outcomeMemory: params && params.outcomeMemory,
        rng: params && params.rng,
        policy: params && params.policy,
      });
      return result.slate || [];
    }

    const scored = Array.isArray(params && params.scored) ? params.scored.slice() : [];
    const limit = Number.isFinite(Number(params && params.limit)) ? Number(params.limit) : 3;
    const scoreKey = (params && params.scoreKey) || "_score";

    scored.sort(function (a, b) {
      const scoreA = Number(a[scoreKey]) || 0;
      const scoreB = Number(b[scoreKey]) || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      const nameA = cleanText((a.play || a).play_name);
      const nameB = cleanText((b.play || b).play_name);
      return nameA.localeCompare(nameB);
    });

    const picked = [];
    const usedTypes = {};
    const usedShells = {};
    const usedFormations = {};
    const nearScoreWindow = Number.isFinite(Number(params && params.nearScoreWindow))
      ? Number(params.nearScoreWindow)
      : 3.5;
    const topScore = scored.length ? (Number(scored[0][scoreKey]) || 0) : 0;

    function tryPick(item, requireUnique) {
      const play = item.play || item;
      const type = upper(play.type) || "OTHER";
      const shell = defensiveFormationSetKeyOf(play);
      const formation = upper(play.formation) || "";
      const score = Number(item[scoreKey]) || 0;
      if (requireUnique) {
        if (usedTypes[type]) return false;
        if (shell && usedShells[shell]) return false;
        if (formation && usedFormations[formation] && (topScore - score) <= nearScoreWindow) {
          return false;
        }
      } else if (picked.some(function (entry) {
        return (entry.play || entry).id === play.id;
      })) {
        return false;
      }
      picked.push(item);
      usedTypes[type] = true;
      if (shell) usedShells[shell] = true;
      if (formation) usedFormations[formation] = true;
      return true;
    }

    scored.forEach(function (item) {
      if (picked.length >= limit) return;
      tryPick(item, true);
    });
    scored.forEach(function (item) {
      if (picked.length >= limit) return;
      tryPick(item, false);
    });

    return picked.slice(0, limit);
  }

  function computeDefensiveRecommendations(params) {
    const plays = Array.isArray(params && params.plays) ? params.plays : [];
    const recentPlayIds = new Set(Array.isArray(params && params.recentPlayIds) ? params.recentPlayIds : []);
    const down = Number(params && params.down) || 1;
    const yardsRaw = params && params.yards != null ? Number(params.yards) : Number(params && params.yardsToGo);
    const yards = Number.isFinite(yardsRaw) && yardsRaw > 0 ? yardsRaw : null;
    const goalToGo = !!(params && params.goalToGo);
    const fieldPosition = (params && params.fieldPosition) || null;
    const distBucket = (params && params.distBucket) || distToBucket(yards);
    const fieldPositionBucket =
      (params && params.fieldPositionBucket) || buildFieldPositionBucket(fieldPosition, goalToGo);
    const offenseShowing = normalizeOffenseShowing(params && params.offenseShowing);
    const game = buildGameContextFields(params);
    const ctx = {
      down: down,
      yards: yards,
      goalToGo: goalToGo,
      fieldPosition: fieldPosition,
      distBucket: distBucket,
      fieldPositionBucket: fieldPositionBucket,
      offenseShowing: offenseShowing,
      quarter: game.quarter,
      userScore: game.userScore,
      oppScore: game.oppScore,
      scoreDiff: game.scoreDiff,
      situationPlan: null,
    };
    ctx.situationPlan = buildDefensiveSituationPlan(ctx);

    const scored = [];
    plays.forEach(function (play) {
      if (!play) return;
      const traits = defensivePlayTraitsOf(play);
      if (shouldExcludeDefensivePlay(play, ctx, traits)) return;
      let score = scoreDefensivePlayCore(play, ctx, traits);
      score += scoreOffenseShowingBias(play, traits, offenseShowing);
      if (play.id && recentPlayIds.has(play.id)) score -= 6.5;
      scored.push({
        play: play,
        traits: traits,
        _score: score,
        score: score,
        why: buildDefensiveWhy(play, ctx, traits),
        family: traits.fam,
      });
    });

    const top = pickTopDefensiveRecommendationsCore({ scored: scored, limit: 3, scoreKey: "_score" });
    return {
      context: ctx,
      recommendations: top.map(function (item) {
        const play = item.play || item;
        // Flatten for Mobile-style presentation (play fields + score meta).
        return Object.assign({}, play, {
          _score: item._score,
          _why: item.why,
          _family: item.family || defensiveFamilyOf(play),
          why: item.why,
          traits: item.traits,
        });
      }),
      scoredCount: scored.length,
    };
  }

  // --- DC v2: chip-first situation + package-level ranking ---

  const DC_SITUATION_CHIPS = [
    { id: "early_medium", label: "1st/2nd · Med" },
    { id: "short", label: "Short" },
    { id: "money_medium", label: "3rd+ · Med" },
    { id: "money_long", label: "3rd+ · Long" },
    { id: "red", label: "Red" },
    { id: "gtg", label: "GTG" },
  ];

  const DC_OFFENSE_TAGS = [
    { id: "unknown", label: "Normal" },
    { id: "empty", label: "Empty" },
    { id: "spread", label: "Spread" },
    { id: "condensed", label: "Condensed" },
    { id: "goal_line", label: "Goal Line" },
  ];

  function normalizeSituationChip(value) {
    const id = lower(value);
    for (let i = 0; i < DC_SITUATION_CHIPS.length; i += 1) {
      if (DC_SITUATION_CHIPS[i].id === id) return id;
    }
    return "";
  }

  function normalizeOffenseTag(value) {
    const id = lower(value);
    for (let i = 0; i < DC_OFFENSE_TAGS.length; i += 1) {
      if (DC_OFFENSE_TAGS[i].id === id) return id;
    }
    return "unknown";
  }

  function applySituationChipToContext(chipId, base) {
    const chip = normalizeSituationChip(chipId);
    const next = Object.assign({}, base || {});
    if (!chip) return next;

    if (chip === "early_medium") {
      next.down = 1;
      next.yards = 10;
      next.goalToGo = false;
      next.distBucket = "medium";
      if (!next.fieldPositionBucket || next.fieldPositionBucket === "goal_to_go" || next.fieldPositionBucket === "high_red_zone" || next.fieldPositionBucket === "red_zone") {
        next.fieldPositionBucket = "midfield";
      }
    } else if (chip === "short") {
      next.down = Number.isFinite(Number(next.down)) ? next.down : 2;
      next.yards = 2;
      next.goalToGo = false;
      next.distBucket = "short";
    } else if (chip === "money_medium") {
      next.down = 3;
      next.yards = 5;
      next.goalToGo = false;
      next.distBucket = "medium";
    } else if (chip === "money_long") {
      next.down = 3;
      next.yards = 12;
      next.goalToGo = false;
      next.distBucket = "long";
    } else if (chip === "red") {
      next.down = Number.isFinite(Number(next.down)) ? next.down : 1;
      next.yards = Number.isFinite(Number(next.yards)) ? next.yards : 8;
      next.goalToGo = false;
      next.distBucket = distToBucket(next.yards);
      next.fieldPositionBucket = "red_zone";
      next.fieldPosition = { side: "OPP", yardLine: 15 };
    } else if (chip === "gtg") {
      next.down = Number.isFinite(Number(next.down)) && Number(next.down) >= 1 ? next.down : 1;
      next.yards = 3;
      next.goalToGo = true;
      next.distBucket = "short";
      next.fieldPositionBucket = "goal_to_go";
      next.fieldPosition = { side: "OPP", yardLine: 3 };
    }
    return next;
  }

  function offenseTagToShowing(tagId) {
    const tag = normalizeOffenseTag(tagId);
    if (tag === "empty") return { formation: "GUN", set: "Empty" };
    if (tag === "spread") return { formation: "GUN", set: "Spread" };
    if (tag === "condensed") return { formation: "SINGLEBACK", set: "Tight" };
    if (tag === "goal_line") return { formation: "GOAL LINE", set: "Base" };
    return null;
  }

  /** Map a live OCR/manual offense look onto the coarse DC offense tags. */
  function inferOffenseTagFromShowing(offenseShowing) {
    const traits = offenseShowingTraitsOf(offenseShowing);
    if (!traits) return "unknown";
    if (traits.isGoalLine || traits.isHailMary) return "goal_line";
    if (traits.isEmpty || traits.isQuads) return "empty";
    if (traits.isTrips || traits.isBunch || traits.isSpread) return "spread";
    if (traits.isTight || traits.isWing) return "condensed";
    return "unknown";
  }

  function coverageFamilyOf(play, traits) {
    const t = traits || defensivePlayTraitsOf(play);
    if (t.isZoneBlitz) return "zone_blitz";
    if (t.isManBlitz) return "man_blitz";
    if (t.isBlitz || t.isPressure) return "blitz";
    if (t.isCover1) return "cover1";
    if (t.isCover2) return "cover2";
    if (t.isCover3) return "cover3";
    if (t.isCover4) return "cover4";
    if (t.isMan) return "man";
    if (t.isMatch) return "match";
    if (t.isZone) return "zone";
    if (t.isPrevent) return "prevent";
    return t.fam || "other";
  }

  function coverageFamilyLabel(family) {
    const key = lower(family);
    const labels = {
      blitz: "Blitz",
      zone_blitz: "Zone Blitz",
      man_blitz: "Man Blitz",
      cover1: "Cover 1",
      cover2: "Cover 2",
      cover3: "Cover 3",
      cover4: "Cover 4 / Quarters",
      man: "Man",
      match: "Match",
      zone: "Zone",
      prevent: "Prevent",
      other: "Other",
    };
    return labels[key] || cleanText(family) || "Coverage";
  }

  function pressureOf(traits) {
    return traits && (traits.isBlitz || traits.isPressure) ? "blitz" : "base";
  }

  function buildDefensivePackageKey(play, traits) {
    const t = traits || defensivePlayTraitsOf(play);
    const formation = defensiveFormationKeyOf(play) || "BASE";
    const coverage = coverageFamilyOf(play, t);
    const pressure = pressureOf(t);
    return formation + "|" + coverage + "|" + pressure;
  }

  function formatDefensivePackageLabel(packageKey, formation, coverageFamily) {
    const parts = cleanText(packageKey).split("|");
    const form = upper(formation || parts[0] || "BASE");
    const cov = coverageFamilyLabel(coverageFamily || parts[1] || "zone");
    return form + " · " + cov.toUpperCase();
  }

  function countRecentPackageKey(list, packageKey, windowSize) {
    const needle = cleanText(packageKey);
    if (!needle) return 0;
    const window = Array.isArray(list) ? list.slice(-(Number(windowSize) || list.length)) : [];
    return window.filter(function (entry) {
      const key = cleanText(typeof entry === "string" ? entry : entry && (entry.packageKey || entry.key || entry.id));
      return key === needle;
    }).length;
  }

  function packageMmrAdjustment(packageKey, recentPackageKeys, exposurePackageKeys) {
    const confirmed = countRecentPackageKey(recentPackageKeys, packageKey, 12);
    const shown = countRecentPackageKey(exposurePackageKeys, packageKey, 18);
    let tax = 0;
    tax += Math.min(confirmed * 4.5, 14);
    tax += Math.min(shown * 3.25, 12);
    if (confirmed >= 1 && shown >= 1) tax += 2.0;
    return -tax;
  }

  function clampNumber(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  /**
   * Bayesian-style stop/fail rate → bounded score (mirrors OCR learnedAdjustment).
   * Kept in-core so Mobile Package Call can learn without the OCR module graph.
   */
  function boundedEffectivenessAdjustment(stat, options) {
    const cfg = options || {};
    const observations = Number(stat && stat.observations) || 0;
    const successes = Number(stat && stat.successes) || 0;
    const failures = Number(stat && stat.failures) || 0;
    const known = successes + failures;
    const minObservations = Number.isFinite(Number(cfg.minObservations)) ? Number(cfg.minObservations) : 3;
    const maxAdjustment = Math.abs(Number.isFinite(Number(cfg.maxAdjustment)) ? Number(cfg.maxAdjustment) : 2.75);
    if (observations < minObservations || known < minObservations) return 0;
    const priorStrength = Number.isFinite(Number(cfg.priorStrength)) ? Math.max(0, Number(cfg.priorStrength)) : 4;
    const priorRate = Number.isFinite(Number(cfg.priorRate)) ? clampNumber(Number(cfg.priorRate), 0, 1) : 0.5;
    const posterior = (successes + priorRate * priorStrength) / (known + priorStrength);
    const centered = (posterior - priorRate) * 2;
    const reliability = clampNumber(
      (known - minObservations + 1) / (Number(cfg.fullWeightAt) || 10),
      0.15,
      1
    );
    let yardsPenalty = 0;
    if (Number.isFinite(Number(stat && stat.yardsAllowed)) && observations > 0) {
      const avgYards = Number(stat.yardsAllowed) / observations;
      const neutralYards = Number.isFinite(Number(cfg.neutralYards)) ? Number(cfg.neutralYards) : 5;
      yardsPenalty = clampNumber((neutralYards - avgYards) / 10, -0.35, 0.35);
    }
    return clampNumber((centered + yardsPenalty) * maxAdjustment * reliability, -maxAdjustment, maxAdjustment);
  }

  function aggregateEffectivenessStats(stats) {
    const list = Array.isArray(stats) ? stats.filter(Boolean) : [];
    if (!list.length) return null;
    const out = {
      observations: 0,
      successes: 0,
      failures: 0,
      unknowns: 0,
      yardsAllowed: 0,
    };
    list.forEach(function (stat) {
      out.observations += Number(stat.observations) || 0;
      out.successes += Number(stat.successes) || 0;
      out.failures += Number(stat.failures) || 0;
      out.unknowns += Number(stat.unknowns) || 0;
      out.yardsAllowed += Number(stat.yardsAllowed) || 0;
    });
    return out.observations > 0 ? out : null;
  }

  /**
   * Long-run OCR defensiveEffectiveness → package lean.
   * OCR ledger keys packages as FORMATION|SET; DC V2 keys are FORMATION|coverage|pressure.
   * Resolve by exact key, then all OCR keys for that formation, then byFormation.
   */
  function packageLearningEffectivenessAdjustment(item, learningSnapshot, options) {
    const effectiveness = learningSnapshot && learningSnapshot.defensiveEffectiveness;
    if (!effectiveness || !item) return 0;
    const cfg = options || {};
    const formation = upper(item.formation);
    const pkgKey = upper(item.packageKey);
    const byPackage = effectiveness.byPackage || {};
    const byFormation = effectiveness.byFormation || {};

    let adj = pkgKey ? boundedEffectivenessAdjustment(byPackage[pkgKey], cfg) : 0;
    if (Math.abs(adj) < 0.05 && formation) {
      const formationStats = [];
      Object.keys(byPackage).forEach(function (key) {
        const k = upper(key);
        if (k === formation || k.indexOf(formation + "|") === 0) {
          formationStats.push(byPackage[key]);
        }
      });
      adj = boundedEffectivenessAdjustment(aggregateEffectivenessStats(formationStats), cfg) * 0.7;
    }
    if (Math.abs(adj) < 0.05 && formation) {
      adj = boundedEffectivenessAdjustment(byFormation[formation], cfg) * 0.55;
    }
    if (Math.abs(adj) < 0.05) {
      adj = boundedEffectivenessAdjustment(effectiveness.global, cfg) * 0.12;
    }
    const cap = Math.abs(Number.isFinite(Number(cfg.maxAdjustment)) ? Number(cfg.maxAdjustment) : 2.75);
    return clampNumber(adj, -cap, cap);
  }

  function offenseConceptTagsFromPlayKey(playKey) {
    const blob = upper(playKey).replace(/\|/g, " ");
    const tags = [];
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

  function defensiveCounterScoreForTags(tags, traits) {
    const t = traits || {};
    let score = 0;
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
        if (t.isCover4 || t.isPrevent || t.isDime || t.isDollar) score += 1.1;
        if (t.isBlitz) score -= 0.7;
      } else if (tag === "crossers") {
        if (t.isMatch || t.isMan) score += 1.0;
        if (t.isCover2) score += 0.6;
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

  function packageTraitsProxy(item) {
    const cov = lower(item && item.coverageFamily);
    const form = lower(item && item.formation);
    const pressure = lower(item && item.pressure);
    return {
      isBlitz: cov === "blitz" || pressure === "blitz",
      isMan: cov === "man" || cov === "cover1",
      isMatch: cov === "match",
      isZone: cov === "zone" || cov === "cover2" || cov === "cover3" || cov === "cover4" || cov === "prevent",
      isCover2: cov === "cover2",
      isCover4: cov === "cover4",
      isFourThree: form.indexOf("4-3") >= 0 || form.indexOf("43") >= 0,
      isFortySix: form.indexOf("46") >= 0 || form.indexOf("4-6") >= 0,
      isNickel: form.indexOf("nickel") >= 0,
      isDime: form.indexOf("dime") >= 0,
      isDollar: form.indexOf("dollar") >= 0,
      isPrevent: form.indexOf("prevent") >= 0 || cov === "prevent",
      isGoalLine: form.indexOf("goal") >= 0,
    };
  }

  /**
   * Opponent OCR tendency (by down/distance/formation) → package counter lean.
   */
  function packageTendencyAdjustment(item, learningSnapshot, liveContext, options) {
    const tendency = learningSnapshot && learningSnapshot.opponentTendency;
    if (!tendency || !item) return 0;
    const cfg = options || {};
    const showing = (liveContext && liveContext.offenseShowing) || {};
    const opponent = upper((liveContext && liveContext.opponent) || "*") || "*";
    const down = cleanText(liveContext && liveContext.down != null ? liveContext.down : "*") || "*";
    const distance = lower((liveContext && (liveContext.distBucket || liveContext.distanceBucket)) || "*") || "*";
    const formation = upper(showing.formation || "*") || "*";
    const setName = upper(showing.set || "*") || "*";
    const exactKey = [opponent, down, distance, formation, setName].join("|");
    const formationKey = [opponent, "*", "*", formation, "*"].join("|");
    const globalKey = ["*", "*", "*", "*", "*"].join("|");
    const byContext = tendency.byContext || {};
    const minObservations = Number.isFinite(Number(cfg.minObservations)) ? Number(cfg.minObservations) : 3;
    let selectedKey = "";
    let weight = 0;
    if (byContext[exactKey] && (Number(byContext[exactKey].observations) || 0) >= minObservations) {
      selectedKey = exactKey;
      weight = 1;
    } else if (byContext[formationKey] && (Number(byContext[formationKey].observations) || 0) >= minObservations) {
      selectedKey = formationKey;
      weight = 0.55;
    } else if (byContext[globalKey] && (Number(byContext[globalKey].observations) || 0) >= minObservations) {
      selectedKey = globalKey;
      weight = 0.25;
    } else if ((Number(tendency.observations) || 0) >= minObservations) {
      selectedKey = globalKey;
      weight = 0.2;
    }
    if (!selectedKey || !weight) return 0;
    const context = byContext[selectedKey];
    if (!context || !context.plays) return 0;
    const entries = Object.keys(context.plays)
      .filter(function (playKey) { return playKey && playKey !== "UNKNOWN"; })
      .map(function (playKey) {
        return {
          playKey: playKey,
          observations: Number(context.plays[playKey] && context.plays[playKey].observations) || 0,
        };
      })
      .filter(function (entry) { return entry.observations > 0; });
    const totalObs = entries.reduce(function (sum, entry) { return sum + entry.observations; }, 0);
    if (totalObs < (Number(cfg.minObservations) || 2)) return 0;
    const traits = packageTraitsProxy(item);
    let expected = 0;
    entries.forEach(function (entry) {
      expected += (entry.observations / totalObs) * defensiveCounterScoreForTags(
        offenseConceptTagsFromPlayKey(entry.playKey),
        traits
      );
    });
    const reliability = clampNumber(totalObs / (Number(cfg.fullWeightAt) || 8), 0.2, 1);
    const cap = Math.abs(Number.isFinite(Number(cfg.maxTendencyAdjustment)) ? Number(cfg.maxTendencyAdjustment) : 2.0);
    return clampNumber(expected * weight * reliability, -cap, cap);
  }

  /**
   * OCR stop/fail memory → next package sheet:
   * - Success: lean same coverage family, but soften the exact shell that just worked
   *   (so the sheet stays in-family without resurfacing the same package/play).
   * - Failure: leave that family; nudge other families.
   * Offense-showing overlap amplifies the lean (same look coming back).
   */
  function packageOutcomeMatchupAdjustment(item, matchupMemory, liveContext) {
    const list = Array.isArray(matchupMemory) ? matchupMemory.slice(-12) : [];
    if (!item || !list.length) return 0;
    const cov = lower(item.coverageFamily);
    const form = upper(item.formation);
    const pkg = cleanText(item.packageKey);
    const showing = (liveContext && liveContext.offenseShowing) || {};
    const liveForm = upper(showing.formation);
    const liveSet = upper(showing.set);
    let adj = 0;

    list.forEach(function (entry, index) {
      if (!entry) return;
      if (entry.successfulDefense !== true && entry.successfulDefense !== false) return;
      const age = Math.max(0.4, 1 - ((list.length - 1 - index) * 0.07));
      let offenseRelevance = 1;
      const entryForm = upper(entry.offenseFormation);
      const entrySet = upper(entry.offenseSet);
      if (liveForm && entryForm && liveForm === entryForm) offenseRelevance += 0.35;
      if (liveSet && entrySet && liveSet === entrySet) offenseRelevance += 0.25;
      if (entry.offensePlayKey && liveForm) offenseRelevance = Math.min(offenseRelevance, 1.7);

      const entryFamily = lower(entry.coverageFamily);
      const sameFamily = Boolean(cov && entryFamily && cov === entryFamily);
      const sameFormation = Boolean(form && entry.defenseFormation && form === upper(entry.defenseFormation));
      const sameShell = sameFamily && sameFormation;
      const samePackage = Boolean(
        pkg
        && (
          (entry.dcPackageKey && pkg === cleanText(entry.dcPackageKey))
          || (entry.defensePackageKey && pkg.toUpperCase() === upper(entry.defensePackageKey))
        ),
      );

      if (entry.successfulDefense === true) {
        if (sameFamily) adj += 2.35 * age * offenseRelevance;
        // Soften the exact shell/package so another in-family lean can surface.
        if (sameShell || samePackage) adj -= 1.25 * age;
      } else {
        if (sameFamily) adj -= 3.6 * age * offenseRelevance;
        if (sameShell || samePackage) adj -= 1.8 * age;
        if (!sameFamily && cov && entryFamily) adj += 0.95 * age * offenseRelevance;
      }
    });

    if (adj > 5.5) return 5.5;
    if (adj < -8.5) return -8.5;
    return adj;
  }

  function buildPackageWhy(item, ctx, offenseTag) {
    const parts = [];
    const chip = normalizeSituationChip(ctx && ctx.situationChip);
    const tag = normalizeOffenseTag(offenseTag);
    if (item && item._matchupWhy) parts.push(item._matchupWhy);
    if (chip === "gtg" || chip === "short") {
      parts.push(item.pressure === "blitz" ? "Pressure the short snap." : "Tighten the box.");
    } else if (chip === "money_long") {
      parts.push("Cover the sticks on long money.");
    } else if (chip === "money_medium") {
      parts.push("Money-down package lean.");
    } else if (chip === "red") {
      parts.push("Red-zone shell.");
    } else {
      parts.push("Early-down package lean.");
    }
    if (tag === "empty") parts.push("Answers empty/pass-heavy.");
    else if (tag === "spread") parts.push("Fits spread personnel.");
    else if (tag === "condensed") parts.push("Fits condensed/run look.");
    else if (tag === "goal_line") parts.push("Matches goal-line offense.");
    return parts.slice(0, 2).join(" ");
  }

  function pickTopDefensivePackagesCore(params) {
    const SelectionEngine = getSelectionEngine();
    if (SelectionEngine && typeof SelectionEngine.selectDiversitySlate === "function") {
      const scored = Array.isArray(params && params.scored) ? params.scored : [];
      const limit = Number.isFinite(Number(params && params.limit)) ? Number(params.limit) : 3;
      const scoreKey = (params && params.scoreKey) || "_score";
      const recentPackageKeys = Array.isArray(params && params.recentPackageKeys)
        ? params.recentPackageKeys
        : [];
      const exposurePackageKeys = Array.isArray(params && params.exposurePackageKeys)
        ? params.exposurePackageKeys
        : [];
      const recentGameCalls = recentPackageKeys.map(function (key) {
        return { playId: key, packageKey: key, family: key, conceptKey: key, formationSetKey: key };
      });
      const recommendationExposureHistory = exposurePackageKeys.map(function (key, index) {
        return {
          batchId: "dc-exp-" + index,
          playId: key,
          packageKey: key,
          family: key,
          conceptKey: key,
          formationSetKey: key,
          rank: 1,
        };
      });
      const result = SelectionEngine.selectDiversitySlate({
        scored: scored.map(function (item) {
          const syntheticPlay = {
            id: item.packageKey,
            play_name: item.label,
            formation: item.formation,
            set: item.coverageFamily,
            type: item.pressure || "ZONE",
            family: item.coverageFamily,
            coverageFamily: item.coverageFamily,
            packageKey: item.packageKey,
          };
          return Object.assign({}, item, {
            play: syntheticPlay,
            packageKey: item.packageKey,
            formation: item.formation,
            coverageFamily: item.coverageFamily,
            family: item.coverageFamily,
            compositeParts: {
              base: Number(item[scoreKey]) || Number(item.score) || 0,
              defense: 0,
              team: 0,
              success: 0,
            },
          });
        }),
        familyOf: function (play) {
          return cleanText(play && (play.coverageFamily || play.family)).toLowerCase();
        },
        formationSetKeyOf: function (play) {
          if (play && play.packageKey) return cleanText(play.packageKey).toLowerCase();
          const formation = cleanText(play && play.formation).toLowerCase() || "base";
          const set = cleanText(play && (play.coverageFamily || play.set)).toLowerCase() || "base";
          return formation + "|" + set;
        },
        normalizedConceptKey: function (play) {
          return cleanText(play && (play.coverageFamily || play.family || play.packageKey || play.id)).toLowerCase();
        },
        scoreKey: scoreKey,
        limit: limit,
        recentGameCalls: recentGameCalls,
        recommendationExposureHistory: recommendationExposureHistory,
        rng: params && params.rng,
        policy: {
          shownPlayBanBatches: 8,
          shownConceptBanBatches: 1,
          shownShellBanBatches: 1,
          shownFamilyBanBatches: 0,
          wildcardTemperature: 2.1,
          requireUniqueFormation: true,
        },
      });
      return (result.slate || []).map(function (item) {
        // Restore package fields if selection annotated a wrapped play.
        if (item.packageKey) return item;
        return item;
      });
    }

    const scored = Array.isArray(params && params.scored) ? params.scored.slice() : [];
    const limit = Number.isFinite(Number(params && params.limit)) ? Number(params.limit) : 3;
    const scoreKey = (params && params.scoreKey) || "_score";
    const explore = params && params.explore !== false;
    const band = Number.isFinite(Number(params && params.fitnessBand)) ? Number(params.fitnessBand) : 3.5;
    const rng = typeof (params && params.rng) === "function" ? params.rng : Math.random;

    scored.sort(function (a, b) {
      const scoreA = Number(a[scoreKey]) || 0;
      const scoreB = Number(b[scoreKey]) || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return cleanText(a.packageKey).localeCompare(cleanText(b.packageKey));
    });

    const picked = [];
    const usedFormations = {};
    const usedCoverage = {};

    function tryPick(item, requireUnique) {
      if (!item) return false;
      const formation = upper(item.formation) || "BASE";
      const coverage = lower(item.coverageFamily) || "other";
      if (requireUnique) {
        if (usedFormations[formation]) return false;
        if (usedCoverage[coverage]) return false;
      } else if (picked.some(function (entry) {
        return entry.packageKey === item.packageKey;
      })) {
        return false;
      }
      picked.push(item);
      usedFormations[formation] = true;
      usedCoverage[coverage] = true;
      return true;
    }

    if (explore && scored.length) {
      const best = Number(scored[0][scoreKey]) || 0;
      const near = scored.filter(function (item) {
        return best - (Number(item[scoreKey]) || 0) <= band;
      }).slice(0, 8);
      if (near.length === 1) {
        tryPick(near[0], true);
      } else if (near.length > 1) {
        const temperature = 1.15;
        const weights = near.map(function (item) {
          return Math.exp(((Number(item[scoreKey]) || 0) - best) / temperature);
        });
        let total = 0;
        weights.forEach(function (w) { total += w; });
        let cursor = Math.max(0, Math.min(Number(rng()) || 0, 0.999999)) * total;
        let chosen = near[0];
        for (let i = 0; i < near.length; i += 1) {
          cursor -= weights[i];
          if (cursor <= 0) {
            chosen = near[i];
            break;
          }
        }
        tryPick(chosen, true);
      }
    }

    scored.forEach(function (item) {
      if (picked.length >= limit) return;
      tryPick(item, true);
    });
    scored.forEach(function (item) {
      if (picked.length >= limit) return;
      tryPick(item, false);
    });

    return picked.slice(0, limit);
  }

  function computeDefensivePackageRecommendations(params) {
    const plays = Array.isArray(params && params.plays) ? params.plays : [];
    const recentPlayIds = new Set(Array.isArray(params && params.recentPlayIds) ? params.recentPlayIds : []);
    const recentPackageKeys = Array.isArray(params && params.recentPackageKeys) ? params.recentPackageKeys : [];
    const exposurePackageKeys = Array.isArray(params && params.exposurePackageKeys) ? params.exposurePackageKeys : [];
    const learningSnapshot = params && params.learningSnapshot && typeof params.learningSnapshot === "object"
      ? params.learningSnapshot
      : null;
    const matchupMemory = Array.isArray(params && params.matchupMemory)
      ? params.matchupMemory
      : (learningSnapshot && Array.isArray(learningSnapshot.recentMatchups)
        ? learningSnapshot.recentMatchups
        : []);
    const situationChip = normalizeSituationChip(params && params.situationChip);
    const offenseTag = normalizeOffenseTag(params && params.offenseTag);
    // Prefer a concrete OCR/manual showing over synthetic tag placeholders.
    const offenseShowing = normalizeOffenseShowing(params && params.offenseShowing)
      || offenseTagToShowing(offenseTag);

    let ctx = {
      down: Number(params && params.down) || 1,
      yards: (function () {
        const raw = params && params.yards != null ? Number(params.yards) : Number(params && params.yardsToGo);
        return Number.isFinite(raw) && raw > 0 ? raw : null;
      })(),
      goalToGo: !!(params && params.goalToGo),
      fieldPosition: (params && params.fieldPosition) || null,
      distBucket: (params && params.distBucket) || null,
      fieldPositionBucket: (params && params.fieldPositionBucket) || null,
      situationChip: situationChip,
      offenseTag: offenseTag,
      offenseShowing: offenseShowing,
      opponent: cleanText(params && params.opponent) || null,
      quarter: null,
      userScore: null,
      oppScore: null,
      scoreDiff: null,
    };
    const game = buildGameContextFields(params);
    ctx.quarter = game.quarter;
    ctx.userScore = game.userScore;
    ctx.oppScore = game.oppScore;
    ctx.scoreDiff = game.scoreDiff;
    if (situationChip) ctx = applySituationChipToContext(situationChip, ctx);
    if (!ctx.distBucket) ctx.distBucket = distToBucket(ctx.yards);
    if (!ctx.fieldPositionBucket) {
      ctx.fieldPositionBucket = buildFieldPositionBucket(ctx.fieldPosition, ctx.goalToGo);
    }
    ctx.situationPlan = buildDefensiveSituationPlan(ctx);

    const groups = {};
    plays.forEach(function (play) {
      if (!play) return;
      const traits = defensivePlayTraitsOf(play);
      if (shouldExcludeDefensivePlay(play, ctx, traits)) return;

      let score = scoreDefensivePlayCore(play, ctx, traits);
      score += scoreOffenseShowingBias(play, traits, offenseShowing);
      if (play.id && recentPlayIds.has(play.id)) score -= 3.25;

      const packageKey = buildDefensivePackageKey(play, traits);
      const coverageFamily = coverageFamilyOf(play, traits);
      const pressure = pressureOf(traits);
      const formation = defensiveFormationKeyOf(play) || "BASE";

      if (!groups[packageKey]) {
        groups[packageKey] = {
          packageKey: packageKey,
          formation: formation,
          coverageFamily: coverageFamily,
          coverageLabel: coverageFamilyLabel(coverageFamily),
          pressure: pressure,
          label: formatDefensivePackageLabel(packageKey, formation, coverageFamily),
          scores: [],
          members: [],
        };
      }
      groups[packageKey].scores.push(score);
      groups[packageKey].members.push({ play: play, traits: traits, score: score });
    });

    const scored = Object.keys(groups).map(function (key) {
      const group = groups[key];
      const scores = group.scores.slice().sort(function (a, b) { return b - a; });
      const topN = scores.slice(0, Math.min(3, scores.length));
      const avgTop = topN.reduce(function (sum, value) { return sum + value; }, 0) / Math.max(topN.length, 1);
      const maxScore = scores[0] || 0;
      let packageScore = (avgTop * 0.65) + (maxScore * 0.35);
      packageScore += packageMmrAdjustment(group.packageKey, recentPackageKeys, exposurePackageKeys);
      const matchupAdj = packageOutcomeMatchupAdjustment(group, matchupMemory, ctx);
      packageScore += matchupAdj;
      const learningAdj = packageLearningEffectivenessAdjustment(group, learningSnapshot);
      packageScore += learningAdj;
      const tendencyAdj = packageTendencyAdjustment(group, learningSnapshot, ctx);
      packageScore += tendencyAdj;
      let matchupWhy = "";
      if (matchupAdj >= 1.4) matchupWhy = "Stay in the family that just stopped them.";
      else if (matchupAdj <= -2.0) matchupWhy = "Leave the family that just got beat.";
      else if (learningAdj >= 1.2) matchupWhy = "Learned stop rate favors this shell.";
      else if (learningAdj <= -1.2) matchupWhy = "Learned stop rate cools this shell.";
      else if (tendencyAdj >= 1.0) matchupWhy = "Counters their OCR tendency in this look.";

      group.members.sort(function (a, b) { return b.score - a.score; });
      // Prefer an in-package example that is not the exact prior OCR defense play.
      const bannedPlayIds = new Set(recentPlayIds);
      matchupMemory.slice(-6).forEach(function (entry) {
        if (entry && entry.defensePlayId) bannedPlayIds.add(entry.defensePlayId);
      });
      const example = group.members.find(function (entry) {
        return entry.play && entry.play.id && !bannedPlayIds.has(entry.play.id);
      }) || group.members.find(function (entry) {
        return entry.play && entry.play.id && !recentPlayIds.has(entry.play.id);
      }) || group.members[0] || null;

      return {
        packageKey: group.packageKey,
        formation: group.formation,
        coverageFamily: group.coverageFamily,
        coverageLabel: group.coverageLabel,
        pressure: group.pressure,
        label: group.label,
        memberCount: group.members.length,
        _score: packageScore,
        score: packageScore,
        _matchupAdj: matchupAdj,
        _learningAdj: learningAdj,
        _tendencyAdj: tendencyAdj,
        _matchupWhy: matchupWhy,
        why: "",
        examplePlay: example ? example.play : null,
        exampleScore: example ? example.score : null,
      };
    });

    scored.forEach(function (item) {
      item.why = buildPackageWhy(item, ctx, offenseTag);
    });

    const top = pickTopDefensivePackagesCore({
      scored: scored,
      limit: Number.isFinite(Number(params && params.limit)) ? Number(params.limit) : 3,
      scoreKey: "_score",
      explore: params && params.explore,
      fitnessBand: params && params.fitnessBand,
      rng: params && params.rng,
      recentPackageKeys: recentPackageKeys,
      exposurePackageKeys: exposurePackageKeys,
    });

    return {
      context: ctx,
      recommendations: top.map(function (item) {
        return {
          packageKey: item.packageKey,
          formation: item.formation,
          coverageFamily: item.coverageFamily,
          coverageLabel: item.coverageLabel,
          pressure: item.pressure,
          label: item.label,
          memberCount: item.memberCount,
          _score: item._score,
          score: item.score,
          why: item.why,
          _why: item.why,
          examplePlay: item.examplePlay,
          examplePlayId: item.examplePlay && item.examplePlay.id ? item.examplePlay.id : null,
          examplePlayName: item.examplePlay ? cleanText(item.examplePlay.play_name) : "",
        };
      }),
      scoredCount: scored.length,
      packageCount: scored.length,
    };
  }

  return {
    DEFENSIVE_TYPES: DEFENSIVE_TYPES,
    distToBucket: distToBucket,
    buildFieldPositionBucket: buildFieldPositionBucket,
    defensiveFamilyOf: defensiveFamilyOf,
    defensiveFormationKeyOf: defensiveFormationKeyOf,
    defensiveFormationSetKeyOf: defensiveFormationSetKeyOf,
    defensivePlayTraitsOf: defensivePlayTraitsOf,
    shouldExcludeDefensivePlay: shouldExcludeDefensivePlay,
    isTrueGoalLineDefenseContext: isTrueGoalLineDefenseContext,
    isPreventEligibleContext: isPreventEligibleContext,
    isLongMoneyDown: isLongMoneyDown,
    buildDefensiveSituationPlan: buildDefensiveSituationPlan,
    scoreDefensivePlanFit: scoreDefensivePlanFit,
    normalizeOffenseShowing: normalizeOffenseShowing,
    offenseShowingTraitsOf: offenseShowingTraitsOf,
    scoreOffenseShowingBias: scoreOffenseShowingBias,
    buildOpponentOffenseFormationCatalog: buildOpponentOffenseFormationCatalog,
    scoreDefensivePlayCore: scoreDefensivePlayCore,
    buildDefensiveWhy: buildDefensiveWhy,
    pickTopDefensiveRecommendationsCore: pickTopDefensiveRecommendationsCore,
    computeDefensiveRecommendations: computeDefensiveRecommendations,
    DC_SITUATION_CHIPS: DC_SITUATION_CHIPS,
    DC_OFFENSE_TAGS: DC_OFFENSE_TAGS,
    normalizeSituationChip: normalizeSituationChip,
    normalizeOffenseTag: normalizeOffenseTag,
    applySituationChipToContext: applySituationChipToContext,
    offenseTagToShowing: offenseTagToShowing,
    inferOffenseTagFromShowing: inferOffenseTagFromShowing,
    coverageFamilyOf: coverageFamilyOf,
    coverageFamilyLabel: coverageFamilyLabel,
    buildDefensivePackageKey: buildDefensivePackageKey,
    formatDefensivePackageLabel: formatDefensivePackageLabel,
    packageMmrAdjustment: packageMmrAdjustment,
    packageOutcomeMatchupAdjustment: packageOutcomeMatchupAdjustment,
    packageLearningEffectivenessAdjustment: packageLearningEffectivenessAdjustment,
    packageTendencyAdjustment: packageTendencyAdjustment,
    boundedEffectivenessAdjustment: boundedEffectivenessAdjustment,
    pickTopDefensivePackagesCore: pickTopDefensivePackagesCore,
    computeDefensivePackageRecommendations: computeDefensivePackageRecommendations,
  };
});
