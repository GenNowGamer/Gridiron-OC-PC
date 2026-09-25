(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironOcrContracts = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PROFILE_VERSION = 1;
  var REGION_KINDS = ["scoreboard", "offense_team", "formation", "set", "play", "result"];

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function finite(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeRect(rect, frame) {
    var source = rect || {};
    var width = Math.max(1, Math.round(finite(frame && frame.width, 1)));
    var height = Math.max(1, Math.round(finite(frame && frame.height, 1)));
    var normalized = source.normalized === true ||
      [source.x, source.y, source.width, source.height].every(function (v) {
        return Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1;
      });
    var x = finite(source.x, 0);
    var y = finite(source.y, 0);
    var w = finite(source.width, source.w == null ? 0 : source.w);
    var h = finite(source.height, source.h == null ? 0 : source.h);
    if (normalized) {
      x *= width;
      y *= height;
      w *= width;
      h *= height;
    }
    x = clamp(Math.round(x), 0, width - 1);
    y = clamp(Math.round(y), 0, height - 1);
    w = clamp(Math.round(w), 1, width - x);
    h = clamp(Math.round(h), 1, height - y);
    return { x: x, y: y, width: w, height: h };
  }

  function rectToNormalized(rect, frame) {
    var bounded = normalizeRect(Object.assign({}, rect, { normalized: false }), frame);
    var width = Math.max(1, finite(frame && frame.width, 1));
    var height = Math.max(1, finite(frame && frame.height, 1));
    return {
      x: bounded.x / width,
      y: bounded.y / height,
      width: bounded.width / width,
      height: bounded.height / height,
      normalized: true,
    };
  }

  function normalizeRegion(name, input, frame) {
    var source = input || {};
    return {
      id: text(source.id || name).toLowerCase().replace(/\s+/g, "_"),
      kind: text(source.kind || name).toLowerCase(),
      rect: normalizeRect(source.rect || source, frame),
      scale: clamp(finite(source.scale, 1), 0.25, 8),
      threshold: clamp(finite(source.threshold, 0.5), 0, 1),
      enabled: source.enabled !== false,
      whitelist: text(source.whitelist),
    };
  }

  function normalizeProfile(input, frameOverride) {
    var source = input || {};
    var sourceFrame = frameOverride || source.frame || {};
    var frame = {
      width: Math.max(1, Math.round(finite(sourceFrame.width, 1920))),
      height: Math.max(1, Math.round(finite(sourceFrame.height, 1080))),
    };
    var rawRegions = source.regions || {};
    var regions = {};
    if (Array.isArray(rawRegions)) {
      rawRegions.forEach(function (region, index) {
        var key = text(region && (region.id || region.kind)) || ("region_" + index);
        regions[key] = normalizeRegion(key, region, frame);
      });
    } else {
      Object.keys(rawRegions).forEach(function (key) {
        regions[key] = normalizeRegion(key, rawRegions[key], frame);
      });
    }
    return {
      version: PROFILE_VERSION,
      id: text(source.id || source.profileId || "default"),
      name: text(source.name || source.id || "Default"),
      game: text(source.game || "Madden"),
      frame: frame,
      regions: regions,
      matching: {
        minScore: clamp(finite(source.matching && source.matching.minScore, 0.72), 0, 1),
        ambiguityMargin: clamp(finite(source.matching && source.matching.ambiguityMargin, 0.06), 0, 1),
      },
    };
  }

  function validateProfile(profile) {
    var errors = [];
    if (!profile || typeof profile !== "object") errors.push("profile must be an object");
    if (!profile || !profile.frame || !Number.isFinite(profile.frame.width) || !Number.isFinite(profile.frame.height)) {
      errors.push("frame dimensions are required");
    }
    Object.keys((profile && profile.regions) || {}).forEach(function (key) {
      var rect = profile.regions[key] && profile.regions[key].rect;
      if (!rect || rect.width <= 0 || rect.height <= 0) errors.push("region " + key + " has invalid bounds");
    });
    return { valid: errors.length === 0, errors: errors };
  }

  return {
    PROFILE_VERSION: PROFILE_VERSION,
    REGION_KINDS: REGION_KINDS,
    clamp: clamp,
    normalizeRect: normalizeRect,
    boundRoi: normalizeRect,
    rectToNormalized: rectToNormalized,
    normalizeRegion: normalizeRegion,
    normalizeProfile: normalizeProfile,
    validateProfile: validateProfile,
  };
});
