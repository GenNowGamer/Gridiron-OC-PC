"use strict";

const OpeningScript = globalThis.GridironOpeningScript || {};
const Gameplan = globalThis.GridironGameplan || {};
const Tendency = globalThis.GridironOpponentTendency || {};
const SituationBoard = globalThis.GridironSituationBoard || {};
const ResultLabels = globalThis.GridironResultLabels || {
  emptyStore: function () { return { plays: {}, looks: {}, concepts: {} }; },
  normalizeStore: function (value) { return value || { plays: {}, looks: {}, concepts: {} }; },
  recordResult: function (_store) { return _store; },
  rateFor: function () { return null; },
  reasonFor: function () { return ""; },
  summary: function () { return { theirOffense: "Not enough yet", theirDefense: "Not enough yet", record: "Not enough yet" }; },
};
const TabletSession = globalThis.GridironTabletSession || {};
const DefensiveScout = globalThis.GridironDefensiveScout || {};

const STORAGE_KEYS = {
  preferences: "goc-desktop-preferences-v3",
  userLearning: "goc-desktop-user-learning-v1",
  floatingLayout: "goc-desktop-floating-layout-v1",
  recentRunScripts: "goc-desktop-recent-run-scripts-v1",
  recentBoardPlays: "goc-desktop-recent-board-plays-v1",
  gameplans: "goc-desktop-gameplans-v1",
  opponentTendencies: "goc-desktop-opponent-tendencies-v1",
  resultLabels: "goc-desktop-result-labels-v1",
};

const APP_DISPLAY_NAME = "Gridiron OC";
const COORDINATOR_ROLE_OC = "oc";
const SCORING_DEFENSE_UNKNOWN = "Unknown";
const MIN_FAMILY_LEARNING_SAMPLES = 4;
const MIN_FORMATION_LEARNING_SAMPLES = 3;
const MIN_FORMATION_SET_LEARNING_SAMPLES = 3;
const MIN_EXACT_PLAY_LEARNING_SAMPLES = 5;
const TRACE_LOG_FILENAME = "gridiron-trace-current.txt";
const MAX_TRACE_LOG_CHARS = 240000;
const TRACE_PREVIEW_CHARS = 12000;

const NFL_TEAMS = [
  { code: "ARI", name: "Arizona Cardinals" },
  { code: "ATL", name: "Atlanta Falcons" },
  { code: "BAL", name: "Baltimore Ravens" },
  { code: "BUF", name: "Buffalo Bills" },
  { code: "CAR", name: "Carolina Panthers" },
  { code: "CHI", name: "Chicago Bears" },
  { code: "CIN", name: "Cincinnati Bengals" },
  { code: "CLE", name: "Cleveland Browns" },
  { code: "DAL", name: "Dallas Cowboys" },
  { code: "DEN", name: "Denver Broncos" },
  { code: "DET", name: "Detroit Lions" },
  { code: "GB", name: "Green Bay Packers" },
  { code: "HOU", name: "Houston Texans" },
  { code: "IND", name: "Indianapolis Colts" },
  { code: "JAX", name: "Jacksonville Jaguars" },
  { code: "KC", name: "Kansas City Chiefs" },
  { code: "LV", name: "Las Vegas Raiders" },
  { code: "LAC", name: "Los Angeles Chargers" },
  { code: "LAR", name: "Los Angeles Rams" },
  { code: "MIA", name: "Miami Dolphins" },
  { code: "MIN", name: "Minnesota Vikings" },
  { code: "NE", name: "New England Patriots" },
  { code: "NO", name: "New Orleans Saints" },
  { code: "NYG", name: "New York Giants" },
  { code: "NYJ", name: "New York Jets" },
  { code: "PHI", name: "Philadelphia Eagles" },
  { code: "PIT", name: "Pittsburgh Steelers" },
  { code: "SF", name: "San Francisco 49ers" },
  { code: "SEA", name: "Seattle Seahawks" },
  { code: "TB", name: "Tampa Bay Buccaneers" },
  { code: "TEN", name: "Tennessee Titans" },
  { code: "WAS", name: "Washington Commanders" },
];

const TEAM_THEME_META = {
  NFL: { label: "Neutral", primary: "#2a6cff", secondary: "#8fb8ff", primarySoft: "#1b2a3d" },
  ARI: { label: "Arizona", primary: "#97233f", secondary: "#ffb612", primarySoft: "#2a1820" },
  ATL: { label: "Atlanta", primary: "#a71930", secondary: "#000000", primarySoft: "#2c161a" },
  BAL: { label: "Baltimore", primary: "#24135f", secondary: "#9e7c0c", primarySoft: "#18142a" },
  BUF: { label: "Buffalo", primary: "#00338d", secondary: "#c60c30", primarySoft: "#132038" },
  CAR: { label: "Carolina", primary: "#0085ca", secondary: "#101820", primarySoft: "#132633" },
  CHI: { label: "Chicago", primary: "#0b162a", secondary: "#c83803", primarySoft: "#142033" },
  CIN: { label: "Cincinnati", primary: "#fb4f14", secondary: "#000000", primarySoft: "#302018" },
  CLE: { label: "Cleveland", primary: "#ff3c00", secondary: "#311d00", primarySoft: "#2d1b16" },
  DAL: { label: "Dallas", primary: "#003594", secondary: "#869397", primarySoft: "#132038" },
  DEN: { label: "Denver", primary: "#fb4f14", secondary: "#002244", primarySoft: "#301f18" },
  DET: { label: "Detroit", primary: "#0076b6", secondary: "#b0b7bc", primarySoft: "#132634" },
  GB: { label: "Green Bay", primary: "#203731", secondary: "#ffb612", primarySoft: "#16231f" },
  HOU: { label: "Houston", primary: "#03202f", secondary: "#a71930", primarySoft: "#13202b" },
  IND: { label: "Indianapolis", primary: "#003b7b", secondary: "#a2aaad", primarySoft: "#142033" },
  JAX: { label: "Jacksonville", primary: "#006778", secondary: "#d7a22a", primarySoft: "#14252a" },
  KC: { label: "Kansas City", primary: "#e31837", secondary: "#ffb81c", primarySoft: "#31171f" },
  LV: { label: "Las Vegas", primary: "#000000", secondary: "#a5acaf", primarySoft: "#1a1a1a" },
  LAC: { label: "LAC", primary: "#0080c6", secondary: "#ffc20e", primarySoft: "#132634" },
  LAR: { label: "LAR", primary: "#003594", secondary: "#ffd100", primarySoft: "#132038" },
  MIA: { label: "Miami", primary: "#008e97", secondary: "#fc4c02", primarySoft: "#14282b" },
  MIN: { label: "Minnesota", primary: "#4f2683", secondary: "#ffc62f", primarySoft: "#21192c" },
  NE: { label: "New England", primary: "#002244", secondary: "#c60c30", primarySoft: "#131d28" },
  NO: { label: "New Orleans", primary: "#d3bc8d", secondary: "#101820", primarySoft: "#2a251b" },
  NYG: { label: "NYG", primary: "#0b2265", secondary: "#a71930", primarySoft: "#131d30" },
  NYJ: { label: "NYJ", primary: "#125740", secondary: "#ffffff", primarySoft: "#15231f" },
  PHI: { label: "Philadelphia", primary: "#004c54", secondary: "#a5acaf", primarySoft: "#142527" },
  PIT: { label: "Pittsburgh", primary: "#ffb612", secondary: "#101820", primarySoft: "#2b2417" },
  SF: { label: "San Francisco", primary: "#aa0000", secondary: "#b3995d", primarySoft: "#2d1718" },
  SEA: { label: "Seattle", primary: "#002244", secondary: "#69be28", primarySoft: "#131d28" },
  TB: { label: "Tampa Bay", primary: "#d50a0a", secondary: "#ff7900", primarySoft: "#311818" },
  TEN: { label: "Tennessee", primary: "#0c2340", secondary: "#4b92db", primarySoft: "#131d27" },
  WAS: { label: "Washington", primary: "#5a1414", secondary: "#ffb612", primarySoft: "#251818" },
};

const TEAM_IDENTITY_LABELS = {
  ARI: "Power Run Condensed",
  ATL: "Versatile West Coast",
  BAL: "Power Multiple",
  BUF: "QB Run Multiple",
  CAR: "Quick West Coast",
  CHI: "PA Motion Explosive",
  CIN: "Shotgun Pass",
  CLE: "West Coast PA",
  DAL: "Air Coryell Efficiency",
  DEN: "Air Coryell Efficiency",
  DET: "PA Motion Explosive",
  GB: "Versatile West Coast",
  HOU: "Under Center PA Middle",
  IND: "Vertical RPO Gun",
  JAX: "Perimeter Pass",
  KC: "Creative West Coast",
  LV: "Spread Run",
  LAC: "Ground Control",
  LAR: "Shanahan Condensed",
  MIA: "Motion Speed",
  MIN: "Rhythm Passing",
  NE: "West Coast PA",
  NO: "Shanahan Condensed",
  NYG: "Under Center PA Middle",
  NYJ: "Quick West Coast",
  PHI: "Tempo Motion RPO",
  PIT: "Ground Control",
  SF: "Shanahan Condensed",
  SEA: "Vertical Aggressive",
  TB: "Vertical Aggressive",
  TEN: "Pass First Creative",
  WAS: "Spread Run",
};

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

const cleanText = v => String(v ?? "").trim();
const escapeHtml = v => cleanText(v)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");
const toTextArray = v => Array.isArray(v) ? v.map(cleanText).filter(Boolean) : (cleanText(v) ? [cleanText(v)] : []);

