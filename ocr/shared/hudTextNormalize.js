(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironOcrHudTextNormalize = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  /**
   * Strip Madden HUD chrome and common OCR substitutions before parsing/matching.
   */
  function sanitizeHudText(value) {
    var text = clean(value)
      // TNF down-arrow often OCR's as yen (¥) glued to yards — map before strip.
      .replace(/¥/g, "v")
      // Currency / legal / ornament glyphs OCR often invents on Madden HUDs.
      // Strip before NFKC — compatibility normalize turns ™ into "TM".
      .replace(/[€£§™®©˚ºª•·∙●◆■□▪▫★☆«»]/g, "");
    if (typeof text.normalize === "function") {
      try { text = text.normalize("NFKC"); } catch (_error) { /* ignore */ }
    }
    text = text
      .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ")
      // PP-OCRv5 often wraps HUD glyphs in quotes/apostrophes on outlined fonts:
      // "'1'ST'&''1''0'" → "1ST&10", "'2''6'" → "26".
      .replace(/['"`´‘’“”]+/g, "")
      .replace(/[|\/\\]+/g, " ")
      .replace(/[<>\[\]{}]+/g, " ")
      .replace(/\b[il]\s*(st|nd|rd|th)\b/gi, "1$1")
      .replace(/\bist\b/gi, "1st")
      .replace(/\bind\b/gi, "2nd")
      .replace(/\bird\b/gi, "3rd")
      .replace(/\s+/g, " ")
      .trim();
    return text;
  }

  function fieldSideFromArrowGlyphs(raw) {
    var text = clean(raw);
    if (!text) return null;
    // TNF: down arrow = OWN, up arrow = OPP. OCR may emit these glyphs,
    // often glued to the yard digits (v35 / ^42). ¥ is a common down-arrow misread.
    if (/[↓∨¥]|down\s*arrow/i.test(text) || /\bv\s*\d/i.test(text) || /v\d{1,2}/i.test(text)) {
      return "OWN";
    }
    if (/[↑∧Λ^]|up\s*arrow/i.test(text) || /\^\s*\d/.test(text) || /\^\d{1,2}/.test(text)) {
      return "OPP";
    }
    return null;
  }

  /** Fold letter O/o that OCR used instead of digit 0 in numeric HUD text. */
  function foldOcrDigits(value) {
    return clean(value)
      // Use a function replacer — "$10" is capture-group 10 in JS, not "$1" + "0".
      .replace(/([0-9])[Oo]/g, function (_, digit) { return digit + "0"; })
      .replace(/[Oo]([0-9])/g, function (_, digit) { return "0" + digit; })
      .replace(/:([Oo]{1,2})\b/g, function (_, group) {
        return ":" + group.replace(/[Oo]/g, "0");
      })
      // "2nd & 1 0" / "2nd & 1 O" from split-digit OCR → "2nd & 10"
      .replace(/(?:&|\bAND\b)\s*([0-9])\s+([0-9Oo])\b/gi, function (_, tens, ones) {
        return "& " + tens + String(ones).replace(/[Oo]/g, "0");
      });
  }

  function ordinalSuffix(n) {
    return n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
  }

  // Madden ordinals are fixed: 1st/2nd/3rd/4th. The suffix tells us the down
  // even when OCR swaps the leading digit for a lookalike letter (3→S, 1→I, …).
  var ORDINAL_DOWN_BY_SUFFIX = Object.freeze({ ST: 1, ND: 2, RD: 3, TH: 4 });

  // Yard-to-go confusable glyphs (single-glyph OCR swaps into digits).
  var YARD_CONFUSABLE_TO_DIGIT = Object.freeze({
    O: "0", Q: "0", D: "0",
    I: "1", L: "1", "|": "1",
    Z: "2",
    E: "3",
    A: "4", H: "4",
    S: "5",
    G: "6",
    T: "7",
    B: "8",
  });

  function foldYardToken(token) {
    var raw = clean(token).toUpperCase();
    if (!raw) return "";
    if (raw === "GOAL") return "GOAL";
    // GOAL OCR variants — must run before digit confusable maps
    // (BOAL→8041, G0AL/60AL→6041 destroyed real & Goal reads).
    if (/^(?:GOA[LI1]|GOLA|BOAL|G0AL|GOA1|6OAL|60AL|G0A1)$/.test(raw)) {
      return "GOAL";
    }
    // Madden short-yardage HUD: "4th & Inches" → treat as 1 yard to go.
    // OCR often swaps letters: INGHES / INCRES / INCHES / MGHES / MCHES.
    if (
      /^INCH(?:ES)?$/.test(raw)
      || /^INGH?ES$/.test(raw)
      || /^INCRES$/.test(raw)
      || /^M[CG]HES$/.test(raw)
      || /^INCHES?$/.test(raw)
    ) {
      return "1";
    }
    var folded = raw.split("").map(function (ch) {
      if (/[0-9]/.test(ch)) return ch;
      return YARD_CONFUSABLE_TO_DIGIT[ch] || "";
    }).join("");
    return folded;
  }

  /**
   * Deterministic HUD repair for down/distance before grammar/catalog.
   * Uses ordinal suffix as ground truth for down; folds yard confusables after &.
   */
  function repairDownDistanceOcrText(value) {
    var text = foldOcrDigits(sanitizeHudText(value)).toUpperCase().replace(/\s+/g, " ").trim();
    if (!text) return "";

    // Normalize conjunction early so "AND" is never mistaken for "2ND".
    text = text.replace(/\bAND\b/g, "&");

    // OCR often reads ordinal trailing D as 0/O: "2N0"→"2ND", "SRO"/"SR0"→"3RD".
    text = text.replace(/\b([1-4])N[O0]\b/g, "$1ND");
    // "2M0" / "2MO" — ND collapsed to M0 (export: "'2'M'0''&''4'").
    text = text.replace(/\b([1-4])M[O0]\b/g, "$1ND");
    // "38D" — R misread as 8 before D (export: "38D & GOAL").
    text = text.replace(/\b([1-4])8D\b/g, "$1RD");
    text = text.replace(/\b([0-9A-Z|]{0,2})R[O0]\b/g, function (match) {
      if (match === "AND" || match === "OR" || match === "FOR") return match;
      return "3RD";
    });
    // Digit-soup ordinals: R→8, D→0 so "3RD" becomes "380" / "382".
    text = text.replace(/\b([1-4])8[0O2]\b(?=\s*[&-]|\s*$)/g, "$1RD");
    // "4TH"/"1ST" collapsing to "44"/"11" before &: keep only when followed by &.
    text = text.replace(/\b([14])\1\b(?=\s*[&-])/g, function (_match, down) {
      return down === "1" ? "1ST" : "4TH";
    });

    // Bare ordinal suffix before &: "TH & INCHES" → "4TH & INCHES".
    text = text.replace(/\b(ST|ND|RD|TH)\s*&/g, function (_match, suffix) {
      var down = ORDINAL_DOWN_BY_SUFFIX[suffix];
      return down ? String(down) + suffix + " &" : _match;
    });

    // Incomplete ordinals from dropped letters / ornaments: "1S™ & 10" → "1ST & 10".
    // Partial suffix letter maps to the only legal Madden ordinal for that letter.
    text = text.replace(/\b([1-4])([SNRT])\b(?=\s*[&-]|\s*$)/g, function (_match, down, partial) {
      var suffix = ({ S: "ST", N: "ND", R: "RD", T: "TH" })[partial];
      return suffix ? down + suffix : down + partial;
    });
    // Same when glued to &: "1S&10"
    text = text.replace(/\b([1-4])([SNRT])(&)/g, function (_match, down, partial, amp) {
      var suffix = ({ S: "ST", N: "ND", R: "RD", T: "TH" })[partial];
      return suffix ? down + suffix + amp : down + partial + amp;
    });

    // "SRD" / "IRD" / "3RD" → force down from suffix (RD⇒3, ST⇒1, …).
    text = text.replace(/\b([0-9A-Z|]{0,2})(ST|ND|RD|TH)\b/g, function (match, _head, suffix) {
      if (match === "AND") return match;
      var down = ORDINAL_DOWN_BY_SUFFIX[suffix];
      return down ? String(down) + suffix : match;
    });

    // Normalize GOAL OCR before yard digit folding (export: BOAL / G0AL / 60AL).
    text = text.replace(
      /((?:&|-)\s*)(?:GOAL|GOAI|GOLA|BOAL|G0AL|GOA1|6OAL|60AL|G0A1)\b/g,
      "$1GOAL",
    );
    text = text.replace(
      /\b([1-4](?:ST|ND|RD|TH))(?:GOAL|GOAI|GOLA|BOAL|G0AL|GOA1|6OAL|60AL|G0A1)\b/g,
      "$1GOAL",
    );

    // "3RD & A" / "3 & S" / "3RD & IO" → fold yard token confusables to digits.
    text = text.replace(/((?:&|-)\s*)([0-9A-Z|]+)\b/g, function (_match, sep, yards) {
      var folded = foldYardToken(yards);
      if (!folded) return sep + yards;
      return sep + folded;
    });

    // Glued ordinal+yards with confusable yards: 3RDA → 3RD4, 1STIO → 1ST10
    text = text.replace(/\b([1-4](?:ST|ND|RD|TH))([0-9A-Z|]{1,2})\b/g, function (_match, ord, yards) {
      if (yards === "GOAL") return ord + yards;
      var folded = foldYardToken(yards);
      return folded ? ord + folded : ord + yards;
    });

    // Strip bracket/ornament junk OCR invents beside ordinals: "38] &5", "3°) &3".
    text = text.replace(/[\]\)\}°]+/g, " ").replace(/\s+/g, " ").trim();

    // Digit-soup before &: "38 &5" / "3 8 & 5" where leading 3 is the down (→ 3RD & 5).
    // Same family as "380"→"3RD"; only fire when no real ordinal already present.
    if (!/\b[1-4](?:ST|ND|RD|TH)\b/.test(text)) {
      text = text.replace(/\b([1-4])\s*[0-9OIl|]{0,2}\s*&/g, function (_match, down) {
        var suffix = ordinalSuffix(Number(down)).toUpperCase();
        return down + suffix + " &";
      });
    }

    return text;
  }

  function canonicalDownDistance(down, yardsToGo, goalToGo) {
    var okDown = Number.isFinite(down) && down >= 1 && down <= 4;
    var okYards = goalToGo === true || (Number.isFinite(yardsToGo) && yardsToGo >= 1 && yardsToGo <= 40);
    if (!okDown || !okYards) {
      return { down: null, yardsToGo: null, goalToGo: false, label: "", ok: false };
    }
    return {
      down: down,
      yardsToGo: goalToGo ? null : yardsToGo,
      goalToGo: goalToGo === true,
      label: down + ordinalSuffix(down) + " & " + (goalToGo ? "Goal" : yardsToGo),
      ok: true,
    };
  }

  function normalizeDownDistanceKey(value) {
    return repairDownDistanceOcrText(value)
      .replace(/\bAND\b/g, "&")
      .replace(/[^A-Z0-9&]+/g, "")
      .replace(/&+/g, "&");
  }

  /**
   * Finite legal Madden down/distance space. Matching is deterministic:
   * exact alias keys only — no digit-soup invention ("34", "2010").
   */
  function buildDownDistanceAliasMap() {
    var map = Object.create(null);
    function add(key, down, yardsToGo, goalToGo) {
      if (!key || map[key]) return;
      map[key] = { down: down, yardsToGo: yardsToGo, goalToGo: goalToGo };
    }
    for (var down = 1; down <= 4; down += 1) {
      var ord = String(down) + ordinalSuffix(down).toUpperCase();
      var goalKeys = [
        ord + "&GOAL",
        ord + "GOAL",
        String(down) + "&GOAL",
        String(down) + "GOAL",
      ];
      goalKeys.forEach(function (key) { add(key, down, null, true); });
      for (var yards = 1; yards <= 40; yards += 1) {
        var y = String(yards);
        // Structural aliases only. Never register bare "34" / "210" — those are
        // ambiguous without ordinal or separator evidence from OCR.
        [
          ord + "&" + y,
          ord + y,
          String(down) + "&" + y,
          String(down) + "AND" + y,
          ord + "AND" + y,
        ].forEach(function (key) { add(normalizeDownDistanceKey(key), down, yards, false); });
      }
    }
    return map;
  }

  var DOWN_DISTANCE_ALIASES = null;
  function downDistanceAliasMap() {
    if (!DOWN_DISTANCE_ALIASES) DOWN_DISTANCE_ALIASES = buildDownDistanceAliasMap();
    return DOWN_DISTANCE_ALIASES;
  }

  function hasDownDistanceStructure(raw) {
    var text = clean(raw).toUpperCase();
    if (!text) return false;
    if (/[&]|(\bAND\b)/.test(text)) return true;
    // Accept confusable ordinal heads (SRD, IRD) — repair maps them via suffix.
    if (/\b[0-9A-Z|]{0,2}(?:ST|ND|RD|TH)\b/.test(text)) return true;
    if (/[0-9A-Z|]{0,2}(ST|ND|RD|TH)(?:\d{1,2}|GOAL|[A-Z])\b/.test(text.replace(/\s+/g, ""))) return true;
    return false;
  }

  function parseDownDistanceGrammar(raw) {
    var text = repairDownDistanceOcrText(raw).replace(/\s+/g, " ").trim();
    if (!text) return canonicalDownDistance(null, null, false);

    // 3RD&4 / 3RD & 4 / 3 & 4 / 3RD AND 4 / 3-4 (separator required for bare down)
    var spaced = text
      .replace(/\s*&\s*/g, " & ")
      .replace(/\s+AND\s+/g, " & ")
      .replace(/\s*-\s*/g, " & ");
    var classic = spaced.match(/\b([1-4])(?:ST|ND|RD|TH)?\s*&\s*(\d{1,2}|GOAL)\b/);
    if (classic) {
      var goal = classic[2] === "GOAL";
      return canonicalDownDistance(Number(classic[1]), goal ? null : Number(classic[2]), goal);
    }

    // Glued ordinal forms that still carry structure: 3RD4, 1ST10, 2NDGOAL
    var glued = text.replace(/\s+/g, "").match(/\b([1-4])(ST|ND|RD|TH)(\d{1,2}|GOAL)\b/);
    if (!glued) glued = text.replace(/\s+/g, "").match(/^([1-4])(ST|ND|RD|TH)(\d{1,2}|GOAL)$/);
    if (glued) {
      var gluedGoal = glued[3] === "GOAL";
      return canonicalDownDistance(Number(glued[1]), gluedGoal ? null : Number(glued[3]), gluedGoal);
    }

    return canonicalDownDistance(null, null, false);
  }

  function parseDownDistanceText(value) {
    var original = clean(value);
    // Empty crops must fail closed — do not invent downs from missing OCR.
    if (!original) {
      return {
        down: null,
        yardsToGo: null,
        goalToGo: false,
        label: "",
        ok: false,
        reason: "empty_raw_text",
      };
    }
    var repaired = repairDownDistanceOcrText(original);
    var grammatical = parseDownDistanceGrammar(repaired);
    if (grammatical.ok) return grammatical;

    // Deterministic catalog hit: only when OCR kept structural evidence
    // (ordinal and/or separator). Bare digit blobs fail closed.
    if (!hasDownDistanceStructure(original) && !hasDownDistanceStructure(repaired)) {
      return {
        down: null,
        yardsToGo: null,
        goalToGo: false,
        label: sanitizeHudText(original),
        ok: false,
        reason: "missing_down_distance_structure",
      };
    }

    var key = normalizeDownDistanceKey(repaired || original);
    var hit = downDistanceAliasMap()[key];
    if (hit) return canonicalDownDistance(hit.down, hit.yardsToGo, hit.goalToGo);

    return {
      down: null,
      yardsToGo: null,
      goalToGo: false,
      label: sanitizeHudText(original),
      ok: false,
      reason: "unresolved_down_distance",
    };
  }

  function parseFieldPositionText(value, options) {
    var opts = options || {};
    var original = clean(value);
    // Empty / glyph-only crops fail closed — geometry/engine must produce text.
    if (!original) {
      return {
        side: null,
        yardLine: null,
        label: "",
        ok: false,
        reason: "empty_raw_text",
        glyphSide: null,
        alternatives: [],
      };
    }
    var sideHint = clean(opts.sideHint || opts.fieldSide).toUpperCase();
    if (sideHint !== "OWN" && sideHint !== "OPP" && sideHint !== "MIDFIELD") sideHint = "";

    // Capture OPP/OWN intent from leading O/o *before* foldOcrDigits turns "o1" into "01".
    var leadingOppO = /^[Oo](\d{1,2})\b/.test(original);
    var preFold = sanitizeHudText(original).toUpperCase();
    // Glued OWN/OPP labels: "OPP5" / "OWN32" / "OPPONENT15".
    preFold = preFold
      .replace(/\b(OWN|OPP|OPPONENT)(\d{1,2})\b/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
    if (leadingOppO) {
      preFold = preFold.replace(/^[O0](\d{1,2})\b/, "OPP $1");
    }

    var raw = foldOcrDigits(preFold).toUpperCase();
    // Separate TNF arrow glyphs glued to yard digits so "V35" / "^42" parse.
    // Drop digits that appear *before* the arrow (left-side ROI bleed).
    raw = raw
      .replace(/\d+([V↑↓∨∧Λ^])/g, "$1")
      .replace(/([V↑↓∨∧Λ^])(\d{1,2})\b/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();

    // Trailing HUD pipe "|" OCR'd as "1": "261" / "281" / "451" → 26 / 28 / 45.
    // Require a full 2-digit yard (10–50) before the extra "1" — never strip
    // the ones digit of real yardlines 11/21/31/41 (regression: v21 → OWN 2).
    // Must run BEFORE the 4XX bleed rule — otherwise "451" becomes "51" (invalid).
    var compactYards = raw.replace(/\s+/g, "").replace(/^-/, "");
    var pipeBleed = compactYards.match(/^([V↑↓∨∧Λ^])?([1-4]\d|50)1$/);
    var bleed3 = null;
    if (pipeBleed) {
      raw = (pipeBleed[1] ? pipeBleed[1] + " " : "") + pipeBleed[2];
    } else {
      // Three-digit arrow bleed: "415" / "418" → yard = last two digits (side from hint/glyph).
      bleed3 = compactYards.match(/^4(\d{2})$/);
      if (bleed3) {
        raw = bleed3[1];
      }
    }

    var sideMatch = raw.match(/\b(OWN|OPP|OPPONENT)\b/);
    // Prefer the last digit group when OCR bleeds an extra number in front
    // ("4 5" / "OWN 4 5" → 5). Bare "45" stays 45 (valid midfield hash).
    // Drop a trailing lone "1" (pipe bleed) only after a 2-digit yard (26 1 → 26).
    var yardMatches = raw.match(/\b(\d{1,2})\b/g) || [];
    if (
      yardMatches.length >= 2
      && yardMatches[yardMatches.length - 1] === "1"
    ) {
      var prior = Number(yardMatches[yardMatches.length - 2]);
      if (Number.isFinite(prior) && prior >= 10 && prior <= 50) {
        yardMatches = yardMatches.slice(0, -1);
      }
    }
    if (!yardMatches.length) {
      var tail = raw.match(/(\d{1,2})\s*$/);
      if (tail) yardMatches = [tail[1]];
    }
    var glyphSide = fieldSideFromArrowGlyphs(value) || fieldSideFromArrowGlyphs(raw);
    // Prefer explicit OWN/OPP words, then the arrow glyph in the same crop (v=OWN, ^=OPP),
    // then ROI vision sideHint. Glyph beats a wrong ROI hint (SEA opening drive v45→OWN).
    var side = sideMatch
      ? (sideMatch[1].indexOf("OPP") === 0 ? "OPP" : "OWN")
      : (glyphSide || sideHint || null);
    if (leadingOppO && !side) side = "OPP";

    var yardToken = yardMatches.length ? yardMatches[yardMatches.length - 1] : null;
    var yardLine = yardToken ? Number(yardToken) : null;
    // "v00" / "00" / "v0" — arrow glyph with no usable yard line (crop miss).
    if (!Number.isFinite(yardLine) || yardLine < 1 || yardLine > 50) {
      return {
        side: null,
        yardLine: null,
        label: sanitizeHudText(value),
        ok: false,
        reason: glyphSide || /^[V↑↓∨∧Λ^]?\s*0+\b/.test(raw) ? "yardline_zero_garbage" : "unresolved_field_position",
        glyphSide: glyphSide || null,
        alternatives: [],
      };
    }
    // The 50 is midfield — OWN/OPP prefixes are meaningless and must not block accept.
    if (yardLine === 50) side = "MIDFIELD";

    var alternatives = [];
    // Ambiguous bare "4X" with a side hint: keep yard 4X as primary, offer SIDE X as alt
    // when ones-digit ≤ 20 (LV/DEN "45"→OPP 5 cases) without auto-flipping midfield hashes.
    var bareTwo = sanitizeHudText(original).replace(/\s+/g, "");
    if (
      side
      && side !== "MIDFIELD"
      && /^4([1-9])$/.test(bareTwo)
      && !bleed3
      && !sideMatch
      && !glyphSide
      && !leadingOppO
    ) {
      var ones = Number(bareTwo.charAt(1));
      if (ones >= 1 && ones <= 20) {
        alternatives.push({
          side: side,
          yardLine: ones,
          label: side + " " + ones,
        });
      }
    }
    // When glyph and ROI hint disagree, keep glyph as primary and expose hint as alt.
    if (
      glyphSide
      && sideHint
      && (glyphSide === "OWN" || glyphSide === "OPP")
      && (sideHint === "OWN" || sideHint === "OPP")
      && glyphSide !== sideHint
      && side === glyphSide
    ) {
      alternatives.push({
        side: sideHint,
        yardLine: yardLine,
        label: sideHint + " " + yardLine,
      });
    }

    return {
      side: side,
      yardLine: yardLine,
      label: (side ? side + " " : "") + yardLine,
      ok: true,
      glyphSide: glyphSide || null,
      alternatives: alternatives,
    };
  }

  /**
   * Madden previous-play HUD slot is "--" (or blank) on drive start / no prior snap.
   * OCR often invents noise from adjacent chrome when the crop is empty.
   */
  function isEmptyPreviousPlayOcr(value) {
    var text = clean(value);
    if (!text) return true;
    var stripped = text
      .replace(/[¥€£§™®©˚ºª•·∙●◆■□▪▫★☆«»""''`´]/g, "")
      .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ")
      .trim();
    if (!stripped) return true;
    if (/^[\s\-–—_.=·•~,;:]+$/u.test(stripped)) return true;
    if (/^(n\/?a|none|null|unknown|nil|-)$/i.test(stripped)) return true;
    return false;
  }

  /**
   * Low-signal OCR that should not force Review as a fake previous play.
   * Real catalog misses with readable play-like text still go to Review.
   */
  function isGarbagePreviousPlayOcr(value) {
    if (isEmptyPreviousPlayOcr(value)) return true;
    var text = sanitizeHudText(value).replace(/\s+/g, " ").trim();
    if (!text) return true;
    // Pure digit soup from empty-slot chrome ("900", "11") is not a play name.
    if (/^\d{2,}$/.test(text.replace(/\s+/g, ""))) return true;
    var letters = (text.match(/[A-Za-z]/g) || []).length;
    var digits = (text.match(/[0-9]/g) || []).length;
    if (letters + digits < 3) return true;
    if (letters === 0 && digits >= 2) return true;
    var noise = (text.match(/[^A-Za-z0-9\s\-']/g) || []).length;
    if (noise >= 3 && noise >= Math.max(2, Math.floor(letters * 0.3))) return true;
    var tokens = text.split(/\s+/).filter(Boolean);
    var solid = tokens.filter(function (token) {
      return /[A-Za-z]{4,}/.test(token) || /^\d{1,2}$/.test(token);
    });
    var longSolid = tokens.filter(function (token) {
      return /[A-Za-z]{4,}/.test(token);
    });
    // Many tiny fragments with at most one solid token ("ot 2 ae expense eg a").
    if (tokens.length >= 5 && solid.length <= 2) return true;
    if (tokens.length >= 4 && solid.length <= 1) return true;
    // Digit + chrome soup: lots of fragments, few real words ("2 On DOWNS he +e aden am").
    if (tokens.length >= 6 && longSolid.length <= 2) return true;
    return false;
  }

  function parseQuarterClockText(value) {
    var raw = foldOcrDigits(sanitizeHudText(value)).toUpperCase();
    var clockMatch = raw.match(/\b(\d{1,2}):(\d{2})\b/);
    var clock = clockMatch ? (Number(clockMatch[1]) + ":" + clockMatch[2]) : "";
    // Remove clock first so minute digits cannot be mistaken for quarter.
    var withoutClock = clockMatch ? raw.replace(clockMatch[0], " ") : raw;
    var quarterMatch = withoutClock.match(/\b([1-4])(?:ST|ND|RD|TH)\b/)
      || withoutClock.match(/\bQ\s*([1-4])\b/);
    var quarter = quarterMatch ? Number(quarterMatch[1]) : null;
    var label = [
      Number.isFinite(quarter) ? (quarter + ordinalSuffix(quarter)) : "",
      clock,
    ].filter(Boolean).join(" ");
    return {
      quarter: Number.isFinite(quarter) ? quarter : null,
      clock: clock,
      label: label || sanitizeHudText(value),
      ok: Number.isFinite(quarter) || Boolean(clock),
    };
  }

  function parseScoresText(value) {
    var raw = sanitizeHudText(value).toUpperCase();
    var pair = raw.match(/\b([A-Z]{2,4})\s*(\d{1,3})\b[\s\S]*?\b([A-Z]{2,4})\s*(\d{1,3})\b/);
    if (!pair) {
      var single = raw.match(/\b([A-Z]{2,4})\s*(\d{1,3})\b/);
      return {
        awayTeam: single ? single[1] : "",
        awayScore: single ? Number(single[2]) : null,
        homeTeam: "",
        homeScore: null,
        label: sanitizeHudText(value),
        ok: false,
      };
    }
    return {
      awayTeam: pair[1],
      awayScore: Number(pair[2]),
      homeTeam: pair[3],
      homeScore: Number(pair[4]),
      label: pair[1] + " " + pair[2] + "  " + pair[3] + " " + pair[4],
      ok: true,
    };
  }

  function repairIFormFormationName(formation) {
    var name = clean(formation);
    // OCR often drops the leading "I" ("| Form" / "Form - Wing" → "Form").
    if (/^FORM$/i.test(name)) return "I Form";
    if (/^FORM\b/i.test(name) && !/^I\s+FORM\b/i.test(name)) {
      return ("I Form" + name.slice(4)).replace(/\s+/g, " ").trim();
    }
    return name;
  }

  function repairPersonnelOcrConfusions(text) {
    var cleaned = clean(text)
      // DEN/GB storm: "1RB" OCR'd as "LRB" / "ORB" / "0RB" / "lRB" / "I RB" / "|RB".
      .replace(/\bLRB\b/gi, "1RB")
      .replace(/\bORB\b/gi, "1RB")
      .replace(/\b0RB\b/gi, "1RB")
      .replace(/\blRB\b/g, "1RB")
      .replace(/\bI\s*RB\b/gi, "1RB")
      .replace(/\|\s*RB\b/gi, "1RB");

    // Glued Madden personnel bar: "1 RB | 1 TE | 3 WR" → OCR "1RBI2TEI2WR" / "RBITEIAWR".
    // Pipes become I; digits may drop or become confusable letters (3→A).
    // Leading I before RB is a dropped "1" (export: IRBITEIAWR).
    var glued = cleaned.toUpperCase().replace(/\s+/g, "");
    glued = glued.replace(/^IRB/, "1RB");
    // 0 TE often OCR'd as OTE: "2RBIOTEI3WR" → 2RB - 0TE 3WR.
    glued = glued.replace(/RB([I|]?)OTE/g, "RB$10TE");
    // Allow I/L as TE count 1: "2RBIITEIZWR" → 2RB - 1TE 2WR.
    var personnel = glued.match(/^(\d)?RB[I|]?([0-9OIL])?TE[I|]?([0-9A-Z])?WR$/);
    if (personnel) {
      var rb = personnel[1] || "1";
      var teRaw = personnel[2] || "1";
      var te = (teRaw === "O") ? "0" : ((teRaw === "I" || teRaw === "L") ? "1" : teRaw);
      var wrRaw = personnel[3] || "";
      // Personnel WR-count confusables differ slightly from yard-to-go maps
      // (outlined "3" often reads as A/B/E/S on Madden HUDs).
      var wrMap = {
        "0": "0", "1": "1", "2": "2", "3": "3", "4": "4", "5": "5",
        A: "3", B: "3", E: "3", S: "3", Z: "2", O: "0", I: "1", L: "1",
      };
      var wr = wrMap[wrRaw] || (/[0-9]/.test(wrRaw) ? wrRaw : "");
      if (!wr) wr = "3";
      return rb + "RB - " + te + "TE " + wr + "WR";
    }
    // Spaced pipe form already sanitized to spaces: "1 RB 1 TE 3 WR".
    var spaced = cleaned.toUpperCase().match(/^(\d)\s*RB\s+(\d)\s*TE\s+(\d)\s*WR$/);
    if (spaced) {
      return spaced[1] + "RB - " + spaced[2] + "TE " + spaced[3] + "WR";
    }
    return cleaned;
  }

  /**
   * Light repairs so glued previous-play OCR can catalog-match.
   * Examples: COVERBCLOUD→COVER 3 CLOUD, TAMPAZ→TAMPA 2, OITRAP→01 TRAP.
   */
  function repairPreviousPlayOcrText(value) {
    var text = sanitizeHudText(value).toUpperCase().replace(/\s+/g, " ").trim();
    if (!text) return "";

    // Truncated COVER → COV must run before shell/digit maps (export: COVBUZZMATCH).
    text = text.replace(/\bCOV(?=BUZZ|CLOUD|SKY|MATCH|HOLE|PRESS|DROP|HARD|FLAT|QUARTERS)/g, "COVER");
    text = text.replace(/\bCOV\b(?=\s*(BUZZ|CLOUD|SKY|MATCH|HOLE|PRESS|DROP))/g, "COVER");

    // Resolve COVER+shell words BEFORE single-letter digit maps so COVERBUZZ
    // does not become "COVER 3 UZZ" (B stolen from BUZZ).
    // Map optional confusable digit: A/H→4, B/E/S→3, Z→2, I/L→1; default 3 when omitted.
    // Export: COVERAQUARTERS→COVER 4 QUARTERS, COVERIHOLE→COVER 1 HOLE (not forced 3).
    var coverShellDigit = { B: "3", E: "3", S: "3", A: "4", H: "4", Z: "2", I: "1", L: "1", G: "6" };
    text = text.replace(
      /\bCOVER(?:([BESAHZGIL]))?(BUZZ|CLOUD|SKY|HARD|FLAT|MATCH|QUARTERS|ROLL|PRESS|HOLE)/g,
      function (_m, digit, shell) {
        var d = digit ? (coverShellDigit[digit] || digit) : "3";
        return "COVER " + d + " " + shell;
      },
    );
    text = text.replace(/\bCOVERG(?=WILLE)/g, "COVER 6 ");
    text = text.replace(/\bCOVER(?=WILLE)/g, "COVER 3 ");
    // COVER 1 LB / COVER 1 DOUBLE — I/L/1 after COVER before LB/DOUBLE.
    text = text.replace(/\bCOVER[IL1](?=LB|DBL|DOUBLE)/g, "COVER 1 ");
    text = text.replace(/\bCOVER\s*[IL1]\s*(?=LB|DBL|DOUBLE)/g, "COVER 1 ");

    // Cover family: remaining digit confusables after COVER.
    var coverDigit = { B: "3", E: "3", S: "3", A: "4", H: "4", G: "6", Z: "2", I: "1", L: "1" };
    text = text.replace(/\bCOVER\s*([BESAHGZIL])\b/g, function (_m, ch) {
      return "COVER " + (coverDigit[ch] || ch);
    });
    text = text.replace(/\bCOVER([BESAHGZ])(?=[A-Z])/g, function (_m, ch) {
      return "COVER " + (coverDigit[ch] || ch) + " ";
    });
    // COVER with no digit before a known coverage shell → default Cover 3.
    text = text.replace(
      /\bCOVER(?=\s*(CLOUD|SKY|HARD|FLAT|MATCH|QUARTERS|ROLL|BUZZ|PRESS|HOLE|WILLE|WIL)\b)/g,
      "COVER 3 ",
    );
    text = text.replace(
      /\bCOVER(?=(CLOUD|SKY|HARD|FLAT|MATCH|QUARTERS|ROLL|BUZZ|PRESS|HOLE))/g,
      "COVER 3 ",
    );

    // Tampa 2 / Nickel 2 / Cover-digit glued as trailing Z/S.
    text = text.replace(/\bTAMPA\s*Z\b/g, "TAMPA 2");
    text = text.replace(/\bTAMPAZ\b/g, "TAMPA 2");
    text = text.replace(/\bTAMPAZ(?=[A-Z])/g, "TAMPA 2 ");
    text = text.replace(/\bNICKEL\s*Z\b/g, "NICKEL 2");
    text = text.replace(/\bNICKELZ(?=[A-Z])/g, "NICKEL 2 ");
    // SAM/WS BLITZ 3 — trailing S/Z/A after BLITZ (glued or spaced).
    text = text.replace(/BLITZ[SA]\b/g, "BLITZ 3");
    text = text.replace(/BLITZZ\b/g, "BLITZ 2");
    text = text.replace(/\bBLITZ\s*[SA]\b/g, "BLITZ 3");
    text = text.replace(/\bBLITZ\s*Z\b/g, "BLITZ 2");

    // FELD → FIELD (export: COVERDROPFELD).
    text = text.replace(/\bFELD\b/g, "FIELD");
    text = text.replace(/FELD(?=[A-Z]|$)/g, "FIELD");
    // COVER + DROP without digit — Cover 4 Drop is the common Madden family.
    text = text.replace(/\bCOVER(?=\s*DROP\b)/g, "COVER 4 ");
    text = text.replace(/\bCOVER(?=DROP)/g, "COVER 4 ");

    // Leading play numbers: OI/0I/OL → 01; I/L before DOUBLE → 1.
    text = text.replace(/\bO[IL1]\b(?=\s*[A-Z])/g, "01");
    text = text.replace(/\bO[IL1](?=[A-Z])/g, "01 ");
    text = text.replace(/\b[IL](?=DOUBLE)/g, "1 ");
    text = text.replace(/^[IL](?=[A-Z])/g, "1 ");
    // ZE/Z6 → 26 for duo/power style play numbers.
    text = text.replace(/\bZE(?=[A-Z])/g, "26 ");
    text = text.replace(/\bZ([0-9])(?=[A-Z])/g, "2$1 ");
    // Leading D→O for OUTS / OUT.
    text = text.replace(/\bDUT(S?)\b/g, "OUT$1");
    // Dropped leading I on INSIDE (export: NSIDEZONE / NSDEZONESPLIT).
    text = text.replace(/\bNSIDE\b/g, "INSIDE");
    text = text.replace(/^NSIDE(?=[A-Z])/, "INSIDE");
    text = text.replace(/\bNSDE\b/g, "INSIDE");
    text = text.replace(/NSDE(?=ZONE)/g, "INSIDE");
    // HB prefix glued to run/pass names (export: HBDIVE / HBSLIPSCREEN / HBLEAD).
    text = text.replace(
      /\bHB(?=DIVE|SLAM|DRAW|STRETCH|ZONE|TOSS|SWEEP|POWER|ISO|DUO|SLIP|LEAD|CHOICE|COUNTER|SCREEN|SNEAK)\b/g,
      "HB ",
    );
    text = text.replace(
      /\bHB(DIVE|SLAM|DRAW|STRETCH|ZONE|TOSS|SWEEP|POWER|ISO|DUO|SLIP|LEAD|CHOICE|COUNTER|SCREEN|SNEAK)/g,
      "HB $1",
    );
    // GL MAN glue.
    text = text.replace(/\bGL(?=MAN)/g, "GL ");

    // Insert spaces before long glued football tokens when OCR drops spaces.
    // Only rewrite fully-glued strings — spaced HUD text must keep token order.
    var tokenStarts = [
      "COVER", "TAMPA", "NICKEL", "INSIDE", "OUTSIDE", "ZONE", "TRAP", "OPTION",
      "READ", "MESH", "SPOT", "BENCH", "ANGLE", "HARD", "FLAT", "CLOUD", "MATCH",
      "PALMS", "HOLE", "SLOT", "CORNER", "UNDER", "OVER", "FLOOD", "SCREEN",
      "COUNTER", "DRAW", "SWEEP", "ISO", "POWER", "TOSS", "BOOT", "NAKED",
      "YCORNER", "NEWS", "ORLEANS", "NEW", "BLITZ", "SAM", "WILL", "WILLE",
      "BUZZ", "PRESS", "QUARTERS", "ROLL", "SKY", "DOUBLE", "PIVOT", "DUO",
      "MIKE", "OUTS", "MABLE", "DIVE", "SLAM", "STRETCH", "SLIP", "LEAD",
      "CHOICE", "BRACKET", "SWITCH", "CONTAIN", "FIELD", "EMPTY", "VERTICAL",
      "MTN", "WHEEL", "SPLIT", "POST", "SAIL", "SNEAK", "DROP", "MAN",
    ];
    tokenStarts.sort(function (a, b) { return b.length - a.length; });
    var hadSpaces = /\s/.test(sanitizeHudText(value));
    var compacted = text.replace(/\s+/g, "");
    if (!hadSpaces && /^[A-Z0-9]+$/.test(compacted) && compacted.length >= 8) {
      var pieces = [];
      var cursor = 0;
      while (cursor < compacted.length) {
        var hit = null;
        for (var i = 0; i < tokenStarts.length; i += 1) {
          var tok = tokenStarts[i];
          if (compacted.slice(cursor, cursor + tok.length) === tok) {
            hit = tok;
            break;
          }
        }
        if (hit) {
          pieces.push(hit);
          cursor += hit.length;
          continue;
        }
        // Digit run
        var digits = compacted.slice(cursor).match(/^\d+/);
        if (digits) {
          pieces.push(digits[0]);
          cursor += digits[0].length;
          continue;
        }
        // Short alpha fragment until next known token/digit.
        var next = compacted.length;
        for (var j = 0; j < tokenStarts.length; j += 1) {
          var idx = compacted.indexOf(tokenStarts[j], cursor + 1);
          if (idx > cursor && idx < next) next = idx;
        }
        var digitIdx = compacted.slice(cursor + 1).search(/\d/);
        if (digitIdx >= 0 && cursor + 1 + digitIdx < next) next = cursor + 1 + digitIdx;
        if (next <= cursor) next = cursor + 1;
        pieces.push(compacted.slice(cursor, next));
        cursor = next;
      }
      if (pieces.length >= 2) text = pieces.join(" ");
    }

    return text.replace(/\s+/g, " ").trim();
  }

  function parseFormationPersonnelText(value) {
    var packageOnly = clean(value).replace(/\s+/g, " ");
    // Whole-string special packages — do not split "Field Goal" into Field / Goal.
    if (/^(Field\s*Goal|FieldGoal|Kickoff|Punt)$/i.test(packageOnly)) {
      var packageName = packageOnly.replace(/\s+/g, " ").replace(/FieldGoal/i, "Field Goal");
      if (/^field\s*goal$/i.test(packageName)) packageName = "Field Goal";
      else if (/^kickoff$/i.test(packageName)) packageName = "Kickoff";
      else if (/^punt$/i.test(packageName)) packageName = "Punt";
      return {
        formation: packageName,
        set: "",
        personnel: "",
        label: packageName,
      };
    }

    var raw = repairPersonnelOcrConfusions(sanitizeHudText(value));
    if (!raw) return { formation: "", set: "", personnel: "", label: "" };
    var lines = String(value == null ? "" : value)
      .split(/\r?\n+/)
      .map(function (line) { return repairPersonnelOcrConfusions(sanitizeHudText(line)); })
      .filter(Boolean);
    var joined = lines.length ? lines.join(" - ") : raw;
    joined = repairPersonnelOcrConfusions(joined);
    var parts = joined.split(/\s*[-–—]\s+/).map(function (part) { return part.trim(); }).filter(Boolean);
    if (parts.length >= 1) parts[0] = repairIFormFormationName(parts[0]);
    if (parts.length >= 3) {
      return {
        formation: parts[0],
        set: parts[1],
        personnel: parts.slice(2).join(" - "),
        label: [parts[0], parts[1], parts.slice(2).join(" - ")].filter(Boolean).join(" - "),
      };
    }
    if (parts.length === 2) {
      // Madden often prints "Gun - Deuce Close 1 RB 2 TE 2 WR" in one line.
      var personnelTail = parts[1].match(/\b\d+\s*RB\b[\s\S]*$/i);
      if (personnelTail) {
        var setName = parts[1].slice(0, personnelTail.index).trim();
        return {
          formation: parts[0],
          set: setName,
          personnel: sanitizeHudText(personnelTail[0]),
          label: [parts[0], setName, sanitizeHudText(personnelTail[0])].filter(Boolean).join(" - "),
        };
      }
      // Glued personnel repair: "1RB - 1TE 3WR" → formation + set (not free personnel).
      var packageSet = /^\d+\s*TE\b[\s\S]*\d+\s*WR\b/i.test(parts[1])
        || /^\d+\s*RB\b[\s\S]*\d+\s*TE\b/i.test(parts[1]);
      if (packageSet) {
        return {
          formation: parts[0],
          set: parts[1],
          personnel: "",
          label: [parts[0], parts[1]].filter(Boolean).join(" - "),
        };
      }
      var maybePersonnel = /\b\d+\s*RB\b/i.test(parts[1]) || /\b\d+\s*TE\b/i.test(parts[1]);
      return {
        formation: parts[0],
        set: maybePersonnel ? "" : parts[1],
        personnel: maybePersonnel ? parts[1] : "",
        label: [parts[0], parts[1]].filter(Boolean).join(" - "),
      };
    }
    var personnelOnly = joined.match(/\b\d+\s*RB\b[\s\S]*$/i);
    if (personnelOnly && lines.length >= 2) {
      var repairedLine0 = repairIFormFormationName(lines[0]);
      return {
        formation: repairedLine0,
        set: lines.slice(1, -1).join(" - ") || lines[1],
        personnel: personnelOnly[0],
        label: [repairedLine0].concat(lines.slice(1)).filter(Boolean).join(" - "),
      };
    }
    var tokens = joined.split(/\s+/).filter(Boolean);
    var formationToken = repairIFormFormationName(tokens[0] || joined);
    var setTokens = tokens.slice(1);
    return {
      formation: formationToken,
      set: setTokens.join(" "),
      personnel: "",
      label: [formationToken, setTokens.join(" ")].filter(Boolean).join(" - "),
    };
  }

  /**
   * Strip leading OCR chrome before catalog match ("i BERET ae RPO ZONE READ BUBBLE").
   * Returns the longest trailing run where every token is solid football-ish text.
   */
  function stripNoisyPreviousPlayPrefix(value) {
    var repaired = typeof repairPreviousPlayOcrText === "function"
      ? repairPreviousPlayOcrText(value)
      : "";
    var text = (repaired || sanitizeHudText(value)).replace(/\s+/g, " ").trim();
    if (!text || isGarbagePreviousPlayOcr(text)) return text;
    var tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length <= 2) return text;
    function solid(token) {
      return /[A-Za-z]{3,}/.test(token) || /^\d{1,2}$/.test(token);
    }
    for (var start = 0; start < tokens.length - 1; start += 1) {
      var slice = tokens.slice(start);
      if (slice.length >= 2 && slice.every(solid)) return slice.join(" ");
    }
    return text;
  }

  function significantTokens(value) {
    return sanitizeHudText(value)
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .map(function (token) { return token.trim(); })
      .filter(function (token) {
        return token.length >= 2 && !/^(AND|THE|A|OF|TO)$/.test(token);
      });
  }

  return {
    sanitizeHudText: sanitizeHudText,
    foldOcrDigits: foldOcrDigits,
    repairDownDistanceOcrText: repairDownDistanceOcrText,
    repairPreviousPlayOcrText: repairPreviousPlayOcrText,
    parseDownDistanceText: parseDownDistanceText,
    hasDownDistanceStructure: hasDownDistanceStructure,
    fieldSideFromArrowGlyphs: fieldSideFromArrowGlyphs,
    parseFieldPositionText: parseFieldPositionText,
    isEmptyPreviousPlayOcr: isEmptyPreviousPlayOcr,
    isGarbagePreviousPlayOcr: isGarbagePreviousPlayOcr,
    stripNoisyPreviousPlayPrefix: stripNoisyPreviousPlayPrefix,
    parseQuarterClockText: parseQuarterClockText,
    parseScoresText: parseScoresText,
    parseFormationPersonnelText: parseFormationPersonnelText,
    significantTokens: significantTokens,
  };
});
