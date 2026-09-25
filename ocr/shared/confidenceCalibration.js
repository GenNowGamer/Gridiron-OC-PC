(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironOcrConfidenceCalibration = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DEFAULTS = Object.freeze({
    minOcrConfidence: 0.92,
    minResolverConfidence: 0.76,
    minFrameAgreement: 2 / 3,
    minCombinedScore: 0.88,
    ocrWeight: 0.45,
    resolverWeight: 0.35,
    agreementWeight: 0.2,
  });

  function clamp01(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
  }

  function mergeOptions(options) {
    var cfg = options || {};
    return {
      minOcrConfidence: Number.isFinite(Number(cfg.minOcrConfidence))
        ? Number(cfg.minOcrConfidence) : DEFAULTS.minOcrConfidence,
      minResolverConfidence: Number.isFinite(Number(cfg.minResolverConfidence))
        ? Number(cfg.minResolverConfidence) : DEFAULTS.minResolverConfidence,
      minFrameAgreement: Number.isFinite(Number(cfg.minFrameAgreement))
        ? Number(cfg.minFrameAgreement) : DEFAULTS.minFrameAgreement,
      minCombinedScore: Number.isFinite(Number(cfg.minCombinedScore))
        ? Number(cfg.minCombinedScore) : DEFAULTS.minCombinedScore,
      ocrWeight: Number.isFinite(Number(cfg.ocrWeight)) ? Number(cfg.ocrWeight) : DEFAULTS.ocrWeight,
      resolverWeight: Number.isFinite(Number(cfg.resolverWeight))
        ? Number(cfg.resolverWeight) : DEFAULTS.resolverWeight,
      agreementWeight: Number.isFinite(Number(cfg.agreementWeight))
        ? Number(cfg.agreementWeight) : DEFAULTS.agreementWeight,
      requireCatalog: cfg.requireCatalog === true || cfg.catalogField === true,
    };
  }

  function combinedConfidence(input, options) {
    var cfg = mergeOptions(options);
    var ocr = clamp01(input && input.ocrConfidence);
    var catalog = cfg.requireCatalog || (input && input.catalogField === true);
    var resolver = catalog ? clamp01(input.resolverConfidence) : 1;
    var agreement = clamp01(input && (input.framesAgree == null ? 1 : input.framesAgree));
    var weightSum = cfg.ocrWeight + cfg.resolverWeight + cfg.agreementWeight;
    if (weightSum <= 0) return 0;
    return (ocr * cfg.ocrWeight + resolver * cfg.resolverWeight + agreement * cfg.agreementWeight)
      / weightSum;
  }

  function decideFieldAcceptance(input, options) {
    var cfg = mergeOptions(options);
    var hasValue = Boolean(input && input.value);
    var ocr = clamp01(input && input.ocrConfidence);
    var resolver = clamp01(input && input.resolverConfidence);
    var agreement = clamp01(input && (input.framesAgree == null ? 1 : input.framesAgree));
    var catalogField = cfg.requireCatalog;
    var combined = combinedConfidence(input, cfg);
    var reasons = [];
    if (!hasValue) reasons.push("empty_value");
    if (ocr < cfg.minOcrConfidence) reasons.push("ocr_below_threshold");
    if (agreement < cfg.minFrameAgreement) reasons.push("agreement_below_threshold");
    if (catalogField && resolver < cfg.minResolverConfidence) reasons.push("resolver_below_threshold");
    if (combined < cfg.minCombinedScore) reasons.push("combined_below_threshold");
    return {
      accepted: reasons.length === 0,
      combinedConfidence: Math.round(combined * 10000) / 10000,
      calibratedConfidence: Math.round(combined * 10000) / 10000,
      ocrConfidence: ocr,
      resolverConfidence: resolver,
      framesAgree: agreement,
      reasons: reasons,
      thresholds: cfg,
    };
  }

  return {
    DEFAULTS: DEFAULTS,
    combinedConfidence: combinedConfidence,
    decideFieldAcceptance: decideFieldAcceptance,
    calibrateFieldAcceptance: decideFieldAcceptance,
  };
});
