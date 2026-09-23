"use strict";

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
};
const NUMBER_WORD_ALIASES = { oh: "zero", o: "zero", won: "one", to: "two", too: "two", for: "four" };
const cleanText = (v) => String(v ?? "").trim();
const hasKnownNumericValue = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const createEmptyFieldPosition = () => ({ side: null, yardLine: null });

function normalizeFieldPosition(side, yardLine) {
  const y = hasKnownNumericValue(yardLine) ? Number(yardLine) : null;
  const s = cleanText(side).toUpperCase();
  if (!Number.isFinite(y) || y < 1 || y > 50) return createEmptyFieldPosition();
  if (s === "MIDFIELD" || y === 50) return { side: "MIDFIELD", yardLine: 50 };
  if (s === "OWN" || s === "OPP") return { side: s, yardLine: y };
  return createEmptyFieldPosition();
}

function parseSpokenNumber(value) {
  const cleaned = cleanText(value).toLowerCase();
  if (!cleaned) return null;
  const normalized = NUMBER_WORD_ALIASES[cleaned] || cleaned;
  const ordinal = normalized.match(/^(\d{1,2})(?:st|nd|rd|th)$/);
  if (ordinal) return Number(ordinal[1]);
  if (/^\d{1,2}$/.test(normalized)) return Number(normalized);
  if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, normalized)) return NUMBER_WORDS[normalized];
  return null;
}

function parseSpokenDown(value) {
  const cleaned = cleanText(value).toLowerCase();
  if (!cleaned) return null;
  if (/^[1-4](?:st|nd|rd|th)?$/.test(cleaned)) return Number(cleaned[0]);
  if (cleaned === "first") return 1;
  if (cleaned === "second") return 2;
  if (cleaned === "third") return 3;
  if (cleaned === "fourth") return 4;
  return null;
}

