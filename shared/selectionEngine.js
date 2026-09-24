/**
 * Gridiron OC / DC Composite Recommendation Engine
 *
 * Implements the Gemini blueprint:
 *   S = W1·B + W2·D + W3·C + W4·T − P_decay − P_predictability
 * then diversity-bucket slate selection:
 *   #1 Primary (top score)
 *   #2 Alt formation / complementary counter
 *   #3 Softmax exploration wildcard among under-used eligible plays
 *
 * Soft score taxes alone cannot force variety; bucket policy + hard bans do.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.GridironSelectionEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function cleanText(value) {
    return String(value == null ? "" : value).trim();
  }

  function lower(value) {
    return cleanText(value).toLowerCase();
  }

  function upper(value) {
    return cleanText(value).toUpperCase();
  }

  function defaultRng() {
    return Math.random();
  }

  function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  const COMPOSITE_DEFAULTS = {
    enabled: true,
    weights: {
      base: 1.0,
      defense: 0.85,
      team: 0.55,
      success: 0.9,
    },
    // Recency decay: P = K * exp(-λ * Δplays)
    decayK: 16,
    decayLambda: 0.32,
    decayWindow: 15,
    // Predictability: same concept N times in a short window → heavy ban
    predictabilityWindow: 6,
    predictabilityRepeatThreshold: 3,
    predictabilityPenalty: 24,
    predictabilityBanPlays: 5,
    // Concept learning: boost concept globally; diminish specific shell
    conceptSuccessWeight: 1.0,
    conceptFailureWeight: 0.85,
    conceptBoostCap: 14,
    shellDiminishFactor: 0.4,
    // Hard shown bans (any slate slot) — counted in distinct recommendation *batches*, not flat entries.
    shownPlayBanBatches: 14,
    shownConceptBanBatches: 7,
    shownShellBanBatches: 5,
    shownFamilyBanBatches: 3,
    // Session hard cap: max distinct sheets a playId may appear in (any slot) this game.
    sessionPlayCap: 2,
    // Soft tax after each prior sheet appearance (before hard cap).
    sessionPlayRepeatTax: 22,
    // Wildcard / exploration
    wildcardPoolPercentile: 0.5,
    wildcardMinPool: 14,
    wildcardMaxPool: 48,
    wildcardTemperature: 2.35,
    underusedBonus: 3.5,
    // Slate rules
    limit: 3,
    requireUniqueFamilyType: true,
    requireUniqueShell: true,
    requireUniqueConcept: true,
    requireUniqueFormation: false,
    complementaryPaBoost: 2.75,
  };

  // Back-compat alias used by older smokes / flags.
  const SELECTION_DEFAULTS = Object.assign({}, COMPOSITE_DEFAULTS);

  function resolvePolicy(override) {
    const next = Object.assign({}, COMPOSITE_DEFAULTS, override && typeof override === "object" ? override : {});
    next.weights = Object.assign({}, COMPOSITE_DEFAULTS.weights, (override && override.weights) || {});
    return next;
  }

  function playOf(item) {
    return item && item.play ? item.play : item;
  }

  function readScore(item, scoreKey) {
    const key = scoreKey || "_score";
    const direct = Number(item && item[key]);
    if (Number.isFinite(direct)) return direct;
    const nested = Number(item && item.score);
    return Number.isFinite(nested) ? nested : 0;
  }

  function resolveFamily(item, familyOf) {
    const play = playOf(item);
    if (item && item._family) return lower(item._family);
    if (item && item._selectionFamily) return lower(item._selectionFamily);
    if (item && item.coverageFamily) return lower(item.coverageFamily);
    if (item && item.family) return lower(item.family);
    if (typeof familyOf === "function") return lower(familyOf(play));
    return lower(play && (play.family || play._family));
  }

  function resolveShell(item, formationSetKeyOf) {
    const play = playOf(item);
    if (item && item._shellKey) return lower(item._shellKey);
    if (item && item._selectionShell) return lower(item._selectionShell);
    if (item && item.packageKey) return lower(item.packageKey);
    if (typeof formationSetKeyOf === "function") return lower(formationSetKeyOf(play));
    const formation = cleanText(play && play.formation);
    const set = cleanText(play && play.set);
    if (formation && set) return lower(formation + "|" + set);
    if (item && item.formation) return lower(item.formation);
    return "";
  }

  function resolveConcept(item, normalizedConceptKey) {
    const play = playOf(item);
    if (item && item._selectionConcept) return lower(item._selectionConcept);
    if (item && item.coverageFamily) return lower(item.coverageFamily);
    if (typeof normalizedConceptKey === "function") return lower(normalizedConceptKey(play));
    const concepts = play && play.concepts;
    if (Array.isArray(concepts) && concepts[0]) return lower(concepts[0]);
    if (item && item.family) return lower(item.family);
    return lower(play && play.id);
  }

  function resolvePlayId(item) {
    const play = playOf(item);
    if (item && item.packageKey) return cleanText(item.packageKey);
    return cleanText(play && play.id);
  }

  function resolveFormation(item) {
    const play = playOf(item);
    if (item && item.formation) return upper(item.formation);
    return upper(play && play.formation);
  }

  function resolveType(item) {
    const play = playOf(item);
    return upper(play && play.type) || "OTHER";
  }

  /**
   * EPA-style success grading (Gemini thresholds).
   * Returns { success: boolean, successPoints: number, rate: number|null }
   */
  function gradeEpaSuccess(params) {
    const down = Number(params && params.down);
    const yardsToGo = Number(params && params.yardsToGo);
    const yardsGained = Number(params && params.yardsGained);
    if (!Number.isFinite(yardsGained)) {
      return { success: false, successPoints: 0, rate: null };
    }
    if (!Number.isFinite(yardsToGo) || yardsToGo <= 0) {
      const success = yardsGained > 0;
      return { success: success, successPoints: success ? 1 : -1, rate: null };
    }
    const rate = yardsGained / yardsToGo;
    let needed = 1;
    if (down === 1) needed = 0.45;
    else if (down === 2) needed = 0.6;
    else needed = 1;
    const success = rate + 1e-9 >= needed || yardsGained >= yardsToGo;
    let successPoints = 0;
    if (success) {
      successPoints = down >= 3 ? 2.75 : (down === 1 ? 1.5 : 2.0);
      if (yardsGained >= 12) successPoints += 0.5;
    } else if (yardsGained <= 0) {
      successPoints = -1.5;
    } else {
      successPoints = -0.75;
    }
    return { success: success, successPoints: successPoints, rate: rate };
  }

  /**
   * Composite contextual score:
   * S = W1·B + W2·D + W3·C + W4·T − P_decay − P_predictability
   */
  function composeScore(parts, policy) {
    const cfg = resolvePolicy(policy);
    const w = cfg.weights;
    const base = Number(parts && parts.base) || 0;
    const defense = Number(parts && parts.defense) || 0;
    const team = Number(parts && parts.team) || 0;
    const success = Number(parts && parts.success) || 0;
    const decay = Math.max(0, Number(parts && parts.decay) || 0);
    const predictability = Math.max(0, Number(parts && parts.predictability) || 0);
    const score =
      w.base * base +
      w.defense * defense +
      w.team * team +
      w.success * success -
      decay -
      predictability;
    return {
      score: score,
      parts: {
        base: base,
        defense: defense,
        team: team,
        success: success,
        decay: decay,
        predictability: predictability,
      },
    };
  }

  function playsElapsedSince(recentCalls, matcher) {
    const list = Array.isArray(recentCalls) ? recentCalls : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (matcher(list[i])) return list.length - 1 - i;
    }
    return null;
  }

  /**
   * Recency / memory decay: K · e^{-λ·Δt} for exact play, shell, and concept.
   */
  function recencyDecayPenalty(identity, recentCalls, policy) {
    const cfg = resolvePolicy(policy);
    const window = Array.isArray(recentCalls) ? recentCalls.slice(-(Number(cfg.decayWindow) || 15)) : [];
    if (!window.length) return 0;

    const playId = cleanText(identity && identity.playId);
    const shell = lower(identity && identity.shell);
    const concept = lower(identity && identity.concept);
    const family = lower(identity && identity.family);

    let penalty = 0;
    const addDecay = function (delta, scale) {
      if (delta == null) return;
      penalty += (Number(cfg.decayK) || 16) * scale * Math.exp(-(Number(cfg.decayLambda) || 0.32) * delta);
    };

    addDecay(playsElapsedSince(window, function (call) {
      return playId && cleanText(call && (call.playId || call.id)) === playId;
    }), 1.0);

    addDecay(playsElapsedSince(window, function (call) {
      return shell && lower(call && (call.formationSetKey || call.shellKey || call.packageKey)) === shell;
    }), 0.72);

    addDecay(playsElapsedSince(window, function (call) {
      return concept && lower(call && (call.conceptKey || call.concept || call.coverageFamily)) === concept;
    }), 0.85);

    addDecay(playsElapsedSince(window, function (call) {
      return family && lower(call && call.family) === family;
    }), 0.55);

    return Math.min(penalty, 36);
  }

  /**
   * Predictability penalty: same concept repeated in a short window → heavy tax.
   */
  function predictabilityPenalty(identity, recentCalls, policy) {
    const cfg = resolvePolicy(policy);
    const window = Array.isArray(recentCalls)
      ? recentCalls.slice(-(Number(cfg.predictabilityWindow) || 6))
      : [];
    const concept = lower(identity && identity.concept);
    const family = lower(identity && identity.family);
    if (!window.length || (!concept && !family)) return 0;

    const needle = concept || family;
    let streak = 0;
    for (let i = window.length - 1; i >= 0; i -= 1) {
      const call = window[i];
      const callConcept = lower(call && (call.conceptKey || call.concept || call.coverageFamily || call.family));
      if (callConcept === needle) streak += 1;
      else break;
    }
    const count = window.filter(function (call) {
      const callConcept = lower(call && (call.conceptKey || call.concept || call.coverageFamily || call.family));
      return callConcept === needle;
    }).length;

    const threshold = Number(cfg.predictabilityRepeatThreshold) || 3;
    if (streak < threshold && count < threshold) return 0;
    const over = Math.max(streak, count) - threshold + 1;
    return Math.min((Number(cfg.predictabilityPenalty) || 24) * over, 48);
  }

  /**
   * Concept-level success learning:
   * boost concept globally; apply diminishing returns to the specific shell used.
   */
  function conceptSuccessAdjustment(identity, outcomeMemory, policy) {
    const cfg = resolvePolicy(policy);
    const list = Array.isArray(outcomeMemory) ? outcomeMemory : [];
    if (!list.length) return 0;
    const concept = lower(identity && identity.concept);
    const shell = lower(identity && identity.shell);
    if (!concept) return 0;

    let conceptPts = 0;
    let shellPts = 0;
    list.forEach(function (entry) {
      const entryConcept = lower(entry && (entry.conceptKey || entry.concept || entry.family));
      if (entryConcept !== concept) return;
      const pts = Number(entry && entry.successPoints);
      const signed = Number.isFinite(pts)
        ? pts
        : (entry && entry.success ? (Number(cfg.conceptSuccessWeight) || 1) : -(Number(cfg.conceptFailureWeight) || 0.85));
      conceptPts += signed;
      const entryShell = lower(entry && (entry.formationSetKey || entry.shellKey || entry.packageKey));
      if (shell && entryShell === shell) shellPts += signed;
    });

    const globalBoost = clamp(conceptPts * 0.55, -Number(cfg.conceptBoostCap), Number(cfg.conceptBoostCap));
    // Diminishing returns on the specific formation/shell that already earned the reps.
    const shellTax = shellPts > 0
      ? Math.min(shellPts * (Number(cfg.shellDiminishFactor) || 0.4), Number(cfg.conceptBoostCap) * 0.6)
      : 0;
    return globalBoost - shellTax;
  }

  function countRecentTail(list, value, n) {
    if (!value || !Array.isArray(list) || n <= 0) return 0;
    const needle = lower(value);
    return list.slice(-Math.max(1, n)).filter(function (entry) {
      return lower(entry) === needle;
    }).length;
  }

  function batchContains(batch, field, value) {
    if (!batch || !value) return false;
    const needle = field === "playIds" ? cleanText(value) : lower(value);
    const list = batch[field] || [];
    for (let i = 0; i < list.length; i += 1) {
      const entry = field === "playIds" ? cleanText(list[i]) : lower(list[i]);
      if (entry === needle) return true;
    }
    return false;
  }

  function countRecentBatchesWith(batchesNewestFirst, field, value, n) {
    if (!value || !Array.isArray(batchesNewestFirst) || n <= 0) return 0;
    const window = batchesNewestFirst.slice(0, Math.max(1, n));
    let hits = 0;
    for (let i = 0; i < window.length; i += 1) {
      if (batchContains(window[i], field, value)) hits += 1;
    }
    return hits;
  }

  function buildSelectionMemory(params) {
    const policy = resolvePolicy(params && params.policy);
    const recentGameCalls = Array.isArray(params && params.recentGameCalls) ? params.recentGameCalls : [];
    const exposure = Array.isArray(params && params.recommendationExposureHistory)
      ? params.recommendationExposureHistory
      : [];
    const driveExposure = Array.isArray(params && params.driveRecommendationExposure)
      ? params.driveRecommendationExposure
      : [];
    const outcomeMemory = Array.isArray(params && params.outcomeMemory) ? params.outcomeMemory : [];

    // Prefer game exposure for session counts; merge drive for recent bans (same batchId collapses).
    const mergedExposure = exposure.concat(driveExposure);
    const rankAnyByBatch = {};
    mergedExposure.forEach(function (entry) {
      if (!entry) return;
      const batchId = entry.batchId != null ? String(entry.batchId) : "unknown";
      if (!rankAnyByBatch[batchId]) rankAnyByBatch[batchId] = [];
      rankAnyByBatch[batchId].push(entry);
    });
    const batchIds = Object.keys(rankAnyByBatch).sort(function (a, b) {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return nb - na;
      return b.localeCompare(a);
    });

    const batchesNewestFirst = batchIds.map(function (batchId) {
      const playIds = [];
      const shells = [];
      const concepts = [];
      const families = [];
      const seenPlay = {};
      const seenShell = {};
      const seenConcept = {};
      const seenFamily = {};
      (rankAnyByBatch[batchId] || []).forEach(function (entry) {
        const playId = cleanText(entry.playId || entry.id || entry.packageKey);
        const shell = lower(entry.formationSetKey || entry.shellKey || entry.packageKey);
        const concept = lower(entry.conceptKey || entry.concept || entry.coverageFamily);
        const family = lower(entry.family);
        if (playId && !seenPlay[playId]) {
          seenPlay[playId] = true;
          playIds.push(playId);
        }
        if (shell && !seenShell[shell]) {
          seenShell[shell] = true;
          shells.push(shell);
        }
        if (concept && !seenConcept[concept]) {
          seenConcept[concept] = true;
          concepts.push(concept);
        }
        if (family && !seenFamily[family]) {
          seenFamily[family] = true;
          families.push(family);
        }
      });
      return {
        batchId: batchId,
        playIds: playIds,
        shells: shells,
        concepts: concepts,
        families: families,
      };
    });

    // Flat lists kept for underusedBonus / back-compat diagnostics (one entry per batch presence).
    const recentShownPlayIds = [];
    const recentShownShells = [];
    const recentShownConcepts = [];
    const recentShownFamilies = [];
    batchesNewestFirst.forEach(function (batch) {
      batch.playIds.forEach(function (id) { recentShownPlayIds.push(id); });
      batch.shells.forEach(function (id) { recentShownShells.push(id); });
      batch.concepts.forEach(function (id) { recentShownConcepts.push(id); });
      batch.families.forEach(function (id) { recentShownFamilies.push(id); });
    });

    // Session show counts from full game exposure only (distinct batches per playId).
    const playShowCounts = {};
    const gameBatches = {};
    exposure.forEach(function (entry) {
      if (!entry) return;
      const batchId = entry.batchId != null ? String(entry.batchId) : "unknown";
      const playId = cleanText(entry.playId || entry.id || entry.packageKey);
      if (!playId) return;
      if (!gameBatches[batchId]) gameBatches[batchId] = {};
      gameBatches[batchId][playId] = true;
    });
    Object.keys(gameBatches).forEach(function (batchId) {
      Object.keys(gameBatches[batchId]).forEach(function (playId) {
        playShowCounts[playId] = (playShowCounts[playId] || 0) + 1;
      });
    });

    return {
      recentGameCalls: recentGameCalls,
      outcomeMemory: outcomeMemory,
      recentShownPlayIds: recentShownPlayIds,
      recentShownShells: recentShownShells,
      recentShownConcepts: recentShownConcepts,
      recentShownFamilies: recentShownFamilies,
      batchesNewestFirst: batchesNewestFirst,
      playShowCounts: playShowCounts,
      policy: policy,
    };
  }

  function hardBanReason(memory, playId, shell, concept, family, policy) {
    const batches = memory && memory.batchesNewestFirst ? memory.batchesNewestFirst : [];
    const showCounts = memory && memory.playShowCounts ? memory.playShowCounts : {};
    const sessionCap = Number(policy.sessionPlayCap);
    if (playId && Number.isFinite(sessionCap) && sessionCap > 0) {
      if ((showCounts[cleanText(playId)] || 0) >= sessionCap) return "session_play_cap";
    }
    if (playId && countRecentBatchesWith(batches, "playIds", playId, policy.shownPlayBanBatches) > 0) {
      return "shown_play_ban";
    }
    if (concept && countRecentBatchesWith(batches, "concepts", concept, policy.shownConceptBanBatches) > 0) {
      return "shown_concept_ban";
    }
    if (shell && countRecentBatchesWith(batches, "shells", shell, policy.shownShellBanBatches) > 0) {
      return "shown_shell_ban";
    }
    if (family && countRecentBatchesWith(batches, "families", family, policy.shownFamilyBanBatches) > 0) {
      return "shown_family_ban";
    }
    // Predictability ban window: concept called repeatedly → hard exclude briefly.
    const window = (memory.recentGameCalls || []).slice(-(Number(policy.predictabilityBanPlays) || 5));
    if (concept && window.length) {
      const hits = window.filter(function (call) {
        return lower(call && (call.conceptKey || call.concept || call.coverageFamily || call.family)) === concept;
      }).length;
      if (hits >= (Number(policy.predictabilityRepeatThreshold) || 3)) return "predictability_ban";
    }
    return null;
  }

  function sessionRepeatTax(identity, memory, policy) {
    const playId = cleanText(identity && identity.playId);
    if (!playId) return 0;
    const shows = (memory && memory.playShowCounts && memory.playShowCounts[playId]) || 0;
    if (shows <= 0) return 0;
    const tax = Number(policy.sessionPlayRepeatTax);
    return (Number.isFinite(tax) ? tax : 22) * shows;
  }

  function underusedBonus(identity, memory, policy) {
    const concept = lower(identity && identity.concept);
    const playId = cleanText(identity && identity.playId);
    const calls = memory && memory.recentGameCalls ? memory.recentGameCalls : [];
    const showCounts = memory && memory.playShowCounts ? memory.playShowCounts : {};
    const shownHits = playId ? (showCounts[playId] || 0) : 0;
    const conceptHits = concept
      ? calls.filter(function (call) {
        return lower(call && (call.conceptKey || call.concept || call.family)) === concept;
      }).length
      : 0;
    if (conceptHits === 0 && shownHits === 0) return Number(policy.underusedBonus) || 3.5;
    if (conceptHits <= 1 && shownHits <= 1) return (Number(policy.underusedBonus) || 3.5) * 0.45;
    return 0;
  }

  function annotateCandidates(scored, memory, helpers, policy) {
    const familyOf = helpers && helpers.familyOf;
    const formationSetKeyOf = helpers && helpers.formationSetKeyOf;
    const normalizedConceptKey = helpers && helpers.normalizedConceptKey;
    const scoreKey = (helpers && helpers.scoreKey) || "_score";

    return (Array.isArray(scored) ? scored : []).map(function (item) {
      const playId = resolvePlayId(item);
      const family = resolveFamily(item, familyOf);
      const shell = resolveShell(item, formationSetKeyOf);
      const concept = resolveConcept(item, normalizedConceptKey);
      const formation = resolveFormation(item);
      const type = resolveType(item);
      const identity = { playId: playId, shell: shell, concept: concept, family: family };

      const existingParts = item && item.compositeParts ? item.compositeParts : null;
      let base = existingParts ? Number(existingParts.base) || 0 : readScore(item, scoreKey);
      let defense = existingParts ? Number(existingParts.defense) || 0 : 0;
      let team = existingParts ? Number(existingParts.team) || 0 : 0;
      let success = existingParts ? Number(existingParts.success) || 0 : 0;

      // If caller already baked a flat score without parts, treat it as base.
      if (!existingParts && item && item.parts && typeof item.parts === "object") {
        // Map legacy constrained parts → Gemini tiers when present.
        const p = item.parts;
        base = (Number(p.situation) || 0) + (Number(p.script) || 0) + (Number(p.novelty) || 0);
        defense = Number(p.platform) || 0;
        team = Number(p.identity) || 0;
        success = (Number(p.learning) || 0) + (Number(p.variety) || 0);
      }

      const decay = recencyDecayPenalty(identity, memory.recentGameCalls, policy);
      const predictability = predictabilityPenalty(identity, memory.recentGameCalls, policy);
      const repeatTax = sessionRepeatTax(identity, memory, policy);
      success += conceptSuccessAdjustment(identity, memory.outcomeMemory, policy);
      success += underusedBonus(identity, memory, policy);

      const composed = composeScore({
        base: base,
        defense: defense,
        team: team,
        success: success,
        decay: decay + repeatTax,
        predictability: predictability,
      }, policy);

      const ban = hardBanReason(memory, playId, shell, concept, family, policy);
      const softBlocked = !!(item && (item._cooldownBlocked === true || item.cooldownBlocked === true));
      const showCount = (memory.playShowCounts && memory.playShowCounts[playId]) || 0;

      const next = Object.assign({}, item, {
        _selectionPlayId: playId,
        _selectionFamily: family,
        _selectionShell: shell,
        _selectionConcept: concept,
        _selectionFormation: formation,
        _selectionType: type,
        _selectionScore: composed.score,
        _compositeParts: composed.parts,
        _sessionShowCount: showCount,
        _rank1Blocked: softBlocked || !!ban,
        _slateBlocked: softBlocked || !!ban,
        _blockReasons: [softBlocked ? "recent_play_id" : null, ban].filter(Boolean),
        _selectionEngine: true,
      });
      if (item && item.play) next.play = item.play;
      next[scoreKey] = composed.score;
      next._score = composed.score;
      next.score = composed.score;
      return next;
    });
  }

  function familyTypeSig(item) {
    return (item._selectionFamily || "") + "|" + (item._selectionType || "");
  }

  function isComplementaryCounter(primary, candidate) {
    if (!primary || !candidate) return false;
    const aType = primary._selectionType;
    const bType = candidate._selectionType;
    const aFam = primary._selectionFamily;
    const bFam = candidate._selectionFamily;
    // PA / boot off a run primary, or run answer off a pass primary.
    if ((aType === "RUN" || aType === "RPO") && (bType === "PA" || bFam === "boot" || bFam === "play_action")) {
      return true;
    }
    if ((aType === "PASS" || aType === "PA") && (bType === "RUN" || bType === "RPO")) {
      return true;
    }
    if (aFam && bFam && aFam !== bFam && primary._selectionFormation !== candidate._selectionFormation) {
      return true;
    }
    return false;
  }

  function canAdd(item, slate, policy, opts) {
    opts = opts || {};
    if (!item) return { ok: false, reason: "empty" };
    const reasons = Array.isArray(item._blockReasons) ? item._blockReasons : [];
    // Session hard cap is never bypassed — even when the eligible pool is empty.
    if (reasons.indexOf("session_play_cap") >= 0) {
      return { ok: false, reason: "session_play_cap" };
    }
    if (!opts.allowBanned && item._slateBlocked) {
      return { ok: false, reason: (item._blockReasons && item._blockReasons[0]) || "banned" };
    }
    const playId = item._selectionPlayId;
    if (slate.some(function (entry) { return entry._selectionPlayId === playId; })) {
      return { ok: false, reason: "duplicate_play" };
    }
    if (policy.requireUniqueFamilyType !== false) {
      const sig = familyTypeSig(item);
      if (slate.some(function (entry) { return familyTypeSig(entry) === sig; })) {
        return { ok: false, reason: "duplicate_family_type" };
      }
    }
    if (policy.requireUniqueShell !== false && item._selectionShell) {
      if (slate.some(function (entry) { return entry._selectionShell === item._selectionShell; })) {
        return { ok: false, reason: "duplicate_shell" };
      }
    }
    if (policy.requireUniqueConcept !== false && item._selectionConcept) {
      if (slate.some(function (entry) { return entry._selectionConcept === item._selectionConcept; })) {
        return { ok: false, reason: "duplicate_concept" };
      }
    }
    if (policy.requireUniqueFormation === true && item._selectionFormation) {
      if (slate.some(function (entry) { return entry._selectionFormation === item._selectionFormation; })) {
        return { ok: false, reason: "duplicate_formation" };
      }
    }
    if (opts.requireDifferentFormation && slate[0] && item._selectionFormation) {
      if (item._selectionFormation === slate[0]._selectionFormation) {
        return { ok: false, reason: "same_formation" };
      }
    }
    return { ok: true, reason: null };
  }

  function softmaxSample(pool, temperature, rng) {
    if (!pool || !pool.length) return null;
    if (pool.length === 1) return pool[0];
    const temp = Math.max(0.35, Number(temperature) || 2.35);
    const best = pool[0]._selectionScore;
    const weights = pool.map(function (item) {
      return Math.exp((item._selectionScore - best) / temp);
    });
    let total = 0;
    for (let i = 0; i < weights.length; i += 1) total += Math.max(0, weights[i]);
    if (!(total > 0)) return pool[0];
    const roll = typeof rng === "function" ? rng() : defaultRng();
    let cursor = clamp(roll, 0, 0.999999) * total;
    for (let i = 0; i < pool.length; i += 1) {
      cursor -= Math.max(0, weights[i]);
      if (cursor <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  function buildWildcardPool(annotated, slate, policy) {
    const sorted = annotated.slice().sort(function (a, b) {
      if (b._selectionScore !== a._selectionScore) return b._selectionScore - a._selectionScore;
      return cleanText(a._selectionPlayId).localeCompare(cleanText(b._selectionPlayId));
    });
    const percentile = clamp(Number(policy.wildcardPoolPercentile) || 0.5, 0.1, 1);
    const minPool = Number(policy.wildcardMinPool) || 14;
    const maxPool = Number(policy.wildcardMaxPool) || 48;
    const count = Math.min(maxPool, Math.max(minPool, Math.ceil(sorted.length * percentile)));
    const pool = sorted.slice(0, Math.max(count, Math.min(sorted.length, minPool)));
    const eligible = pool.filter(function (item) {
      return canAdd(item, slate, policy, { allowBanned: false }).ok;
    });
    // Prefer never-shown plays so slot #3 is not a stale-filler dump.
    const fresh = eligible.filter(function (item) {
      return !(Number(item._sessionShowCount) > 0);
    });
    return fresh.length ? fresh : eligible;
  }

  /**
   * Diversity bucket allocation (Gemini):
   * 1) Primary / exploitation — highest score among eligible
   * 2) Alt formation / complementary counter
   * 3) Softmax wildcard among under-used eligible plays
   */
  function selectDiversitySlate(params) {
    const policy = resolvePolicy(params && params.policy);
    const scoreKey = (params && params.scoreKey) || "_score";
    const limit = Number.isFinite(Number(params && params.limit))
      ? Math.max(1, Number(params.limit))
      : policy.limit;
    const rng = typeof (params && params.rng) === "function" ? params.rng : defaultRng;
    const helpers = {
      familyOf: params && params.familyOf,
      formationSetKeyOf: params && params.formationSetKeyOf,
      normalizedConceptKey: params && params.normalizedConceptKey,
      scoreKey: scoreKey,
    };

    const memory = buildSelectionMemory({
      recentGameCalls: params && params.recentGameCalls,
      recommendationExposureHistory: params && params.recommendationExposureHistory,
      driveRecommendationExposure: params && params.driveRecommendationExposure,
      outcomeMemory: params && params.outcomeMemory,
      policy: policy,
    });

    const annotated = annotateCandidates(
      Array.isArray(params && params.scored) ? params.scored : [],
      memory,
      helpers,
      policy
    ).sort(function (a, b) {
      if (b._selectionScore !== a._selectionScore) return b._selectionScore - a._selectionScore;
      return cleanText(a._selectionPlayId).localeCompare(cleanText(b._selectionPlayId));
    });

    const debug = {
      engine: "compositeDiversity",
      annotatedCount: annotated.length,
      eligibleCount: 0,
      pickReasons: [],
      bannedSample: annotated.filter(function (item) { return item._slateBlocked; }).slice(0, 8).map(function (item) {
        return {
          id: item._selectionPlayId,
          family: item._selectionFamily,
          concept: item._selectionConcept,
          reasons: item._blockReasons,
        };
      }),
    };

    const eligible = annotated.filter(function (item) { return !item._slateBlocked; });
    debug.eligibleCount = eligible.length;
    // Prefer fully eligible; if empty, allow soft/shown bans but never session-capped plays.
    const softPool = annotated.filter(function (item) {
      const reasons = Array.isArray(item._blockReasons) ? item._blockReasons : [];
      return reasons.indexOf("session_play_cap") < 0;
    });
    const pool = eligible.length ? eligible : (softPool.length ? softPool : []);

    const slate = [];
    const preferredForms = (Array.isArray(policy.preferredFormations) ? policy.preferredFormations : [])
      .map(function (name) { return upper(name); })
      .filter(Boolean);
    function inPreferredBand(item) {
      return preferredForms.indexOf(item && item._selectionFormation) >= 0;
    }
    const bandPool = preferredForms.length ? pool.filter(inPreferredBand) : [];

    const primarySource = bandPool.length ? bandPool : pool;
    const primary = primarySource.find(function (item) {
      return canAdd(item, slate, policy, { allowBanned: !eligible.length }).ok;
    }) || null;
    if (primary) {
      slate.push(primary);
      debug.pickReasons.push({ rank: 1, id: primary._selectionPlayId, via: "primary" });
    }

    if (bandPool.length && slate.length < limit) {
      const sibling = pool.find(function (item) {
        return inPreferredBand(item) && canAdd(item, slate, policy, { allowBanned: !eligible.length }).ok;
      }) || null;
      if (sibling) {
        slate.push(sibling);
        debug.pickReasons.push({ rank: slate.length, id: sibling._selectionPlayId, via: "personnel_band" });
      }
    }

    if (slate.length < limit) {
      const counters = pool
        .filter(function (item) {
          return canAdd(item, slate, policy, {
            allowBanned: !eligible.length,
            requireDifferentFormation: true,
          }).ok;
        })
        .map(function (item) {
          const boost = isComplementaryCounter(slate[0], item)
            ? (Number(policy.complementaryPaBoost) || 2.75)
            : 0;
          return { item: item, rankScore: item._selectionScore + boost };
        })
        .sort(function (a, b) { return b.rankScore - a.rankScore; });

      let alt = counters.length ? counters[0].item : null;
      if (!alt) {
        alt = pool.find(function (item) {
          return canAdd(item, slate, policy, { allowBanned: !eligible.length }).ok;
        }) || null;
      }
      if (alt) {
        slate.push(alt);
        debug.pickReasons.push({
          rank: 2,
          id: alt._selectionPlayId,
          via: counters.length && isComplementaryCounter(slate[0], alt) ? "counter" : "alt_formation",
        });
      }
    }

    // --- Slot 3: Softmax exploration wildcard ---
    if (slate.length < limit) {
      let wildPool = buildWildcardPool(pool, slate, policy);
      // Prefer a formation not already on the slate when alternatives exist.
      const usedFormations = {};
      slate.forEach(function (entry) {
        if (entry._selectionFormation) usedFormations[entry._selectionFormation] = true;
      });
      const freshFormationPool = wildPool.filter(function (item) {
        return !item._selectionFormation || !usedFormations[item._selectionFormation];
      });
      if (freshFormationPool.length) wildPool = freshFormationPool;

      let wild = softmaxSample(wildPool, policy.wildcardTemperature, rng);
      if (!wild) {
        wild = pool.find(function (item) {
          return canAdd(item, slate, policy, { allowBanned: true }).ok;
        }) || null;
      }
      if (wild) {
        slate.push(wild);
        debug.pickReasons.push({ rank: 3, id: wild._selectionPlayId, via: "wildcard_softmax" });
      }
    }

    // Fill any remaining slots greedily if limit > 3 or earlier slots failed.
    pool.forEach(function (item) {
      if (slate.length >= limit) return;
      if (!canAdd(item, slate, policy, { allowBanned: true }).ok) return;
      slate.push(item);
      debug.pickReasons.push({ rank: slate.length, id: item._selectionPlayId, via: "fill" });
    });

    const cleaned = slate.slice(0, limit).map(function (item) {
      const next = Object.assign({}, item);
      next._selectionEngine = true;
      next._score = item._selectionScore;
      next.score = item._selectionScore;
      if (scoreKey !== "_score" && scoreKey !== "score") {
        next[scoreKey] = item._selectionScore;
      }
      if (item && item.play) next.play = item.play;
      return next;
    });

    return { slate: cleaned, debug: debug };
  }

  /**
   * Back-compat entry used by Mobile/PC OC wiring.
   * Now routes through diversity-bucket selection + composite penalties.
   */
  function selectRecommendationSlate(params) {
    return selectDiversitySlate(params);
  }

  return {
    COMPOSITE_DEFAULTS: COMPOSITE_DEFAULTS,
    SELECTION_DEFAULTS: SELECTION_DEFAULTS,
    composeScore: composeScore,
    gradeEpaSuccess: gradeEpaSuccess,
    recencyDecayPenalty: recencyDecayPenalty,
    predictabilityPenalty: predictabilityPenalty,
    conceptSuccessAdjustment: conceptSuccessAdjustment,
    buildSelectionMemory: buildSelectionMemory,
    sessionRepeatTax: sessionRepeatTax,
    selectDiversitySlate: selectDiversitySlate,
    selectRecommendationSlate: selectRecommendationSlate,
  };
});
