(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironOcrTemporalConsensus = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function normalizeObservation(input, now) {
    var source = input || {};
    return {
      value: source.value == null ? null : source.value,
      key: String(source.key == null ? source.value == null ? "" : source.value : source.key),
      confidence: clamp(Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : 1, 0, 1),
      at: Number.isFinite(Number(source.at)) ? Number(source.at) : now,
    };
  }

  function computeConsensus(observations, options) {
    var cfg = options || {};
    var now = Number.isFinite(Number(cfg.now)) ? Number(cfg.now) : Date.now();
    var maxAgeMs = Number.isFinite(Number(cfg.maxAgeMs)) ? Number(cfg.maxAgeMs) : 1500;
    var maxSamples = Number.isFinite(Number(cfg.maxSamples)) ? Math.max(1, Number(cfg.maxSamples)) : 8;
    var minSamples = Number.isFinite(Number(cfg.minSamples)) ? Math.max(1, Number(cfg.minSamples)) : 3;
    var minConfidence = Number.isFinite(Number(cfg.minConfidence)) ? Number(cfg.minConfidence) : 0.68;
    var list = (Array.isArray(observations) ? observations : [])
      .map(function (item) { return normalizeObservation(item, now); })
      .filter(function (item) { return item.key && now - item.at <= maxAgeMs; })
      .slice(-maxSamples);
    var groups = {};
    var totalWeight = 0;
    list.forEach(function (item) {
      var age = Math.max(0, now - item.at);
      var recency = maxAgeMs > 0 ? clamp(1 - age / maxAgeMs, 0.2, 1) : 1;
      var weight = item.confidence * recency;
      totalWeight += weight;
      if (!groups[item.key]) groups[item.key] = { key: item.key, value: item.value, weight: 0, count: 0 };
      groups[item.key].weight += weight;
      groups[item.key].count += 1;
    });
    var ranked = Object.keys(groups).map(function (key) { return groups[key]; }).sort(function (a, b) {
      return b.weight - a.weight || b.count - a.count || a.key.localeCompare(b.key);
    });
    var winner = ranked[0] || null;
    var runnerUp = ranked[1] || null;
    var support = winner && totalWeight > 0 ? winner.weight / totalWeight : 0;
    var separation = winner && totalWeight > 0 ? (winner.weight - (runnerUp ? runnerUp.weight : 0)) / totalWeight : 0;
    var confidence = clamp(support * 0.8 + separation * 0.2, 0, 1);
    var stable = !!(winner && winner.count >= minSamples && confidence >= minConfidence);
    return {
      value: stable ? winner.value : null,
      candidate: winner ? winner.value : null,
      key: winner ? winner.key : "",
      confidence: confidence,
      support: support,
      sampleCount: list.length,
      winningSamples: winner ? winner.count : 0,
      stable: stable,
      observations: list,
    };
  }

  function addObservation(state, observation, options) {
    var previous = state && Array.isArray(state.observations) ? state.observations : [];
    return computeConsensus(previous.concat([observation]), options);
  }

  function createConsensusTracker(options) {
    var state = { observations: [] };
    return {
      push: function (observation) {
        state = addObservation(state, observation, options);
        return state;
      },
      snapshot: function () { return state; },
      reset: function () { state = { observations: [] }; return state; },
    };
  }

  return {
    normalizeObservation: normalizeObservation,
    computeConsensus: computeConsensus,
    addObservation: addObservation,
    createConsensusTracker: createConsensusTracker,
  };
});