function uniqueText(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function hexToRgb(hex) {
  const n = cleanText(hex).replace("#", "");
  if (n.length !== 6) return { r: 11, g: 15, b: 20 };
  const value = parseInt(n, 16);
  if (!Number.isFinite(value)) return { r: 11, g: 15, b: 20 };
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgbToHex({ r, g, b }) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

function mixHex(baseHex, accentHex, amount = 0.5) {
  const mix = Math.max(0, Math.min(1, amount));
  const base = hexToRgb(baseHex);
  const accent = hexToRgb(accentHex);
  return rgbToHex({
    r: base.r + ((accent.r - base.r) * mix),
    g: base.g + ((accent.g - base.g) * mix),
    b: base.b + ((accent.b - base.b) * mix),
  });
}

function getReadableTextColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (((r * 299) + (g * 587) + (b * 114)) / 1000) >= 160 ? "#101820" : "#ffffff";
}

function getThemePreset(teamCode) {
  const meta = TEAM_THEME_META[cleanText(teamCode).toUpperCase()] || TEAM_THEME_META.NFL;
  const topPlayBackground = mixHex(meta.secondary, "#ffffff", 0.08);
  const topPlayText = getReadableTextColor(topPlayBackground);
  const controlBackground = mixHex("#111927", meta.primary, 0.18);
  const controlBackgroundHover = mixHex(controlBackground, "#ffffff", 0.08);
  const controlText = getReadableTextColor(controlBackground);
  return {
    background: mixHex("#0b0f14", meta.primary, 0.22),
    backgroundAlt: mixHex("#101722", meta.primary, 0.34),
    panel: mixHex("#0f1620", meta.primary, 0.3),
    panelAlt: mixHex("#121b27", meta.primary, 0.22),
    border: mixHex("#253246", meta.secondary, 0.4),
    borderStrong: mixHex(meta.secondary, "#ffffff", 0.18),
    primary: meta.primary,
    secondary: meta.secondary,
    secondaryPressed: mixHex(meta.secondary, "#000000", 0.16),
    topPlayBackground,
    topPlayBorder: mixHex(meta.secondary, "#000000", 0.18),
    topPlayText,
    topPlaySubtext: mixHex(topPlayText, topPlayBackground, 0.22),
    muted: mixHex("#a9b4c8", meta.secondary, 0.2),
    hint: mixHex("#c3cede", meta.secondary, 0.16),
    controlBackground,
    controlBackgroundHover,
    controlText,
  };
}

function applyTheme(themeTeam) {
  const theme = getThemePreset(themeTeam);
  const root = document.documentElement.style;
  root.setProperty("--bg", theme.background);
  root.setProperty("--bg-alt", theme.backgroundAlt);
  root.setProperty("--panel", theme.panel);
  root.setProperty("--panel-alt", theme.panelAlt);
  root.setProperty("--border", theme.border);
  root.setProperty("--border-strong", theme.borderStrong);
  root.setProperty("--primary", theme.primary);
  root.setProperty("--secondary", theme.secondary);
  root.setProperty("--secondary-pressed", theme.secondaryPressed);
  root.setProperty("--muted", theme.muted);
  root.setProperty("--hint", theme.hint);
  root.setProperty("--top-play-bg", theme.topPlayBackground);
  root.setProperty("--top-play-border", theme.topPlayBorder);
  root.setProperty("--top-play-text", theme.topPlayText);
  root.setProperty("--top-play-subtext", theme.topPlaySubtext);
  root.setProperty("--control-bg", theme.controlBackground);
  root.setProperty("--control-bg-hover", theme.controlBackgroundHover);
  root.setProperty("--control-text", theme.controlText);
  root.setProperty("--on-secondary", getReadableTextColor(theme.secondary));
}

function normalizeOpponentTeam(value) {
  const code = cleanText(value).toUpperCase();
  return NFL_TEAMS.some(team => team.code === code) ? code : "";
}

function formatOpponentLabel(code = state.selectedOpponent) {
  const normalized = normalizeOpponentTeam(code);
  return normalized ? (TEAM_THEME_META[normalized]?.label || normalized) : "Not set";
}

function normalizePlayType(value) {
  const key = cleanText(value).toUpperCase().replace(/[^A-Z]/g, "");
  if (key === "RUN") return "RUN";
  if (key === "PASS") return "PASS";
  if (key === "PA" || key === "PLAYACTION") return "PA";
  if (key === "RPO") return "RPO";
  return "PASS";
}

function isHailMaryPlay(play) {
  const formationText = `${cleanText(play?.formation)} ${cleanText(play?.set)}`.toLowerCase();
  return formationText.includes("hail mary");
}

function isGoalLinePlay(play) {
  const formationText = `${cleanText(play?.formation)} ${cleanText(play?.set)}`.toLowerCase();
  return formationText.includes("goal line");
}

function normalizeFormationAndSet(formationValue, setValue) {
  let formation = cleanText(formationValue);
  let set = cleanText(setValue);
  const rewrite = (expectedFormation, setPrefix, nextFormation) => {
    if (formation !== expectedFormation || !set.startsWith(setPrefix)) return;
    formation = nextFormation;
    set = cleanText(set.slice(setPrefix.length));
  };
  rewrite("Full", "House ", "Full House");
  rewrite("Goal", "Line ", "Goal Line");
  rewrite("Hail", "Mary ", "Hail Mary");
  rewrite("I", "Form ", "I Form");
  rewrite("Strong", "I ", "Strong I");
  rewrite("Weak", "I ", "Weak I");
  rewrite("Split", "Backs ", "Split Backs");
  rewrite("Maryland", "I ", "Maryland I");
  return { formation, set };
}

function inferTypeFromName(playName, currentType) {
  const name = cleanText(playName).toUpperCase().replace(/[^A-Z0-9 ]/g, " ");
  const words = name.split(/\s+/).filter(Boolean);
  const hasWord = word => words.includes(word);
  if (hasWord("RPO")) return "RPO";
  if (hasWord("PA")) return "PA";
  if (hasWord("SCREEN")) return "PASS";
  if (name.includes("MIDDLE SLAM")) return "PASS";
  const passIndicators = new Set(["MESH", "STICK", "SPACING", "BENCH", "DAGGER", "SCISSORS", "SEAM", "WHEEL", "CURL", "SNAG", "DIG", "ANGLE", "LEAK", "WHIP", "SLANTS"]);
  const runIndicators = new Set(["COUNTER", "ZONE", "DIVE", "SWEEP", "TRAP", "DUO", "DRAW", "TOSS", "POWER", "SLAM", "PLUNGE", "ISO", "LEAD"]);
  const hasPass = words.some(word => passIndicators.has(word));
  const hasRun = words.some(word => runIndicators.has(word));
  if (currentType === "RUN" && hasPass) return "PASS";
  if (currentType === "PASS" && hasRun && !hasPass) return "RUN";
  return currentType;
}

const playIdOf = play => [play.team, play.formation, play.set, play.play_name].map(value => cleanText(value).toLowerCase()).join("|");

function inferDerivedConcepts(play) {
  const text = `${cleanText(play.play_name)} ${cleanText(play.set)} ${cleanText(play.formation)}`.toLowerCase();
  const tags = [];
  const has = (...terms) => terms.some(term => text.includes(term));
  if (play.type === "RPO") tags.push("RPO");
  if (play.type === "PA") tags.push("Play Action");
  if (has("inside zone")) tags.push("Inside Zone");
  if (has("split zone")) tags.push("Split Zone");
  if (has("outside zone", "wide zone")) tags.push("Wide Zone");
  if (has("duo")) tags.push("Duo");
  if (has("counter")) tags.push("Counter");
  if (has("trap")) tags.push("Trap");
  if (has("power")) tags.push("Power O");
  if (has("draw")) tags.push("Draw");
  if (has("dive", "plunge")) tags.push("Dive");
  if (has("screen")) tags.push("Screen");
  if (has("stick")) tags.push("Stick");
  if (has("spacing")) tags.push("Spacing");
  if (has("slant", "slants")) tags.push("Slant");
  if (has("mesh")) tags.push("Mesh");
  if (has("drag")) tags.push("Drag");
  if (has("under")) tags.push("Under");
  if (has("cross")) tags.push("Cross");
  if (has("over")) tags.push("Deep Over");
  if (has("dagger")) tags.push("Dagger");
  if (has("post")) tags.push("Post");
  if (has("corner")) tags.push("Corner");
  if (has("bench")) tags.push("Bench");
  if (has("flood", "sail")) tags.push("Flood");
  if (has("boot", "sprint")) tags.push("Boot");
  if (has("leak")) tags.push("Leak");
  if (has("wheel")) tags.push("Wheel");
  if (has("seam")) tags.push("Seam");
  if (has("curl")) tags.push("Curl");
  if (has("flat")) tags.push("Flat");
  if (has("swing")) tags.push("Swing");
  if (has("out", "outs")) tags.push("Out");
  if (has("stick", "spacing", "bench", "slant", "under", "curl", "outs")) tags.push("Quick Game");
  if (play.type === "RUN" && !tags.length) tags.push("Run");
  if (play.type === "PASS" && !tags.length) tags.push("Pass");
  return uniqueText(tags);
}

function inferDerivedStrongVs(play, concepts) {
  const text = cleanText(play.play_name).toLowerCase();
  const conceptText = concepts.map(value => String(value).toLowerCase());
  const strongVs = [];
  const has = (...terms) => terms.some(term => text.includes(term) || conceptText.some(value => value.includes(term)));
  if (has("mesh", "drag", "slant", "cross", "wheel", "leak", "under", "dig")) strongVs.push("Man", "Cover 1", "Cover 6");
  if (has("seam", "post", "dagger")) strongVs.push("Cover 1", "Tampa 2");
  if (has("flood", "corner", "bench", "spacing", "stick", "quick game", "out")) strongVs.push("Cover 2", "Cover 3", "Tampa 2");
  if (has("dagger", "post", "seam", "deep over", "scissors", "shot")) strongVs.push("Cover 4", "Cover 6");
  if (has("boot", "play action", "screen", "rpo", "flat", "swing")) strongVs.push("Cover 9");
  if (play.type === "RUN" || has("screen", "quick game", "trap", "inside zone", "split zone", "dive", "leak")) strongVs.push("Blitz", "Cover 9");
  return uniqueText(strongVs);
}

function normalizeImportedPlay(play) {
  const { formation, set } = normalizeFormationAndSet(play.formation, play.set);
  const normalized = {
    ...play,
    team: cleanText(play.team),
    formation,
    set,
    play_name: cleanText(play.play_name),
    type: inferTypeFromName(play.play_name, normalizePlayType(play.type)),
  };
  const concepts = uniqueText([...toTextArray(play.concepts), ...inferDerivedConcepts(normalized)]);
  const strong_vs = uniqueText([...toTextArray(play.strong_vs), ...inferDerivedStrongVs(normalized, concepts)]);
  return {
    ...normalized,
    concepts,
    strong_vs,
    situations: uniqueText(toTextArray(play.situations)),
    id: playIdOf(normalized),
  };
}

function normalizeDefensivePlayType(type) {
  const key = cleanText(type).toUpperCase();
  return ({ MAN: "MAN", ZONE: "ZONE", BLITZ: "BLITZ", MATCH: "MATCH", RETURN: "RETURN", OTHER: "OTHER" })[key] || "OTHER";
}

function normalizeImportedDefensivePlay(play) {
  const { formation, set } = normalizeFormationAndSet(play.formation, play.set);
  const normalized = {
    ...play,
    team: cleanText(play.team),
    formation,
    set,
    play_name: cleanText(play.play_name),
    type: normalizeDefensivePlayType(play.type),
  };
  return {
    ...normalized,
    concepts: uniqueText(toTextArray(play.concepts)),
    strong_vs: uniqueText(toTextArray(play.strong_vs)),
    situations: uniqueText(toTextArray(play.situations)),
    id: playIdOf(normalized),
  };
}

function familyOf(play) {
  if (SituationBoard.primaryFamily) return SituationBoard.primaryFamily(play);
  return "quick_game";
}

function situationFamiliesOf(play) {
  if (SituationBoard.conceptTags) return SituationBoard.conceptTags(play);
  const fam = familyOf(play);
  return fam ? [fam] : [];
}

const lowerConcepts = play => (play.concepts || []).map(value => cleanText(value).toLowerCase());
const lowerStrongVs = play => (play.strong_vs || []).map(value => cleanText(value).toLowerCase());
const formationKeyOf = play => cleanText(play.formation).toLowerCase() || "unknown";
const formationSetKeyOf = play => `${formationKeyOf(play)}|${cleanText(play.set).toLowerCase() || "base"}`;

function playTraitsOf(play) {
  const concepts = lowerConcepts(play);
  const fam = familyOf(play);
  const has = (...terms) => terms.some(term => concepts.some(value => value === term || value.includes(term)) || cleanText(play.play_name).toLowerCase().includes(term));
  const type = play.type;
  const isHailMary = fam === "hail_mary";
  const isRun = type === "RUN";
  const isPass = type === "PASS";
  const isPA = type === "PA";
  const isRpo = type === "RPO";
  const isPassish = isPass || isPA;
  const quickAnswer = fam === "screen" || fam === "quick_game" || fam === "curl_flat" || fam === "snag_spot" || fam === "redzone_pass" || has("quick game", "stick", "spacing", "slant", "mesh", "drag", "flat", "swing", "whip", "under", "out", "bench", "hitch", "snag", "spot", "curl", "choice", "redzone");
  const manBeater = fam === "man_beat" || fam === "wheel" || fam === "levels_dig" || fam === "redzone_pass" || has("mesh", "whip", "drag", "shallow cross", "slant", "cross", "wheel", "zig", "under", "trail", "dig", "drive", "scissors");
  const cover2Beater = fam === "flood" || fam === "smash" || fam === "redzone_pass" || has("corner", "bench", "seam", "smash", "scissors", "post", "redzone");
  const cover3Beater = fam === "flood" || fam === "curl_flat" || fam === "smash" || has("flood", "bench", "spacing", "stick", "curl", "flat", "seam", "post", "cross", "deep over", "out", "sail");
  const cover4Beater = fam === "shot" || fam === "verticals" || fam === "levels_dig" || fam === "redzone_pass" || has("dagger", "scissors", "post", "deep over", "seam", "shallow cross", "spacing", "cross", "verticals", "dig", "redzone");
  const blitzAnswer = quickAnswer || fam === "screen" || fam === "leak" || fam === "draw" || fam === "read_option" || has("screen", "flat", "swing", "leak", "draw", "read option") || (isRun && ["inside_zone", "split_zone", "duo_power", "dive", "trap", "counter", "draw", "iso"].includes(fam));
  const sticksFriendly = fam === "flood" || fam === "man_beat" || fam === "shot" || fam === "levels_dig" || fam === "curl_flat" || fam === "snag_spot" || fam === "smash" || fam === "redzone_pass" || has("stick", "spacing", "bench", "mesh", "cross", "shallow cross", "dagger", "deep over", "seam", "post", "curl", "out", "corner", "dig", "levels", "drive", "snag", "spot", "smash", "redzone");
  const explosive = isHailMary || fam === "shot" || fam === "verticals" || has("post", "seam", "deep over", "dagger", "scissors", "wheel", "corner", "verticals");
  const interiorRun = isRun && ["inside_zone", "split_zone", "duo_power", "dive", "trap", "draw", "iso"].includes(fam);
  const perimeterRun = isRun && ["wide_zone", "jet", "counter", "read_option"].includes(fam);
  const shortYardage = interiorRun || perimeterRun || quickAnswer || isRpo || fam === "iso" || fam === "redzone_pass";
  const screenLike = fam === "screen" || has("screen", "bubble", "tunnel", "smoke");
  const outletHeavy = fam !== "screen" && (screenLike || has("flat", "swing")) && !sticksFriendly;
  const chunkCapable = explosive || fam === "flood" || fam === "wheel" || fam === "levels_dig" || fam === "smash" || manBeater;
  const chainAccess = sticksFriendly || chunkCapable;
  const slowDeveloping = isHailMary || (isPA && fam !== "redzone_pass") || fam === "shot" || fam === "boot" || fam === "leak" || fam === "verticals" || (explosive && !quickAnswer && fam !== "redzone_pass");
  const pressureSensitive = slowDeveloping && !blitzAnswer;
  const highVariance = (isHailMary || explosive || screenLike || perimeterRun || fam === "read_option") && fam !== "redzone_pass";
  const efficient = quickAnswer || interiorRun || isRpo || fam === "flood" || fam === "screen" || fam === "iso" || fam === "curl_flat" || fam === "snag_spot" || fam === "redzone_pass";
  return {
    fam,
    concepts,
    strong: lowerStrongVs(play),
    isRun,
    isPassish,
    isPA,
    isRpo,
    quickAnswer,
    manBeater,
    cover2Beater,
    cover3Beater,
    cover4Beater,
    blitzAnswer,
    sticksFriendly,
    explosive,
    interiorRun,
    perimeterRun,
    shortYardage,
    outletHeavy,
    screenLike,
    chunkCapable,
    chainAccess,
    slowDeveloping,
    pressureSensitive,
    highVariance,
    efficient,
  };
}

function coverageMatchupScore(play, defense, traits) {
  const t = traits || playTraitsOf(play);
  if (defense === SCORING_DEFENSE_UNKNOWN || defense === "Unknown") return 0;
  let score = 0;
  if (t.strong.includes(defense.toLowerCase())) score += 2.25;
  if (defense === "Man") {
    if (t.manBeater) score += 3;
    if (t.quickAnswer) score += 0.75;
    if (t.perimeterRun) score += 0.5;
  }
  if (defense === "Cover 1") {
    if (t.manBeater) score += 2.9;
    if (t.quickAnswer) score += 0.85;
    if (t.explosive) score += 0.9;
    if (t.perimeterRun) score += 0.35;
  }
  if (defense === "Cover 2") {
    if (t.cover2Beater) score += 2.9;
    if (t.explosive) score += 0.8;
    if (t.isRun) score += 0.7;
  }
  if (defense === "Cover 3") {
    if (t.cover3Beater) score += 2.9;
    if (t.quickAnswer) score += 0.6;
    if (t.interiorRun) score += 0.9;
  }
  if (defense === "Cover 4") {
    if (t.cover4Beater) score += 2.9;
    if (t.interiorRun) score += 1.1;
    if (t.quickAnswer) score += 0.5;
    if (t.explosive && !t.cover4Beater) score -= 1;
  }
  if (defense === "Cover 6") {
    if (t.manBeater) score += 2.2;
    if (t.cover4Beater) score += 2.4;
    if (t.quickAnswer) score += 0.9;
    if (t.sticksFriendly) score += 0.75;
  }
  if (defense === "Tampa 2") {
    if (t.cover2Beater) score += 2.7;
    if (t.manBeater) score += 1.4;
    if (t.explosive) score += 1;
    if (t.quickAnswer) score += 0.65;
  }
  if (defense === "Cover 9") {
    if (t.quickAnswer) score += 2.2;
    if (t.isPA) score += 2.5;
    if (t.isRpo) score += 1.8;
    if (t.screenLike) score += 1.6;
    if (t.isRun) score += 0.9;
    if (t.perimeterRun) score += 0.75;
  }
  if (defense === "Blitz") {
    if (t.blitzAnswer) score += 3.4;
    if (t.quickAnswer) score += 1.1;
    if (t.screenLike) score += 1.4;
    if (t.interiorRun || t.perimeterRun) score += 0.9;
    if (t.explosive && !t.quickAnswer && !t.isPA) score -= 2;
  }
  return Math.max(0, score);
}

function createEmptyOpponentScouting() {
  return { byOpponent: {} };
}

function createEmptyUserLearning() {
  return {
    byLearningSituation: {},
    global: { families: {}, formations: {}, formationSets: {}, plays: {} },
    coverageOutcomes: { byDefense: {} },
    defenseTendency: { byDefense: {} },
    opponentScouting: createEmptyOpponentScouting(),
    updatedAt: 0,
  };
}

function normalizeLearningStat(value) {
  const safe = value || {};
  return {
    attempts: Number(safe.attempts) || 0,
    successPoints: Number(safe.successPoints) || 0,
    yardsTotal: Number(safe.yardsTotal) || 0,
    firstDowns: Number(safe.firstDowns) || 0,
    explosiveGains: Number(safe.explosiveGains) || 0,
    negativePlays: Number(safe.negativePlays) || 0,
    stuffedPlays: Number(safe.stuffedPlays) || 0,
    updatedAt: Number(safe.updatedAt) || 0,
  };
}

function personalLearningComponent(stat, minSamples, multiplier, cap) {
  const safe = normalizeLearningStat(stat);
  if (safe.attempts < minSamples) return 0;
  const average = safe.successPoints / Math.max(safe.attempts, 1);
  const reliability = Math.max(0, Math.min((safe.attempts - minSamples + 1) / 6, 1));
  return Math.max(-cap, Math.min(average * reliability * multiplier, cap));
}

function personalLearningFromSituation(play, learning) {
  if (!learning) return 0;
  const family = familyOf(play);
  const formationKey = formationKeyOf(play);
  const formationSetKey = formationSetKeyOf(play);
  const familyBonus = personalLearningComponent(learning.families?.[family], MIN_FAMILY_LEARNING_SAMPLES, 0.9, 1.25);
  const formationBonus = personalLearningComponent(learning.formations?.[formationKey], MIN_FORMATION_LEARNING_SAMPLES, 0.55, 0.75);
  const formationSetBonus = personalLearningComponent(learning.formationSets?.[formationSetKey], MIN_FORMATION_SET_LEARNING_SAMPLES, 0.8, 1);
  const exactPlayBonus = personalLearningComponent(learning.plays?.[play.id], MIN_EXACT_PLAY_LEARNING_SAMPLES, 1.15, 1.5);
  return familyBonus + formationBonus + formationSetBonus + exactPlayBonus;
}

function getOpponentScoutingProfile(userLearning, opponent) {
  const code = normalizeOpponentTeam(opponent);
  if (!code) return null;
  return userLearning?.opponentScouting?.byOpponent?.[code] || null;
}

const state = {
  maddenVersion: "M27",
  selectedTeam: "CHI",
  selectedOpponent: "DAL",
  themeTeam: "NFL",
  coordinatorRole: COORDINATOR_ROLE_OC,
  playcallScope: "offense",
  opponentContext: "cpu",
  opponentTendencies: { byKey: {} },
  normalizedPlays: [],
  normalizedDefensivePlays: [],
  gameStarted: false,
  customScriptPlays: [],
  customScriptActive: false,
  customScriptIndex: 0,
  customScriptSearch: "",
  customScriptLoggedToHistory: false,
  customScriptLockedIndexes: [],
  scriptOfferIds: [],
  scriptBuilderPurpose: "",
  recentRunScripts: [],
  recentBoardPlayIds: [],
  gameplans: {},
  activeGameplan: null,
  gameplanTab: "script",
  navigatorFormation: "",
  navigatorSet: "",
  userLearning: createEmptyUserLearning(),
  resultLabels: null,
  tabletSession: null,
  traceLogText: "",
  traceLogLoaded: false,
};

const dom = {
  headerSub: document.getElementById("headerSub"),
  statusValue: document.getElementById("statusValue"),
  newDriveBtn: document.getElementById("newDriveBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  settingsOverlay: document.getElementById("settingsOverlay"),
  teamSelect: document.getElementById("teamSelect"),
  opponentSelect: document.getElementById("opponentSelect"),
  maddenVersionSelect: document.getElementById("maddenVersionSelect"),
  themeSelect: document.getElementById("themeSelect"),
  matchupOverlay: document.getElementById("matchupOverlay"),
  matchupTeamSelect: document.getElementById("matchupTeamSelect"),
  matchupOpponentSelect: document.getElementById("matchupOpponentSelect"),
  matchupOpponentContextGroup: document.getElementById("matchupOpponentContextGroup"),
  matchupMaddenVersionGroup: document.getElementById("matchupMaddenVersionGroup"),
  matchupSkipBtn: document.getElementById("matchupSkipBtn"),
  matchupConfirmBtn: document.getElementById("matchupConfirmBtn"),
  scriptBuilderBtn: document.getElementById("scriptBuilderBtn"),
  scriptBuilderOverlay: document.getElementById("scriptBuilderOverlay"),
  closeScriptBuilderBtn: document.getElementById("closeScriptBuilderBtn"),
  scriptSearchInput: document.getElementById("scriptSearchInput"),
  scriptPlaybookList: document.getElementById("scriptPlaybookList"),
  scriptCountBadge: document.getElementById("scriptCountBadge"),
  scriptAutoFillBtn: document.getElementById("scriptAutoFillBtn"),
  scriptClearBtn: document.getElementById("scriptClearBtn"),
  scriptQueueList: document.getElementById("scriptQueueList"),
  scriptDoneBtn: document.getElementById("scriptDoneBtn"),
  gameplanTabScript: document.getElementById("gameplanTabScript"),
  gameplanTabSheet: document.getElementById("gameplanTabSheet"),
  gameplanSheet: document.getElementById("gameplanSheet"),
  scriptQueueCol: document.getElementById("scriptQueueCol"),
};

function normalizeOpponentContext(value) {
  return cleanText(value).toLowerCase() === "human" ? "human" : "cpu";
}

function buildPreferencesPayload() {
  return {
    maddenVersion: state.maddenVersion || "M27",
    selectedTeam: state.selectedTeam,
    selectedOpponent: state.selectedOpponent,
    themeTeam: state.themeTeam,
    coordinatorRole: COORDINATOR_ROLE_OC,
    playcallScope: "offense",
    opponentContext: normalizeOpponentContext(state.opponentContext),
  };
}

function clearLegacyLayout() {
  if (typeof document === "undefined" || !document) return;
  if (document.body?.removeAttribute) document.body.removeAttribute("data-layout-mode");
  try {
    if (typeof localStorage !== "undefined" && localStorage?.removeItem) {
      localStorage.removeItem(STORAGE_KEYS.floatingLayout);
    }
  } catch (_e) {}
}

function savePreferences(sync = false) {
  const payload = buildPreferencesPayload();
  localStorage.setItem(STORAGE_KEYS.preferences, JSON.stringify(payload));
  if (sync && window.desktopApi?.writePreferencesSync) {
    try {
      const result = window.desktopApi.writePreferencesSync(payload);
      if (result?.error) throw new Error(result.error);
      return;
    } catch (_error) {}
  }
  if (window.desktopApi?.writePreferences) {
    window.desktopApi.writePreferences(payload).catch(() => {});
  }
}

function loadOpponentTendencies() {
  state.opponentTendencies = Tendency.normalizeStore ? Tendency.normalizeStore({ byKey: {} }) : { byKey: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.opponentTendencies) || "{}");
    state.opponentTendencies = Tendency.normalizeStore ? Tendency.normalizeStore(raw) : { byKey: {} };
  } catch (_e) {}
}

