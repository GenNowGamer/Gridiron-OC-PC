const PLAYCALLING_MODE_NORMAL = "normal";
const GAME_SCORE_ADJ_CAP = 4.5;

function normalizeQuarter(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "ot" || raw === "overtime") return 5;
  const n = Number(value);
  if (n === 5) return 5;
  if (n === 2 || n === 3 || n === 4) return n;
  return 1;
}

function isLateGameQuarter(quarter) {
  const normalized = normalizeQuarter(quarter);
  return normalized === 4 || normalized === 5;
}

function applyComebackScoreLean(t, tags, intensity) {
  let score = 0;
  if (t.isPassish) score += 3.8 * intensity;
  if (t.isRpo) score += 1.5 * intensity;
  if (t.isRun) score -= 3.1 * intensity;
  if (t.quickAnswer) score += 2.7 * intensity;
  if (t.sticksFriendly) score += 2.3 * intensity;
  if (t.chunkCapable) score += 2.7 * intensity;
  if (t.explosive) score += 1.9 * intensity;
  if (tags.sidelinePass) score += 1.5 * intensity;
  if (t.fam === "shot") score += 2.4 * intensity;
  if (t.fam === "flood" || t.fam === "man_beat") score += 1.9 * intensity;
  if (t.fam === "screen") score += 0.8 * intensity;
  if (t.isPA) score -= 2.4 * intensity;
  if (t.slowDeveloping) score -= 1.8 * intensity;
  return score;
}

function applyKillClockScoreLean(t, tags, intensity) {
  let score = 0;
  if (t.isRun) score += 4.4 * intensity;
  if (t.interiorRun) score += 2.7 * intensity;
  if (t.perimeterRun) score += 1.3 * intensity;
  if (t.efficient) score += 1.4 * intensity;
  if (t.quickAnswer && t.isPassish) score += 2.3 * intensity;
  if (t.isPassish && !t.quickAnswer && !t.isPA) score -= 2.1 * intensity;
  if (t.fam === "shot" || t.explosive) score -= 5.5 * intensity;
  if (t.highVariance) score -= 2.4 * intensity;
  if (tags.sidelinePass && t.isPassish) score -= 0.9 * intensity;
  return score;
}

function gameScoreAdjustmentRaw(ctx, traits) {
  const quarter = normalizeQuarter(ctx?.quarter);
  const scoreDiff = Number(ctx.scoreDiff);
  const absMargin = Math.abs(scoreDiff);
  const mode = ctx.playcallingMode || PLAYCALLING_MODE_NORMAL;
  const t = traits;
  const tags = { sidelinePass: false };
  let intensity = 0;
  let lean = "none";
  if (absMargin <= 7) return { lean, after: 0 };
  if (scoreDiff <= -14 && quarter <= 2) {
    intensity = 0.25;
    lean = "comeback";
  } else if (scoreDiff <= -8 && quarter === 3) {
    intensity = 0.45;
    lean = "comeback";
  } else if (scoreDiff <= -8 && isLateGameQuarter(quarter)) {
    intensity = 0.7;
    lean = "comeback";
  } else if (scoreDiff >= 8 && quarter === 3) {
    intensity = 0.35;
    lean = "kill_clock";
  } else if (scoreDiff >= 8 && isLateGameQuarter(quarter)) {
    intensity = 0.7;
    lean = "kill_clock";
  } else {
    return { lean, after: 0 };
  }
  if (mode === PLAYCALLING_MODE_NORMAL) {
    // full lean
  } else if (mode === "comeback") {
    if (lean !== "comeback") return { lean, after: 0 };
  } else if (mode === "kill_clock") {
    if (lean !== "kill_clock") return { lean, after: 0 };
  } else {
    return { lean, after: 0 };
  }
  const score = lean === "comeback"
    ? applyComebackScoreLean(t, tags, intensity)
    : applyKillClockScoreLean(t, tags, intensity);
  return {
    lean,
    after: Math.max(-GAME_SCORE_ADJ_CAP, Math.min(score, GAME_SCORE_ADJ_CAP)),
  };
}

const passPlay = {
  isPassish: true,
  isRun: false,
  isRpo: false,
  quickAnswer: true,
  sticksFriendly: true,
  chunkCapable: true,
  explosive: false,
  fam: "quick_game",
  isPA: false,
  slowDeveloping: false,
  interiorRun: false,
  perimeterRun: false,
  efficient: false,
  highVariance: false,
};

const runPlay = {
  isPassish: false,
  isRun: true,
  isRpo: false,
  quickAnswer: false,
  sticksFriendly: false,
  chunkCapable: false,
  explosive: false,
  fam: "inside_zone",
  isPA: false,
  slowDeveloping: false,
  interiorRun: true,
  perimeterRun: false,
  efficient: true,
  highVariance: false,
};

const shotPlay = {
  isPassish: true,
  isRun: false,
  isRpo: false,
  quickAnswer: false,
  sticksFriendly: true,
  chunkCapable: true,
  explosive: true,
  fam: "shot",
  isPA: false,
  slowDeveloping: true,
  interiorRun: false,
  perimeterRun: false,
  efficient: false,
  highVariance: true,
};

function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
    return;
  }
  console.log("PASS", name);
}

assert("tied => 0", gameScoreAdjustmentRaw({ quarter: 4, scoreDiff: 0, playcallingMode: "normal" }, passPlay).after === 0);
const trail = gameScoreAdjustmentRaw({ quarter: 4, scoreDiff: -14, playcallingMode: "normal" }, passPlay);
const trailRun = gameScoreAdjustmentRaw({ quarter: 4, scoreDiff: -14, playcallingMode: "normal" }, runPlay);
assert("Q4 trailing pass > run", trail.after > trailRun.after && trail.after > 0 && trailRun.after < 0);
const lead = gameScoreAdjustmentRaw({ quarter: 4, scoreDiff: 14, playcallingMode: "normal" }, runPlay);
const leadShot = gameScoreAdjustmentRaw({ quarter: 4, scoreDiff: 14, playcallingMode: "normal" }, shotPlay);
assert("Q4 leading run > shot", lead.after > leadShot.after && lead.after > 0 && leadShot.after < 0);
const alignedComeback = gameScoreAdjustmentRaw({ quarter: 4, scoreDiff: -14, playcallingMode: "comeback" }, passPlay);
assert("comeback keeps aligned lean", Math.abs(alignedComeback.after - trail.after) < 1e-9);
assert(
  "kill_clock zeros opposite lean",
  gameScoreAdjustmentRaw({ quarter: 4, scoreDiff: -14, playcallingMode: "kill_clock" }, passPlay).after === 0
);
assert(
  "blitz_beater zeros scoreboard lean",
  gameScoreAdjustmentRaw({ quarter: 4, scoreDiff: -14, playcallingMode: "blitz_beater" }, passPlay).after === 0
);
assert("Q1 lead 0", gameScoreAdjustmentRaw({ quarter: 1, scoreDiff: 14, playcallingMode: "normal" }, runPlay).after === 0);
assert(
  "Q2 trail light",
  gameScoreAdjustmentRaw({ quarter: 2, scoreDiff: -14, playcallingMode: "normal" }, passPlay).after < trail.after
);
const otTrail = gameScoreAdjustmentRaw({ quarter: 5, scoreDiff: -14, playcallingMode: "normal" }, passPlay);
assert("OT trailing matches Q4 intensity", Math.abs(otTrail.after - trail.after) < 1e-9);

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("OK scoreboard bias smoke");
