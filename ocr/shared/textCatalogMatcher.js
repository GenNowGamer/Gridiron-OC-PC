(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironOcrTextCatalogMatcher = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var OCR_CHAR_MAP = { "0": "O", "1": "I", "5": "S", "8": "B" };

  function normalizeOcrText(value, options) {
    var cfg = options || {};
    var result = String(value == null ? "" : value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[|\/\\]+/g, " ")
      .replace(/[^A-Z0-9&+\- ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cfg.foldDigits === true) {
      result = result.replace(/[0158]/g, function (ch) { return OCR_CHAR_MAP[ch] || ch; });
    }
    return result;
  }

  function tokens(value) {
    var normalized = normalizeOcrText(value);
    return normalized ? normalized.split(" ") : [];
  }

  function levenshtein(a, b) {
    var left = normalizeOcrText(a);
    var right = normalizeOcrText(b);
    var previous = [];
    var current = [];
    var i;
    var j;
    for (j = 0; j <= right.length; j += 1) previous[j] = j;
    for (i = 1; i <= left.length; i += 1) {
      current[0] = i;
      for (j = 1; j <= right.length; j += 1) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
        );
      }
      previous = current.slice();
    }
    return previous[right.length] || left.length;
  }

  function tokenSimilarity(a, b) {
    var aa = tokens(a);
    var bb = tokens(b);
    if (!aa.length || !bb.length) return 0;
    var hits = aa.reduce(function (sum, token) {
      var best = bb.reduce(function (score, other) {
        var size = Math.max(token.length, other.length, 1);
        return Math.max(score, 1 - levenshtein(token, other) / size);
      }, 0);
      return sum + best;
    }, 0);
    return hits / Math.max(aa.length, bb.length);
  }

  function similarity(a, b) {
    var left = normalizeOcrText(a);
    var right = normalizeOcrText(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    var edit = 1 - levenshtein(left, right) / Math.max(left.length, right.length, 1);
    var token = (tokenSimilarity(left, right) + tokenSimilarity(right, left)) / 2;
    var containment = left.includes(right) || right.includes(left)
      ? Math.min(left.length, right.length) / Math.max(left.length, right.length)
      : 0;
    // Glued OCR ("READOPTION") vs spaced catalog ("READ OPTION"): compare compacted forms.
    var compactLeft = left.replace(/\s+/g, "");
    var compactRight = right.replace(/\s+/g, "");
    var compact = compactLeft === compactRight
      ? 1
      : (1 - levenshtein(compactLeft, compactRight)
        / Math.max(compactLeft.length, compactRight.length, 1));
    return Math.max(0, Math.min(1, Math.max(
      edit * 0.55 + token * 0.35 + containment * 0.1,
      compact * 0.92
    )));
  }

  function field(entry, names) {
    for (var i = 0; i < names.length; i += 1) {
      if (entry && entry[names[i]] != null) return entry[names[i]];
    }
    return "";
  }

  function scopeCatalog(catalog, scope) {
    var cfg = scope || {};
    var team = normalizeOcrText(cfg.team || cfg.teamCode, { foldDigits: false });
    var formation = normalizeOcrText(cfg.formation);
    var set = normalizeOcrText(cfg.set);
    return (Array.isArray(catalog) ? catalog : []).filter(function (entry) {
      var entryTeam = normalizeOcrText(field(entry, ["team", "teamCode"]), { foldDigits: false });
      var entryFormation = normalizeOcrText(field(entry, ["formation"]));
      var entrySet = normalizeOcrText(field(entry, ["set"]));
      return (!team || !entryTeam || entryTeam === team) &&
        (!formation || !entryFormation || entryFormation === formation) &&
        (!set || !entrySet || entrySet === set);
    });
  }

  function significantTokens(value, options) {
    return normalizeOcrText(value, options)
      .split(" ")
      .filter(function (token) {
        return token.length >= 2 && !/^(AND|THE|A|OF|TO)$/.test(token);
      });
  }

  function tokenClose(a, b) {
    if (a === b) return true;
    var size = Math.max(a.length, b.length, 1);
    return (1 - levenshtein(a, b) / size) >= 0.8;
  }

  /**
   * Fail-closed: catalog labels must share meaningful tokens with raw OCR,
   * so garbage like "FS FIRE 1" cannot resolve to an unrelated "4-3 Under".
   */
  function rawAgreesWithMatch(rawText, matchedLabel, options) {
    var cfg = options || {};
    var minSimilarity = Number.isFinite(Number(cfg.minAgreementSimilarity))
      ? Number(cfg.minAgreementSimilarity) : 0.82;
    var minOverlapRatio = Number.isFinite(Number(cfg.minTokenOverlapRatio))
      ? Number(cfg.minTokenOverlapRatio) : 0.5;
    var label = String(matchedLabel == null ? "" : matchedLabel);
    if (!cleanish(rawText) || !cleanish(label)) return false;
    var sim = similarity(rawText, label);
    if (sim >= minSimilarity) return true;
    // Compacted OCR vs spaced catalog labels (READOPTION / READ OPTION).
    var compactRaw = normalizeOcrText(rawText).replace(/\s+/g, "");
    var compactLabel = normalizeOcrText(label).replace(/\s+/g, "");
    if (compactRaw && compactLabel) {
      var compactSim = compactRaw === compactLabel
        ? 1
        : (1 - levenshtein(compactRaw, compactLabel)
          / Math.max(compactRaw.length, compactLabel.length, 1));
      if (compactSim >= minSimilarity) return true;
    }
    var rawTokens = significantTokens(rawText, { foldDigits: false });
    var matchTokens = significantTokens(label, { foldDigits: false });
    if (!rawTokens.length || !matchTokens.length) return false;
    var overlap = rawTokens.filter(function (token) {
      return matchTokens.some(function (other) { return tokenClose(token, other); });
    }).length;
    return overlap >= 1 && (overlap / rawTokens.length) >= minOverlapRatio;
  }

  function cleanish(value) {
    return String(value == null ? "" : value).trim();
  }

  function matchCatalogText(rawText, catalog, scope, options) {
    var cfg = options || {};
    var query = normalizeOcrText(rawText, { foldDigits: cfg.foldDigits === true });
    var candidates = scopeCatalog(catalog, scope).map(function (entry) {
      var aliases = [field(entry, ["play_name", "playName", "name", "label"])]
        .concat(Array.isArray(entry.aliases) ? entry.aliases : [])
        .filter(Boolean);
      var score = aliases.reduce(function (best, alias) {
        return Math.max(best, similarity(query, alias));
      }, 0);
      return { entry: entry, score: score, matchedText: aliases[0] || "" };
    }).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.matchedText).localeCompare(String(b.matchedText));
    });
    var best = candidates[0] || null;
    var runnerUp = candidates[1] || null;
    var minScore = Number.isFinite(Number(cfg.minScore)) ? Number(cfg.minScore) : 0.72;
    var margin = Number.isFinite(Number(cfg.ambiguityMargin)) ? Number(cfg.ambiguityMargin) : 0.06;
    var ambiguous = !!(best && runnerUp && best.score - runnerUp.score < margin);
    // Same play name under different formations/sets is not a real conflict for OCR labels.
    if (ambiguous && best && runnerUp) {
      var bestPlay = normalizeOcrText(field(best.entry, ["play_name", "playName", "name", "label"]));
      var runnerPlay = normalizeOcrText(field(runnerUp.entry, ["play_name", "playName", "name", "label"]));
      if (bestPlay && bestPlay === runnerPlay) ambiguous = false;
    }
    var matched = best && best.score >= minScore && !ambiguous ? best.entry : null;
    var matchedLabel = matched
      ? (field(matched, ["play_name", "playName", "name", "label", "formation", "set"]) || best.matchedText)
      : "";
    if (matched && cfg.requireRawAgreement !== false) {
      var agreementLabel = cfg.agreementLabel || matchedLabel;
      if (!rawAgreesWithMatch(rawText, agreementLabel, cfg)) {
        matched = null;
      }
    }
    return {
      rawText: String(rawText == null ? "" : rawText),
      normalizedText: query,
      match: matched,
      score: best ? best.score : 0,
      ambiguous: ambiguous,
      rejectedForRawDisagreement: Boolean(best && best.score >= minScore && !ambiguous && !matched),
      alternatives: candidates.slice(0, Number(cfg.limit) || 3),
      scopedCount: candidates.length,
    };
  }

  return {
    normalizeOcrText: normalizeOcrText,
    levenshtein: levenshtein,
    similarity: similarity,
    scopeCatalog: scopeCatalog,
    matchCatalogText: matchCatalogText,
    fuzzyMatchCatalog: matchCatalogText,
    rawAgreesWithMatch: rawAgreesWithMatch,
    significantTokens: significantTokens,
  };
});