function currentOpponentProfile() {
  return Tendency.profileFor ? Tendency.profileFor(state.opponentTendencies, state.selectedOpponent, state.opponentContext) : null;
}

function saveRecentRunScripts() {
  try {
    localStorage.setItem(STORAGE_KEYS.recentRunScripts, JSON.stringify(Array.isArray(state.recentRunScripts) ? state.recentRunScripts.slice(-2) : []));
  } catch (_e) {}
}

function saveRecentBoardPlays() {
  try {
    localStorage.setItem(STORAGE_KEYS.recentBoardPlays, JSON.stringify(Array.isArray(state.recentBoardPlayIds) ? state.recentBoardPlayIds.slice(-1000) : []));
  } catch (_e) {}
}

function rememberBoardPlaysFromSession(session) {
  const counts = session && session.gameShowCounts;
  if (!counts || typeof counts !== "object") return;
  const ids = Object.keys(counts).filter(id => cleanText(id) && Number(counts[id]) > 0);
  if (!ids.length) return;
  const existing = (state.recentBoardPlayIds || []).filter(id => !ids.includes(id));
  state.recentBoardPlayIds = [...existing, ...ids].slice(-1000);
  saveRecentBoardPlays();
}

function tabletDeferIds() {
  return Array.isArray(state.recentBoardPlayIds) ? state.recentBoardPlayIds.filter(Boolean) : [];
}

