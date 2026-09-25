(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.GridironPenaltyCatalog = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const EFFECT_VOID_SNAP = "void_snap";
  const EFFECT_SKIP_LEARN = "skip_learn";

  const PENALTY_CATALOG = [
    { id: "offside", label: "Offside", effect: EFFECT_SKIP_LEARN, hint: "Defense gift / free-play noise — not scored for learning" },
    { id: "false_start", label: "False Start", effect: EFFECT_VOID_SNAP, hint: "No play — void this confirm for learning and variety" },
    { id: "offensive_holding", label: "Offensive Holding", effect: EFFECT_SKIP_LEARN, hint: "Spot polluted — package learning skipped" },
    { id: "facemask", label: "Facemask", effect: EFFECT_SKIP_LEARN, hint: "Personal foul — package learning skipped" },
    { id: "illegal_block_in_back", label: "Illegal Block in the Back", effect: EFFECT_SKIP_LEARN, hint: "Spot polluted — package learning skipped" },
    { id: "roughing_the_passer", label: "Roughing the Passer", effect: EFFECT_SKIP_LEARN, hint: "Defense gift — package learning skipped" },
    { id: "defensive_pass_interference", label: "Defensive Pass Interference", effect: EFFECT_SKIP_LEARN, hint: "Free first down noise — package learning skipped" },
    { id: "ineligible_receiver", label: "Ineligible Receiver Downfield", effect: EFFECT_VOID_SNAP, hint: "Play wiped — void this confirm for learning and variety" },
    { id: "offensive_pass_interference", label: "Offensive Pass Interference", effect: EFFECT_SKIP_LEARN, hint: "Spot polluted — package learning skipped" },
    { id: "kick_catch_interference", label: "Kick Catch Interference", effect: EFFECT_SKIP_LEARN, hint: "Special teams — package learning skipped" },
    { id: "intentional_grounding", label: "Intentional Grounding", effect: EFFECT_SKIP_LEARN, hint: "Foul outcome — package learning skipped" },
    { id: "roughing_the_kicker", label: "Roughing the Kicker", effect: EFFECT_SKIP_LEARN, hint: "Special teams — package learning skipped" },
    { id: "running_into_kicker", label: "Running into the Kicker", effect: EFFECT_SKIP_LEARN, hint: "Special teams — package learning skipped" },
    { id: "illegal_contact", label: "Illegal Contact", effect: EFFECT_SKIP_LEARN, hint: "Defense gift — package learning skipped" },
  ];

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function getPenaltyMeta(id) {
    const needle = cleanText(id);
    if (!needle) return null;
    return PENALTY_CATALOG.find(function (item) {
      return item.id === needle;
    }) || null;
  }

  function normalizePenaltyStamp(input) {
    const meta = typeof input === "string" ? getPenaltyMeta(input) : getPenaltyMeta(input && input.id);
    if (!meta) return null;
    return {
      id: meta.id,
      label: meta.label,
      effect: meta.effect,
      at: Date.now(),
    };
  }

  function isVoidSnapPenalty(penalty) {
    const meta = typeof penalty === "string" ? getPenaltyMeta(penalty) : penalty;
    return cleanText(meta && meta.effect) === EFFECT_VOID_SNAP;
  }

  function shouldSkipLearningForPenalty(pendingOrPenalty) {
    const stamp = pendingOrPenalty && pendingOrPenalty.penalty
      ? pendingOrPenalty.penalty
      : pendingOrPenalty;
    if (!stamp) return false;
    const effect = cleanText(stamp.effect);
    return effect === EFFECT_VOID_SNAP || effect === EFFECT_SKIP_LEARN;
  }

  function formatPenaltyBarLabel(penalty) {
    const stamp = normalizePenaltyStamp(penalty);
    if (!stamp) return "";
    if (stamp.effect === EFFECT_VOID_SNAP) return "Penalty: " + stamp.label + " (void)";
    return "Penalty: " + stamp.label + " (no learn)";
  }

  /** Neutral report-only outcome — must not train personal learning / outcome memory. */
  function buildPenaltyOutcome(penalty) {
    const stamp = normalizePenaltyStamp(penalty);
    if (!stamp) return null;
    if (stamp.effect === EFFECT_VOID_SNAP) {
      return {
        successPoints: 0,
        yardsGained: null,
        firstDownAchieved: false,
        explosiveGain: false,
        negativePlay: false,
        stuffedPlay: false,
        penaltySkipLearn: true,
        penaltyVoid: true,
        penaltyId: stamp.id,
        penaltyLabel: stamp.label,
        terminalResult: "",
        inferredAt: Date.now(),
      };
    }
    return {
      successPoints: 0,
      yardsGained: null,
      firstDownAchieved: false,
      explosiveGain: false,
      negativePlay: false,
      stuffedPlay: false,
      penaltySkipLearn: true,
      penaltyVoid: false,
      penaltyId: stamp.id,
      penaltyLabel: stamp.label,
      terminalResult: "",
      inferredAt: Date.now(),
    };
  }

  return {
    EFFECT_VOID_SNAP,
    EFFECT_SKIP_LEARN,
    PENALTY_CATALOG,
    getPenaltyMeta,
    normalizePenaltyStamp,
    isVoidSnapPenalty,
    shouldSkipLearningForPenalty,
    formatPenaltyBarLabel,
    buildPenaltyOutcome,
  };
});
