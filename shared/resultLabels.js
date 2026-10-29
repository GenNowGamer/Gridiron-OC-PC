(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironResultLabels = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var BASELINE = 3;

  function clean(value) {
    return String(value == null ? "" : value).trim();
  }

  function contextOf(value) {
    return clean(value).toLowerCase() === "human" ? "human" : "cpu";
  }

  function emptyStore() {
    return { plays: {}, looks: {}, concepts: {} };
  }

  function normalizeStore(value) {
    var source = value && typeof value === "object" ? value : {};
    return {
      plays: source.plays && typeof source.plays === "object" ? source.plays : {},
      looks: source.looks && typeof source.looks === "object" ? source.looks : {},
      concepts: source.concepts && typeof source.concepts === "object" ? source.concepts : {},
    };
  }

  function playKey(input) {
    return [
      clean(input.opponent).toUpperCase(),
      contextOf(input.context),
      clean(input.slotId),
      clean(input.playId),
    ].join("|");
  }

  function lookKey(input, lookSide) {
    return [
      clean(input.opponent).toUpperCase(),
      contextOf(input.context),
      clean(lookSide),
    ].join("|");
  }

  function conceptKey(input, look) {
    return [
      clean(input.opponent).toUpperCase(),
      contextOf(input.context),
      clean(input.slotId),
      clean(input.family),
      clean(look),
    ].join("|");
  }

  function bump(bucket, success) {
    var next = {
      success: Number(bucket && bucket.success) || 0,
      failure: Number(bucket && bucket.failure) || 0,
    };
    if (success) next.success += 1;
    else next.failure += 1;
    return next;
  }

  function recordResult(store, input) {
    var safe = normalizeStore(store);
    var event = input || {};
    if (!clean(event.opponent) || !clean(event.playId) || !clean(event.slotId)) return safe;
    if (event.success !== true && event.success !== false) return safe;
    var plays = Object.assign({}, safe.plays);
    plays[playKey(event)] = bump(plays[playKey(event)], event.success === true);
    var looks = Object.assign({}, safe.looks);
    var concepts = Object.assign({}, safe.concepts);
    var look = clean(event.opponentLook);
    var lookSide = clean(event.lookSide) === "offense" ? "offense" : "defense";
    if (look) {
      var lKey = lookKey(event, lookSide);
      var lookBucket = Object.assign({}, looks[lKey] || {});
      lookBucket[look] = (Number(lookBucket[look]) || 0) + 1;
      looks[lKey] = lookBucket;
      if (clean(event.family)) {
        var cKey = conceptKey(event, look);
        concepts[cKey] = bump(concepts[cKey], event.success === true);
      }
    }
    return { plays: plays, looks: looks, concepts: concepts };
  }

  function rateFor(store, input) {
    var stat = normalizeStore(store).plays[playKey(input || {})];
    if (!stat) return null;
    var attempts = (Number(stat.success) || 0) + (Number(stat.failure) || 0);
    if (attempts < BASELINE) return null;
    return {
      attempts: attempts,
      successes: Number(stat.success) || 0,
      percent: Math.round(((Number(stat.success) || 0) / attempts) * 100),
    };
  }

  function topLook(store, input, lookSide) {
    var bucket = normalizeStore(store).looks[lookKey(input || {}, lookSide)] || {};
    var entries = Object.keys(bucket).map(function (name) {
      return { name: name, count: Number(bucket[name]) || 0 };
    }).filter(function (entry) { return entry.count > 0; }).sort(function (a, b) {
      return b.count - a.count || a.name.localeCompare(b.name);
    });
    var total = entries.reduce(function (sum, entry) { return sum + entry.count; }, 0);
    if (!entries.length || total < BASELINE) return null;
    return { name: entries[0].name, count: entries[0].count, total: total };
  }

  function reasonFor(store, input) {
    var query = input || {};
    var general = clean(query.generalReason) || "Fits this situation.";
    var lookSide = clean(query.lookSide) === "offense" ? "offense" : "defense";
    var look = topLook(store, query, lookSide);
    if (!look) return general;
    var concept = normalizeStore(store).concepts[conceptKey(query, look.name)];
    var attempts = concept ? (Number(concept.success) || 0) + (Number(concept.failure) || 0) : 0;
    var lead = look.name + " on " + look.count + " of " + look.total + ".";
    if (!attempts) return lead;
    return lead + " " + (clean(query.familyLabel) || "This concept") + " is " +
      (Number(concept.success) || 0) + " of " + attempts + " vs that look.";
  }

  function gradeSnap(before, after) {
    var prev = before || {};
    var next = after || {};
    var prevDown = Number(prev.down);
    var nextDown = Number(next.down);
    var prevYards = Number(prev.yards);
    var nextYards = Number(next.yards);
    if (!Number.isFinite(prevDown) || !Number.isFinite(nextDown)) return null;
    var prevAbs = absoluteYard(prev);
    var nextAbs = absoluteYard(next);
    var fieldGain = prevAbs != null && nextAbs != null ? nextAbs - prevAbs : null;
    // A yard-line jump past a single play is a misread, not a 70-yard gain.
    if (fieldGain != null && Math.abs(fieldGain) > 80) fieldGain = null;
    var distanceGain = null;
    if (nextDown === prevDown + 1 && Number.isFinite(prevYards) && Number.isFinite(nextYards)) distanceGain = prevYards - nextYards;
    else if (nextDown === 1 && prevDown !== 1 && Number.isFinite(prevYards)) distanceGain = prevYards;
    var sameDistance = Number.isFinite(prevYards) && Number.isFinite(nextYards) && prevYards === nextYards;
    // The play-call screen was read again. That is not a new result.
    if (nextDown === prevDown && sameDistance && (fieldGain == null || fieldGain === 0)) return null;
    // The yard line is how far the ball moved, including a first down that
    // comes back as another 1st & 10. Down and distance only fill in when
    // one of the yard lines was missed.
    var gained = fieldGain != null ? fieldGain : distanceGain;
    if (gained == null || !Number.isFinite(gained)) return null;
    var needed = Number.isFinite(prevYards) ? prevYards : null;
    var newSeries = nextDown === 1 && (
      prevDown !== 1 ||
      (needed != null && gained + 0.5 >= needed) ||
      (needed == null && gained > 0)
    );
    var success = false;
    if (newSeries || (needed != null && gained >= needed)) success = true;
    else if (needed != null && prevDown === 1) success = gained >= needed * 0.5;
    else if (needed != null && prevDown === 2) success = gained >= needed * 0.7;
    return { yardsGained: gained, success: success === true };
  }

  function absoluteYard(spot) {
    var yard = Number(spot && spot.fieldYard);
    var side = clean(spot && spot.fieldSide).toUpperCase();
    if (!Number.isFinite(yard)) return null;
    if (yard === 50) return 50;
    if (side === "OWN") return yard;
    if (side === "OPP") return 100 - yard;
    return null;
  }

  function summary(store, input) {
    var offense = topLook(store, input, "offense");
    var defense = topLook(store, input, "defense");
    return {
      theirOffense: offense ? offense.name + " · " + offense.count + " of " + offense.total : "Not enough yet",
      theirDefense: defense ? defense.name + " · " + defense.count + " of " + defense.total : "Not enough yet",
      record: defense
        ? defense.count + " of " + defense.total + " " + defense.name
        : "Not enough yet",
    };
  }

  return {
    BASELINE: BASELINE,
    emptyStore: emptyStore,
    normalizeStore: normalizeStore,
    recordResult: recordResult,
    rateFor: rateFor,
    reasonFor: reasonFor,
    gradeSnap: gradeSnap,
    summary: summary,
    topLook: topLook,
  };
});