function normalizeTraceText(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function pruneTraceLogText(value) {
  const normalized = normalizeTraceText(value);
  if (normalized.length <= MAX_TRACE_LOG_CHARS) return normalized;
  const preservedTail = normalized.slice(-(MAX_TRACE_LOG_CHARS - 96));
  return ["[trace-log-pruned] Older entries were trimmed to keep the session log manageable.", "", preservedTail].join("\n");
}

function createTraceSessionHeader(reason = "manual_reset", team = null) {
  return [
    "============================================================",
    `Gridiron OC trace session start: ${new Date().toISOString()}`,
    `reason: ${cleanText(reason) || "manual_reset"}`,
    `team: ${cleanText(team) || "not_selected"}`,
    "============================================================",
    "",
  ].join("\n");
}

function formatTraceEventLine(tag, payload) {
  return `LOG  [${cleanText(tag) || "trace"}] ${JSON.stringify(payload || {})}`;
}

function replaceTraceLogText(nextValue) {
  state.traceLogText = pruneTraceLogText(nextValue);
}

function appendTraceLogEntry(entry) {
  const normalized = normalizeTraceText(entry).trimEnd();
  if (!normalized) return;
  const nextValue = state.traceLogText
    ? `${state.traceLogText}${state.traceLogText.endsWith("\n") ? "" : "\n"}${normalized}\n`
    : `${normalized}\n`;
  replaceTraceLogText(nextValue);
  if (state.traceLogLoaded && window.desktopApi?.writeTraceLog) {
    window.desktopApi.writeTraceLog(state.traceLogText).catch(() => {});
  }
}

function recordTraceEvent(tag, payload) {
  appendTraceLogEntry(formatTraceEventLine(tag, payload));
}

async function loadTraceLog() {
  try {
    const result = await window.desktopApi?.readTraceLog?.();
    replaceTraceLogText(result?.text || createTraceSessionHeader("desktop_trace_init", state.selectedTeam));
    state.traceLogLoaded = true;
  } catch (_error) {
    replaceTraceLogText(createTraceSessionHeader("trace_load_fallback", state.selectedTeam));
    state.traceLogLoaded = true;
  }
}

function applyPersistedPreferences(prefs = {}) {
  if (cleanText(prefs.maddenVersion)) {
    state.maddenVersion = cleanText(prefs.maddenVersion).toUpperCase() === "M26" ? "M26" : "M27";
  }
  if (cleanText(prefs.selectedTeam)) {
    state.selectedTeam = cleanText(prefs.selectedTeam).toUpperCase();
  }
  if (cleanText(prefs.selectedOpponent)) {
    state.selectedOpponent = normalizeOpponentTeam(prefs.selectedOpponent) || state.selectedOpponent;
  }
  if (cleanText(prefs.themeTeam)) {
    state.themeTeam = cleanText(prefs.themeTeam).toUpperCase();
  }
  clearLegacyLayout();
  state.coordinatorRole = COORDINATOR_ROLE_OC;
  state.playcallScope = "offense";
  state.opponentContext = normalizeOpponentContext(prefs.opponentContext);
}

async function loadPersistedState() {
  let loadedDesktopPreferences = false;
  try {
    if (window.desktopApi?.readPreferences) {
      const result = await window.desktopApi.readPreferences();
      const prefs = result?.preferences || {};
      if (prefs && Object.keys(prefs).length > 0) {
        applyPersistedPreferences(prefs);
        loadedDesktopPreferences = true;
        localStorage.setItem(STORAGE_KEYS.preferences, JSON.stringify(prefs));
      }
    }
  } catch (_) {}
  if (!loadedDesktopPreferences) {
    try {
      const prefs = JSON.parse(localStorage.getItem(STORAGE_KEYS.preferences) || "{}");
      applyPersistedPreferences(prefs);
      if (prefs && Object.keys(prefs).length > 0 && window.desktopApi?.writePreferences) {
        window.desktopApi.writePreferences(prefs).catch(() => {});
      }
    } catch (_) {}
  }
  try {
    const rawLearning = JSON.parse(localStorage.getItem(STORAGE_KEYS.userLearning) || "{}");
    state.userLearning = rawLearning && typeof rawLearning === "object" ? { ...createEmptyUserLearning(), ...rawLearning } : createEmptyUserLearning();
  } catch (_) {
    state.userLearning = createEmptyUserLearning();
  }
  try {
    const rawScripts = JSON.parse(localStorage.getItem(STORAGE_KEYS.recentRunScripts) || "[]");
    state.recentRunScripts = Array.isArray(rawScripts) ? rawScripts.slice(-2) : [];
  } catch (_) {
    state.recentRunScripts = [];
  }
  try {
    const rawBoard = JSON.parse(localStorage.getItem(STORAGE_KEYS.recentBoardPlays) || "[]");
    state.recentBoardPlayIds = Array.isArray(rawBoard) ? rawBoard.filter(Boolean).slice(-1000) : [];
  } catch (_) {
    state.recentBoardPlayIds = [];
  }
  loadGameplansFromStorage();
  loadOpponentTendencies();
  loadResultLabels();
}

function setStatus(text) {
  if (dom.statusValue) dom.statusValue.textContent = text;
  const ticker = document.getElementById("tabletTicker");
  if (ticker && cleanText(text)) ticker.textContent = text;
}

function closeOverlay(overlay) {
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
}

function openOverlay(overlay) {
  if (!overlay) return;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}

function populateTeamSelect() {
  if (!dom.teamSelect) return;
  dom.teamSelect.innerHTML = NFL_TEAMS.map(team => `<option value="${team.code}">${escapeHtml(TEAM_THEME_META[team.code]?.label || team.code)}</option>`).join("");
  dom.teamSelect.value = state.selectedTeam;
}

function populateOpponentSelect() {
  if (!dom.opponentSelect) return;
  dom.opponentSelect.innerHTML = NFL_TEAMS.map(team => `<option value="${team.code}">${escapeHtml(TEAM_THEME_META[team.code]?.label || team.code)}</option>`).join("");
  dom.opponentSelect.value = normalizeOpponentTeam(state.selectedOpponent) || NFL_TEAMS.find(team => team.code !== state.selectedTeam)?.code || "DAL";
  state.selectedOpponent = dom.opponentSelect.value;
}

function updateMaddenVersionPillButtons(activeVersion) {
  const ver = String(activeVersion || "M27").toUpperCase() === "M26" ? "M26" : "M27";
  state.maddenVersion = ver;
  if (dom.maddenVersionSelect) dom.maddenVersionSelect.value = ver;
  if (!dom.matchupMaddenVersionGroup) return;
  dom.matchupMaddenVersionGroup.querySelectorAll("button[data-madden-version]").forEach(button => {
    const v = button.getAttribute("data-madden-version");
    button.classList.toggle("is-active", v === ver);
  });
}

function updateOpponentContextPills(context) {
  const next = normalizeOpponentContext(context);
  state.opponentContext = next;
  dom.matchupOpponentContextGroup?.querySelectorAll("button[data-opponent-context]").forEach(button => {
    button.classList.toggle("is-active", button.getAttribute("data-opponent-context") === next);
  });
}

function setOpponentContext(context) {
  const next = normalizeOpponentContext(context);
  if (next === state.opponentContext) {
    updateOpponentContextPills(next);
    return;
  }
  updateOpponentContextPills(next);
  savePreferences(true);
  recordTraceEvent("opponent-context-change", {
    at: new Date().toISOString(),
    opponentContext: next,
    opponent: normalizeOpponentTeam(state.selectedOpponent) || null,
  });
  setStatus(next === "human"
    ? "Tendencies for this opponent are kept separate from CPU games."
    : "Tendencies for this opponent use the CPU profile.");
}

function populateMatchupModal() {
  if (dom.matchupTeamSelect) {
    dom.matchupTeamSelect.innerHTML = NFL_TEAMS.map(team => `<option value="${team.code}">${escapeHtml(TEAM_THEME_META[team.code]?.label || team.code)}</option>`).join("");
    dom.matchupTeamSelect.value = state.selectedTeam;
  }
  if (dom.matchupOpponentSelect) {
    dom.matchupOpponentSelect.innerHTML = NFL_TEAMS.map(team => `<option value="${team.code}">${escapeHtml(TEAM_THEME_META[team.code]?.label || team.code)}</option>`).join("");
    dom.matchupOpponentSelect.value = normalizeOpponentTeam(state.selectedOpponent) || NFL_TEAMS.find(team => team.code !== state.selectedTeam)?.code || "DAL";
  }
  updateMaddenVersionPillButtons(state.maddenVersion || "M27");
  updateOpponentContextPills(state.opponentContext);
}

function openScriptBuilder() {
  if (state.scriptBuilderPurpose !== "new-game") {
    const live = (ensureTabletSession().scriptIds || []).slice(0, 15);
    state.customScriptPlays = live.slice();
    state.scriptOfferIds = live.slice();
    state.customScriptLockedIndexes = [];
    state.scriptBuilderPurpose = "edit";
  }
  state.customScriptSearch = "";
  if (dom.scriptSearchInput) dom.scriptSearchInput.value = "";
  ensureActivePlan();
  renderScriptBuilder();
  if (dom.scriptBuilderOverlay) openOverlay(dom.scriptBuilderOverlay);
}

function dismissScriptBuilder() {
  if (state.scriptBuilderPurpose === "new-game") {
    const ids = (state.customScriptPlays || []).slice(0, 15);
    state.customScriptPlays = ids.slice();
    state.customScriptIndex = 0;
    state.customScriptActive = ids.length > 0;
    const session = ensureTabletSession();
    session.scriptIds = ids.slice();
    session.scriptIndex = 0;
    state.tabletSession = session;
  } else {
    state.customScriptPlays = (state.scriptOfferIds || []).slice();
    state.customScriptActive = state.customScriptPlays.length > 0;
  }
  state.scriptBuilderPurpose = "";
  persistActivePlan();
  if (dom.scriptBuilderOverlay) closeOverlay(dom.scriptBuilderOverlay);
  render();
}

function commitScriptBuilder() {
  const ids = (state.customScriptPlays || []).slice(0, 15);
  state.customScriptPlays = ids.slice();
  const session = ensureTabletSession();
  const changed = ids.join("|") !== (session.scriptIds || []).join("|");
  session.scriptIds = ids.slice();
  if (state.scriptBuilderPurpose === "new-game" || changed) session.scriptIndex = 0;
  else if (session.scriptIndex > ids.length) session.scriptIndex = ids.length;
  state.customScriptIndex = session.scriptIndex;
  state.customScriptActive = ids.length > 0;
  state.tabletSession = session;
  state.scriptBuilderPurpose = "";
  persistActivePlan();
  if (ids.length >= 10) {
    const existing = (state.recentRunScripts || []).filter(s => Array.isArray(s) && s.length && s.join("|") !== ids.join("|"));
    state.recentRunScripts = [...existing, ids.slice()].slice(-2);
    saveRecentRunScripts();
  }
  if (dom.scriptBuilderOverlay) closeOverlay(dom.scriptBuilderOverlay);
  render();
}

function closeScriptBuilder() {
  dismissScriptBuilder();
}

function addPlayToScript(playId) {
  if (!playId) return;
  const play = (state.normalizedPlays || []).find(item => item && item.id === playId);
  if (play && isGoalLinePlay(play)) {
    setStatus("Goal Line plays stay on the Goal Line card.");
    return;
  }
  if (state.customScriptPlays.length >= 15) {
    setStatus("Opening script reached maximum of 15 plays.");
    return;
  }
  state.customScriptPlays.push(playId);
  state.customScriptLoggedToHistory = false;
  persistActivePlan();
  renderScriptBuilder();
}

function removePlayFromScript(index) {
  if (index < 0 || index >= state.customScriptPlays.length) return;
  state.customScriptPlays.splice(index, 1);
  state.customScriptLockedIndexes = (state.customScriptLockedIndexes || [])
    .filter(slot => slot !== index)
    .map(slot => slot > index ? slot - 1 : slot);
  if (state.customScriptIndex >= state.customScriptPlays.length) {
    state.customScriptIndex = Math.max(0, state.customScriptPlays.length - 1);
  }
  state.customScriptLoggedToHistory = false;
  persistActivePlan();
  renderScriptBuilder();
}

function moveScriptPlay(index, direction) {
  const target = index + direction;
  if (index < 0 || index >= state.customScriptPlays.length || target < 0 || target >= state.customScriptPlays.length) return;
  const temp = state.customScriptPlays[index];
  state.customScriptPlays[index] = state.customScriptPlays[target];
  state.customScriptPlays[target] = temp;
  const locks = new Set(state.customScriptLockedIndexes || []);
  const fromLocked = locks.has(index);
  const toLocked = locks.has(target);
  locks.delete(index);
  locks.delete(target);
  if (fromLocked) locks.add(target);
  if (toLocked) locks.add(index);
  state.customScriptLockedIndexes = [...locks].sort((a, b) => a - b);
  persistActivePlan();
  renderScriptBuilder();
}

function clearScript() {
  state.customScriptPlays = [];
  state.customScriptIndex = 0;
  state.customScriptActive = false;
  state.customScriptLockedIndexes = [];
  state.customScriptLoggedToHistory = false;
  persistActivePlan();
  renderScriptBuilder();
}

function isEarlyDownScriptSituation(situationKey) {
  return OpeningScript.isEarlyDownScriptSituation ? OpeningScript.isEarlyDownScriptSituation(situationKey) : false;
}

function openingScriptOpponentShell(userLearning, opponent) {
  if (!OpeningScript.openingScriptOpponentShell) return null;
  return OpeningScript.openingScriptOpponentShell(getOpponentScoutingProfile(userLearning, opponent));
}

function openingScriptPlayScore(play, shell) {
  if (!OpeningScript.openingScriptPlayScore) return 0;
  return OpeningScript.openingScriptPlayScore(play, shell, {
    coverageMatchupScore,
    coverageLearning: (item, defense) => {
      const coverageStat = state.userLearning?.coverageOutcomes?.byDefense?.[defense]?.families?.[familyOf(item)];
      return personalLearningComponent(coverageStat, 2, 1.05, 1.35);
    },
    personalLearningFromSituation,
    learningSituations: state.userLearning?.byLearningSituation || {},
    teamKey: cleanText(state.selectedTeam).toLowerCase() || "unknown",
    globalLearning: state.userLearning?.global || null,
  });
}

function generateOpeningScriptIds(existingPlayIds, lockedIndexes) {
  const teamPlays = state.normalizedPlays.filter(play => play.team === state.selectedTeam && !isHailMaryPlay(play));
  if (!teamPlays.length || !OpeningScript.fillOpeningScript) return (existingPlayIds || []).slice(0, 15);
  const liveShell = openingScriptOpponentShell(state.userLearning, state.selectedOpponent);
  const scoutProfile = DefensiveScout.getScoutProfile ? DefensiveScout.getScoutProfile(state.selectedOpponent) : null;
  const opponentShell = liveShell || (scoutProfile && DefensiveScout.scoutShellDistribution ? DefensiveScout.scoutShellDistribution(scoutProfile) : null);
  const tendencyProfile = currentOpponentProfile();
  const tendencyPlan = Tendency.scriptSlotPlan ? Tendency.scriptSlotPlan(tendencyProfile) : { slotFamilies: [], slotCells: [] };
  const filled = OpeningScript.fillOpeningScript({
    plays: teamPlays,
    familyOf,
    cooldownIds: [
      ...(state.recentRunScripts || []).flat(),
      ...((existingPlayIds || []).filter((id, idx) => id && !(new Set(lockedIndexes || [])).has(idx))),
    ].filter(Boolean),
    shell: opponentShell,
    setupPayoff: SETUP_PAYOFF,
    random: Math.random,
    existingPlayIds: existingPlayIds || [],
    lockedIndexes: lockedIndexes || [],
    playScore: openingScriptPlayScore,
    slotFamilies: tendencyPlan.slotFamilies,
    tendencyPlayScore: (play, slot) => {
      let boost = 0;
      if (scoutProfile && DefensiveScout.scorePlayAgainstScout) {
        boost += DefensiveScout.scorePlayAgainstScout(play, scoutProfile, slot);
      }
      if (Tendency.playResultBoost) {
        boost += Tendency.playResultBoost(tendencyProfile, tendencyPlan.slotCells[slot], play && play.id);
      }
      return boost;
    },
  });
  return (filled.playIds || []).slice(0, 15);
}

function autoFillScript() {
  const before = state.customScriptPlays.slice();
  const filled = generateOpeningScriptIds(before, state.customScriptLockedIndexes || []);
  if (!filled.length) return;
  state.customScriptPlays = filled;
  state.customScriptIndex = 0;
  state.customScriptActive = true;
  state.customScriptLoggedToHistory = false;
  persistActivePlan();
  const opponentCode = normalizeOpponentTeam(state.selectedOpponent);
  const tendencyProfile = currentOpponentProfile();
  const liveShell = openingScriptOpponentShell(state.userLearning, state.selectedOpponent);
  const scoutProfile = DefensiveScout.getScoutProfile ? DefensiveScout.getScoutProfile(state.selectedOpponent) : null;
  const tendencyCell = tendencyProfile && Tendency.readiness ? Tendency.readiness(tendencyProfile.cells.early_down) : null;
  setStatus(tendencyCell && tendencyCell.ready && opponentCode
    ? `Opening script fitted to ${opponentCode} ${tendencyCell.primary} on early downs (${tendencyCell.total} snaps).`
    : liveShell && opponentCode
    ? `Opening script fitted to ${opponentCode} early-down looks (${liveShell.observations} logged).`
    : scoutProfile && opponentCode
    ? `Opening script scouted vs ${opponentCode} (${scoutProfile.identity} • ${scoutProfile.coverageShell}).`
    : "Opening script filled from the standard 15-play sequence.");
  renderScriptBuilder();
}

function toggleScriptActive() {
  state.customScriptActive = !state.customScriptActive;
  persistActivePlan();
  renderScriptBuilder();
}

function currentPlanKey() {
  return Gameplan.planKey
    ? Gameplan.planKey(state.maddenVersion, state.selectedTeam, state.selectedOpponent)
    : `${state.maddenVersion || "M27"}|${cleanText(state.selectedTeam).toUpperCase()}|${cleanText(state.selectedOpponent).toUpperCase()}`;
}

function loadGameplansFromStorage() {
  state.gameplans = state.gameplans || {};
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.gameplans) || "{}");
    if (!raw || typeof raw !== "object") return;
    Object.keys(raw).forEach(key => {
      state.gameplans[key] = Gameplan.normalizePlan ? Gameplan.normalizePlan(raw[key]) : raw[key];
    });
  } catch (_e) {}
}

