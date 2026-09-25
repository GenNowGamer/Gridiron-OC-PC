(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.GridironRecommendationCore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function cleanText(value) {
    return String(value ?? "").trim();
  }

  const TEAM_IDENTITY_ARCHETYPES = {
    POWER_MULTIPLE: {
      label: "Physical Multiple",
      type: { RUN: 1.3, PA: 0.8, RPO: 0.4 },
      families: { duo_power: 1.1, inside_zone: 0.9, split_zone: 0.8, counter: 0.6, iso: 0.7, draw: 0.5, boot: 0.7, flood: 0.5, leak: 0.7 },
      concepts: { "play action": 0.6, seam: 0.5, cross: 0.4, "jet sweep": 0.3 },
      tags: { underCenter: 0.5, multipleTe: 1.0, motion: 0.8, condensed: 0.6, middleField: 0.5 },
      situational: { earlyRun: 0.5, moneyRun: 0.3 },
    },
    SHOTGUN_PASS: {
      label: "Shotgun Pass",
      type: { PASS: 1.4, PA: 0.3, RPO: 0.2, RUN: -0.2 },
      families: { quick_game: 0.9, man_beat: 0.8, shot: 0.9, flood: 0.4, levels_dig: 0.7, curl_flat: 0.6 },
      concepts: { spacing: 0.5, stick: 0.5, bench: 0.4, dagger: 0.6, post: 0.6, out: 0.4 },
      tags: { shotgun: 1.1, spread: 0.8, quickGame: 0.7, vertical: 0.6, sidelinePass: 0.4 },
      situational: { moneyPass: 0.5, longPass: 0.5 },
    },
    WEST_COAST_PA: {
      label: "West Coast Play Action",
      type: { RUN: 0.8, PASS: 0.5, PA: 1.1 },
      families: { inside_zone: 0.8, split_zone: 0.8, wide_zone: 0.8, boot: 0.9, flood: 0.7, quick_game: 0.5, curl_flat: 0.5, snag_spot: 0.4 },
      concepts: { "play action": 0.7, spacing: 0.4, cross: 0.4, seam: 0.4 },
      tags: { underCenter: 0.8, motion: 0.5, quickGame: 0.4, middleField: 0.5 },
      situational: { earlyRun: 0.4, longPass: 0.3 },
    },
    GROUND_CONTROL: {
      label: "Ground Control",
      type: { RUN: 1.5, PA: 0.5, PASS: 0.2 },
      families: { duo_power: 1.1, inside_zone: 0.9, counter: 0.8, dive: 0.9, trap: 0.8, iso: 0.7, draw: 0.5, boot: 0.4 },
      concepts: { cross: 0.3, seam: 0.2, "quick game": 0.3 },
      tags: { underCenter: 0.7, multipleTe: 0.8, middleField: 0.5, condensed: 0.5 },
      situational: { earlyRun: 0.6, moneyRun: 0.5 },
    },
    QB_RUN_MULTIPLE: {
      label: "QB-Centric Multiple",
      type: { RUN: 1.2, RPO: 0.8, PASS: 0.5, PA: 0.3 },
      families: { inside_zone: 0.8, counter: 0.7, quick_game: 0.6, shot: 0.6, flood: 0.4, read_option: 0.7 },
      concepts: { spacing: 0.4, stick: 0.4, post: 0.4, "jet sweep": 0.3 },
      tags: { shotgun: 0.8, spread: 0.6, motion: 0.4, quickGame: 0.4, vertical: 0.4 },
      situational: { earlyRun: 0.4, moneyPass: 0.2 },
    },
    MOTION_SPEED: {
      label: "Motion Speed",
      type: { PASS: 1.0, RUN: 0.7, RPO: 0.7, PA: 0.4 },
      families: { wide_zone: 0.8, jet: 1.0, quick_game: 0.8, flood: 0.6, shot: 0.5, wheel: 0.4, read_option: 0.5 },
      concepts: { "jet sweep": 0.7, flat: 0.4, swing: 0.4, cross: 0.4, post: 0.4 },
      tags: { motion: 1.2, spread: 0.6, quickGame: 0.5, vertical: 0.4, sidelinePass: 0.4 },
      situational: { earlyRun: 0.2, moneyPass: 0.2 },
    },
    QUICK_WEST_COAST: {
      label: "Quick West Coast",
      type: { PASS: 1.0, RUN: 0.6, PA: 0.3, RPO: 0.2 },
      families: { quick_game: 1.0, man_beat: 0.7, wide_zone: 0.5, boot: 0.4, flood: 0.4, curl_flat: 0.6, snag_spot: 0.5 },
      concepts: { spacing: 0.6, stick: 0.6, slant: 0.5, mesh: 0.5, bench: 0.3 },
      tags: { quickGame: 1.0, underCenter: 0.3, spread: 0.4, sidelinePass: 0.3 },
      situational: { moneyPass: 0.4, earlyRun: 0.2 },
    },
    UNDER_CENTER_PA_MIDDLE: {
      label: "Under-Center Play Action",
      type: { PA: 1.2, PASS: 0.7, RUN: 0.6 },
      families: { boot: 1.0, flood: 0.7, leak: 0.8, inside_zone: 0.6, wide_zone: 0.6, shot: 0.5 },
      concepts: { cross: 0.5, seam: 0.5, dagger: 0.5, post: 0.4, "play action": 0.7 },
      tags: { underCenter: 1.0, middleField: 0.8, condensed: 0.4, motion: 0.4 },
      situational: { longPass: 0.4, earlyRun: 0.3 },
    },
    VERTICAL_RPO_GUN: {
      label: "Vertical Gun / RPO",
      type: { PASS: 1.0, RPO: 1.0, RUN: 0.3, PA: 0.2 },
      families: { quick_game: 0.5, shot: 0.9, flood: 0.4, inside_zone: 0.3, verticals: 0.8, levels_dig: 0.5 },
      concepts: { post: 0.6, dagger: 0.6, seam: 0.5, spacing: 0.3, rpo: 0.6 },
      tags: { shotgun: 1.2, spread: 0.8, vertical: 0.7, quickGame: 0.3 },
      situational: { moneyPass: 0.4, longPass: 0.6 },
    },
    PERIMETER_PASS: {
      label: "Perimeter Passing",
      type: { PASS: 1.2, RUN: 0.2, PA: 0.2 },
      families: { flood: 0.8, quick_game: 0.6, shot: 0.6, smash: 0.7, curl_flat: 0.5 },
      concepts: { out: 0.7, corner: 0.7, bench: 0.6, flood: 0.6, curl: 0.4 },
      tags: { spread: 0.8, sidelinePass: 1.0, shotgun: 0.5, vertical: 0.4 },
      situational: { moneyPass: 0.4, longPass: 0.3 },
    },
    PASS_FIRST_CREATIVE: {
      label: "Pass-First Creative",
      type: { PASS: 1.2, PA: 0.5, RPO: 0.4, RUN: -0.1 },
      families: { quick_game: 0.7, flood: 0.5, shot: 0.6, man_beat: 0.5, levels_dig: 0.5, smash: 0.4 },
      concepts: { spacing: 0.4, cross: 0.4, dagger: 0.5, bench: 0.3, post: 0.4 },
      tags: { shotgun: 0.8, spread: 0.6, quickGame: 0.4, vertical: 0.4 },
      situational: { moneyPass: 0.5, longPass: 0.4 },
    },
    AIR_CORYELL_EFFICIENCY: {
      label: "Air Coryell Efficiency",
      type: { PASS: 1.0, PA: 0.5, RUN: 0.2 },
      families: { shot: 1.0, flood: 0.7, quick_game: 0.5, boot: 0.4, verticals: 0.8, levels_dig: 0.6 },
      concepts: { post: 0.7, corner: 0.6, dagger: 0.6, out: 0.4, curl: 0.4 },
      tags: { sidelinePass: 0.7, vertical: 0.9, spread: 0.6, quickGame: 0.3 },
      situational: { moneyPass: 0.4, longPass: 0.5 },
    },
    CREATIVE_WEST_COAST: {
      label: "Creative West Coast",
      type: { PASS: 1.0, RUN: 0.5, PA: 0.4, RPO: 0.3 },
      families: { quick_game: 0.9, flood: 0.6, shot: 0.7, man_beat: 0.6, jet: 0.4, snag_spot: 0.5 },
      concepts: { spacing: 0.5, bench: 0.4, whip: 0.4, post: 0.4, screen: 0.4 },
      tags: { spread: 0.7, motion: 0.5, quickGame: 0.7, vertical: 0.5, bunch: 0.4 },
      situational: { moneyPass: 0.4, longPass: 0.3 },
    },
    SPREAD_RUN: {
      label: "Spread Run",
      type: { RUN: 1.2, RPO: 0.7, PASS: 0.4, PA: 0.2 },
      families: { wide_zone: 0.7, counter: 0.8, jet: 0.8, inside_zone: 0.5, quick_game: 0.4, read_option: 0.6 },
      concepts: { "jet sweep": 0.6, screen: 0.4, flat: 0.3, spacing: 0.3, counter: 0.4 },
      tags: { shotgun: 0.6, spread: 0.8, motion: 0.4, quickGame: 0.3, sidelinePass: 0.2 },
      situational: { earlyRun: 0.5, moneyRun: 0.3 },
    },
    PA_MOTION_EXPLOSIVE: {
      label: "Play Action / Motion Explosive",
      type: { PA: 1.55, PASS: 0.85, RUN: 0.45 },
      families: { boot: 1.15, flood: 0.95, leak: 0.95, shot: 0.8, inside_zone: 0.35, wide_zone: 0.45, duo_power: 0.25 },
      concepts: { "play action": 0.95, post: 0.55, dagger: 0.55, seam: 0.55, "jet sweep": 0.45 },
      tags: { underCenter: 1.0, motion: 1.05, bunch: 0.55, condensed: 0.55, vertical: 0.55 },
      situational: { earlyRun: 0.05, earlyPa: 1.15, earlyMotion: 0.85, longPass: 0.45 },
    },
    VERSATILE_WEST_COAST: {
      label: "Versatile West Coast",
      type: { RUN: 0.6, PASS: 0.8, PA: 0.5, RPO: 0.2 },
      families: { quick_game: 0.7, inside_zone: 0.5, wide_zone: 0.5, flood: 0.5, boot: 0.4, shot: 0.4 },
      concepts: { spacing: 0.5, stick: 0.5, cross: 0.4, seam: 0.3, out: 0.3 },
      tags: { quickGame: 0.6, underCenter: 0.3, spread: 0.4, middleField: 0.3 },
      situational: { earlyRun: 0.2, moneyPass: 0.3 },
    },
    RHYTHM_PASSING: {
      label: "Rhythm Passing",
      type: { PASS: 1.1, RUN: 0.3, PA: 0.3 },
      families: { quick_game: 1.0, man_beat: 0.7, shot: 0.4, flood: 0.4 },
      concepts: { spacing: 0.6, stick: 0.6, mesh: 0.5, seam: 0.4, cross: 0.4, under: 0.3 },
      tags: { quickGame: 0.9, spread: 0.4, middleField: 0.5 },
      situational: { moneyPass: 0.5, longPass: 0.2 },
    },
    TEMPO_MOTION_RPO: {
      label: "Tempo Motion RPO",
      type: { RUN: 1.0, RPO: 0.9, PASS: 0.7, PA: 0.2 },
      families: { quick_game: 0.6, inside_zone: 0.6, counter: 0.6, shot: 0.4, jet: 0.4 },
      concepts: { rpo: 0.7, spacing: 0.4, flat: 0.3, swing: 0.3, post: 0.3 },
      tags: { shotgun: 0.7, motion: 0.8, spread: 0.6, quickGame: 0.4, vertical: 0.3 },
      situational: { earlyRun: 0.4, moneyPass: 0.2 },
    },
    SHANAHAN_CONDENSED: {
      label: "Shanahan Condensed",
      type: { RUN: 1.0, PA: 0.9, PASS: 0.6, RPO: 0.3 },
      families: { wide_zone: 1.0, split_zone: 0.9, boot: 0.9, leak: 0.8, flood: 0.7, quick_game: 0.4, smash: 0.5 },
      concepts: { "play action": 0.6, cross: 0.5, over: 0.5, seam: 0.4, "jet sweep": 0.4 },
      tags: { motion: 0.9, condensed: 1.0, underCenter: 0.5, multipleTe: 0.5, middleField: 0.5 },
      situational: { earlyRun: 0.4, longPass: 0.3 },
    },
    VERTICAL_AGGRESSIVE: {
      label: "Vertical Aggressive",
      type: { PASS: 1.3, PA: 0.4, RUN: 0.1 },
      families: { shot: 1.1, flood: 0.6, quick_game: 0.4, man_beat: 0.4, verticals: 0.9, levels_dig: 0.5 },
      concepts: { post: 0.7, corner: 0.7, dagger: 0.6, seam: 0.5, out: 0.3 },
      tags: { spread: 0.7, vertical: 1.0, sidelinePass: 0.5, multipleTe: 0.3 },
      situational: { moneyPass: 0.5, longPass: 0.6 },
    },
    POWER_RUN_CONDENSED: {
      label: "Power Run Condensed",
      type: { RUN: 1.4, PA: 0.5, RPO: 0.3, PASS: 0.2 },
      families: { wide_zone: 0.9, duo_power: 0.8, counter: 0.8, boot: 0.5, flood: 0.3 },
      concepts: { "jet sweep": 0.4, toss: 0.4, flat: 0.2, swing: 0.2 },
      tags: { condensed: 0.9, motion: 0.4, underCenter: 0.4, sidelinePass: 0.2 },
      situational: { earlyRun: 0.6, moneyRun: 0.4 },
    },
  };

  const TEAM_IDENTITY_MAP = {
    ARI: "POWER_RUN_CONDENSED",
    ATL: "VERSATILE_WEST_COAST",
    BAL: "POWER_MULTIPLE",
    BUF: "QB_RUN_MULTIPLE",
    CAR: "QUICK_WEST_COAST",
    CHI: "PA_MOTION_EXPLOSIVE",
    CIN: "SHOTGUN_PASS",
    CLE: "WEST_COAST_PA",
    DAL: "AIR_CORYELL_EFFICIENCY",
    DEN: "AIR_CORYELL_EFFICIENCY",
    DET: "PA_MOTION_EXPLOSIVE",
    GB: "VERSATILE_WEST_COAST",
    HOU: "UNDER_CENTER_PA_MIDDLE",
    IND: "VERTICAL_RPO_GUN",
    JAX: "PERIMETER_PASS",
    KC: "CREATIVE_WEST_COAST",
    LV: "SPREAD_RUN",
    LAC: "GROUND_CONTROL",
    LAR: "SHANAHAN_CONDENSED",
    MIA: "MOTION_SPEED",
    MIN: "RHYTHM_PASSING",
    NE: "WEST_COAST_PA",
    NO: "SHANAHAN_CONDENSED",
    NYG: "UNDER_CENTER_PA_MIDDLE",
    NYJ: "QUICK_WEST_COAST",
    PHI: "TEMPO_MOTION_RPO",
    PIT: "GROUND_CONTROL",
    SF: "SHANAHAN_CONDENSED",
    SEA: "VERTICAL_AGGRESSIVE",
    TB: "VERTICAL_AGGRESSIVE",
    TEN: "PASS_FIRST_CREATIVE",
    WAS: "SPREAD_RUN",
  };

  const DRIVE_RESULT_OPTIONS = [
    { id: "touchdown", label: "Touchdown", successPoints: 4.5, firstDownAchieved: true },
    { id: "field_goal", label: "Field Goal", successPoints: 1.5, firstDownAchieved: false },
    { id: "sack", label: "Sack", successPoints: 0, firstDownAchieved: false, driveEnding: false, negativePlay: true },
    { id: "punt", label: "Punt", successPoints: -1.25, firstDownAchieved: false },
    { id: "safety", label: "Safety", successPoints: -3.5, firstDownAchieved: false, negativePlay: true },
    { id: "interception", label: "Interception", successPoints: -4.0, firstDownAchieved: false, negativePlay: true },
    { id: "pick_6", label: "Pick 6", successPoints: -6.0, firstDownAchieved: false, negativePlay: true },
    { id: "fumble", label: "Fumble", successPoints: -4.0, firstDownAchieved: false, negativePlay: true },
    { id: "scoop_and_score", label: "Scoop & Score", successPoints: -6.0, firstDownAchieved: false, negativePlay: true },
    { id: "turnover_on_downs", label: "Turnover on Downs", successPoints: -2.75, firstDownAchieved: false },
    { id: "quarter_expired", label: "Quarter Expired", successPoints: -0.25, firstDownAchieved: false },
  ];

  function getTeamIdentityProfile(teamCode) {
    const key = TEAM_IDENTITY_MAP[cleanText(teamCode).toUpperCase()];
    return key ? TEAM_IDENTITY_ARCHETYPES[key] : null;
  }

  function matchProfileTerm(terms, concepts) {
    return terms.some(function (term) {
      return concepts.some(function (c) {
        return c === term || c.includes(term) || term.includes(c);
      });
    });
  }

  function teamIdentityBonusCore(params) {
    const profile = getTeamIdentityProfile(params.teamCode);
    if (!profile) return 0;

    const playTraitsOf = params.playTraitsOf;
    const playStructureTags = params.playStructureTags;
    const play = params.play;
    const bucket = params.bucket;
    const down = params.down;
    const defense = params.defense;
    const goalToGo = params.goalToGo;

    const t = params.traits || playTraitsOf(play);
    const tags = playStructureTags(play, t);
    let score = 0;

    score += (profile.type && profile.type[play.type]) || 0;
    score += (profile.families && profile.families[t.fam]) || 0;

    const conceptBoost = Object.entries(profile.concepts || {}).reduce(function (sum, entry) {
      const term = entry[0];
      const value = entry[1];
      return sum + (matchProfileTerm([term], t.concepts) ? value : 0);
    }, 0);
    score += Math.min(conceptBoost, 2.2);

    Object.entries(profile.tags || {}).forEach(function (entry) {
      const tag = entry[0];
      const value = entry[1];
      if (tags[tag]) score += value;
    });

    if (profile.situational && profile.situational.earlyRun && down <= 2 && bucket !== "long" && t.isRun) score += profile.situational.earlyRun;
    if (profile.situational && profile.situational.earlyPa && down <= 2 && bucket !== "long") {
      const earlyPaFamily = ["boot", "flood", "leak", "shot", "smash", "verticals"].indexOf(t.fam) >= 0;
      if (t.isPA || earlyPaFamily) score += profile.situational.earlyPa;
    }
    if (profile.situational && profile.situational.earlyMotion && down <= 2 && tags.motion && (t.isPA || t.isPassish || t.fam === "jet")) {
      score += profile.situational.earlyMotion;
    }
    if (profile.situational && profile.situational.moneyRun && down >= 3 && bucket === "short" && t.isRun) score += profile.situational.moneyRun;
    if (profile.situational && profile.situational.moneyPass && down >= 3 && t.isPassish && (t.sticksFriendly || tags.quickGame)) score += profile.situational.moneyPass;
    if (profile.situational && profile.situational.longPass && bucket === "long" && t.isPassish && (t.explosive || tags.vertical)) score += profile.situational.longPass;

    if (goalToGo) {
      if (tags.condensed && (profile.tags && (profile.tags.condensed || profile.tags.multipleTe))) score += 0.8;
      if (tags.underCenter && profile.tags && profile.tags.underCenter) score += 0.8;
      if (tags.motion && profile.tags && profile.tags.motion) score += 0.75;
      if (t.quickAnswer && profile.tags && profile.tags.quickGame) score += 0.7;
      if (t.interiorRun && (profile.families && (profile.families.inside_zone || profile.families.duo_power) || (profile.type && profile.type.RUN))) score += 0.9;
      if (t.isPA && ((profile.families && (profile.families.boot || profile.families.leak)) || (profile.type && profile.type.PA))) score += 0.7;
    }

    if (defense === "Blitz" && tags.quickGame && profile.tags && (profile.tags.quickGame || profile.tags.motion)) score += 0.25;

    return Math.max(-1.5, Math.min(score, 5.5));
  }

  function matchesScriptEntryCore(params) {
    const traits = params.traits || params.playTraitsOf(params.play);
    const concepts = traits.concepts;
    const entry = params.entry;
    const play = params.play;

    const matchesType = !entry.types || entry.types.includes(play.type);
    const matchesFamily = entry.families && entry.families.includes(traits.fam);
    const matchesConcept = !!entry.concepts && entry.concepts.some(function (term) {
      return concepts.some(function (c) {
        return c === term || c.includes(term) || term.includes(c);
      });
    });

    return matchesType && (matchesFamily || matchesConcept);
  }

  function ocTypeTargetCore(typeHist) {
    const recent = (Array.isArray(typeHist) ? typeHist : []).slice(-20);
    if (recent.length < 6) return null;
    const runish = recent.filter(function (t) { return t === "RUN" || t === "RPO"; }).length;
    const runRate = runish / recent.length;
    if (runRate < 0.55) return "RUN";
    if (runRate > 0.68) return "PASSISH";
    return null;
  }

  function isRiskyPlayActionSpotCore(params) {
    const t = params.traits || params.playTraitsOf(params.play);
    if (!t.isPA) return false;
    if (params.down >= 3 && params.distBucket === "long") return true;
    if (params.down === 4 && params.distBucket !== "short") return true;
    if (params.defense === "Blitz" && (params.down >= 3 || params.distBucket === "long")) return true;
    return false;
  }

  const LEARNING_MODE_KEYS = ["normal", "two_minute", "kill_clock", "comeback", "blitz_beater", "redzone"];

  function normalizeLearningModeKey(mode) {
    const normalized = cleanText(mode).toLowerCase().replace(/\s+/g, "_");
    if (normalized === "2_minute" || normalized === "two-minute" || normalized === "2-minute") return "two_minute";
    if (LEARNING_MODE_KEYS.includes(normalized)) return normalized;
    return "normal";
  }

  function appendLearningModeToKey(baseKey, mode) {
    const base = cleanText(baseKey);
    if (!base) return "";
    const modeKey = normalizeLearningModeKey(mode);
    const parts = base.split("|");
    if (LEARNING_MODE_KEYS.includes(parts[parts.length - 1])) {
      parts[parts.length - 1] = modeKey;
      return parts.join("|");
    }
    return `${base}|${modeKey}`;
  }

  function stripLearningModeFromKey(learningSituationKey) {
    const key = cleanText(learningSituationKey);
    if (!key) return "";
    const parts = key.split("|");
    if (LEARNING_MODE_KEYS.includes(parts[parts.length - 1])) {
      return parts.slice(0, -1).join("|");
    }
    return key;
  }

  function recordGameOutcomeMemoryEntry(memory, context, outcome, options) {
    const list = Array.isArray(memory) ? memory.slice() : [];
    if (!context?.playId || !outcome) return list;
    const successPoints = Number(outcome.successPoints);
    if (!Number.isFinite(successPoints)) return list;
    const maxEntries = Number(options?.maxEntries) > 0 ? Number(options.maxEntries) : 24;
    const defenseShown = cleanText(context.lastDefenseShown || context.defenseShown);
    list.push({
      playId: cleanText(context.playId),
      family: cleanText(context.family),
      formationKey: cleanText(context.formationKey),
      formationSetKey: cleanText(context.formationSetKey),
      conceptKey: cleanText(context.conceptKey || context.concept || context.family),
      lastDefenseShown: defenseShown && defenseShown.toLowerCase() !== "unknown" ? defenseShown : "",
      successPoints,
      success: successPoints > 0,
      negativePlay: outcome.negativePlay === true,
      terminalResult: cleanText(outcome.terminalResult),
      at: Number(outcome.inferredAt) || Date.now(),
    });
    return list.slice(-maxEntries);
  }

  function gameOutcomeMemoryAdjustment(play, memory, helpers) {
    const entries = Array.isArray(memory) ? memory : [];
    if (!play?.id || entries.length === 0) return 0;
    const familyOf = helpers.familyOf;
    const formationKeyOf = helpers.formationKeyOf;
    const formationSetKeyOf = helpers.formationSetKeyOf;
    const coverageMatchupScore = helpers.coverageMatchupScore;
    const playTraitsOf = helpers.playTraitsOf;
    const fam = familyOf(play);
    const formationKey = formationKeyOf(play);
    const formationSetKey = formationSetKeyOf(play);
    const traits = helpers.traits || (playTraitsOf ? playTraitsOf(play) : null);
    const recent = entries.slice(-10);
    let penalty = 0;
    let answerBonus = 0;

    recent.forEach(function (entry, index) {
      const ageWeight = 1 - (recent.length - 1 - index) * 0.06;
      const points = Number(entry.successPoints);
      if (!Number.isFinite(points)) return;
      const weight = Math.max(0.45, ageWeight);
      const defenseShown = cleanText(entry.lastDefenseShown || entry.defenseShown);

      if (points <= -0.75) {
        const severity = points <= -3.5 ? 1.35 : points <= -1.4 ? 1 : 0.55;
        const negWeight = weight * severity;
        if (entry.playId && entry.playId === play.id) penalty += 2.8 * negWeight;
        else if (entry.formationSetKey && entry.formationSetKey === formationSetKey) penalty += 1.9 * negWeight;
        else if (entry.formationKey && entry.formationKey === formationKey) penalty += 1.15 * negWeight;
        else if (entry.family && entry.family === fam) penalty += 0.95 * negWeight;

        // Coverage × package: extra tax when same family failed vs a logged look.
        if (defenseShown && entry.family && entry.family === fam) {
          penalty += 0.85 * negWeight;
        }
        // Nudge toward beaters of the look that just burned us.
        if (defenseShown && typeof coverageMatchupScore === "function") {
          const beat = Number(coverageMatchupScore(play, defenseShown, traits)) || 0;
          if (beat > 0) {
            let credit = 0.4 * negWeight * Math.min(beat / 3.2, 1);
            if (entry.family && entry.family === fam) credit *= 0.35;
            answerBonus += credit;
          }
        }
        return;
      }

      // Positive coverage-tagged outcomes: soft preference for the package that worked vs that look.
      if (points >= 1.25 && defenseShown && entry.family && entry.family === fam) {
        answerBonus += 0.55 * weight * Math.min(points / 3, 1.15);
      }
    });

    return -Math.min(penalty, 6.5) + Math.min(answerBonus, 2.25);
  }

  // Same-drive lean: after logging Last Defense Shown vs a confirmed package,
  // bias the *next* sheet toward answers for that look (survives resetDefenseLogState).
  function sameDriveAnswerLastSnapAdjustment(play, lastSnap, helpers) {
    if (!play || !lastSnap) return 0;
    const defense = cleanText(lastSnap.defense);
    if (!defense || defense.toLowerCase() === "unknown") return 0;
    const coverageMatchupScore = helpers && helpers.coverageMatchupScore;
    const familyOf = helpers && helpers.familyOf;
    const playTraitsOf = helpers && helpers.playTraitsOf;
    if (typeof coverageMatchupScore !== "function") return 0;
    const traits = (helpers && helpers.traits) || (playTraitsOf ? playTraitsOf(play) : null);
    const beat = Number(coverageMatchupScore(play, defense, traits)) || 0;
    if (beat <= 0) return 0;
    let bonus = beat * 0.55;
    const againstFamily = cleanText(lastSnap.againstFamily).toLowerCase();
    const fam = cleanText(familyOf ? familyOf(play) : (traits && traits.fam) || "").toLowerCase();
    // Prefer complementary answers over recycling the exact package they just faced.
    if (againstFamily && fam && againstFamily === fam) bonus *= 0.65;
    return Math.max(0, Math.min(bonus, 3.0));
  }

  function turnoverRiskAdjustment(play, traits, plan, helpers) {
    const t = traits || (helpers?.playTraitsOf ? helpers.playTraitsOf(play) : null);
    if (!t || !plan) return 0;
    let score = 0;
    const field = cleanText(plan.fieldPositionBucket);
    const goal = cleanText(plan.offensiveGoal);
    const lowRisk = ["very_low", "low", "low_medium"].includes(cleanText(plan.riskTolerance));
    const highPressure = ["medium_high", "high"].includes(cleanText(plan.pressureConcern));
    const dangerousField = field === "backed_up" || field === "coming_out";
    const stabilizeGoal = goal === "stabilize_field_position" || goal === "avoid_negative_play";
    const isDeepConcept = t.fam === "shot" || t.fam === "flood" || t.fam === "leak" || t.fam === "wheel" || (t.isPA && t.explosive);
    const isTurnoverProne = isDeepConcept || (t.highVariance && !t.quickAnswer && !t.screenLike);

    if (!isTurnoverProne) return 0;

    if (dangerousField && stabilizeGoal) score -= t.fam === "shot" || t.fam === "leak" ? 2.6 : 1.7;
    if (dangerousField && lowRisk) score -= 1.2;
    if (highPressure && (t.fam === "shot" || t.isPA)) score -= 1.4;
    if (goal === "stay_ahead_of_schedule" && t.fam === "shot" && !t.quickAnswer) score -= 1.1;
    if (t.fam === "leak" && (dangerousField || highPressure)) score -= 0.8;

    return Math.max(score, -4.5);
  }

  function applyLateGamePlanPressure(plan, context) {
    if (!plan || !context) return plan;
    const scoreDiff = Number(context.scoreDiff);
    const quarter = Number(context.quarter);
    const mode = normalizeLearningModeKey(context.playcallingMode);
    const hasScore = Number.isFinite(scoreDiff);
    const hasQuarter = Number.isFinite(quarter);
    const comebackMode = mode === "comeback";
    // Explicit playcalling modes own the sheet. Don't fight Kill Clock / 2-Minute /
    // Blitz Beater / Redzone with a late-game pass push. Comeback stays aligned.
    if (mode && mode !== "normal" && !comebackMode) return plan;
    if (!hasScore && !comebackMode) return plan;

    const trailingHard = hasScore && scoreDiff <= -8;
    const trailingTwoScores = hasScore && scoreDiff <= -10;
    const late = !hasQuarter || quarter >= 4 || (quarter === 3 && trailingTwoScores);
    const shouldPush = (trailingHard && late) || (comebackMode && (!hasScore || scoreDiff <= -3));

    if (!shouldPush) return plan;

    const next = { ...plan };
    const field = cleanText(next.fieldPositionBucket);
    const keepConserve = field === "backed_up" && hasScore && scoreDiff > -14 && mode !== "comeback";

    if (!keepConserve) {
      if (field === "coming_out" || field === "own_territory" || !field) {
        next.offensiveGoal = trailingTwoScores || comebackMode
          ? "recover_chunk_without_disaster"
          : "create_chunk_with_managed_risk";
      } else if (next.offensiveGoal === "stabilize_field_position" || next.offensiveGoal === "stay_ahead_of_schedule") {
        next.offensiveGoal = "create_chunk_with_managed_risk";
      }
      next.runPassLean = "pass_heavy";
      next.riskTolerance = trailingTwoScores || (comebackMode && (!hasQuarter || quarter >= 4)) ? "medium_high" : "medium";
      next.pressureConcern = field === "backed_up" ? "high" : "medium_high";
      next.explosivenessPreference = trailingTwoScores ? "high" : "moderate_high";
      next.preferredFamilies = Array.from(new Set([].concat(next.preferredFamilies || [], ["quick_game", "man_beat", "flood", "shot", "levels_dig", "curl_flat", "verticals"])));
      next.preferredTraits = Array.from(new Set([].concat(next.preferredTraits || [], ["chunkCapable", "sticksFriendly", "quickAnswer", "explosive"])));
      next.discouragedFamilies = (next.discouragedFamilies || []).filter(function (fam) {
        return fam !== "shot" && fam !== "flood";
      });
    }

    return next;
  }

  function isTrueRedZoneGeography(params) {
    if (!params) return false;
    if (params.goalToGo === true) return true;
    const field = cleanText(
      params.fieldPositionBucket ||
      (params.coordinatorPlan && params.coordinatorPlan.fieldPositionBucket) ||
      ""
    ).toLowerCase();
    return field === "red_zone" || field === "high_red_zone" || field === "goal_to_go";
  }

  function isCompressedShortFieldSpot(params) {
    if (!params) return false;
    const field = cleanText(
      params.fieldPositionBucket ||
      (params.coordinatorPlan && params.coordinatorPlan.fieldPositionBucket) ||
      ""
    ).toLowerCase();
    // High red (inside ~10) is always compressed package space.
    if (field === "high_red_zone") return true;

    const goalToGo = params.goalToGo === true || field === "goal_to_go";
    if (!goalToGo) return false;

    const yardsRaw = params.yards != null ? params.yards : params.yardsToGo;
    const yards = Number(yardsRaw);
    if (Number.isFinite(yards) && yards <= 5) return true;

    const fp = params.fieldPosition || (params.coordinatorPlan && params.coordinatorPlan.fieldPosition);
    if (fp) {
      const side = cleanText(fp.side).toUpperCase();
      const yardLine = Number(fp.yardLine);
      if (side === "OPP" && Number.isFinite(yardLine) && yardLine <= 5) return true;
    }

    // Long GTG with known deeper spot stays open/high-red lean.
    if (Number.isFinite(yards) && yards > 5) return false;

    // Spot unknown: only treat as compressed when distance is short.
    const bucket = cleanText(params.distBucket).toLowerCase();
    return bucket === "short";
  }

  function dampenVarietyAdjustment(value, factor) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount >= 0) return Number.isFinite(amount) ? amount : 0;
    const scale = Number.isFinite(Number(factor)) ? Number(factor) : 0.72;
    return amount * Math.max(0.35, Math.min(scale, 1));
  }

  const CONSTRAINT_FAMILIES = ["draw"];
  const MONOPOLY_FAMILIES = ["inside_zone", "flood", "boot", "quick_game"];
  /**
   * Exploration / freshness controls for sampleRank1 + situation MMR.
   * Apps enable via pickTopRecommendationsCore({ exploration: { enabled: true } })
   * or policy.exploration. Inject `rng` for deterministic tests (rng: () => 0 picks top of band).
   */
  const EXPLORATION_DEFAULTS = {
    enabled: false,
    fitnessBand: 4.5,
    temperature: 1.25,
    minBandSize: 2,
    maxBandSize: 12,
    sampleRank1: true,
    applyMmrBeforeSample: true,
    // Soft script should not crown a sticky family when exploring.
    scriptBonuses: [3.5, 2, 1],
    // Situation MMR taxes (applied undampened; capped by mmrCap).
    mmrExactPlay: 5.5,
    mmrExactPlayBroad: 3.0,
    mmrFamilyExact: 2.4,
    mmrFamilyBroad: 1.4,
    mmrShellExact: 3.5,
    mmrShellBroad: 2.0,
    mmrConceptExact: 2.8,
    mmrRank1Play: 6.5,
    mmrRank1Shell: 4.0,
    mmrRank1Family: 2.5,
    mmrWindow: 24,
    // Match variety partCap (±16) so novelty taxes cannot outrun the variety envelope.
    mmrCap: 16,
    // Hard-block exact play ID from rank-1 band if recently shown #1 in this situation.
    shownRank1HardBlockBatches: 2,
    // When exploration is on, historical variety stays dampened so MMR does not
    // uniquely undampen recycle taxes. Exact-play learning offsets history in apps.
    undampenHistoricalVariety: false,
  };
  const CONSTRAINED_RANKING_DEFAULTS = {
    enabled: true,
    drawRank1Epsilon: 0.85,
    maxDrawInTop3: 1,
    monopolyRank1Epsilon: 1.6,
    monopolyRecentWindow: 10,
    monopolyRecentLimit: 3,
    shellRecentWindow: 24,
    shellRank1Limit: 1,
    shellRank1KeepMargin: 2.75,
    shellSoftTaxStart: 1,
    shellConfirmedWeight: 1.5,
    shellShownWeight: 1,
    shellRank1CooldownBatches: 2,
    shellAlternateFamilyMargin: 3.25,
    shellAlternateAnyMargin: 2.35,
    setupPayoffBonus: 4.25,
    constraintAnswerBlitzBonus: 2.75,
    constraintAnswerKillClockBonus: 2.25,
    scriptCapEarlyDownConstraint: 3,
    scriptBonuses: [8, 5, 3],
    exploration: Object.assign({}, EXPLORATION_DEFAULTS),
    partCaps: {
      situation: 24,
      identity: 8,
      script: 8,
      learning: 8,
      variety: 16,
      novelty: 3,
      platform: 18,
      jitter: 0.75,
    },
  };

  function resolveExplorationPolicy(policy, explorationOverride) {
    const base = Object.assign({}, CONSTRAINED_RANKING_DEFAULTS, policy || {});
    const fromPolicy = base.exploration && typeof base.exploration === "object" ? base.exploration : {};
    const override = explorationOverride === false
      ? { enabled: false }
      : (explorationOverride && typeof explorationOverride === "object" ? explorationOverride : {});
    return Object.assign({}, EXPLORATION_DEFAULTS, fromPolicy, override);
  }

  function isConstraintFamily(fam) {
    return CONSTRAINT_FAMILIES.indexOf(cleanText(fam).toLowerCase()) >= 0;
  }

  function isMonopolyFamily(fam) {
    return MONOPOLY_FAMILIES.indexOf(cleanText(fam).toLowerCase()) >= 0;
  }

  function clampPart(value, cap) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    const limit = Number.isFinite(Number(cap)) ? Math.abs(Number(cap)) : Infinity;
    return Math.max(-limit, Math.min(amount, limit));
  }

  function combineRecommendationScore(parts, policy) {
    const cfg = Object.assign({}, CONSTRAINED_RANKING_DEFAULTS, policy || {});
    const caps = Object.assign({}, CONSTRAINED_RANKING_DEFAULTS.partCaps, cfg.partCaps || {});
    const raw = parts && typeof parts === "object" ? parts : {};
    const next = {
      situation: clampPart(raw.situation, caps.situation),
      identity: clampPart(raw.identity, caps.identity),
      script: clampPart(raw.script, caps.script),
      learning: clampPart(raw.learning, caps.learning),
      variety: clampPart(raw.variety, caps.variety),
      novelty: clampPart(raw.novelty, caps.novelty),
      platform: clampPart(raw.platform, caps.platform),
      jitter: clampPart(raw.jitter, caps.jitter),
    };
    const score =
      next.situation +
      next.identity +
      next.script +
      next.learning +
      next.variety +
      next.novelty +
      next.platform +
      next.jitter;
    return { score: score, parts: next };
  }

  function countRecentFamily(recent, fam, windowSize) {
    const needle = cleanText(fam).toLowerCase();
    if (!needle) return 0;
    const window = Array.isArray(recent) ? recent.slice(-(Number(windowSize) || recent.length)) : [];
    return window.filter(function (call) {
      return cleanText(call && call.family).toLowerCase() === needle;
    }).length;
  }

  function countRecentShell(recent, shellKey, windowSize) {
    const needle = cleanText(shellKey).toLowerCase();
    if (!needle) return 0;
    const window = Array.isArray(recent) ? recent.slice(-(Number(windowSize) || recent.length)) : [];
    return window.filter(function (call) {
      const callShell = cleanText(call && (call.formationSetKey || call.shellKey)).toLowerCase();
      return callShell === needle;
    }).length;
  }

  function buildRecentShellEvents(context) {
    const cfg = Object.assign({}, CONSTRAINED_RANKING_DEFAULTS, (context && context.policy) || {});
    const confirmedWeight = Number.isFinite(Number(cfg.shellConfirmedWeight)) ? Number(cfg.shellConfirmedWeight) : 1.5;
    const shownWeight = Number.isFinite(Number(cfg.shellShownWeight)) ? Number(cfg.shellShownWeight) : 1;
    const events = [];

    (Array.isArray(context && context.recentGameCalls) ? context.recentGameCalls : []).forEach(function (call) {
      const shellKey = cleanText(call && (call.formationSetKey || call.shellKey)).toLowerCase();
      if (!shellKey) return;
      events.push({
        formationSetKey: shellKey,
        weight: confirmedWeight,
        source: "confirm",
        rank: null,
        batchId: null,
      });
    });

    const exposure = Array.isArray(context && context.recommendationExposureHistory)
      ? context.recommendationExposureHistory
      : (Array.isArray(context && context.driveRecommendationExposure) ? context.driveRecommendationExposure : []);
    exposure.forEach(function (entry) {
      const shellKey = cleanText(entry && (entry.formationSetKey || entry.shellKey)).toLowerCase();
      if (!shellKey) return;
      const rank = Number(entry && entry.rank);
      events.push({
        formationSetKey: shellKey,
        weight: shownWeight,
        source: "shown",
        rank: Number.isFinite(rank) ? rank : null,
        batchId: entry && entry.batchId != null ? entry.batchId : null,
      });
    });

    return events;
  }

  function countWeightedShell(events, shellKey, windowSize) {
    const needle = cleanText(shellKey).toLowerCase();
    if (!needle) return 0;
    const window = Array.isArray(events) ? events.slice(-(Number(windowSize) || events.length)) : [];
    return window.reduce(function (sum, entry) {
      if (cleanText(entry && entry.formationSetKey).toLowerCase() !== needle) return sum;
      const weight = Number(entry && entry.weight);
      return sum + (Number.isFinite(weight) ? weight : 1);
    }, 0);
  }

  function countRecentShellRank1Batches(events, shellKey, batchLimit) {
    const needle = cleanText(shellKey).toLowerCase();
    if (!needle) return 0;
    const list = Array.isArray(events) ? events : [];
    const batchIds = [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const entry = list[i];
      if (!entry || entry.source !== "shown") continue;
      if (Number(entry.rank) !== 1) continue;
      const batchId = entry.batchId;
      if (batchId == null) continue;
      if (batchIds.indexOf(batchId) >= 0) continue;
      batchIds.push(batchId);
      if (batchIds.length >= (Number(batchLimit) || 2)) break;
    }
    return batchIds.filter(function (batchId) {
      return list.some(function (entry) {
        return entry
          && entry.source === "shown"
          && entry.batchId === batchId
          && Number(entry.rank) === 1
          && cleanText(entry.formationSetKey).toLowerCase() === needle;
      });
    }).length;
  }

  function shouldExemptShellRotation(context) {
    // Kill Clock keeps soft shell tax / alternate-shell promotion; only continuity spots fully exempt.
    const down = Number(context && context.down);
    const goalToGo = context && context.goalToGo === true;
    const bucket = cleanText(context && context.distBucket).toLowerCase();
    if (goalToGo && (bucket === "short" || !bucket)) return true;
    if (Number.isFinite(down) && down >= 3 && bucket === "short") return true;
    return false;
  }

  function familyQuotaAdjustment(play, context, helpers) {
    const familyOf = helpers && helpers.familyOf;
    const formationSetKeyOf = helpers && helpers.formationSetKeyOf;
    const fam = cleanText((helpers && helpers.fam) || (familyOf ? familyOf(play) : "")).toLowerCase();
    const recent = Array.isArray(context && context.recentGameCalls) ? context.recentGameCalls : [];
    const cfg = Object.assign({}, CONSTRAINED_RANKING_DEFAULTS, (context && context.policy) || {});
    let tax = 0;

    if (isConstraintFamily(fam) && !shouldExemptDrawQuotas(context)) {
      const shown = countRecentFamily(recent, fam, 12);
      if (shown >= 3) tax += -1.25;
      else if (shown >= 2) tax += -0.75;
      else if (shown >= 1) tax += -0.35;
    }

    if (isMonopolyFamily(fam) && !shouldExemptMonopolyQuotas(context)) {
      const shown = countRecentFamily(recent, fam, cfg.monopolyRecentWindow || 10);
      if (shown >= 5) tax += -2.4;
      else if (shown >= 4) tax += -1.8;
      else if (shown >= 3) tax += -1.25;
      else if (shown >= 2) tax += -0.7;
    }

    if (typeof formationSetKeyOf === "function" && !shouldExemptShellRotation(context)) {
      const shellKey = cleanText(formationSetKeyOf(play)).toLowerCase();
      const shellEvents = buildRecentShellEvents(context);
      const shellShown = countWeightedShell(shellEvents, shellKey, cfg.shellRecentWindow || 24);
      const softStart = Number.isFinite(Number(cfg.shellSoftTaxStart)) ? Number(cfg.shellSoftTaxStart) : 1;
      if (shellShown >= softStart + 4) tax += -4.2;
      else if (shellShown >= softStart + 3) tax += -3.4;
      else if (shellShown >= softStart + 2) tax += -2.6;
      else if (shellShown >= softStart + 1) tax += -1.9;
      else if (shellShown >= softStart) tax += -1.25;
    }

    return tax;
  }

  function shouldExemptDrawQuotas(context) {
    const defense = cleanText(context && context.defense);
    const mode = normalizeLearningModeKey(context && context.playcallingMode);
    const down = Number(context && context.down);
    const goalToGo = context && context.goalToGo === true;
    const bucket = cleanText(context && context.distBucket).toLowerCase();
    if (defense === "Blitz") return true;
    if (mode === "kill_clock") return true;
    if (mode === "blitz_beater") return true;
    if (goalToGo && (bucket === "short" || !bucket)) return true;
    if (Number.isFinite(down) && down >= 3 && bucket === "short") return true;
    return false;
  }

  // Anti-monopoly (IZ/Flood spam) stays on under Blitz / Kill Clock / Blitz Beater.
  // Only true short-yardage continuity spots exempt monopoly hard gates + soft taxes.
  function shouldExemptMonopolyQuotas(context) {
    const down = Number(context && context.down);
    const goalToGo = context && context.goalToGo === true;
    const bucket = cleanText(context && context.distBucket).toLowerCase();
    if (goalToGo && (bucket === "short" || !bucket)) return true;
    if (Number.isFinite(down) && down >= 3 && bucket === "short") return true;
    return false;
  }

  function withinEpsilonOfBest(item, rankIndex, context, helpers, predicate, epsilon) {
    if (rankIndex !== 0) return true;
    const scoreKey = helpers && helpers.scoreKey ? helpers.scoreKey : "_score";
    const familyOf = helpers && helpers.familyOf;
    const itemScore = Number(item && item[scoreKey]);
    const bestOther = (Array.isArray(context && context.orderedCandidates) ? context.orderedCandidates : []).find(function (candidate) {
      const candidateFam = cleanText(candidate && (candidate._family || (familyOf ? familyOf(candidate.play || candidate) : ""))).toLowerCase();
      return typeof predicate === "function" ? predicate(candidateFam, candidate) : true;
    });
    if (!bestOther) return true;
    const bestScore = Number(bestOther[scoreKey]);
    if (!Number.isFinite(itemScore) || !Number.isFinite(bestScore)) return false;
    return Math.abs(itemScore - bestScore) <= epsilon;
  }

  function canPlaceAtRank(item, rankIndex, picked, context, helpers) {
    const familyOf = helpers && helpers.familyOf;
    const formationSetKeyOf = helpers && helpers.formationSetKeyOf;
    const play = item && (item.play || item);
    const fam = cleanText(item && (item._family || (familyOf ? familyOf(play) : ""))).toLowerCase();
    const cfg = Object.assign({}, CONSTRAINED_RANKING_DEFAULTS, (context && context.policy) || {});
    if (!cfg.enabled) return true;

    const down = Number(context && context.down);
    const earlyDown = !Number.isFinite(down) || down <= 2;
    const recent = Array.isArray(context && context.recentGameCalls) ? context.recentGameCalls : [];
    const exemptConstraint = shouldExemptDrawQuotas(context);
    const exemptMonopoly = shouldExemptMonopolyQuotas(context);
    const exemptShell = shouldExemptShellRotation(context);
    const shellEvents = buildRecentShellEvents(context);

    if (isConstraintFamily(fam)) {
      if (!exemptConstraint) {
        const drawCount = picked.filter(function (entry) {
          const entryFam = cleanText(entry && (entry._family || (familyOf ? familyOf(entry.play || entry) : ""))).toLowerCase();
          return isConstraintFamily(entryFam);
        }).length;
        if (drawCount >= (cfg.maxDrawInTop3 || 1)) return false;

        if (earlyDown && rankIndex === 0) {
          const epsilon = Number.isFinite(Number(cfg.drawRank1Epsilon)) ? Number(cfg.drawRank1Epsilon) : 0.85;
          // Allow Draw at #1 only when it is essentially tied with the best non-draw.
          if (!withinEpsilonOfBest(item, rankIndex, context, helpers, function (candidateFam) {
            return !isConstraintFamily(candidateFam);
          }, epsilon)) {
            return false;
          }
        }
      }
    }

    if (isMonopolyFamily(fam) && !exemptMonopoly && earlyDown && rankIndex === 0) {
      const shown = countRecentFamily(recent, fam, cfg.monopolyRecentWindow || 10);
      const monopolyLimit = Number.isFinite(Number(cfg.monopolyRecentLimit)) ? Number(cfg.monopolyRecentLimit) : 3;
      if (shown >= monopolyLimit) {
        const epsilon = Number.isFinite(Number(cfg.monopolyRank1Epsilon)) ? Number(cfg.monopolyRank1Epsilon) : 1.6;
        if (!withinEpsilonOfBest(item, rankIndex, context, helpers, function (candidateFam) {
          return candidateFam !== fam;
        }, epsilon)) {
          return false;
        }
      }
    }

    if (rankIndex === 0 && typeof formationSetKeyOf === "function" && !exemptShell) {
      const shellKey = cleanText(formationSetKeyOf(play)).toLowerCase();
      const shellLimit = Number.isFinite(Number(cfg.shellRank1Limit)) ? Number(cfg.shellRank1Limit) : 1;
      const cooldownBatches = Number.isFinite(Number(cfg.shellRank1CooldownBatches)) ? Number(cfg.shellRank1CooldownBatches) : 2;
      const shellShown = countWeightedShell(shellEvents, shellKey, cfg.shellRecentWindow || 24);
      const recentRank1Hits = countRecentShellRank1Batches(shellEvents, shellKey, Math.max(cooldownBatches, 1));
      const overexposed = (shellKey && shellShown >= shellLimit) || recentRank1Hits >= 1;
      if (overexposed) {
        const scoreKey = helpers && helpers.scoreKey ? helpers.scoreKey : "_score";
        const itemScore = Number(item && item[scoreKey]);
        const keepMargin = Number.isFinite(Number(cfg.shellRank1KeepMargin)) ? Number(cfg.shellRank1KeepMargin) : 2.75;
        const bestOtherShell = (Array.isArray(context && context.orderedCandidates) ? context.orderedCandidates : []).find(function (candidate) {
          if (candidate && candidate._cooldownBlocked) return false;
          const otherPlay = candidate && (candidate.play || candidate);
          const otherShell = cleanText(formationSetKeyOf(otherPlay)).toLowerCase();
          return otherShell && otherShell !== shellKey;
        });
        if (bestOtherShell) {
          const bestScore = Number(bestOtherShell[scoreKey]);
          // Overexposed shells keep #1 only with a clear score margin over a fresh shell.
          if (Number.isFinite(itemScore) && Number.isFinite(bestScore) && itemScore < bestScore + keepMargin) {
            return false;
          }
        }
      }
    }

    return true;
  }

  function promoteAlternateShellCandidate(scored, context, helpers) {
    const formationSetKeyOf = helpers && helpers.formationSetKeyOf;
    const scoreKey = helpers && helpers.scoreKey ? helpers.scoreKey : "_score";
    const cfg = Object.assign({}, CONSTRAINED_RANKING_DEFAULTS, (context && context.policy) || {});
    if (!cfg.enabled || typeof formationSetKeyOf !== "function" || shouldExemptShellRotation(context)) return scored;

    const primary = scored.filter(function (item) { return !item._cooldownBlocked; });
    if (primary.length < 2) return scored;

    const top = primary[0];
    const topPlay = top.play || top;
    const topShell = cleanText(formationSetKeyOf(topPlay)).toLowerCase();
    if (!topShell) return scored;

    const shellEvents = buildRecentShellEvents(context);
    const shellLimit = Number.isFinite(Number(cfg.shellRank1Limit)) ? Number(cfg.shellRank1Limit) : 1;
    const cooldownBatches = Number.isFinite(Number(cfg.shellRank1CooldownBatches)) ? Number(cfg.shellRank1CooldownBatches) : 2;
    const shellShown = countWeightedShell(shellEvents, topShell, cfg.shellRecentWindow || 24);
    const recentRank1Hits = countRecentShellRank1Batches(shellEvents, topShell, Math.max(cooldownBatches, 1));
    if (!(shellShown >= shellLimit || recentRank1Hits >= 1)) return scored;

    const topScore = Number(top[scoreKey]) || 0;
    const topFam = cleanText(top._family || "").toLowerCase();
    const topType = cleanText(topPlay.type).toUpperCase();
    const familyMargin = Number.isFinite(Number(cfg.shellAlternateFamilyMargin)) ? Number(cfg.shellAlternateFamilyMargin) : 3.25;
    const anyMargin = Number.isFinite(Number(cfg.shellAlternateAnyMargin)) ? Number(cfg.shellAlternateAnyMargin) : 2.35;

    function findAlternate(predicate, margin) {
      return primary.find(function (item) {
        if (item === top) return false;
        const play = item.play || item;
        const shell = cleanText(formationSetKeyOf(play)).toLowerCase();
        if (!shell || shell === topShell) return false;
        if (!predicate(item, play)) return false;
        const score = Number(item[scoreKey]) || 0;
        return topScore - score <= margin;
      });
    }

    const sameFamilyType = findAlternate(function (item, play) {
      return cleanText(item._family || "").toLowerCase() === topFam
        && cleanText(play.type).toUpperCase() === topType;
    }, familyMargin);
    const sameFamily = sameFamilyType || findAlternate(function (item) {
      return cleanText(item._family || "").toLowerCase() === topFam;
    }, familyMargin);
    const anyShell = sameFamily || findAlternate(function () { return true; }, anyMargin);
    if (!anyShell) return scored;

    const promoted = [];
    const seen = {};
    [anyShell].concat(scored).forEach(function (item) {
      const play = item.play || item;
      const id = cleanText(play && play.id) || promoted.length;
      if (seen[id]) return;
      seen[id] = true;
      promoted.push(item);
    });
    return promoted;
  }

  function applySoftScriptBoostCore(params) {
    const scored = Array.isArray(params && params.scored) ? params.scored : [];
    const deck = Array.isArray(params && params.scriptDeck) ? params.scriptDeck : [];
    const scriptIndex = Number(params && params.scriptIndex) || 0;
    const scriptWindow = Number.isFinite(Number(params && params.scriptWindow)) ? Number(params.scriptWindow) : 5;
    const distBucket = cleanText(params && params.distBucket).toUpperCase();
    const playTraitsOf = params && params.playTraitsOf;
    const familyOf = params && params.familyOf;
    const isRiskyPlayActionSpot = params && params.isRiskyPlayActionSpot;
    const matchesScriptEntry = params && params.matchesScriptEntry;
    const scoreKey = params && params.scoreKey ? params.scoreKey : "_score";
    const constrained = !!(params && params.constrained);
    const context = params && params.context ? params.context : {};
    const exploration = resolveExplorationPolicy(
      Object.assign({}, (context && context.policy) || {}, (params && params.policy) || {}),
      params && params.exploration
    );
    const bonuses = Array.isArray(params && params.scriptBonuses)
      ? params.scriptBonuses
      : (exploration.enabled && Array.isArray(exploration.scriptBonuses)
        ? exploration.scriptBonuses
        : CONSTRAINED_RANKING_DEFAULTS.scriptBonuses);
    const earlyCap = Number.isFinite(Number(params && params.scriptCapEarlyDownConstraint))
      ? Number(params.scriptCapEarlyDownConstraint)
      : CONSTRAINED_RANKING_DEFAULTS.scriptCapEarlyDownConstraint;

    if (!(scriptIndex < deck.length)) {
      scored.forEach(function (item) {
        item._scriptMatch = false;
        item._scriptTag = "";
        if (item.parts) item.parts.script = 0;
      });
      return scored;
    }

    scored.forEach(function (item) {
      item._scriptMatch = false;
      item._scriptTag = "";
      const play = item.play || item;
      const traits = playTraitsOf ? playTraitsOf(play) : (item.traits || {});
      if (typeof isRiskyPlayActionSpot === "function" && isRiskyPlayActionSpot(play, traits)) {
        if (item.parts) item.parts.script = 0;
        return;
      }
      let applied = 0;
      for (let k = 0; k < scriptWindow; k += 1) {
        const idx = scriptIndex + k;
        if (idx >= deck.length) break;
        const entry = deck[idx];
        if (entry && Array.isArray(entry.allow) && entry.allow.length && distBucket && entry.allow.indexOf(distBucket) < 0) continue;
        const matched = typeof matchesScriptEntry === "function"
          ? matchesScriptEntry(play, entry)
          : matchesScriptEntryCore({
            play: play,
            entry: entry,
            traits: traits,
            playTraitsOf: playTraitsOf,
          });
        if (!matched) continue;
        applied = Number(bonuses[k]) || 0;
        item._scriptMatch = k === 0;
        item._scriptTag = cleanText(entry && entry.label);
        break;
      }

      if (constrained && applied > 0) {
        const fam = cleanText((familyOf ? familyOf(play) : (traits && traits.fam)) || "").toLowerCase();
        const down = Number(context.down);
        const earlyDown = !Number.isFinite(down) || down <= 2;
        if (earlyDown && isConstraintFamily(fam) && !shouldExemptDrawQuotas(context)) {
          applied = Math.min(applied, earlyCap);
        }
      }

      if (item.parts) item.parts.script = applied;
      item[scoreKey] = Number(item[scoreKey]) || 0;
      item[scoreKey] += applied;
    });
    return scored;
  }

  /**
   * Normalize exposure / confirms / persisted top-rec memory into MMR events.
   * Event shape: { playId, family, formationSetKey, conceptKey, situationKey, broadSituationKey, rank, source, batchId }
   */
  function buildSituationMmrEvents(params) {
    const situationKey = cleanText(params && params.situationKey);
    const broadSituationKey = cleanText(params && params.broadSituationKey);
    const events = [];
    const pushEvent = function (raw, source) {
      if (!raw) return;
      const playId = cleanText(raw.playId || raw.id);
      if (!playId) return;
      events.push({
        playId: playId,
        family: cleanText(raw.family).toLowerCase(),
        formationSetKey: cleanText(raw.formationSetKey || raw.shellKey).toLowerCase(),
        conceptKey: cleanText(raw.conceptKey).toLowerCase(),
        situationKey: cleanText(raw.situationKey) || situationKey,
        broadSituationKey: cleanText(raw.broadSituationKey) || broadSituationKey,
        rank: Number(raw.rank) || 0,
        source: source || cleanText(raw.source) || "unknown",
        batchId: raw.batchId == null ? null : raw.batchId,
      });
    };

    (Array.isArray(params && params.recommendationExposureHistory) ? params.recommendationExposureHistory : []).forEach(function (entry) {
      pushEvent(entry, "exposure");
    });
    (Array.isArray(params && params.driveRecommendationExposure) ? params.driveRecommendationExposure : []).forEach(function (entry) {
      pushEvent(entry, "drive_exposure");
    });
    (Array.isArray(params && params.recentGameCalls) ? params.recentGameCalls : []).forEach(function (entry) {
      pushEvent({
        playId: entry.playId || entry.id,
        family: entry.family,
        formationSetKey: entry.formationSetKey,
        conceptKey: entry.conceptKey,
        situationKey: entry.situationKey,
        broadSituationKey: entry.broadSituationKey,
        rank: 1,
      }, "confirm");
    });

    const topRecs = params && params.topRecommendations && typeof params.topRecommendations === "object"
      ? params.topRecommendations
      : {};
    [situationKey, broadSituationKey].filter(Boolean).forEach(function (key) {
      (Array.isArray(topRecs[key]) ? topRecs[key] : []).forEach(function (entry) {
        pushEvent({
          playId: entry.playId || entry.id,
          family: entry.family,
          formationSetKey: entry.formationSetKey,
          conceptKey: entry.conceptKey,
          situationKey: key === situationKey ? situationKey : (entry.situationKey || key),
          broadSituationKey: key === broadSituationKey ? broadSituationKey : (entry.broadSituationKey || key),
          rank: 1,
        }, "top_rec");
      });
    });

    return events;
  }

  function situationMmrAdjustment(play, events, helpers, policy) {
    const exploration = resolveExplorationPolicy(policy, policy && policy.exploration);
    const list = Array.isArray(events) ? events : [];
    if (!play || !list.length) return 0;

    const familyOf = helpers && helpers.familyOf;
    const formationSetKeyOf = helpers && helpers.formationSetKeyOf;
    const normalizedConceptKey = helpers && helpers.normalizedConceptKey;
    const situationKey = cleanText(helpers && helpers.situationKey);
    const broadSituationKey = cleanText(helpers && helpers.broadSituationKey);
    const playId = cleanText(play.id);
    const fam = cleanText(familyOf ? familyOf(play) : (play.family || "")).toLowerCase();
    const shell = cleanText(formationSetKeyOf ? formationSetKeyOf(play) : (play.formationSetKey || "")).toLowerCase();
    const concept = cleanText(normalizedConceptKey ? normalizedConceptKey(play) : (play.conceptKey || "")).toLowerCase();
    const window = list.slice(-(Number(exploration.mmrWindow) || 24));

    const exact = window.filter(function (e) {
      return e.playId === playId && (!situationKey || e.situationKey === situationKey);
    }).length;
    const exactBroad = window.filter(function (e) {
      return e.playId === playId && (!broadSituationKey || e.broadSituationKey === broadSituationKey);
    }).length;
    const familyExact = fam ? window.filter(function (e) {
      return e.family === fam && (!situationKey || e.situationKey === situationKey);
    }).length : 0;
    const familyBroad = fam ? window.filter(function (e) {
      return e.family === fam && (!broadSituationKey || e.broadSituationKey === broadSituationKey);
    }).length : 0;
    const shellExact = shell ? window.filter(function (e) {
      return e.formationSetKey === shell && (!situationKey || e.situationKey === situationKey);
    }).length : 0;
    const shellBroad = shell ? window.filter(function (e) {
      return e.formationSetKey === shell && (!broadSituationKey || e.broadSituationKey === broadSituationKey);
    }).length : 0;
    const conceptExact = concept ? window.filter(function (e) {
      return e.conceptKey === concept && (!situationKey || e.situationKey === situationKey);
    }).length : 0;
    const rank1Play = window.filter(function (e) {
      return e.playId === playId && Number(e.rank) === 1 && (!situationKey || e.situationKey === situationKey);
    }).length;
    const rank1Shell = shell ? window.filter(function (e) {
      return e.formationSetKey === shell && Number(e.rank) === 1 && (!situationKey || e.situationKey === situationKey);
    }).length : 0;
    const rank1Family = fam ? window.filter(function (e) {
      return e.family === fam && Number(e.rank) === 1 && (!situationKey || e.situationKey === situationKey);
    }).length : 0;

    let tax = 0;
    tax += Math.min(exact * (Number(exploration.mmrExactPlay) || 0), 16);
    tax += Math.min(exactBroad * (Number(exploration.mmrExactPlayBroad) || 0), 10);
    tax += Math.min(Math.max(familyExact - 1, 0) * (Number(exploration.mmrFamilyExact) || 0), 10);
    tax += Math.min(Math.max(familyBroad - 1, 0) * (Number(exploration.mmrFamilyBroad) || 0), 7);
    tax += Math.min(Math.max(shellExact - 1, 0) * (Number(exploration.mmrShellExact) || 0), 12);
    tax += Math.min(Math.max(shellBroad - 1, 0) * (Number(exploration.mmrShellBroad) || 0), 9);
    tax += Math.min(Math.max(conceptExact - 1, 0) * (Number(exploration.mmrConceptExact) || 0), 9);
    tax += Math.min(rank1Play * (Number(exploration.mmrRank1Play) || 0), 16);
    tax += Math.min(rank1Shell * (Number(exploration.mmrRank1Shell) || 0), 12);
    tax += Math.min(Math.max(rank1Family - 1, 0) * (Number(exploration.mmrRank1Family) || 0), 8);

    const cap = Number.isFinite(Number(exploration.mmrCap)) ? Number(exploration.mmrCap) : 18;
    return -Math.min(tax, cap);
  }

  function isShownRank1HardBlocked(play, events, helpers, exploration) {
    const playId = cleanText(play && play.id);
    if (!playId) return false;
    const situationKey = cleanText(helpers && helpers.situationKey);
    const batches = Number.isFinite(Number(exploration && exploration.shownRank1HardBlockBatches))
      ? Number(exploration.shownRank1HardBlockBatches)
      : 2;
    if (batches <= 0) return false;
    const list = Array.isArray(events) ? events : [];
    const situationRank1 = list.filter(function (e) {
      return Number(e.rank) === 1
        && (!situationKey || e.situationKey === situationKey)
        && (e.source === "exposure" || e.source === "drive_exposure" || e.source === "top_rec");
    });
    if (!situationRank1.length) return false;

    const recentBatchIds = [];
    for (let i = situationRank1.length - 1; i >= 0; i -= 1) {
      const id = situationRank1[i].batchId;
      if (id == null) continue;
      if (recentBatchIds.indexOf(id) >= 0) continue;
      recentBatchIds.push(id);
      if (recentBatchIds.length >= batches) break;
    }

    if (recentBatchIds.length) {
      return situationRank1.some(function (e) {
        return e.playId === playId && recentBatchIds.indexOf(e.batchId) >= 0;
      });
    }

    return situationRank1.slice(-batches).some(function (e) {
      return e.playId === playId;
    });
  }

  /**
   * Apply undampened situation MMR taxes onto scored candidates.
   * Mutates item[scoreKey] and item._mmrAdjustment / item._mmrBlocked.
   */
  function applySituationMmrCore(params) {
    const scored = Array.isArray(params && params.scored) ? params.scored : [];
    const scoreKey = params && params.scoreKey ? params.scoreKey : "_score";
    const exploration = resolveExplorationPolicy(params && params.policy, params && params.exploration);
    if (!exploration.enabled || exploration.applyMmrBeforeSample === false) return scored;

    const events = Array.isArray(params && params.events) && params.events.length
      ? params.events
      : buildSituationMmrEvents(params);
    const helpers = {
      familyOf: params && params.familyOf,
      formationSetKeyOf: params && params.formationSetKeyOf,
      normalizedConceptKey: params && params.normalizedConceptKey,
      situationKey: params && params.situationKey,
      broadSituationKey: params && params.broadSituationKey,
    };

    scored.forEach(function (item) {
      const play = item.play || item;
      const mmr = situationMmrAdjustment(play, events, helpers, { exploration: exploration });
      item._mmrAdjustment = mmr;
      item._mmrBlocked = isShownRank1HardBlocked(play, events, helpers, exploration);
      if (mmr) {
        item[scoreKey] = (Number(item[scoreKey]) || 0) + mmr;
        if (item.parts && typeof item.parts === "object") {
          item.parts.variety = (Number(item.parts.variety) || 0) + mmr;
        }
      }
    });
    return scored;
  }

  function defaultRng() {
    return Math.random();
  }

  /**
   * Softmax sample over precomputed weights. rng() => [0,1).
   * rng returning 0 always selects the first positive-weight index (deterministic tests).
   */
  function softmaxSampleIndex(weights, rng) {
    const list = Array.isArray(weights) ? weights : [];
    if (!list.length) return -1;
    let total = 0;
    for (let i = 0; i < list.length; i += 1) {
      const w = Number(list[i]);
      if (Number.isFinite(w) && w > 0) total += w;
    }
    if (!(total > 0)) return 0;
    const roll = typeof rng === "function" ? Number(rng()) : defaultRng();
    const clamped = Number.isFinite(roll) ? Math.max(0, Math.min(roll, 0.999999)) : 0;
    let cursor = clamped * total;
    for (let i = 0; i < list.length; i += 1) {
      const w = Number(list[i]);
      if (!(Number.isFinite(w) && w > 0)) continue;
      cursor -= w;
      if (cursor <= 0) return i;
    }
    return list.length - 1;
  }

  /**
   * Build a near-tie fitness band from an already-sorted (best-first) candidate list.
   */
  function buildFitnessBand(candidates, scoreKey, exploration) {
    const list = Array.isArray(candidates) ? candidates : [];
    if (!list.length) return [];
    const key = scoreKey || "_score";
    const bandWidth = Number.isFinite(Number(exploration && exploration.fitnessBand))
      ? Number(exploration.fitnessBand)
      : 4.5;
    const maxSize = Number.isFinite(Number(exploration && exploration.maxBandSize))
      ? Math.max(1, Number(exploration.maxBandSize))
      : 12;
    const best = Number(list[0][key]) || 0;
    const band = [];
    for (let i = 0; i < list.length; i += 1) {
      const score = Number(list[i][key]) || 0;
      if (best - score > bandWidth) break;
      band.push(list[i]);
      if (band.length >= maxSize) break;
    }
    const minSize = Number.isFinite(Number(exploration && exploration.minBandSize))
      ? Number(exploration.minBandSize)
      : 2;
    if (band.length < minSize && list.length > band.length) {
      return list.slice(0, Math.min(minSize, list.length, maxSize));
    }
    return band;
  }

  /**
   * Sample rank-1 from a fitness band via temperature softmax on scores.
   * API:
   *   sampleRank1({
   *     candidates,           // scored items (unsorted ok)
   *     scoreKey: "_score",
   *     exploration: { fitnessBand, temperature, maxBandSize, ... },
   *     rng: Math.random,     // optional; () => 0 => greedy best
   *     filter: (item) => true // optional eligibility predicate
   *   }) => selectedItem | null
   */
  function sampleRank1(params) {
    const scoreKey = params && params.scoreKey ? params.scoreKey : "_score";
    const exploration = resolveExplorationPolicy(params && params.policy, params && params.exploration);
    const rng = typeof (params && params.rng) === "function" ? params.rng : defaultRng;
    let candidates = Array.isArray(params && params.candidates) ? params.candidates.slice() : [];
    if (typeof (params && params.filter) === "function") {
      candidates = candidates.filter(params.filter);
    }
    if (!candidates.length) return null;

    candidates.sort(function (a, b) {
      const scoreA = Number(a[scoreKey]) || 0;
      const scoreB = Number(b[scoreKey]) || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      const nameA = cleanText((a.play || a).play_name);
      const nameB = cleanText((b.play || b).play_name);
      return nameA.localeCompare(nameB);
    });

    if (exploration.sampleRank1 === false) {
      return candidates[0];
    }

    const band = buildFitnessBand(candidates, scoreKey, exploration);
    if (band.length <= 1) return band[0] || candidates[0];

    const temperature = Math.max(0.15, Number(exploration.temperature) || 1.25);
    const best = Number(band[0][scoreKey]) || 0;
    const weights = band.map(function (item) {
      const score = Number(item[scoreKey]) || 0;
      // Relative to best so large absolute scores do not explode exp().
      return Math.exp((score - best) / temperature);
    });
    const index = softmaxSampleIndex(weights, rng);
    const picked = band[index] || band[0];
    if (picked) {
      picked._explorationSampled = true;
      picked._explorationBandSize = band.length;
    }
    return picked;
  }

  function pickTopRecommendationsCore(params) {
    let scored = Array.isArray(params && params.scored) ? params.scored.slice() : [];
    const familyOf = params && params.familyOf;
    const formationSetKeyOf = params && params.formationSetKeyOf;
    const normalizedConceptKey = params && params.normalizedConceptKey;
    const scoreKey = params && params.scoreKey ? params.scoreKey : "_score";
    const limit = Number.isFinite(Number(params && params.limit)) ? Number(params.limit) : 3;
    const exploration = resolveExplorationPolicy(
      Object.assign({}, (params && params.context && params.context.policy) || {}, (params && params.policy) || {}),
      params && params.exploration
    );
    const context = Object.assign({}, params && params.context, {
      policy: Object.assign({}, CONSTRAINED_RANKING_DEFAULTS, (params && params.policy) || {}, {
        exploration: exploration,
      }),
      situationKey: (params && params.context && params.context.situationKey) || (params && params.situationKey),
      broadSituationKey: (params && params.context && params.context.broadSituationKey) || (params && params.broadSituationKey),
    });
    const useStrictUniqueness = params && params.strictUniqueness !== false;
    const rng = typeof (params && params.rng) === "function" ? params.rng : defaultRng;

    if (exploration.enabled && exploration.applyMmrBeforeSample !== false) {
      const events = Array.isArray(context.situationMmrEvents) && context.situationMmrEvents.length
        ? context.situationMmrEvents
        : buildSituationMmrEvents(Object.assign({}, context, params));
      context.situationMmrEvents = events;
      applySituationMmrCore({
        scored: scored,
        events: events,
        scoreKey: scoreKey,
        exploration: exploration,
        policy: context.policy,
        familyOf: familyOf,
        formationSetKeyOf: formationSetKeyOf,
        normalizedConceptKey: normalizedConceptKey,
        situationKey: context.situationKey,
        broadSituationKey: context.broadSituationKey,
      });
    }

    scored.forEach(function (item) {
      const play = item.play || item;
      item._family = cleanText(familyOf ? familyOf(play) : (item._family || "")).toLowerCase();
    });

    scored.sort(function (a, b) {
      if (a._cooldownBlocked !== b._cooldownBlocked) return a._cooldownBlocked ? 1 : -1;
      const scoreA = Number(a[scoreKey]) || 0;
      const scoreB = Number(b[scoreKey]) || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      const nameA = cleanText((a.play || a).play_name);
      const nameB = cleanText((b.play || b).play_name);
      return nameA.localeCompare(nameB);
    });

    scored = promoteAlternateShellCandidate(scored, context, {
      formationSetKeyOf: formationSetKeyOf,
      scoreKey: scoreKey,
    });

    context.orderedCandidates = scored;
    const primaryPool = scored.filter(function (item) { return !item._cooldownBlocked; });
    const fallbackPool = scored.filter(function (item) { return item._cooldownBlocked; });
    const orderedPools = primaryPool.length ? [primaryPool, fallbackPool] : [fallbackPool];
    const picked = [];
    const usedFamilyType = {};
    const usedFormationSets = {};
    const usedConcepts = {};

    function tryPick(item) {
      const play = item.play || item;
      const fam = item._family || cleanText(familyOf ? familyOf(play) : "").toLowerCase();
      const familyTypeSig = fam + "|" + cleanText(play.type).toUpperCase();
      const formationSetSig = formationSetKeyOf ? formationSetKeyOf(play) : "";
      const conceptSig = normalizedConceptKey ? normalizedConceptKey(play) : "";
      const uniqueFamilyType = !usedFamilyType[familyTypeSig];
      const uniqueFormationSet = !useStrictUniqueness || !formationSetSig || !usedFormationSets[formationSetSig];
      const uniqueConcept = !useStrictUniqueness || !conceptSig || !usedConcepts[conceptSig];
      if (!(picked.length === 0 || (uniqueFamilyType && uniqueFormationSet && uniqueConcept))) return false;
      if (!canPlaceAtRank(item, picked.length, picked, context, {
        familyOf: familyOf,
        formationSetKeyOf: formationSetKeyOf,
        scoreKey: scoreKey,
      })) return false;
      picked.push(item);
      usedFamilyType[familyTypeSig] = true;
      if (formationSetSig) usedFormationSets[formationSetSig] = true;
      if (conceptSig) usedConcepts[conceptSig] = true;
      return true;
    }

    // Rank-1: sample among near-ties when exploration is enabled.
    if (exploration.enabled && exploration.sampleRank1 !== false && limit > 0) {
      const rank1Helpers = {
        familyOf: familyOf,
        formationSetKeyOf: formationSetKeyOf,
        scoreKey: scoreKey,
      };
      let rank1Pool = (primaryPool.length ? primaryPool : fallbackPool).filter(function (item) {
        if (item._mmrBlocked) return false;
        return canPlaceAtRank(item, 0, [], context, rank1Helpers);
      });
      if (!rank1Pool.length) {
        rank1Pool = (primaryPool.length ? primaryPool : fallbackPool).filter(function (item) {
          return canPlaceAtRank(item, 0, [], context, rank1Helpers);
        });
      }
      const sampled = sampleRank1({
        candidates: rank1Pool,
        scoreKey: scoreKey,
        exploration: exploration,
        rng: rng,
      });
      if (sampled) tryPick(sampled);
    }

    orderedPools.forEach(function (pool) {
      if (picked.length >= limit) return;
      pool.forEach(function (item) {
        if (picked.length >= limit) return;
        tryPick(item);
      });
    });

    orderedPools.forEach(function (pool) {
      if (picked.length >= limit) return;
      pool.forEach(function (item) {
        if (picked.length >= limit) return;
        const play = item.play || item;
        const already = picked.some(function (entry) {
          return (entry.play || entry).id === play.id;
        });
        if (already) return;
        if (!canPlaceAtRank(item, picked.length, picked, context, {
          familyOf: familyOf,
          formationSetKeyOf: formationSetKeyOf,
          scoreKey: scoreKey,
        })) return;
        picked.push(item);
      });
    });

    return picked.slice(0, limit);
  }

  function ocBonusCore(params) {
    const play = params.play;
    const playTraitsOf = params.playTraitsOf;
    const familyOf = params.familyOf;
    const playStructureTags = params.playStructureTags;
    const isDrawLikePlay = params.isDrawLikePlay;

    const traits = params.traits || playTraitsOf(play);
    const fam = params.fam || familyOf(play);
    const goal = params.goal || {};
    const bucket = params.distBucket;
    const tags = playStructureTags(play, traits);

    let bonus = 0;

    const goalWantType = goal.wantType || ((Array.isArray(goal.types) && goal.types.length === 1) ? goal.types[0] : null);
    const goalFamilies = goal.family || goal.families || [];

    if (goalWantType === "RUN" && play.type === "RUN") bonus += 4;
    if (goalWantType === "PA" && play.type !== "RUN" && ["boot", "flood", "leak", "shot"].includes(fam)) bonus += 3;
    if (goalWantType === "PASS" && play.type !== "RUN") bonus += 2;
    if (Array.isArray(goalFamilies) && goalFamilies.includes(fam)) bonus += 4;

    const last = (Array.isArray(params.lastCalls) ? params.lastCalls : []).slice(-3);
    const runStreak = last.filter(function (x) { return x.type === "RUN" || x.type === "RPO"; }).length;
    if (runStreak >= 2 && play.type !== "RUN" && ["boot", "flood", "leak", "shot"].includes(fam)) bonus += 3.5;

    if (last.length) {
      const prev = last[last.length - 1];
      const prevFam = prev.fam;
      const pay = (params.setupPayoff && params.setupPayoff[prevFam]) || [];
      const setupPayoffBonus = Number.isFinite(Number(params.setupPayoffBonus))
        ? Number(params.setupPayoffBonus)
        : CONSTRAINED_RANKING_DEFAULTS.setupPayoffBonus;
      if (pay.includes(fam)) bonus += setupPayoffBonus;

      const prevWasPlayActionFamily = prev.type === "PA" || ["boot", "flood", "leak"].includes(prevFam);
      const prevWasQuickGame = prevFam === "quick_game" || prevFam === "man_beat";
      const prevWasShot = prevFam === "shot";
      const currentDrawLike = isDrawLikePlay(play, traits);
      const mode = normalizeLearningModeKey(params.playcallingMode);
      const defense = cleanText(params.defense);
      const allowDrawSequenceBoost = defense === "Blitz" || mode === "kill_clock";
      const settleAfterPa = fam === "inside_zone" || fam === "split_zone" || fam === "quick_game"
        || (currentDrawLike && allowDrawSequenceBoost);
      const settleAfterShot = fam === "quick_game" || fam === "inside_zone" || fam === "split_zone"
        || (currentDrawLike && allowDrawSequenceBoost);

      if (prevWasPlayActionFamily && settleAfterPa) bonus += 3.25;
      if (prevWasQuickGame && ["shot", "flood", "boot"].includes(fam)) bonus += 2.25;
      if (prevWasShot && settleAfterShot) bonus += 2.0;
    }

    if (last.length && fam === last[last.length - 1].fam && !(play.type === "RUN" && bucket === "short")) bonus -= 2.0;

    const target = ocTypeTargetCore(params.typeHist);
    if (target === "RUN" && play.type === "RUN") bonus += 2.0;
    if (target === "PASSISH" && play.type !== "RUN") bonus += 1.5;

    if (bucket === "long" && play.type === "RUN") bonus -= 3.0;
    if (bucket === "short" && play.type === "RUN") bonus += 2.5;

    if (params.goalToGo) {
      if (play.type === "RUN") bonus += bucket === "short" ? 1.4 : 0.4;
      if (play.type === "PA") bonus += bucket === "short" ? 1.0 : 0.25;
      if (tags.condensed || tags.multipleTe || tags.underCenter) bonus += bucket === "short" ? 0.9 : 0.15;
      if ((tags.shotgun || tags.spread) && bucket !== "short") bonus += 1.2;
      if (tags.motion) bonus += 0.75;
      if (bucket === "short" && play.type !== "RUN" && fam === "quick_game") bonus += 0.75;
      if (bucket !== "short" && isDrawLikePlay(play, traits)) bonus += 1.4;
      if (bucket !== "short" && play.type === "PASS" && fam === "shot") bonus -= 0.4;
    }

    const mode = normalizeLearningModeKey(params.playcallingMode);
    const defense = cleanText(params.defense);
    const currentDrawLike = isDrawLikePlay(play, traits);
    if (defense === "Blitz" && (fam === "quick_game" || fam === "leak" || play.type === "RUN")) bonus += 2.0;
    if (defense === "Blitz" && currentDrawLike) {
      bonus += Number.isFinite(Number(params.constraintAnswerBlitzBonus))
        ? Number(params.constraintAnswerBlitzBonus)
        : CONSTRAINED_RANKING_DEFAULTS.constraintAnswerBlitzBonus;
    }
    if (mode === "blitz_beater") {
      if (fam === "quick_game" || fam === "leak" || fam === "screen" || play.type === "RUN") bonus += 2.0;
      if (currentDrawLike) {
        bonus += Number.isFinite(Number(params.constraintAnswerBlitzBonus))
          ? Number(params.constraintAnswerBlitzBonus)
          : CONSTRAINED_RANKING_DEFAULTS.constraintAnswerBlitzBonus;
      }
      if (traits && traits.blitzAnswer) bonus += 1.5;
      if (traits && traits.slowDeveloping) bonus -= 2.5;
      if (traits && traits.isPA) bonus -= 2.0;
    }
    if (mode === "redzone") {
      const compressed = isCompressedShortFieldSpot(params);
      let redzoneLean = 0;
      if (compressed) {
        // Goal-line / high red (≤10): prioritize power, iso, RPO, spot/quick; soft-tax deep intermediates.
        if (["duo_power", "iso", "snag_spot", "counter", "rpo", "quick_game", "curl_flat"].includes(fam)) redzoneLean += 2.2;
        if (play.type === "RPO" || fam === "rpo") redzoneLean += 1.2;
        if (fam === "man_beat") redzoneLean += 1.0;
        if (fam === "smash" || fam === "levels_dig") redzoneLean -= 0.8;
        if (fam === "shot" || fam === "verticals" || fam === "flood") redzoneLean -= 1.8;
      } else {
        // High red / open red (~11–20+) and unknown field: smash, spot, mesh, levels stay lethal.
        if (["smash", "snag_spot", "man_beat", "levels_dig", "duo_power", "counter", "rpo"].includes(fam)) redzoneLean += 1.8;
        if (play.type === "RPO" || fam === "rpo") redzoneLean += 1.0;
        if (fam === "iso") redzoneLean += 0.8;
        if (fam === "shot" || fam === "verticals") redzoneLean -= 1.0;
      }
      // Off-field Redzone mode keeps the sheet selectable but dampens geography leans.
      if (!isTrueRedZoneGeography(params)) redzoneLean *= 0.35;
      bonus += redzoneLean;
    }
    if (mode === "kill_clock" && currentDrawLike) {
      bonus += Number.isFinite(Number(params.constraintAnswerKillClockBonus))
        ? Number(params.constraintAnswerKillClockBonus)
        : CONSTRAINED_RANKING_DEFAULTS.constraintAnswerKillClockBonus;
    }

    if (params.down === 1) {
      if (play.type === "RUN") bonus += 2.0;
      if (play.type !== "RUN" && (fam === "boot" || fam === "flood")) bonus += 1.0;
      if (play.type === "PA" || fam === "boot" || fam === "flood" || fam === "leak") bonus += 0.85;
    }

    if (isRiskyPlayActionSpotCore({
      play: play,
      traits: traits,
      down: params.down,
      distBucket: params.distBucket,
      defense: params.defense,
      playTraitsOf: playTraitsOf,
    })) {
      bonus -= 8.5;
    }

    return bonus;
  }

  function formatFamilyChipLabel(family) {
    return cleanText(family)
      .replace(/[_|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, function (ch) {
        return ch.toUpperCase();
      });
  }

  function coverageBeatLabel(defense, traits, play) {
    const def = cleanText(defense);
    if (!def || def === "Unknown" || def === "—") return "";
    const t = traits || {};
    const strong = Array.isArray(t.strong)
      ? t.strong
      : (Array.isArray(play && play.strong_vs) ? play.strong_vs.map(function (value) {
        return cleanText(value).toLowerCase();
      }) : []);
    const strongHit = strong.some(function (value) {
      return cleanText(value).toLowerCase() === def.toLowerCase();
    });

    if (def === "Blitz") {
      if (t.blitzAnswer || strongHit) return "Answers blitz";
      return "";
    }
    if (def === "Man" || def === "Cover 1") {
      if (t.manBeater || strongHit) return def === "Cover 1" ? "Beats Cover 1" : "Beats man";
      return "";
    }
    if (def === "Cover 2" || def === "Tampa 2") {
      if (t.cover2Beater || strongHit) return def === "Tampa 2" ? "Beats Tampa 2" : "Beats Cover 2";
      return "";
    }
    if (def === "Cover 3") {
      if (t.cover3Beater || strongHit) return "Beats Cover 3";
      return "";
    }
    if (def === "Cover 4") {
      if (t.cover4Beater || strongHit) return "Beats Cover 4";
      return "";
    }
    if (def === "Cover 6") {
      if (t.manBeater || t.cover4Beater || strongHit) return "Beats Cover 6";
      return "";
    }
    if (def === "Cover 9") {
      if (t.manBeater || t.cover3Beater || t.quickAnswer || strongHit) return "Beats Cover 9";
      return "";
    }
    if (strongHit) return "Strong vs " + def;
    return "";
  }

  function buildRecommendationContextCore(params) {
    const play = params.play || {};
    const playTraitsOf = params.playTraitsOf;
    const familyOf = params.familyOf;
    const traits = params.traits || (playTraitsOf ? playTraitsOf(play) : {});
    const fam = params.fam || traits.fam || (familyOf ? familyOf(play) : "");
    const setupPayoff = params.setupPayoff || {};
    const lastCalls = Array.isArray(params.lastCalls) ? params.lastCalls : [];
    const chips = [];
    const profile = getTeamIdentityProfile(params.teamCode);

    if (profile) {
      const famWeight = Number((profile.families && profile.families[fam]) || 0);
      const typeWeight = Number((profile.type && profile.type[play.type]) || 0);
      if (famWeight >= 0.5 || (famWeight > 0 && typeWeight >= 0.5)) {
        chips.push({ id: "identity", label: "Identity fit", tone: "identity" });
      } else if (famWeight <= 0 && typeWeight < 0.4) {
        chips.push({ id: "identity", label: "Off-identity", tone: "warn" });
      } else if (famWeight > 0 || typeWeight >= 0.4) {
        chips.push({ id: "identity", label: "Identity lean", tone: "identity" });
      }
    }

    const prev = lastCalls.length ? lastCalls[lastCalls.length - 1] : null;
    const cashesSetup = !!(prev && Array.isArray(setupPayoff[prev.fam]) && setupPayoff[prev.fam].includes(fam));
    if (cashesSetup) {
      chips.push({ id: "payoff", label: "Cashes setup", tone: "payoff" });
    } else {
      const nextPayoffs = Array.isArray(setupPayoff[fam]) ? setupPayoff[fam] : [];
      if (nextPayoffs.length) {
        const labels = nextPayoffs.slice(0, 2).map(formatFamilyChipLabel).join("/");
        chips.push({ id: "setup", label: "Sets up " + labels, tone: "payoff" });
      }
    }

    if (params.scriptMatch === true) {
      const scriptLabel = cleanText(params.scriptTag);
      chips.push({
        id: "script",
        label: scriptLabel ? "On script · " + scriptLabel : "On script",
        tone: "script",
      });
    } else if (cleanText(params.scriptTag)) {
      chips.push({ id: "script", label: cleanText(params.scriptTag), tone: "script" });
    }

    const beatLabel = coverageBeatLabel(params.defense, traits, play);
    if (beatLabel) {
      chips.push({ id: "coverage", label: beatLabel, tone: "coverage" });
    }

    const limited = chips.slice(0, 4);
    const offIdentity = limited.some(function (chip) {
      return chip.id === "identity" && chip.tone === "warn";
    });
    const onScript = params.scriptMatch === true;
    let note = "";
    if (offIdentity && cashesSetup) note = "Breaks identity to cash the setup.";
    else if (offIdentity && onScript) note = "Off-identity, but on script.";
    else if (offIdentity && beatLabel) note = "Off-identity coverage answer.";
    else if (!offIdentity && cashesSetup && beatLabel) note = "Setup cash that also fits the look.";

    return { chips: limited, note: note };
  }

  return {
    DRIVE_RESULT_OPTIONS,
    getTeamIdentityProfile,
    teamIdentityBonusCore,
    matchesScriptEntryCore,
    ocTypeTargetCore,
    isRiskyPlayActionSpotCore,
    ocBonusCore,
    buildRecommendationContextCore,
    formatFamilyChipLabel,
    LEARNING_MODE_KEYS,
    normalizeLearningModeKey,
    appendLearningModeToKey,
    stripLearningModeFromKey,
    recordGameOutcomeMemoryEntry,
    gameOutcomeMemoryAdjustment,
    sameDriveAnswerLastSnapAdjustment,
    turnoverRiskAdjustment,
    applyLateGamePlanPressure,
    isCompressedShortFieldSpot,
    isTrueRedZoneGeography,
    dampenVarietyAdjustment,
    CONSTRAINT_FAMILIES,
    MONOPOLY_FAMILIES,
    EXPLORATION_DEFAULTS,
    CONSTRAINED_RANKING_DEFAULTS,
    isConstraintFamily,
    isMonopolyFamily,
    resolveExplorationPolicy,
    combineRecommendationScore,
    buildRecentShellEvents,
    familyQuotaAdjustment,
    shouldExemptDrawQuotas,
    shouldExemptMonopolyQuotas,
    shouldExemptShellRotation,
    canPlaceAtRank,
    promoteAlternateShellCandidate,
    applySoftScriptBoostCore,
    buildSituationMmrEvents,
    situationMmrAdjustment,
    applySituationMmrCore,
    buildFitnessBand,
    softmaxSampleIndex,
    sampleRank1,
    pickTopRecommendationsCore,
  };
});