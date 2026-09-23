(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironOcrSnapLifecycle = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value) { return String(value == null ? "" : value).trim(); }

  function hashString(value) {
    var hash = 2166136261;
    var input = String(value);
    for (var i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function eventFingerprint(event) {
    var e = event || {};
    if (clean(e.id || e.eventId)) return clean(e.id || e.eventId);
    return hashString([
      clean(e.type),
      clean(e.snapId),
      clean(e.at),
      clean(e.playId),
      clean(e.state && e.state.quarter),
      clean(e.state && (e.state.clockSeconds != null ? e.state.clockSeconds : e.state.clock)),
    ].join("|"));
  }

  function createLifecycleState() {
    return { phase: "idle", currentSnap: null, completedSnaps: [], seenEventIds: {} };
  }

  function reduceLifecycle(state, event, options) {
    var cfg = options || {};
    var previous = state || createLifecycleState();
    var fingerprint = eventFingerprint(event);
    if (previous.seenEventIds[fingerprint]) {
      return { state: previous, accepted: false, duplicate: true, snap: previous.currentSnap };
    }
    var next = {
      phase: previous.phase,
      currentSnap: previous.currentSnap ? Object.assign({}, previous.currentSnap) : null,
      completedSnaps: previous.completedSnaps.slice(),
      seenEventIds: Object.assign({}, previous.seenEventIds),
    };
    next.seenEventIds[fingerprint] = true;
    var e = event || {};
    var type = clean(e.type).toLowerCase();
    var at = Number.isFinite(Number(e.at)) ? Number(e.at) : Date.now();
    var completed = null;

    if (type === "pre_snap" || type === "ready") {
      if (!next.currentSnap || next.phase === "ended") {
        var snapId = clean(e.snapId) || ("snap-" + hashString([at, e.playId, e.state && e.state.clockSeconds].join("|")));
        next.currentSnap = {
          id: snapId,
          phase: "pre_snap",
          startedAt: at,
          snappedAt: null,
          endedAt: null,
          preState: e.state || null,
          postState: null,
          offensePlay: e.offensePlay || null,
          defensePlay: e.defensePlay || null,
          observations: [],
          eventIds: [fingerprint],
        };
      } else {
        next.currentSnap.eventIds = next.currentSnap.eventIds.concat([fingerprint]);
      }
      next.phase = "pre_snap";
    } else if (type === "snap" || type === "snapped") {
      if (!next.currentSnap) {
        next.currentSnap = {
          id: clean(e.snapId) || ("snap-" + hashString([at, e.playId].join("|"))),
          startedAt: at,
          preState: e.state || null,
          offensePlay: e.offensePlay || null,
          defensePlay: e.defensePlay || null,
          observations: [],
          eventIds: [],
        };
      }
      next.currentSnap.phase = "snapped";
      next.currentSnap.snappedAt = at;
      next.currentSnap.eventIds = next.currentSnap.eventIds.concat([fingerprint]);
      next.phase = "snapped";
    } else if (type === "observation") {
      if (!next.currentSnap) return { state: previous, accepted: false, reason: "no_active_snap" };
      next.currentSnap.observations = next.currentSnap.observations.concat([e.observation || e]);
      next.currentSnap.eventIds = next.currentSnap.eventIds.concat([fingerprint]);
    } else if (type === "end" || type === "post_snap" || type === "whistle") {
      if (!next.currentSnap) return { state: previous, accepted: false, reason: "no_active_snap" };
      next.currentSnap.phase = "ended";
      next.currentSnap.endedAt = at;
      next.currentSnap.postState = e.state || e.postState || null;
      next.currentSnap.eventIds = next.currentSnap.eventIds.concat([fingerprint]);
      completed = next.currentSnap;
      next.completedSnaps = next.completedSnaps.concat([completed]).slice(-(Number(cfg.maxCompleted) || 64));
      next.currentSnap = null;
      next.phase = "ended";
    } else {
      return { state: previous, accepted: false, reason: "unknown_event_type" };
    }
    return { state: next, accepted: true, duplicate: false, snap: completed || next.currentSnap, completedSnap: completed };
  }

  function attributeToSnap(snaps, observation, options) {
    var cfg = options || {};
    var at = Number(observation && observation.at);
    var slack = Number.isFinite(Number(cfg.slackMs)) ? Number(cfg.slackMs) : 500;
    var candidates = (Array.isArray(snaps) ? snaps : []).filter(function (snap) {
      var start = Number(snap.startedAt);
      var end = Number(snap.endedAt == null ? Date.now() : snap.endedAt);
      return Number.isFinite(at) && at >= start - slack && at <= end + slack;
    }).sort(function (a, b) {
      return Math.abs(at - Number(b.snappedAt || b.startedAt)) - Math.abs(at - Number(a.snappedAt || a.startedAt));
    });
    return candidates[candidates.length - 1] || null;
  }

  return {
    createLifecycleState: createLifecycleState,
    eventFingerprint: eventFingerprint,
    reduceLifecycle: reduceLifecycle,
    applySnapEvent: reduceLifecycle,
    attributeToSnap: attributeToSnap,
  };
});