function saveGameplans() {
  try {
    const payload = {};
    Object.keys(state.gameplans || {}).forEach(key => {
      payload[key] = Gameplan.normalizePlan ? Gameplan.normalizePlan(state.gameplans[key]) : state.gameplans[key];
    });
    localStorage.setItem(STORAGE_KEYS.gameplans, JSON.stringify(payload));
  } catch (_e) {}
}

function ensureActivePlan() {
  const key = currentPlanKey();
  if (!key) return null;
  if (!state.gameplans[key]) {
    state.gameplans[key] = Gameplan.createPlan
      ? Gameplan.createPlan({ maddenEdition: state.maddenVersion, team: state.selectedTeam, opponent: state.selectedOpponent })
      : {
          maddenEdition: state.maddenVersion === "M26" ? "M26" : "M27",
          team: cleanText(state.selectedTeam).toUpperCase(),
          opponent: cleanText(state.selectedOpponent).toUpperCase(),
          context: "any",
          openingScript: { playIds: [], lockedIndexes: [], active: false },
          offense: {},
        };
  }
  state.activeGameplan = state.gameplans[key];
  return state.activeGameplan;
}

function persistActivePlan() {
  const plan = ensureActivePlan();
  if (!plan) return;
  plan.openingScript = {
    playIds: (state.customScriptPlays || []).slice(0, 15),
    lockedIndexes: (state.customScriptLockedIndexes || []).slice(),
    active: state.customScriptActive === true,
  };
  plan.maddenEdition = state.maddenVersion === "M26" ? "M26" : "M27";
  plan.team = cleanText(state.selectedTeam).toUpperCase();
  plan.opponent = cleanText(state.selectedOpponent).toUpperCase();
  plan.context = "any";
  state.gameplans[currentPlanKey()] = plan;
  state.activeGameplan = plan;
  saveGameplans();
}