function normalizeSpokenSituationText(text) {
  return cleanText(text).toLowerCase()
    .replace(/\b(?:an?\s+)?inch(?:es|s)?\b/g, "one")
    .replace(/\bintent\b/g, "and ten")
    .replace(/\bantenna\b/g, "and ten")
    .replace(/\band\s+tenna\b/g, "and ten")
    .replace(/\bn\s+go\b/g, "and goal")
    .replace(/\band\s+go\b/g, "and goal")
    .replace(/\b&\s*go\b/g, "and goal")
    .replace(/\bgo\s+on\b/g, "goal on")
    .replace(/\bon\s+the\s+point\b/g, "on the opponents")
    .replace(/\bon\s+point\b/g, "on the opponents")
    .replace(/\b(\d{1,2})th\b/g, "$1")
    .replace(/[^a-z0-9&']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDownDistanceText(text) {
  return normalizeSpokenSituationText(text)
    .replace(/\bfor\b/g, "four")
    .replace(/\btoo\b/g, "two")
    .replace(/\bto\b/g, "two")
    .replace(/\bn\b/g, "and")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDownAndDistance(text) {
  const s = cleanText(text).toLowerCase();
  if (!s) return { down: null, yards: null };
  const normalized = normalizeDownDistanceText(s);
  const downAtYards = normalized.match(/\b(1st|2nd|3rd|4th|first|second|third|fourth|[1-4])\s+down\s+(?:at|and|&)\s*(?:uh|um|a|about|around|maybe|like)?\s*(\d{1,2}(?:st|nd|rd|th)?|[a-z]+)\b/);
  if (downAtYards) {
    const down = parseSpokenDown(downAtYards[1]);
    const yards = parseSpokenNumber(downAtYards[2]);
    if (Number.isFinite(down) && Number.isFinite(yards)) return { down, yards };
  }
  const patterns = [
    /\b(1st|2nd|3rd|4th|first|second|third|fourth|[1-4])\s*(?:down\s*)?(?:and|&)\s*(?:uh|um|a|about|around|maybe|like)?\s*(\d{1,2}(?:st|nd|rd|th)?|[a-z]+)\b/,
    /\b(1st|2nd|3rd|4th|first|second|third|fourth|[1-4])\s+down\s+(?:and\s+)?(?:uh|um|a|about|around|maybe|like)?\s*(\d{1,2}(?:st|nd|rd|th)?|[a-z]+)\b/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const down = parseSpokenDown(match?.[1]);
    const yards = parseSpokenNumber(match?.[2]);
    if (Number.isFinite(down) || Number.isFinite(yards)) {
      return { down: Number.isFinite(down) ? down : null, yards: Number.isFinite(yards) ? yards : null };
    }
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const connectors = new Set(["and", "&"]);
  const fillers = new Set(["uh", "um", "a", "about", "around", "maybe", "like"]);
  for (let i = 0; i < tokens.length; i += 1) {
    const down = parseSpokenDown(tokens[i]);
    if (!Number.isFinite(down)) continue;
    let j = i + 1;
    if (tokens[j] === "down") j += 1;
    if (connectors.has(tokens[j]) || tokens[j] === "at") j += 1;
    while (fillers.has(tokens[j])) j += 1;
    for (let k = j; k < Math.min(j + 4, tokens.length); k += 1) {
      if (fillers.has(tokens[k])) continue;
      const yards = parseSpokenNumber(tokens[k]);
      if (Number.isFinite(yards)) return { down, yards };
    }
  }
  return { down: null, yards: null };
}

function parseGoalLineSpot(text) {
  const s = normalizeSpokenSituationText(text);
  const patterns = [
    /\bgoal(?:\s+to\s+go)?(?:\s+on|\s+from|\s+at)?\s+the\s+(\d{1,2}|[a-z]+)\b/,
    /\bgoal(?:\s+to\s+go)?(?:\s+on|\s+from|\s+at)?\s+(\d{1,2}|[a-z]+)\b/,
    /\bgoal(?:\s+to\s+go)?(?:\s+on|\s+from|\s+at)?\s+(?:the\s+)?(?:my|our|own|their|opponent(?:'s)?|opponents)\s+(\d{1,2}|[a-z]+)(?:\s+yard(?:\s+line)?)?\b/,
    /\b(?:on|from|at)\s+the\s+(\d{1,2}|[a-z]+)\s+yard\b/,
    /\b(?:on|from|at)\s+the\s+(\d{1,2}|[a-z]+)\b/,
    /\b(?:on|from|at)\s+(?:the\s+)?(?:my|our|own|their|opponent(?:'s)?|opponents)\s+(\d{1,2}|[a-z]+)(?:\s+yard(?:\s+line)?)?\b/,
  ];
  for (const pattern of patterns) {
    const match = s.match(pattern);
    const value = parseSpokenNumber(match?.[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function parseFieldPosition(text) {
  const s = normalizeSpokenSituationText(text);
  if (!s) return null;
  for (const pattern of [
    /\bon\s+(?:my|our|the)?\s*own\s+(\d{1,2}|[a-z]+)(?:\s+yard\s+line)?\b/,
    /\b(?:my|our)\s+own\s+(\d{1,2}|[a-z]+)(?:\s+yard\s+line)?\b/,
    /\bi\s*(?:'m|am)?\s+(?:on\s+)?(?:my|our)?\s*own\s+(\d{1,2}|[a-z]+)(?:\s+yard\s+line)?\b/,
    /\bi\s*(?:'m|am)?\s+on\s+(?:my|our)\s+(\d{1,2}|[a-z]+)(?:\s+yard\s+line)?\b/,
    /\bon\s+my\s+(\d{1,2}|[a-z]+)(?:\s+yard\s+line)?\b/,
    /\bmy\s+(\d{1,2}|[a-z]+)\s+yard(?:\s+line)?\b/,
    /\bown\s+(\d{1,2}|[a-z]+)(?:\s+yard\s+line)?\b/,
  ]) {
    const match = s.match(pattern);
    const value = parseSpokenNumber(match?.[1]);
    if (Number.isFinite(value)) return normalizeFieldPosition("OWN", value);
  }
  for (const pattern of [
    /\bon\s+(?:their|the|opponent(?:'s)?|opponents)\s+(\d{1,2}|[a-z]+)(?:\s+yard\s+line)?\b/,
    /\b(?:their|opponent(?:'s)?|opponents)\s+(\d{1,2}|[a-z]+)(?:\s+yard\s+line)?\b/,
  ]) {
    const match = s.match(pattern);
    const value = parseSpokenNumber(match?.[1]);
    if (Number.isFinite(value)) return normalizeFieldPosition("OPP", value);
  }
  if (/\bon(?:\s+the)?\s+50(?:\s+yard\s+line)?\b/.test(s) || /\bat(?:\s+the)?\s+50(?:\s+yard\s+line)?\b/.test(s) || /\bmid\s*field\b/.test(s) || /\b50\s+yard\s+line\b/.test(s)) {
    return normalizeFieldPosition("MIDFIELD", 50);
  }
  return null;
}

function isGoalToGoSpoken(text) {
  const s = normalizeSpokenSituationText(text);
  return s.includes("goal to go") || s.includes("and goal") || s.includes("& goal") || /\bgoal\b/.test(s);
}

function inferDownDistanceFromLeadingDigits(text) {
  const match = cleanText(text).match(/\b([1-4])(\d)\b/);
  if (!match) return null;
  const down = Number(match[1]);
  const yards = Number(match[2]);
  if (!Number.isFinite(down) || down < 1 || down > 4 || !Number.isFinite(yards) || yards < 1 || yards > 15) return null;
  if (/\b(?:1st|2nd|3rd|4th|first|second|third|fourth)\b/.test(text)) return null;
  return { down, yards };
}

function parseSituation(text, fallbackState = { down: 1, yards: 10 }) {
  const raw = cleanText(text);
  const s = normalizeSpokenSituationText(raw);
  const parsed = parseDownAndDistance(s);
  const digitGuess = !Number.isFinite(parsed.down) || !Number.isFinite(parsed.yards) ? inferDownDistanceFromLeadingDigits(s) : null;
  const goalToGo = isGoalToGoSpoken(s);
  let down = Number.isFinite(parsed.down) ? parsed.down : (digitGuess?.down ?? (Number(fallbackState.down) || 1));
  let yards = fallbackState.yards;
  if (goalToGo) {
    const goalSpot = parseGoalLineSpot(s);
    yards = Number.isFinite(goalSpot) ? goalSpot : 1;
  } else if (Number.isFinite(parsed.yards)) {
    yards = parsed.yards;
  } else if (Number.isFinite(digitGuess?.yards)) {
    yards = digitGuess.yards;
  }
  return {
    down,
    yards,
    goalToGo,
    fieldPosition: !goalToGo ? (parseFieldPosition(s) || createEmptyFieldPosition()) : createEmptyFieldPosition(),
  };
}

function assert(name, cond) {
  if (!cond) {
    console.error("FAIL", name);
    process.exitCode = 1;
    return;
  }
  console.log("PASS", name);
}

const intent = parseSituation("First intent on the opponent's 21.");
assert("intent => 1st & 10 Opp 21", intent.down === 1 && intent.yards === 10 && intent.fieldPosition.side === "OPP" && intent.fieldPosition.yardLine === 21);

const antenna = parseSituation("First antenna my own 24.");
assert("antenna => 1st & 10 Own 24", antenna.down === 1 && antenna.yards === 10 && antenna.fieldPosition.side === "OWN" && antenna.fieldPosition.yardLine === 24);

const andGo = parseSituation("First, and go on the opponent 6.", { down: 1, yards: 4 });
assert("and go => goalToGo spot 6", andGo.goalToGo === true && andGo.yards === 6 && andGo.down === 1);

const secondGo = parseSituation("Second and go on the opponent's three.");
assert("second and go => goal spot 3", secondGo.goalToGo === true && secondGo.yards === 3 && secondGo.down === 2);

const thirdAt = parseSituation("Third down at 7 on the opponent's 39.");
assert("third down at 7 => 3rd & 7 Opp 39", thirdAt.down === 3 && thirdAt.yards === 7 && thirdAt.fieldPosition.side === "OPP" && thirdAt.fieldPosition.yardLine === 39);

const onMy = parseSituation("First in 10 on my 43 yard line.");
assert("on my 43 => Own 43", onMy.down === 1 && onMy.yards === 10 && onMy.fieldPosition.side === "OWN" && onMy.fieldPosition.yardLine === 43);

const goalToGoSafe = parseSituation("1st and goal on the 4");
assert("goal to go preserved", goalToGoSafe.goalToGo === true && goalToGoSafe.yards === 4);

const point = parseSituation("Second 11 I'm on the point 33");
assert("on the point => Opp 33", point.down === 2 && point.yards === 11 && point.fieldPosition.side === "OPP" && point.fieldPosition.yardLine === 33);

const coverIgnored = parseSituation("2nd and 8 cover 3");
assert("spoken cover ignored in parse", coverIgnored.down === 2 && coverIgnored.yards === 8 && !Object.prototype.hasOwnProperty.call(coverIgnored, "defense"));

const atFifty = parseSituation("1st and 10 at the 50");
assert("at the 50 => midfield", atFifty.down === 1 && atFifty.yards === 10 && atFifty.fieldPosition.side === "MIDFIELD" && atFifty.fieldPosition.yardLine === 50);

const own26th = parseSituation("3rd and 9 on my own 26th");
assert("26th yard line => own 26", own26th.down === 3 && own26th.yards === 9 && own26th.fieldPosition.side === "OWN" && own26th.fieldPosition.yardLine === 26);

const digitGuess = parseSituation("39 on my own 26");
assert("39 => 3rd and 9 own 26", digitGuess.down === 3 && digitGuess.yards === 9 && digitGuess.fieldPosition.side === "OWN" && digitGuess.fieldPosition.yardLine === 26);

if (process.exitCode) process.exit(process.exitCode);
console.log("OK situation parse smoke");