function applyPlanToSession(plan) {
  if (!plan) return;
  const next = Gameplan.normalizePlan ? Gameplan.normalizePlan(plan) : plan;
  const key = currentPlanKey();
  if (key) state.gameplans[key] = next;
  state.activeGameplan = next;
  const opening = next.openingScript || { playIds: [], lockedIndexes: [], active: false };
  state.customScriptPlays = (opening.playIds || []).slice(0, 15);
  state.customScriptLockedIndexes = (opening.lockedIndexes || []).slice();
  state.customScriptActive = opening.active === true;
  state.customScriptIndex = 0;
  state.customScriptLoggedToHistory = false;
}

function loadMatchupPlan() {
  const key = currentPlanKey();
  if (!key) return;
  const fallback = Gameplan.createPlan
    ? Gameplan.createPlan({ maddenEdition: state.maddenVersion, team: state.selectedTeam, opponent: state.selectedOpponent })
    : {
        maddenEdition: state.maddenVersion === "M26" ? "M26" : "M27",
        team: cleanText(state.selectedTeam).toUpperCase(),
        opponent: cleanText(state.selectedOpponent).toUpperCase(),
        context: "any",
        openingScript: { playIds: [], lockedIndexes: [], active: false },
        offense: {},
      };
  applyPlanToSession(state.gameplans[key] || fallback);
}

function resetScriptCursor() {
  persistActivePlan();
  state.customScriptIndex = 0;
  state.customScriptLoggedToHistory = false;
  if (state.activeGameplan) applyPlanToSession(state.activeGameplan);
}

function teamBookPlays() {
  return state.normalizedPlays.filter(play => play.team === state.selectedTeam && !isHailMaryPlay(play));
}

function maddenCallLabel(play) {
  return [cleanText(play?.formation), cleanText(play?.set), cleanText(play?.play_name)]
    .filter(Boolean)
    .map(part => part.toUpperCase())
    .join(" · ");
}

function playNavigatorDetail(play) {
  const concepts = Array.isArray(play.concepts) ? play.concepts.filter(Boolean).join(", ") : "";
  const strong = Array.isArray(play.strong_vs) ? play.strong_vs.filter(Boolean).join(", ") : "";
  return [cleanText(play.type), concepts, strong ? `strong vs ${strong}` : ""].filter(Boolean).join(" · ");
}

function navigatorPlayRow(play) {
  const full = state.customScriptPlays.length >= 15;
  return `<div class="scriptPlayRow"><div class="scriptPlayRowLeft"><span class="scriptPlayRowTitle">${escapeHtml(maddenCallLabel(play))}</span><span class="scriptPlayRowMeta">${escapeHtml(playNavigatorDetail(play))}</span></div><div class="scriptQueueActions"><button class="scriptAddBtn" type="button" data-play-id="${escapeHtml(play.id)}" ${full ? "disabled" : ""}>+ Add</button></div></div>`;
}

function renderNavigator(teamPlays) {
  if (!dom.scriptPlaybookList) return;
  const query = cleanText(state.customScriptSearch).toLowerCase();
  if (query) {
    const matches = teamPlays.filter(play => {
      const name = cleanText(play.play_name).toLowerCase();
      const form = cleanText(play.formation).toLowerCase();
      const setLabel = cleanText(play.set).toLowerCase();
      const concepts = Array.isArray(play.concepts) ? play.concepts.join(" ").toLowerCase() : "";
      return name.includes(query) || form.includes(query) || setLabel.includes(query) || concepts.includes(query);
    }).slice(0, 40);
    if (!matches.length) {
      dom.scriptPlaybookList.innerHTML = `<div class="recPlaceholderCopy">No plays match "${escapeHtml(state.customScriptSearch)}".</div>`;
      return;
    }
    const groups = [];
    const seen = new Map();
    matches.forEach(play => {
      const key = `${cleanText(play.formation)}|${cleanText(play.set)}`;
      if (!seen.has(key)) {
        const group = { formation: play.formation, set: play.set, plays: [] };
        seen.set(key, group);
        groups.push(group);
      }
      seen.get(key).plays.push(play);
    });
    dom.scriptPlaybookList.innerHTML = groups.map(group => `<div class="navGroup"><div class="navGroupTitle">${escapeHtml(cleanText(group.formation).toUpperCase() || "FORMATION")} · ${escapeHtml(cleanText(group.set).toUpperCase() || "BASE")}</div>${group.plays.map(navigatorPlayRow).join("")}</div>`).join("");
    return;
  }
  if (!state.navigatorFormation) {
    const counts = new Map();
    teamPlays.forEach(play => {
      const formation = cleanText(play.formation) || "Unknown";
      counts.set(formation, (counts.get(formation) || 0) + 1);
    });
    const names = [...counts.keys()].sort((a, b) => a.localeCompare(b));
    dom.scriptPlaybookList.innerHTML = names.map(name => `<button class="navChoice" type="button" data-nav-formation="${escapeHtml(name)}"><span>${escapeHtml(name.toUpperCase())}</span><span class="navCount">${counts.get(name)}</span></button>`).join("") || '<div class="recPlaceholderCopy">No offensive plays loaded.</div>';
    return;
  }
  if (!state.navigatorSet) {
    const counts = new Map();
    teamPlays.filter(play => cleanText(play.formation) === state.navigatorFormation).forEach(play => {
      const setName = cleanText(play.set) || "Base";
      counts.set(setName, (counts.get(setName) || 0) + 1);
    });
    const names = [...counts.keys()].sort((a, b) => a.localeCompare(b));
    dom.scriptPlaybookList.innerHTML = `<button class="navBack" type="button" data-nav-back="formation">All formations</button>${names.map(name => `<button class="navChoice" type="button" data-nav-set="${escapeHtml(name)}"><span>${escapeHtml(name.toUpperCase())}</span><span class="navCount">${counts.get(name)}</span></button>`).join("")}`;
    return;
  }
  const plays = teamPlays.filter(play => cleanText(play.formation) === state.navigatorFormation && (cleanText(play.set) || "Base") === state.navigatorSet);
  dom.scriptPlaybookList.innerHTML = `<button class="navBack" type="button" data-nav-back="set">${escapeHtml(state.navigatorFormation.toUpperCase())}</button>${plays.map(navigatorPlayRow).join("")}`;
}

function currentCallStyle() {
  const session = state.tabletSession;
  return SituationBoard.normalizeCallStyle ? SituationBoard.normalizeCallStyle(session && session.callStyle) : "default";
}

function syncCallStyleSelect() {
  const select = document.getElementById("callStyleSelect");
  if (!select || !SituationBoard.CALL_STYLES) return;
  if (select.options.length !== SituationBoard.CALL_STYLES.length) {
    select.innerHTML = SituationBoard.CALL_STYLES.map(style => `<option value="${escapeHtml(style.id)}">${escapeHtml(style.label)}</option>`).join("");
  }
  const active = currentCallStyle();
  if (select.value !== active) select.value = active;
}

function selectCallStyle(styleId) {
  if (!SituationBoard.normalizeCallStyle || !TabletSession.applyCallStyle) return;
  const next = SituationBoard.normalizeCallStyle(styleId);
  if (next === currentCallStyle()) return;
  const session = ensureTabletSession();
  state.tabletSession = TabletSession.applyCallStyle(session, next, {
    board: SituationBoard,
    offensePlays: tabletPlays("oc"),
    familyOf,
    situationFamiliesOf,
    deferIds: tabletDeferIds(),
  });
  const label = SituationBoard.callStyleLabel ? SituationBoard.callStyleLabel(next) : next;
  setStatus(next === "default"
    ? "Play-call style is Default. Cards that still fit stay put; the rest reshuffle without putting this game's already-shown plays first. You can switch again any time."
    : `Play-call style is ${label}. Cards that still fit stay put; the rest reshuffle for that style without wiping this game's variety memory. Goal Line stays. Switch whenever you want.`);
  render();
  renderScriptBuilder();
}

function renderCallSheet() {
  if (!dom.gameplanSheet) return;
  const styles = SituationBoard.CALL_STYLES || [];
  const active = currentCallStyle();
  dom.gameplanSheet.innerHTML = `<p class="callSheetFillHint">Pick a play-call style before the game or at any point during it. Cards that still fit stay put; the rest reshuffle for that style without wiping this game's variety memory. Goal Line always stays. You can change this as often as you want.</p><div class="callStyleList">${styles.map(style => {
    const on = style.id === active;
    return `<button class="callStyleBtn${on ? " is-active" : ""}" type="button" data-call-style="${escapeHtml(style.id)}" aria-pressed="${on ? "true" : "false"}">${escapeHtml(style.label)}</button>`;
  }).join("")}</div>`;
}

function setGameplanTab(tab) {
  state.gameplanTab = tab === "sheet" ? "sheet" : "script";
  renderScriptBuilder();
}

function toggleScriptSlotLock(index) {
  if (index < 0 || index >= state.customScriptPlays.length) return;
  const locks = new Set(state.customScriptLockedIndexes || []);
  if (locks.has(index)) locks.delete(index);
  else locks.add(index);
  state.customScriptLockedIndexes = [...locks].sort((a, b) => a - b);
  persistActivePlan();
  renderScriptBuilder();
}

function renderScriptBuilder() {
  if (!dom.scriptBuilderOverlay) return;
  const teamPlays = state.normalizedPlays.filter(play => play.team === state.selectedTeam && !isHailMaryPlay(play));
  const count = state.customScriptPlays.length;
  if (dom.scriptCountBadge) {
    dom.scriptCountBadge.textContent = count + " / 15 Plays";
    dom.scriptCountBadge.classList.toggle("is-full", count >= 15);
  }
  const sheetTab = state.gameplanTab === "sheet";
  if (dom.gameplanTabScript) dom.gameplanTabScript.classList.toggle("is-active", !sheetTab);
  if (dom.gameplanTabSheet) dom.gameplanTabSheet.classList.toggle("is-active", sheetTab);
  if (dom.scriptQueueCol) dom.scriptQueueCol.classList.toggle("hidden", sheetTab);
  if (dom.gameplanSheet) dom.gameplanSheet.classList.toggle("hidden", !sheetTab);
  renderNavigator(teamPlays);
  renderCallSheet(teamPlays);
  if (dom.scriptQueueList) {
    if (!count) {
      dom.scriptQueueList.innerHTML = '<div class="recPlaceholderCopy">No plays in script yet. Pick from the playbook on the left or tap "Auto-Fill 15" for a balanced opening script.</div>';
    } else {
      const playMap = new Map(state.normalizedPlays.map(p => [p.id, p]));
      const locks = new Set(state.customScriptLockedIndexes || []);
      dom.scriptQueueList.innerHTML = state.customScriptPlays.map((playId, index) => {
        const play = playMap.get(playId);
        const name = play ? maddenCallLabel(play) : playId;
        const meta = play ? cleanText(play.type).toUpperCase() : "Unavailable";
        const nextIndex = state.scriptBuilderPurpose === "new-game" ? 0 : (ensureTabletSession().scriptIndex || 0);
        const isCurrent = index === nextIndex;
        const locked = locks.has(index);
        return '<div class="scriptQueueRow' + (isCurrent ? ' is-current' : '') + '">' +
          '<span class="scriptQueueIndex">#' + (index + 1) + '</span>' +
          '<div class="scriptPlayRowLeft">' +
            '<span class="scriptPlayRowTitle">' + escapeHtml(name) + '</span>' +
            '<span class="scriptPlayRowMeta">' + escapeHtml(meta) + (locked ? ' · LOCKED' : '') + (isCurrent ? ' · NEXT UP' : '') + '</span>' +
          '</div>' +
          '<div class="scriptQueueActions">' +
            '<button class="scriptIconBtn' + (locked ? ' is-locked' : '') + '" type="button" data-action="toggle-lock" data-index="' + index + '" title="Lock slot">' + (locked ? 'Locked' : 'Lock') + '</button>' +
            '<button class="scriptIconBtn" type="button" data-action="move-up" data-index="' + index + '" ' + (index === 0 ? 'disabled' : '') + ' title="Move Up">▲</button>' +
            '<button class="scriptIconBtn" type="button" data-action="move-down" data-index="' + index + '" ' + (index === count - 1 ? 'disabled' : '') + ' title="Move Down">▼</button>' +
            '<button class="scriptIconBtn delete" type="button" data-action="remove-play" data-index="' + index + '" title="Remove">✕</button>' +
          '</div>' +
        '</div>';
      }).join("");
    }
  }
}

async function showMatchupModal() {
  populateMatchupModal();
  if (dom.matchupOverlay) {
    dom.matchupOverlay.classList.remove("hidden");
    dom.matchupOverlay.setAttribute("aria-hidden", "false");
  }
}

function closeMatchupModal() {
  if (dom.matchupOverlay) {
    dom.matchupOverlay.classList.add("hidden");
    dom.matchupOverlay.setAttribute("aria-hidden", "true");
  }
}

async function reloadPlaysForVersion(targetVersion) {
  const ver = String(targetVersion || state.maddenVersion || "M27").toUpperCase() === "M26" ? "M26" : "M27";
  state.maddenVersion = ver;
  updateMaddenVersionPillButtons(ver);
  setStatus(`Loading ${ver === "M27" ? "Madden 27" : "Madden 26"} playbooks...`);
  try {
    const plays = await window.desktopApi.loadPlays(ver);
    state.normalizedPlays = Array.isArray(plays) ? plays.map(normalizeImportedPlay) : [];
    try {
      const defensive = window.desktopApi.loadDefensivePlays ? await window.desktopApi.loadDefensivePlays(ver) : [];
      state.normalizedDefensivePlays = Array.isArray(defensive) ? defensive.map(normalizeImportedDefensivePlay) : [];
    } catch (_err) {
      state.normalizedDefensivePlays = [];
    }
    if (!state.normalizedPlays.some(play => play.team === state.selectedTeam)) {
      state.selectedTeam = state.normalizedPlays[0]?.team || "CHI";
    }
    if (dom.teamSelect) dom.teamSelect.value = state.selectedTeam;
    if (dom.matchupTeamSelect) dom.matchupTeamSelect.value = state.selectedTeam;
    populateOpponentSelect();
    loadMatchupPlan();
    savePreferences(true);
    render();
    setStatus("Ready");
    recordTraceEvent("madden-version-change", { at: new Date().toISOString(), version: ver, team: state.selectedTeam });
  } catch (error) {
    setStatus(`Could not load ${ver} plays: ${cleanText(error?.message || error)}`);
  }
}

async function confirmMatchupModal() {
  persistActivePlan();
  const nextTeam = dom.matchupTeamSelect?.value || state.selectedTeam;
  let nextOpp = dom.matchupOpponentSelect?.value || state.selectedOpponent;
  if (nextTeam === nextOpp) {
    nextOpp = NFL_TEAMS.find(t => t.code !== nextTeam)?.code || "DAL";
  }
  state.selectedTeam = nextTeam;
  state.selectedOpponent = nextOpp;
  state.themeTeam = nextTeam;
  if (dom.teamSelect) dom.teamSelect.value = nextTeam;
  if (dom.opponentSelect) dom.opponentSelect.value = nextOpp;
  if (dom.themeSelect) dom.themeSelect.value = nextTeam;
  savePreferences(true);

  await reloadPlaysForVersion(state.maddenVersion || "M27");
  applyTheme(state.themeTeam);

  closeMatchupModal();
  if (document.getElementById("tabletRoot")) startTabletGame();
  else render();
  setStatus(`Matchup ready (${state.maddenVersion || "M27"}): ${TEAM_THEME_META[state.selectedTeam]?.label || state.selectedTeam} vs ${formatOpponentLabel(state.selectedOpponent)}`);
  recordTraceEvent("matchup-setup-confirmed", {
    at: new Date().toISOString(),
    team: state.selectedTeam,
    opponent: state.selectedOpponent,
    maddenVersion: state.maddenVersion || "M27",
  });
}

function populateThemeSelect() {
  if (!dom.themeSelect) return;
  dom.themeSelect.innerHTML = [{ code: "NFL" }, ...NFL_TEAMS]
    .map(option => `<option value="${option.code}">${escapeHtml(TEAM_THEME_META[option.code]?.label || option.code)}</option>`)
    .join("");
  dom.themeSelect.value = state.themeTeam;
}

function persistThemeSelection(nextThemeTeam) {
  const normalized = cleanText(nextThemeTeam).toUpperCase();
  const allowed = new Set(["NFL", ...NFL_TEAMS.map(team => team.code)]);
  state.themeTeam = allowed.has(normalized) ? normalized : "NFL";
  if (dom.themeSelect) dom.themeSelect.value = state.themeTeam;
  applyTheme(state.themeTeam);
  savePreferences(true);
  render();
}

function openSettings() {
  openOverlay(dom.settingsOverlay);
}

function onPressNewDrive() {
  showMatchupModal();
}

function emptyResultLabels() {
  if (ResultLabels.emptyStore) return ResultLabels.emptyStore();
  if (ResultLabels.normalizeStore) return ResultLabels.normalizeStore({});
  return { plays: {}, looks: {}, concepts: {} };
}

function clearStoredResultLabels() {
  state.resultLabels = emptyResultLabels();
  try {
    localStorage.removeItem(STORAGE_KEYS.resultLabels);
  } catch (_e) {}
}

function loadResultLabels() {
  clearStoredResultLabels();
}

function saveResultLabels() {
  try {
    localStorage.removeItem(STORAGE_KEYS.resultLabels);
  } catch (_e) {}
}

function tabletPlays(side) {
  const book = side === "dc" ? state.normalizedDefensivePlays : state.normalizedPlays;
  return (book || []).filter(play => play && play.team === state.selectedTeam);
}

function tabletIdentityFamilies() {
  return {};
}

function tabletCooldownIds() {
  const ids = [];
  (state.recentRunScripts || []).forEach(script => {
    (Array.isArray(script) ? script : []).forEach(id => {
      if (id) ids.push(id);
    });
  });
  return ids;
}

function ensureTabletSession() {
  if (!state.tabletSession || !TabletSession.createSession) {
    state.tabletSession = TabletSession.createSession
      ? TabletSession.createSession()
      : { ocBoard: {}, dcBoard: {}, scriptIds: [], scriptIndex: 0, highlighted: [], lastCaptureText: "" };
  }
  if (!state.resultLabels) {
    state.resultLabels = ResultLabels.emptyStore ? ResultLabels.emptyStore() : { plays: {}, looks: {}, concepts: {} };
  }
  return state.tabletSession;
}

function startTabletGame() {
  const previous = state.tabletSession;
  if (previous && Array.isArray(previous.scriptIds) && previous.scriptIds.length) {
    const prevIds = previous.scriptIds.slice(0, 15);
    const existing = (state.recentRunScripts || []).filter(s => Array.isArray(s) && s.length && s.join("|") !== prevIds.join("|"));
    state.recentRunScripts = [...existing, prevIds].slice(-2);
    saveRecentRunScripts();
  }
  rememberBoardPlaysFromSession(previous);
  state.gameStarted = true;
  clearStoredResultLabels();
  state.tabletSession = TabletSession.startGame
    ? TabletSession.startGame(TabletSession.createSession(), {
        board: SituationBoard,
        opening: OpeningScript,
        offensePlays: tabletPlays("oc"),
        defensePlays: tabletPlays("dc"),
        familyOf,
        situationFamiliesOf,
        identityFamilies: tabletIdentityFamilies(),
        cooldownIds: tabletCooldownIds(),
        deferIds: tabletDeferIds(),
        setupPayoff: SETUP_PAYOFF,
      })
    : ensureTabletSession();
  state.customScriptPlays = [];
  state.customScriptLockedIndexes = [];
  state.customScriptIndex = 0;
  state.customScriptActive = false;
  state.customScriptLoggedToHistory = false;
  state.scriptOfferIds = [];
  state.scriptBuilderPurpose = "new-game";
  state.tabletSession.scriptIds = [];
  state.tabletSession.scriptIndex = 0;
  persistActivePlan();
  render();
  openScriptBuilder();
}

function confirmTabletSlot(slotId) {
  const session = ensureTabletSession();
  const side = "oc";
  if (!TabletSession.confirmSlot) return;
  state.tabletSession = TabletSession.confirmSlot(session, slotId, {
    board: SituationBoard,
    offensePlays: tabletPlays("oc"),
    defensePlays: tabletPlays("dc"),
    familyOf,
    situationFamiliesOf,
    identityFamilies: tabletIdentityFamilies(),
    side,
  });
  render();
}

function confirmTabletScript() {
  const session = ensureTabletSession();
  if (!TabletSession.confirmScript) return;
  state.tabletSession = TabletSession.confirmScript(session);
  if (state.customScriptActive && state.customScriptPlays.length) {
    state.customScriptIndex = state.tabletSession.scriptIndex;
  }
  render();
}

function syncTabletOpeningScript() {
  if (!(state.customScriptActive && Array.isArray(state.customScriptPlays) && state.customScriptPlays.length)) return;
  const session = ensureTabletSession();
  session.scriptIds = state.customScriptPlays.slice(0, 15);
  if (session.scriptIndex > session.scriptIds.length) session.scriptIndex = session.scriptIds.length;
  state.customScriptIndex = session.scriptIndex;
  state.tabletSession = session;
}

function onTabletClick(event) {
  const slot = event.target.closest("[data-confirm-slot]");
  if (slot) {
    confirmTabletSlot(slot.getAttribute("data-confirm-slot"));
    return;
  }
  if (event.target.closest("[data-confirm-script]")) confirmTabletScript();
}

function renderTablet() {
  const root = document.getElementById("tabletRoot");
  if (!root) return;
  const session = ensureTabletSession();
  const side = "oc";
  const slots = SituationBoard.slotsFor ? SituationBoard.slotsFor(side) : [];
  const board = session.ocBoard || {};
  const opponent = normalizeOpponentTeam(state.selectedOpponent);
  const context = state.opponentContext === "human" ? "human" : "cpu";
  const scriptHost = document.getElementById("tabletScript");
  if (scriptHost) {
    scriptHost.classList.remove("is-hidden");
    const scriptId = session.scriptIds && session.scriptIds[session.scriptIndex];
    const scriptPlay = scriptId ? (state.normalizedPlays || []).find(play => play.id === scriptId) : null;
    if (!session.scriptIds || !session.scriptIds.length) {
      scriptHost.innerHTML = '<div class="tabletScriptEmpty">No opening script set. Tap Script builder or Auto-Fill 15 to begin.</div>';
    } else if (!scriptPlay) {
      scriptHost.innerHTML = '<div class="tabletScriptEmpty">Opening script complete.</div>';
    } else {
      const rate = ResultLabels.rateFor ? ResultLabels.rateFor(state.resultLabels, { opponent, context, slotId: "opening_script", playId: scriptPlay.id }) : null;
      const reason = ResultLabels.reasonFor ? ResultLabels.reasonFor(state.resultLabels, {
        opponent,
        context,
        slotId: "opening_script",
        family: familyOf(scriptPlay),
        familyLabel: familyOf(scriptPlay).replace(/_/g, " "),
        generalReason: "Opening script.",
        lookSide: "defense",
      }) : "";
      scriptHost.innerHTML =
        '<div class="tabletScriptKicker">Opening script ' + escapeHtml(String(session.scriptIndex + 1)) + ' / ' + escapeHtml(String((session.scriptIds || []).length || 15)) + '</div>' +
        '<div class="tabletScriptCall">' +
          '<div class="tabletScriptPath">' + escapeHtml(cleanText(scriptPlay.formation).toUpperCase()) + '</div>' +
          (cleanText(scriptPlay.set) ? '<div class="tabletScriptPath">' + escapeHtml(cleanText(scriptPlay.set).toUpperCase()) + '</div>' : '') +
          '<div class="tabletScriptPlay">' + escapeHtml(cleanText(scriptPlay.play_name).toUpperCase()) + '</div>' +
        '</div>' +
        '<div class="tabletScriptMeta"><span>' + escapeHtml(rate ? rate.percent + "%" : "") + '</span><span>' + escapeHtml(reason) + '</span></div>' +
        '<button class="tabletRan" type="button" data-confirm-script="1">Ran it</button>';
    }
  }
  const grid = document.getElementById("tabletGrid");
  if (grid) {
    const highlighted = new Set(session.highlighted || []);
    grid.innerHTML = slots.map(slot => {
      const play = board[slot.id];
      const rate = play && ResultLabels.rateFor ? ResultLabels.rateFor(state.resultLabels, { opponent, context, slotId: slot.id, playId: play.id }) : null;
      const reason = ResultLabels.reasonFor ? ResultLabels.reasonFor(state.resultLabels, {
        opponent,
        context,
        slotId: slot.id,
        family: play ? familyOf(play) : "",
        familyLabel: play ? familyOf(play).replace(/_/g, " ") : "",
        generalReason: SituationBoard.generalReason ? SituationBoard.generalReason(slot.id) : "",
        lookSide: "defense",
      }) : "";
      return '<article class="tabletCard' + (highlighted.has(slot.id) ? ' is-hot' : '') + '">' +
        '<header>' + (highlighted.has(slot.id) ? '<span class="tabletHotMark">Now</span>' : '') + escapeHtml(slot.label) + '</header>' +
        (play
          ? '<div class="tabletPath">' + escapeHtml(cleanText(play.formation).toUpperCase()) + '</div>' +
            (cleanText(play.set) ? '<div class="tabletPath">' + escapeHtml(cleanText(play.set).toUpperCase()) + '</div>' : '') +
            '<div class="tabletPlay">' + escapeHtml(cleanText(play.play_name).toUpperCase()) + '</div>'
          : '<div class="tabletPlay">No play</div>') +
        '<div class="tabletRate">' + escapeHtml(rate ? rate.percent + "%" : "") + '</div>' +
        '<p>' + escapeHtml(reason) + '</p>' +
        (play ? '<button type="button" data-confirm-slot="' + escapeHtml(slot.id) + '">Ran it</button>' : '') +
      '</article>';
    }).join("");
  }
  const ticker = document.getElementById("tabletTicker");
  if (ticker) ticker.textContent = session.lastCaptureText || "Press Ran it after the play you called.";
}

function render() {
  applyTheme(state.themeTeam);
  if (dom.headerSub) {
    dom.headerSub.textContent = "Offense board · " + (TEAM_THEME_META[state.themeTeam]?.label || "Neutral");
  }
  if (dom.teamSelect) dom.teamSelect.value = state.selectedTeam;
  if (dom.opponentSelect) {
    dom.opponentSelect.value = normalizeOpponentTeam(state.selectedOpponent) || dom.opponentSelect.value;
    state.selectedOpponent = dom.opponentSelect.value;
  }
  if (dom.themeSelect) dom.themeSelect.value = state.themeTeam;
  syncCallStyleSelect();
  renderTablet();
}

function bindEvents() {
  dom.newDriveBtn?.addEventListener("click", onPressNewDrive);
  document.getElementById("tabletRoot")?.addEventListener("click", onTabletClick);
  dom.scriptBuilderBtn?.addEventListener("click", openScriptBuilder);
  document.getElementById("callStyleSelect")?.addEventListener("change", event => selectCallStyle(event.target.value));
  dom.closeScriptBuilderBtn?.addEventListener("click", dismissScriptBuilder);
  dom.scriptDoneBtn?.addEventListener("click", commitScriptBuilder);
  dom.scriptClearBtn?.addEventListener("click", clearScript);
  dom.scriptAutoFillBtn?.addEventListener("click", autoFillScript);
  dom.scriptSearchInput?.addEventListener("input", event => {
    state.customScriptSearch = event.target.value;
    renderScriptBuilder();
  });
  dom.scriptPlaybookList?.addEventListener("click", event => {
    const add = event.target.closest("[data-play-id]");
    if (add) {
      addPlayToScript(add.getAttribute("data-play-id"));
      return;
    }
    const formation = event.target.closest("[data-nav-formation]");
    if (formation) {
      state.navigatorFormation = formation.getAttribute("data-nav-formation");
      state.navigatorSet = "";
      renderScriptBuilder();
      return;
    }
    const setBtn = event.target.closest("[data-nav-set]");
    if (setBtn) {
      state.navigatorSet = setBtn.getAttribute("data-nav-set");
      renderScriptBuilder();
      return;
    }
    const back = event.target.closest("[data-nav-back]");
    if (!back) return;
    if (back.getAttribute("data-nav-back") === "set") state.navigatorSet = "";
    else {
      state.navigatorFormation = "";
      state.navigatorSet = "";
    }
    renderScriptBuilder();
  });
  dom.scriptQueueList?.addEventListener("click", event => {
    const btn = event.target.closest(".scriptIconBtn");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    const index = parseInt(btn.getAttribute("data-index"), 10);
    if (action === "move-up") moveScriptPlay(index, -1);
    else if (action === "move-down") moveScriptPlay(index, 1);
    else if (action === "remove-play") removePlayFromScript(index);
    else if (action === "toggle-lock") toggleScriptSlotLock(index);
  });
  dom.gameplanTabScript?.addEventListener("click", () => setGameplanTab("script"));
  dom.gameplanTabSheet?.addEventListener("click", () => setGameplanTab("sheet"));
  dom.gameplanSheet?.addEventListener("click", event => {
    const button = event.target.closest("[data-call-style]");
    if (!button) return;
    selectCallStyle(button.getAttribute("data-call-style"));
  });
  dom.settingsBtn?.addEventListener("click", openSettings);
  dom.closeSettingsBtn?.addEventListener("click", () => closeOverlay(dom.settingsOverlay));
  dom.teamSelect?.addEventListener("change", () => {
    persistActivePlan();
    state.selectedTeam = dom.teamSelect.value;
    state.themeTeam = state.selectedTeam;
    if (dom.themeSelect) dom.themeSelect.value = state.themeTeam;
    applyTheme(state.themeTeam);
    if (dom.opponentSelect && normalizeOpponentTeam(dom.opponentSelect.value) === state.selectedTeam) {
      const fallback = NFL_TEAMS.find(team => team.code !== state.selectedTeam)?.code || "DAL";
      dom.opponentSelect.value = fallback;
      state.selectedOpponent = fallback;
    }
    loadMatchupPlan();
    savePreferences(true);
    recordTraceEvent("team-change", {
      at: new Date().toISOString(),
      team: state.selectedTeam,
      opponent: normalizeOpponentTeam(state.selectedOpponent) || null,
    });
    render();
  });
  dom.opponentSelect?.addEventListener("change", () => {
    const next = normalizeOpponentTeam(dom.opponentSelect.value);
    if (!next) return;
    persistActivePlan();
    state.selectedOpponent = next;
    loadMatchupPlan();
    savePreferences(true);
    recordTraceEvent("opponent-change", {
      at: new Date().toISOString(),
      opponent: state.selectedOpponent,
    });
    render();
  });
  dom.themeSelect?.addEventListener("change", () => persistThemeSelection(dom.themeSelect.value));
  dom.themeSelect?.addEventListener("input", () => persistThemeSelection(dom.themeSelect.value));
  dom.matchupSkipBtn?.addEventListener("click", closeMatchupModal);
  dom.matchupConfirmBtn?.addEventListener("click", () => confirmMatchupModal().catch(() => {}));
  dom.matchupMaddenVersionGroup?.addEventListener("click", event => {
    const button = event.target.closest("button[data-madden-version]");
    if (!button) return;
    const ver = button.getAttribute("data-madden-version");
    persistActivePlan();
    updateMaddenVersionPillButtons(ver);
    loadMatchupPlan();
  });
  dom.matchupOpponentContextGroup?.addEventListener("click", event => {
    const button = event.target.closest("button[data-opponent-context]");
    if (!button) return;
    setOpponentContext(button.getAttribute("data-opponent-context"));
  });
  dom.maddenVersionSelect?.addEventListener("change", () => {
    const ver = dom.maddenVersionSelect.value;
    persistActivePlan();
    updateMaddenVersionPillButtons(ver);
    reloadPlaysForVersion(ver).catch(() => {});
  });
  dom.matchupTeamSelect?.addEventListener("change", () => {
    persistActivePlan();
    const nextTeam = dom.matchupTeamSelect.value;
    state.selectedTeam = nextTeam;
    state.themeTeam = nextTeam;
    if (dom.teamSelect) dom.teamSelect.value = nextTeam;
    if (dom.themeSelect) dom.themeSelect.value = nextTeam;
    applyTheme(state.themeTeam);
    if (dom.matchupOpponentSelect && dom.matchupOpponentSelect.value === nextTeam) {
      const fallback = NFL_TEAMS.find(t => t.code !== nextTeam)?.code || "DAL";
      dom.matchupOpponentSelect.value = fallback;
      state.selectedOpponent = fallback;
      if (dom.opponentSelect) dom.opponentSelect.value = fallback;
    }
    savePreferences(true);
    loadMatchupPlan();
  });
  window.addEventListener("beforeunload", () => {
    persistActivePlan();
    savePreferences(true);
  });
}

async function init() {
  await loadPersistedState();
  applyTheme(state.themeTeam);
  populateTeamSelect();
  populateOpponentSelect();
  populateThemeSelect();
  if (dom.maddenVersionSelect) dom.maddenVersionSelect.value = state.maddenVersion || "M27";
  await loadTraceLog();
  render();
  await reloadPlaysForVersion(state.maddenVersion || "M27");
  bindEvents();
  await showMatchupModal();
}

init();
