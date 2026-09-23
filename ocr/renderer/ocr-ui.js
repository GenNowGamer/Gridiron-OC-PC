(function () {
  "use strict";

  const FIELD_DEFINITIONS = [
    ["down_distance", "Down / distance", true],
    ["field_position", "Field position", true],
    // Kept required in calibration so shared presentation profiles still store the DC crop.
    // Runtime readiness treats it as DC-only (see situationGate / exactCallGate).
    ["offense_formation_personnel", "Upcoming Formation / Personnel", true],
    ["previous_offense_play", "Previous offensive play", false],
    ["previous_defense_play", "Previous defensive play", false],
    ["calibration_anchor", "Calibration anchor (drift)", false],
  ];
  const REMOVED_OCR_FIELDS = new Set(["quarter_clock", "scores", "quarter", "game_clock"]);
  const MIN_ACCEPTED_FIELD_CONFIDENCE = 0.92;
  // Shared situation fields for both roles. Formation/personnel is DC-only on Madden HUDs.
  const SITUATION_REQUIRED_FIELDS = Object.freeze([
    "down_distance",
    "field_position",
  ]);
  // Exact Calls / DC package offense-look need the upcoming formation crop.
  const EXACT_CALL_REQUIRED_FIELDS = Object.freeze([
    "down_distance",
    "field_position",
    "offense_formation_personnel",
  ]);
  const OC_SITUATION_REQUIRED_FIELDS = SITUATION_REQUIRED_FIELDS;
  const DC_SITUATION_REQUIRED_FIELDS = EXACT_CALL_REQUIRED_FIELDS;
  const DEFAULT_CONFIG = Object.freeze({
    enabled: false,
    exactCallsEnabled: false,
    learningEnabled: false,
    hotkey: "CommandOrControl+Shift+D",
    adapter: "capture-bridge",
    settleDelayMs: 100,
    burstFrames: 3,
    retainDebugFrames: false,
  });

  function normalizeAdapter(value) {
    if (value === "websocket" || value === "obs-plugin" || value === "capture-bridge") return value;
    return "capture-bridge";
  }

  function isBridgeAdapter(adapter) {
    return normalizeAdapter(adapter) === "capture-bridge";
  }
  const PRESENTATION_STYLES = Object.freeze([
    "Default Presentation",
    "Sunday Night Football",
    "Monday Night Football",
    "Thursday Night Football",
  ]);
  const DEFAULT_PRESENTATION_STYLE = PRESENTATION_STYLES[0];

  const ui = {};
  const local = {
    config: { ...DEFAULT_CONFIG },
    profiles: [],
    activeProfile: null,
    sources: [],
    reference: null,
    regions: [],
    selectedRegion: -1,
    drawing: null,
    referenceBitmap: null,
    latestCapture: null,
    defensivePlays: [],
    latestExactRecommendations: [],
    exactCallState: null,
    initialized: false,
  };

  const byId = (id) => document.getElementById(id);
  const text = (value) => String(value == null ? "" : value).trim();
  const escapeHtml = (value) => text(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const desktop = () => window.desktopApi || {};
  const ocrCore = () => window.GridironOcrCore || {};

  function setOverlay(element, open) {
    if (!element) return;
    element.classList.toggle("hidden", !open);
    element.setAttribute("aria-hidden", open ? "false" : "true");
  }

  function setCalibrationStatus(message, isError = false) {
    if (!ui.calibrationStatus) return;
    ui.calibrationStatus.textContent = text(message);
    ui.calibrationStatus.style.color = isError ? "#ffc4c4" : "";
  }

  function profileSourceName(profile) {
    return text(profile?.source?.name || profile?.sourceName || profile?.sourceId);
  }

  function normalizePresentationKey(value) {
    return text(value).toLowerCase().replace(/\s+/g, " ");
  }

  function canonicalPresentationStyle(value) {
    const needle = normalizePresentationKey(value);
    if (!needle) return DEFAULT_PRESENTATION_STYLE;
    const exact = PRESENTATION_STYLES.find((style) => normalizePresentationKey(style) === needle);
    if (exact) return exact;
    // Soft aliases for older free-text labels.
    if (/\bthursday\b|\btnf\b/.test(needle)) return "Thursday Night Football";
    if (/\bmonday\b|\bmnf\b/.test(needle)) return "Monday Night Football";
    if (/\bsunday\b|\bsnf\b/.test(needle)) return "Sunday Night Football";
    if (/\bdefault\b|\bstandard\b|\benhanced\b/.test(needle)) return "Default Presentation";
    return DEFAULT_PRESENTATION_STYLE;
  }

  function selectedPresentationStyle() {
    return canonicalPresentationStyle(ui.presentationSelect?.value || local.activeProfile?.presentation);
  }

  function findProfileForPresentation(style) {
    const target = normalizePresentationKey(canonicalPresentationStyle(style));
    const profiles = Array.isArray(local.profiles) ? local.profiles : [];
    return profiles.find((profile) => normalizePresentationKey(profile?.presentation) === target)
      || profiles.find((profile) => normalizePresentationKey(profile?.name) === target)
      || null;
  }

  function presentationHasProfile(style) {
    return Boolean(findProfileForPresentation(style));
  }

  function renderPresentationSelect(selectedStyle) {
    if (!ui.presentationSelect) return;
    const selected = canonicalPresentationStyle(selectedStyle || selectedPresentationStyle());
    const extras = [];
    const raw = text(local.activeProfile?.presentation);
    if (raw && !PRESENTATION_STYLES.some((style) => normalizePresentationKey(style) === normalizePresentationKey(raw))) {
      extras.push(raw);
    }
    const options = [...PRESENTATION_STYLES, ...extras];
    ui.presentationSelect.innerHTML = options.map((style) => {
      const calibrated = presentationHasProfile(style);
      const label = calibrated ? `${style} · calibrated` : style;
      return `<option value="${escapeHtml(style)}"${normalizePresentationKey(style) === normalizePresentationKey(selected) ? " selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");
  }

  async function activateProfile(profile) {
    if (!profile || !desktop().ocrSaveProfile) {
      local.activeProfile = profile || null;
      return profile || null;
    }
    try {
      const result = await desktop().ocrSaveProfile(profile);
      local.activeProfile = result?.profile || profile;
      await refreshState();
      return local.activeProfile;
    } catch (_error) {
      local.activeProfile = profile;
      return profile;
    }
  }

  async function onPresentationStyleChange() {
    const style = selectedPresentationStyle();
    const existing = findProfileForPresentation(style);
    if (existing) {
      hydrateCalibrationFromProfile(existing);
      await activateProfile(existing);
      setCalibrationStatus(`Loaded “${text(existing.name) || style}” for ${style}.`);
      return;
    }
    local.activeProfile = null;
    local.regions = [];
    local.selectedRegion = -1;
    local.reference = null;
    local.referenceBitmap = null;
    if (ui.profileName) ui.profileName.value = style;
    renderPresentationSelect(style);
    renderSavedProfileSelect();
    renderRegionList();
    if (ui.canvasEmpty) ui.canvasEmpty.classList.remove("hidden");
    setCalibrationStatus(`New calibration for ${style}. Capture a reference, draw regions, then Save Profile.`);
  }

  function normalizeConfig(value) {
    const incoming = value && typeof value === "object" ? value : {};
    return {
      ...DEFAULT_CONFIG,
      enabled: incoming.enabled === true,
      exactCallsEnabled: incoming.exactCallsEnabled === true,
      learningEnabled: incoming.learningEnabled === true,
      hotkey: text(incoming.hotkey) || DEFAULT_CONFIG.hotkey,
      adapter: normalizeAdapter(incoming.adapter),
      settleDelayMs: Math.max(0, Math.min(2000, Number(incoming.settleDelayMs) || DEFAULT_CONFIG.settleDelayMs)),
      burstFrames: Math.max(1, Math.min(5, Number(incoming.burstFrames) || DEFAULT_CONFIG.burstFrames)),
      retainDebugFrames: incoming.retainDebugFrames === true,
      obs: incoming.obs && typeof incoming.obs === "object" ? incoming.obs : {},
      activeProfileId: text(incoming.activeProfileId),
      sourceId: text(incoming.sourceId),
    };
  }

  function syncAdapterUi() {
    const bridge = isBridgeAdapter(local.config.adapter);
    if (ui.obsUrlField) ui.obsUrlField.classList.toggle("hidden", bridge);
    if (ui.obsPasswordField) ui.obsPasswordField.classList.toggle("hidden", bridge);
    if (ui.sourceKindField) ui.sourceKindField.classList.toggle("hidden", !bridge);
    if (ui.sourceSelectLabel) {
      ui.sourceSelectLabel.textContent = bridge ? "Capture source" : "OBS scene or input";
    }
    if (ui.connectObsBtn) {
      ui.connectObsBtn.textContent = bridge ? "Refresh sources" : "Connect & List Sources";
    }
  }

  function updateToggle(button, enabled) {
    if (!button) return;
    button.textContent = enabled ? "On" : "Off";
    button.classList.toggle("is-active", enabled);
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
  }

  function renderSettings(status = {}) {
    updateToggle(ui.captureToggle, local.config.enabled);
    updateToggle(ui.exactToggle, local.config.exactCallsEnabled);
    updateToggle(ui.learningToggle, local.config.learningEnabled);
    updateToggle(ui.debugToggle, local.config.retainDebugFrames);
    if (ui.hotkeyInput) ui.hotkeyInput.value = local.config.hotkey;
    if (ui.captureAdapter) ui.captureAdapter.value = local.config.adapter;
    syncAdapterUi();
    const workerReady = status.worker?.ready === true || status.workerReady === true;
    const engineName = text(status.engineWarm?.engine || status.engineWarm?.requested || "");
    if (ui.workerPill) {
      if (!workerReady) {
        ui.workerPill.textContent = "Worker offline";
        ui.workerPill.style.borderColor = "";
      } else if (engineName) {
        const label = engineName === "onnx_ppocrv5"
          ? "PP-OCRv5"
          : engineName === "paddleocr"
            ? "PaddleOCR"
            : engineName === "tesseract"
              ? "Tesseract (fallback)"
              : engineName;
        ui.workerPill.textContent = `Worker · ${label}`;
        ui.workerPill.style.borderColor = engineName === "tesseract"
          ? "rgba(255,180,60,.65)"
          : "rgba(91,220,151,.5)";
      } else if (status.engineWarmError) {
        ui.workerPill.textContent = "Worker · engine error";
        ui.workerPill.style.borderColor = "rgba(255,92,92,.55)";
      } else {
        ui.workerPill.textContent = "Worker · warming…";
        ui.workerPill.style.borderColor = "rgba(255,209,102,.45)";
      }
    }
    const profile = local.activeProfile;
    const registration = status.hotkey || {};
    const registrationText = registration.registered
      ? `Hotkey ${local.config.hotkey} registered.`
      : (registration.error ? `Hotkey unavailable: ${registration.error}` : "Hotkey is not registered.");
    const debugSession = status.debugSession || {};
    const debugText = local.config.retainDebugFrames
      ? `Debug on${debugSession.eventCount ? ` · ${debugSession.eventCount} event(s)` : ""}.`
      : null;
    if (ui.settingsSummary) {
      const presentation = profile
        ? canonicalPresentationStyle(profile.presentation || profile.name)
        : null;
      ui.settingsSummary.textContent = [
        local.config.enabled ? "Capture enabled." : "OCR is disabled.",
        profile
          ? `Style: ${presentation} · Profile: ${profile.name} (${profileSourceName(profile) || "source"}).`
          : "No active calibration profile.",
        registrationText,
        debugText,
      ].filter(Boolean).join(" ");
    }
    const diagnostics = status.diagnostics || {};
    const p50 = Number(diagnostics.p50Ms);
    const p95 = Number(diagnostics.p95Ms);
    const samples = Number(diagnostics.samples || diagnostics.sampleCount || 0);
    if (ui.diagSamples) ui.diagSamples.textContent = String(samples);
    if (ui.diagLatency) {
      ui.diagLatency.textContent = `p50 ${Number.isFinite(p50) ? `${Math.round(p50)} ms` : "—"} · p95 ${Number.isFinite(p95) ? `${Math.round(p95)} ms` : "—"}`;
    }
    if (ui.diagFrames) {
      ui.diagFrames.textContent = samples
        ? `${Number(diagnostics.frameCount || 0)} frames · ${Number(diagnostics.duplicateFrames || 0)} duplicate · ${Number(diagnostics.staleFrames || 0)} stale`
        : "No captures";
    }
    if (ui.diagGate) {
      const passed = samples >= 20 && p95 <= 700 && Number(diagnostics.staleFrames || 0) === 0;
      ui.diagGate.textContent = samples < 20 ? "Needs 20 samples" : (passed ? "Gate passed" : "Gate failed");
      ui.diagGate.style.color = passed ? "#9cf0bd" : "";
    }
  }

  function renderStrip(status = {}) {
    const enabled = local.config.enabled;
    const workerReady = status.worker?.ready || status.workerReady;
    const engineReady = status.engineReady === true || Boolean(status.engineWarm?.engine);
    const ready = enabled && local.activeProfile && workerReady && engineReady;
    const warming = enabled && local.activeProfile && workerReady && !engineReady && !status.engineWarmError;
    if (ui.strip) ui.strip.dataset.state = ready ? "ready" : (enabled ? "warning" : "disabled");
    if (ui.captureBtn) ui.captureBtn.disabled = !ready;
    if (ui.reviewBtn) ui.reviewBtn.disabled = !local.latestCapture;
    if (ui.status) {
      ui.status.textContent = ready
        ? `Ready — press ${local.config.hotkey}`
        : warming
          ? "Warming OCR engine…"
          : status.engineWarmError
            ? `OCR engine not ready — ${text(status.engineWarmError)}`
            : (enabled ? "Setup incomplete — open Settings" : "Disabled — enable capture in Settings");
    }
    if (!local.latestCapture && ui.context) {
      ui.context.textContent = ready
        ? `Watching ${profileSourceName(local.activeProfile)}; capture is user-triggered only.`
        : warming
          ? "OCR capture is on; waiting for the local OCR engine to finish warm-up."
          : "Enable OCR Capture in Settings after calibrating an OBS source.";
    }
    if (ui.strip) {
      ui.strip.setAttribute(
        "aria-label",
        isOcHostRole() ? "OCR offensive coordinator" : "OCR defensive coordinator"
      );
    }
  }

  function fieldMapOf(capture) {
    const source = capture?.verified?.fields || capture?.decision?.fields || capture?.fields || {};
    if (Array.isArray(source)) {
      return Object.fromEntries(source.map((field) => [field.key || field.id, field]));
    }
    return source && typeof source === "object" ? source : {};
  }

  function acceptedValue(field) {
    if (!field || field.accepted !== true) return null;
    return field.value == null ? null : field.value;
  }

  function captureConfidence(capture, keys = null) {
    const allFields = Object.values(fieldMapOf(capture));
    const keySet = Array.isArray(keys) && keys.length ? new Set(keys) : null;
    const scoped = keySet
      ? allFields.filter((field) => keySet.has(field?.key || field?.id))
      : allFields.filter((field) => field?.required === true);
    const fields = scoped.length ? scoped : allFields;
    if (!fields.length) return 0;
    const accepted = fields.filter((field) => field?.accepted === true);
    if (!accepted.length) return 0;
    return accepted.reduce((sum, field) => {
      const calibrated = Number(field.calibratedConfidence);
      if (Number.isFinite(calibrated) && calibrated > 0) return sum + calibrated;
      const ocr = Number(field.effectiveOcrConfidence ?? field.ocrConfidence ?? field.confidence ?? 0);
      const resolver = Number(field.resolverConfidence ?? field.confidence ?? 0);
      return sum + Math.max(ocr || 0, resolver || 0);
    }, 0) / accepted.length;
  }

  function exactCallGate(capture) {
    const fields = fieldMapOf(capture);
    const missing = EXACT_CALL_REQUIRED_FIELDS.filter((key) => fields[key]?.accepted !== true);
    const confidence = captureConfidence(capture, EXACT_CALL_REQUIRED_FIELDS);
    return {
      missing,
      confidence,
      ready: missing.length === 0 && confidence >= MIN_ACCEPTED_FIELD_CONFIDENCE,
    };
  }

  /** Role-aware readiness: OC only needs down/distance + field; DC Exact Calls also need formation. */
  function situationGate(capture) {
    const required = isOcHostRole() ? OC_SITUATION_REQUIRED_FIELDS : DC_SITUATION_REQUIRED_FIELDS;
    const fields = fieldMapOf(capture);
    const missing = required.filter((key) => fields[key]?.accepted !== true);
    const confidence = captureConfidence(capture, required);
    return {
      missing,
      confidence,
      ready: missing.length === 0 && confidence >= MIN_ACCEPTED_FIELD_CONFIDENCE,
      requiredFields: required,
    };
  }

  function parseFormationPersonnel(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return {
        formation: text(value.formation),
        set: text(value.set),
        label: text(value.label || value.raw || [value.formation, value.set].filter(Boolean).join(" - ")),
      };
    }
    const raw = text(value);
    if (!raw) return { formation: "", set: "", label: "" };
    const parts = raw.split(/\s*[-–—]\s+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        formation: parts[0],
        set: parts.slice(1).join(" - "),
        label: raw,
      };
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    return {
      formation: tokens[0] || raw,
      set: tokens.slice(1).join(" "),
      label: raw,
    };
  }

  function offenseShowingOf(fields) {
    const combined = acceptedValue(fields.offense_formation_personnel);
    if (combined != null && combined !== "") return parseFormationPersonnel(combined);
    return {
      formation: text(acceptedValue(fields.offense_formation)),
      set: text(acceptedValue(fields.offense_personnel)),
      label: "",
    };
  }

  function readOcScoreboard() {
    const userScore = Number(String(byId("userScoreValue")?.textContent || "").trim());
    const oppScore = Number(String(byId("oppScoreValue")?.textContent || "").trim());
    const activeQuarter = byId("quarterButtonGroup")?.querySelector("button.is-active,button[aria-pressed='true']");
    const quarter = Number(activeQuarter?.getAttribute("data-quarter"));
    return {
      userScore: Number.isFinite(userScore) ? userScore : 0,
      oppScore: Number.isFinite(oppScore) ? oppScore : 0,
      quarter: Number.isFinite(quarter) && quarter >= 1 ? quarter : 1,
    };
  }

  function scoreboardFromCapture(capture) {
    const board = capture?.scoreboard;
    if (!board || typeof board !== "object") return readOcScoreboard();
    const quarter = Number(board.quarter);
    const userScore = Number(board.userScore);
    const oppScore = Number(board.oppScore);
    const live = readOcScoreboard();
    return {
      quarter: Number.isFinite(quarter) && quarter >= 1 ? quarter : live.quarter,
      userScore: Number.isFinite(userScore) ? userScore : live.userScore,
      oppScore: Number.isFinite(oppScore) ? oppScore : live.oppScore,
    };
  }

  function formatScoreboardLabel(board) {
    const quarter = Number(board?.quarter);
    const qLabel = quarter === 5 ? "OT" : `Q${Number.isFinite(quarter) ? quarter : 1}`;
    return `${qLabel} ${Number(board?.userScore) || 0}-${Number(board?.oppScore) || 0}`;
  }

  function coerceFieldPosition(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const yardLine = Number(value.yardLine);
      if (Number.isFinite(yardLine) && yardLine === 50) {
        return { side: "MIDFIELD", yardLine: 50, label: text(value.label) || "MIDFIELD 50" };
      }
      const side = text(value.side).toUpperCase();
      if ((side === "OWN" || side === "OPP" || side === "MIDFIELD") && Number.isFinite(yardLine)) {
        return {
          side,
          yardLine,
          label: text(value.label) || `${side} ${yardLine}`,
        };
      }
      return null;
    }
    const raw = text(value);
    if (!raw) return null;
    // Bare "50" / "MIDFIELD 50" / "OWN 50" / "OPP 50" → midfield.
    if (/\b50\b/.test(raw) && !/\b(?:OWN|OPP|MIDFIELD)\s+(?!50\b)\d{1,2}\b/i.test(raw)) {
      const yardOnly = raw.match(/\b(\d{1,2})\b/g) || [];
      const lastYard = yardOnly.length ? Number(yardOnly[yardOnly.length - 1]) : NaN;
      if (lastYard === 50) {
        return { side: "MIDFIELD", yardLine: 50, label: "MIDFIELD 50" };
      }
    }
    const match = raw.match(/\b(OWN|OPP|MIDFIELD)\s*(\d{1,2})\b/i);
    if (!match) return null;
    let side = match[1].toUpperCase();
    const yardLine = Number(match[2]);
    if (yardLine === 50) {
      return { side: "MIDFIELD", yardLine: 50, label: "MIDFIELD 50" };
    }
    return { side, yardLine, label: `${side} ${yardLine}` };
  }

  function parseYardsToGo(token, fieldPosition) {
    const raw = text(token).toLowerCase();
    if (!raw) return null;
    if (raw === "goal") {
      const yardLine = Number(fieldPosition?.yardLine);
      return Number.isFinite(yardLine) && yardLine > 0 ? yardLine : 5;
    }
    if (/^inch/.test(raw)) return 1;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function parseSituation(fields, scoreboard = readOcScoreboard()) {
    const raw = text(acceptedValue(fields.down_distance));
    const hud = window.GridironOcrHudTextNormalize;
    const parsed = hud && typeof hud.parseDownDistanceText === "function"
      ? hud.parseDownDistanceText(raw)
      : null;
    const downMatch = raw.match(/\b([1-4])(?:st|nd|rd|th)?\b/i);
    const distanceMatch = raw.match(/(?:and|&)\s*(\d{1,2}|goal|inches?)\b/i);
    const field = acceptedValue(fields.field_position);
    const fieldPosition = coerceFieldPosition(field);
    const offenseShowing = offenseShowingOf(fields);
    const down = parsed && parsed.ok
      ? parsed.down
      : Number(fields.down?.value || downMatch?.[1] || 1);
    const yards = parsed && parsed.ok
      ? (parsed.goalToGo ? parseYardsToGo("goal", fieldPosition) : parsed.yardsToGo)
      : parseYardsToGo(distanceMatch?.[1] || fields.distance?.value || "", fieldPosition);
    return {
      down: Number.isFinite(Number(down)) ? Number(down) : 1,
      yards: Number.isFinite(Number(yards)) && Number(yards) > 0 ? Number(yards) : null,
      goalToGo: parsed && parsed.ok ? parsed.goalToGo === true : /goal/i.test(raw),
      fieldPosition,
      quarter: scoreboard.quarter,
      userScore: scoreboard.userScore,
      oppScore: scoreboard.oppScore,
      scoreDiff: (Number(scoreboard.userScore) || 0) - (Number(scoreboard.oppScore) || 0),
      scoreboard: formatScoreboardLabel(scoreboard),
      offenseShowing: {
        formation: offenseShowing.formation || "",
        set: offenseShowing.set || "",
      },
    };
  }

  function attachLearningSnapshot(capture, result) {
    if (!capture || typeof capture !== "object") return capture;
    const snapshot = result?.learningSnapshot ?? capture.learningSnapshot;
    if (snapshot && local.config.learningEnabled) capture.learningSnapshot = snapshot;
    else if (!local.config.learningEnabled) delete capture.learningSnapshot;
    return capture;
  }

  function rankExactPlays(capture) {
    if (!local.config.exactCallsEnabled) return [];
    if (isOcHostRole()) return [];
    const fields = fieldMapOf(capture);
    const scoreboard = scoreboardFromCapture(capture);
    const ctx = parseSituation(fields, scoreboard);
    const team = text(byId("teamSelect")?.value).toUpperCase();
    const opponent = text(byId("opponentSelect")?.value).toUpperCase();
    const plays = local.defensivePlays.filter((play) => !team || text(play.team).toUpperCase() === team);
    const learned = capture?.learningAdjustment || {};
    const host = ocrHost();
    const variety = typeof host.getExactVarietyMemory === "function"
      ? (host.getExactVarietyMemory() || {})
      : {};
    const recentPlayIds = Array.isArray(variety.recentPlayIds)
      ? variety.recentPlayIds
      : (Array.isArray(host.getRecentDcPlayIds?.()) ? host.getRecentDcPlayIds() : []);
    const exposurePlayIds = Array.isArray(variety.exposurePlayIds) ? variety.exposurePlayIds : [];
    const core = window.GridironOcrExactPlayRecommendation || ocrCore();
    try {
      if (typeof core.computeExactPlayRecommendations === "function") {
        const result = core.computeExactPlayRecommendations({
          plays,
          down: ctx.down,
          yards: ctx.yards,
          goalToGo: ctx.goalToGo,
          fieldPosition: ctx.fieldPosition,
          offenseShowing: ctx.offenseShowing,
          opponent,
          quarter: ctx.quarter,
          userScore: ctx.userScore,
          oppScore: ctx.oppScore,
          scoreDiff: ctx.scoreDiff,
          learningSnapshot: local.config.learningEnabled ? capture?.learningSnapshot : null,
          recentPlayIds,
          exposurePlayIds,
          limit: 3,
        });
        const recommendations = result?.recommendations || [];
        if (typeof host.recordExactTrace === "function" && recommendations.length) {
          host.recordExactTrace({
            opponent,
            learningEnabled: local.config.learningEnabled === true,
            situationLabel: [
              `${ctx.down}${ctx.down === 1 ? "st" : ctx.down === 2 ? "nd" : ctx.down === 3 ? "rd" : "th"} & ${ctx.goalToGo ? "Goal" : (ctx.yards != null ? ctx.yards : "?")}`,
              ctx.fieldPosition?.label || "",
              ctx.scoreboard || "",
            ].filter(Boolean).join(" | "),
            offenseShowing: [ctx.offenseShowing?.formation, ctx.offenseShowing?.set].filter(Boolean).join(" - "),
            recommendations,
            scoreDiff: ctx.scoreDiff,
            quarter: ctx.quarter,
          });
        }
        return recommendations;
      }
      if (typeof core.rankExactDefensivePlays === "function") {
        return core.rankExactDefensivePlays({
          plays, context: ctx, learnedAdjustments: learned, limit: 3,
          recommendationCore: window.GridironDefenseRecommendationCore,
          recentPlayIds,
          exposurePlayIds,
        })?.recommendations || [];
      }
      const defenseCore = window.GridironDefenseRecommendationCore;
      if (defenseCore?.computeDefensiveRecommendations) {
        return defenseCore.computeDefensiveRecommendations({
          plays, down: ctx.down, yards: ctx.yards, goalToGo: ctx.goalToGo,
          fieldPosition: ctx.fieldPosition, offenseShowing: ctx.offenseShowing,
          recentPlayIds,
        }).recommendations.slice(0, 3);
      }
    } catch (_) {
      return [];
    }
    return [];
  }

  function playPath(play) {
    const source = play?.play || play;
    return [source?.formation, source?.set, source?.play_name || source?.playName].map(text).filter(Boolean).join(" → ");
  }

  function normalizeExactRecommendation(entry) {
    if (!entry || typeof entry !== "object") return null;
    const play = entry.play && typeof entry.play === "object" ? entry.play : entry;
    if (!play || (!play.id && !play.play_name && !play.playName)) return null;
    return {
      play,
      why: text(entry.why || entry._why || play.why || play._why),
      score: Number(entry._score ?? entry.score ?? play._score ?? play.score) || 0,
    };
  }

  function ocrHost() {
    return window.GridironOcrHost || {};
  }

  function hostCoordinatorRole() {
    const host = ocrHost();
    if (typeof host.getCoordinatorRole === "function") {
      const role = String(host.getCoordinatorRole() || "").trim().toLowerCase();
      if (role === "oc" || role === "dc") return role;
    }
    return "dc";
  }

  function isOcHostRole() {
    return hostCoordinatorRole() === "oc";
  }

  function syncExactCallsToHost(recommendations) {
    const host = ocrHost();
    if (typeof host.presentExactPlays === "function") {
      return host.presentExactPlays(recommendations) || host.getExactCallState?.() || null;
    }
    return host.getExactCallState?.() || null;
  }

  function exactCallState() {
    return ocrHost().getExactCallState?.() || local.exactCallState || {
      setKey: "",
      sheetConfirmed: false,
      confirmedPlayId: null,
      loggedText: "",
    };
  }

  function renderExactCallsCard(recommendations, callState, options = {}) {
    // Keep Exact Calls out of the OCR strip — host Recommendations panel owns the tiles.
    const rows = isOcHostRole()
      ? []
      : (Array.isArray(recommendations) ? recommendations : [])
        .map(normalizeExactRecommendation)
        .filter(Boolean)
        .slice(0, 3);
    local.latestExactRecommendations = rows;
    // Never re-present Exact Calls during role/chrome updates — that re-enters host render().
    const allowSync = options.syncHost !== false;
    const stateInfo = callState
      || (allowSync ? syncExactCallsToHost(rows) : null)
      || exactCallState();
    local.exactCallState = stateInfo;
    if (ui.exactCallsCard) {
      ui.exactCallsCard.classList.add("empty", "hidden");
      ui.exactCallsCard.classList.remove("stacked");
      ui.exactCallsCard.innerHTML = "";
    }
  }

  function refreshExactCallsFromHost(callState) {
    if (callState) local.exactCallState = callState;
    // Host already owns presented rows — refresh local chrome only.
    renderExactCallsCard(local.latestExactRecommendations || [], callState || exactCallState(), { syncHost: false });
  }

  function renderCapture(capture) {
    local.latestCapture = capture;
    const fields = fieldMapOf(capture);
    const accepted = Object.values(fields).filter((field) => field?.accepted === true).length;
    const total = Object.keys(fields).length;
    const gate = situationGate(capture);
    const exactGate = exactCallGate(capture);
    const confidence = gate.confidence || captureConfidence(capture, gate.requiredFields);
    const situation = parseSituation(fields, scoreboardFromCapture(capture));
    const exactAllowed = !isOcHostRole() && local.config.exactCallsEnabled && exactGate.ready;
    const recommendations = exactAllowed ? rankExactPlays(capture) : [];
    const offenseShowing = offenseShowingOf(fields);
    const contextParts = [
      acceptedValue(fields.down_distance),
      (() => {
        const field = coerceFieldPosition(acceptedValue(fields.field_position));
        if (field) return field.label || [field.side, field.yardLine].filter((v) => v != null && v !== "").join(" ");
        return acceptedValue(fields.field_position);
      })(),
      isOcHostRole()
        ? ""
        : (offenseShowing.label || [offenseShowing.formation, offenseShowing.set].filter(Boolean).join(" - ")),
      situation.scoreboard,
    ].map((value) => text(value)).filter(Boolean);
    if (ui.context) {
      ui.context.innerHTML = escapeHtml(contextParts.join(" · ") || "No fields accepted.");
    }
    renderExactCallsCard(recommendations);
    try {
      const host = ocrHost();
      // Sync live board when role-required situation fields are ready (OC skips formation).
      if (gate.ready && typeof host.applyOcrCaptureSituation === "function") {
        host.applyOcrCaptureSituation(situation);
      }
      if (typeof host.applyOcrLearningSnapshot === "function" && capture?.learningSnapshot) {
        host.applyOcrLearningSnapshot(capture.learningSnapshot);
      }
    } catch (_err) { /* optional host bridge */ }
    if (ui.confidence) {
      ui.confidence.textContent = `${accepted}/${total || 0} fields accepted · capture confidence ${(confidence * 100).toFixed(1)}% · ${Math.round(Number(capture?.timing?.totalMs || capture?.totalMs || 0))} ms`;
    }
    if (ui.strip) {
      ui.strip.dataset.state = (isOcHostRole() ? gate.ready : (recommendations.length || gate.ready))
        ? "ready"
        : (accepted ? "warning" : "error");
    }
    if (ui.status) {
      const top = normalizeExactRecommendation(recommendations[0]);
      if (isOcHostRole()) {
        if (!local.config.enabled) {
          ui.status.textContent = "Capture complete — OCR is disabled";
        } else if (gate.missing.length) {
          ui.status.textContent = `Review required — need ${gate.missing.join(", ")}`;
        } else if (confidence < MIN_ACCEPTED_FIELD_CONFIDENCE) {
          ui.status.textContent = `Review required — situation confidence ${(confidence * 100).toFixed(1)}% (need ${Math.round(MIN_ACCEPTED_FIELD_CONFIDENCE * 100)}%)`;
        } else {
          ui.status.textContent = "Situation synced — check Play Call recommendations";
        }
      } else if (top) {
        ui.status.textContent = `Exact call ready: ${playPath(top)} — see Recommendations`;
      } else if (!local.config.exactCallsEnabled) {
        if (gate.ready) {
          ui.status.textContent = "Situation synced — check Package Call recommendations";
        } else if (gate.missing.length) {
          ui.status.textContent = `Review required — need ${gate.missing.join(", ")}`;
        } else {
          ui.status.textContent = "Capture complete — exact calls disabled";
        }
      } else if (exactGate.missing.length) {
        ui.status.textContent = `Review required — need ${exactGate.missing.join(", ")}`;
      } else if (exactGate.confidence < MIN_ACCEPTED_FIELD_CONFIDENCE) {
        ui.status.textContent = `Review required — situation confidence ${(exactGate.confidence * 100).toFixed(1)}% (need ${Math.round(MIN_ACCEPTED_FIELD_CONFIDENCE * 100)}%)`;
      } else {
        ui.status.textContent = "Review required — exact call withheld";
      }
    }
    if (ui.reviewBtn) ui.reviewBtn.disabled = false;
    renderReviewFields();
    window.dispatchEvent(new CustomEvent("gridiron:ocr-capture", {
      detail: { capture, context: situation, recommendations },
    }));
  }

  async function refreshState() {
    if (!desktop().ocrGetStatus) return;
    try {
      const result = await desktop().ocrGetStatus();
      local.config = normalizeConfig(result?.config);
      local.profiles = Array.isArray(result?.profiles) ? result.profiles : [];
      local.activeProfile = result?.activeProfile
        || local.profiles.find((profile) => profile.id === local.config.activeProfileId)
        || null;
      renderPresentationSelect(local.activeProfile?.presentation || DEFAULT_PRESENTATION_STYLE);
      renderSavedProfileSelect();
      renderSettings(result || {});
      renderStrip(result || {});
    } catch (error) {
      renderSettings({ worker: { ready: false } });
      renderStrip({});
      if (ui.settingsSummary) ui.settingsSummary.textContent = `OCR service unavailable: ${text(error?.message || error)}`;
    }
  }

  async function updateConfig(patch) {
    if (!desktop().ocrUpdateConfig) return;
    const result = await desktop().ocrUpdateConfig(patch);
    local.config = normalizeConfig(result?.config || { ...local.config, ...patch });
    await refreshState();
  }

  function syncTeamContext() {
    if (!desktop().ocrUpdateConfig) return;
    const scoreboard = readOcScoreboard();
    desktop().ocrUpdateConfig({
      context: {
        team: text(byId("teamSelect")?.value).toUpperCase(),
        opponent: text(byId("opponentSelect")?.value).toUpperCase(),
        role: isOcHostRole() ? "oc" : "dc",
        ...scoreboard,
      },
    }).catch(() => {});
  }

  async function triggerCapture() {
    if (!desktop().ocrCapture) return;
    if (ui.captureBtn) ui.captureBtn.disabled = true;
    if (ui.status) ui.status.textContent = "Capturing OBS burst…";
    try {
      const scoreboard = readOcScoreboard();
      const result = await desktop().ocrCapture({
        reason: "renderer_button",
        team: text(byId("teamSelect")?.value).toUpperCase(),
        opponent: text(byId("opponentSelect")?.value).toUpperCase(),
        role: isOcHostRole() ? "oc" : "dc",
        presentation: selectedPresentationStyle() || text(local.activeProfile?.presentation),
        ...scoreboard,
      });
      renderCapture(attachLearningSnapshot(result?.capture || result, result));
    } catch (error) {
      if (ui.strip) ui.strip.dataset.state = "error";
      if (ui.status) ui.status.textContent = `Capture failed: ${text(error?.message || error)}`;
      renderExactCallsCard([]);
    } finally {
      if (ui.captureBtn) ui.captureBtn.disabled = !local.config.enabled;
    }
  }

  function populateFields() {
    if (!ui.regionField) return;
    ui.regionField.innerHTML = FIELD_DEFINITIONS.map(([id, label]) =>
      `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`
    ).join("");
  }

  function sourceValue(source) {
    return text(source.id || source.uuid || source.name);
  }

  function renderSources() {
    if (!ui.sourceSelect) return;
    const kindFilter = text(ui.sourceKind?.value) || "all";
    const visible = local.sources.filter((source) => {
      if (!isBridgeAdapter(local.config.adapter) || kindFilter === "all") return true;
      return text(source.kind) === kindFilter;
    });
    ui.sourceSelect.innerHTML = visible.length
      ? visible.map((source) => `<option value="${escapeHtml(sourceValue(source))}">${escapeHtml(source.name || source.id)}${source.kind ? ` · ${escapeHtml(source.kind)}` : ""}</option>`).join("")
      : "<option value=\"\">No sources found</option>";
    const preferred = text(local.config.sourceId);
    if (preferred && visible.some((source) => sourceValue(source) === preferred)) {
      ui.sourceSelect.value = preferred;
    }
  }

  function selectedSource() {
    const id = text(ui.sourceSelect?.value);
    return local.sources.find((source) => sourceValue(source) === id) || null;
  }

  async function connectObs() {
    const adapter = normalizeAdapter(ui.captureAdapter?.value);
    const bridge = isBridgeAdapter(adapter);
    setCalibrationStatus(bridge ? "Listing Capture Bridge sources…" : "Connecting to OBS…");
    const obs = { url: text(ui.obsUrl?.value), password: text(ui.obsPassword?.value) };
    try {
      if (!desktop().ocrListSources) throw new Error("OCR source discovery is unavailable.");
      await desktop().ocrUpdateConfig?.({ obs, adapter, pluginFallback: false });
      const result = await desktop().ocrListSources(bridge ? {} : obs);
      local.sources = Array.isArray(result?.sources) ? result.sources : (Array.isArray(result) ? result : []);
      local.config.adapter = adapter;
      if (!bridge) {
        local.config.obs = { ...obs, password: obs.password ? "__stored__" : "" };
      }
      syncAdapterUi();
      renderSources();
      setCalibrationStatus(bridge
        ? `Capture Bridge ready. ${local.sources.length} source(s) available.`
        : `Connected. ${local.sources.length} scene/input source(s) available.`);
    } catch (error) {
      setCalibrationStatus(`${bridge ? "Capture Bridge" : "OBS"} connection failed: ${text(error?.message || error)}`, true);
    }
  }

  function imageFromReference(reference) {
    return text(reference?.dataUrl || reference?.imageDataUrl || reference?.url);
  }

  function loadReferenceBitmap(dataUrl) {
    return new Promise((resolve, reject) => {
      if (!dataUrl) {
        local.referenceBitmap = null;
        reject(new Error("Reference screenshot did not return an image."));
        return;
      }
      const image = new Image();
      image.onload = () => {
        local.referenceBitmap = image;
        resolve(image);
      };
      image.onerror = () => {
        local.referenceBitmap = null;
        reject(new Error("Could not decode the OBS reference image."));
      };
      image.src = dataUrl;
    });
  }

  async function captureReference() {
    const source = selectedSource();
    if (!source) return setCalibrationStatus("Choose a capture source first.", true);
    setCalibrationStatus("Capturing lossless reference frame…");
    try {
      const sourceId = sourceValue(source);
      await desktop().ocrUpdateConfig?.({
        adapter: normalizeAdapter(local.config.adapter),
        sourceId,
        pluginFallback: false,
      });
      local.config.sourceId = sourceId;
      const result = await desktop().ocrCaptureReference({
        obs: { url: text(ui.obsUrl?.value), password: text(ui.obsPassword?.value) },
        source,
      });
      local.reference = result?.reference || result;
      const dataUrl = imageFromReference(local.reference);
      const image = await loadReferenceBitmap(dataUrl);
      const width = Number(local.reference.width) || image.naturalWidth;
      const height = Number(local.reference.height) || image.naturalHeight;
      ui.canvas.width = width;
      ui.canvas.height = height;
      ui.canvasEmpty?.classList.add("hidden");
      drawCanvas();
      setCalibrationStatus(`Reference captured at ${width}×${height}. Draw a rectangle for the selected field.`);
    } catch (error) {
      setCalibrationStatus(`Reference capture failed: ${text(error?.message || error)}`, true);
    }
  }

  async function benchmarkCapture() {
    setCalibrationStatus("Capturing a 3-frame diagnostics sample…");
    try {
      const result = await desktop().ocrBenchmarkCapture({
        obs: { url: text(ui.obsUrl?.value), password: text(ui.obsPassword?.value) },
      });
      const diagnostics = result?.diagnostics || {};
      renderSettings({ diagnostics, worker: { ready: true }, hotkey: {} });
      setCalibrationStatus(`Capture sample complete: ${Math.round(Number(result?.sample?.elapsedMs || 0))} ms. Run at least 20 samples before evaluating p95.`);
    } catch (error) {
      setCalibrationStatus(`Capture benchmark failed: ${text(error?.message || error)}`, true);
    }
  }

  function canvasPoint(event) {
    const rect = ui.canvas.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }

  function regionStrokeStyle(region, index) {
    return index === local.selectedRegion ? "#ffd166" : "#7dd3fc";
  }

  function paintRegionRect(ctx, region, index) {
    const x = region.x * ui.canvas.width;
    const y = region.y * ui.canvas.height;
    const width = region.width * ui.canvas.width;
    const height = region.height * ui.canvas.height;
    const color = regionStrokeStyle(region, index);
    const selected = index === local.selectedRegion;
    ctx.save();
    if (selected) {
      ctx.shadowColor = "rgba(255, 209, 102, 0.55)";
      ctx.shadowBlur = 8;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(selected ? 3.5 : 2.5, ui.canvas.width / 520);
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, width, height);
    // High-contrast inner hairline so boxes stay visible on dark HUD chrome.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = Math.max(1, ui.canvas.width / 900);
    ctx.strokeRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
    ctx.restore();

    const label = FIELD_DEFINITIONS.find(([id]) => id === region.field)?.[1] || region.field;
    const labelWidth = Math.min(width, Math.max(120, label.length * 7.2));
    ctx.fillStyle = "rgba(3,7,12,.88)";
    ctx.fillRect(x, y, labelWidth, 24);
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.max(12, ui.canvas.width / 80)}px Segoe UI`;
    ctx.fillText(label, x + 6, y + 17);
  }

  function paintDrawingRect(ctx) {
    if (!local.drawing?.start || !local.drawing?.current) return;
    const start = local.drawing.start;
    const current = local.drawing.current;
    const x = Math.min(start.x, current.x) * ui.canvas.width;
    const y = Math.min(start.y, current.y) * ui.canvas.height;
    const width = Math.abs(current.x - start.x) * ui.canvas.width;
    const height = Math.abs(current.y - start.y) * ui.canvas.height;
    ctx.save();
    ctx.shadowColor = "#00ffa8";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = "#00ffa8";
    ctx.fillStyle = "rgba(0, 255, 168, 0.14)";
    ctx.lineWidth = Math.max(3, ui.canvas.width / 480);
    ctx.setLineDash([10, 6]);
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.5, ui.canvas.width / 800);
    ctx.strokeRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
    ctx.restore();
  }

  function drawCanvas() {
    if (!ui.canvas || !local.reference) return;
    const paint = (image) => {
      const ctx = ui.canvas.getContext("2d");
      ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
      ctx.drawImage(image, 0, 0, ui.canvas.width, ui.canvas.height);
      local.regions.forEach((region, index) => paintRegionRect(ctx, region, index));
      paintDrawingRect(ctx);
    };
    if (local.referenceBitmap && local.referenceBitmap.complete) {
      paint(local.referenceBitmap);
      return;
    }
    const dataUrl = imageFromReference(local.reference);
    if (!dataUrl) return;
    const image = new Image();
    image.onload = () => {
      local.referenceBitmap = image;
      paint(image);
    };
    image.src = dataUrl;
  }

  function renderRegionList() {
    if (!ui.regionList) return;
    ui.regionList.innerHTML = local.regions.length
      ? local.regions.map((region, index) => {
        const label = FIELD_DEFINITIONS.find(([id]) => id === region.field)?.[1] || region.field;
        const detail = `x ${(region.x * 100).toFixed(1)}%, y ${(region.y * 100).toFixed(1)}%, w ${(region.width * 100).toFixed(1)}%, h ${(region.height * 100).toFixed(1)}%`;
        return `<button type="button" class="ocrRegionRow${index === local.selectedRegion ? " is-selected" : ""}" data-region-index="${index}"><strong>${escapeHtml(label)}</strong><span>${detail}</span><span class="ocrScreenBadge">${region.required ? "Required" : "Optional"}</span></button>`;
      }).join("")
      : "<div class=\"settingsNote\">No regions drawn. Drag on the reference to draw a bright green box for each HUD field.</div>";
    drawCanvas();
  }

  function applyRegionControls() {
    const region = local.regions[local.selectedRegion];
    if (!region) return;
    ui.regionField.value = region.field;
    ui.regionRequired.value = region.required ? "true" : "false";
    ui.thresholdMode.value = region.preprocessing?.threshold || "otsu";
    ui.regionScale.value = region.preprocessing?.scale
      || (region.field === "down_distance" || region.field === "field_position" ? 3 : 2);
    if (ui.regionMorphology) ui.regionMorphology.value = region.preprocessing?.morphology || "none";
    if (ui.regionGrayscale) ui.regionGrayscale.checked = region.preprocessing?.grayscale !== false;
    ui.regionInvert.checked = region.preprocessing?.invert === true;
  }

  function fieldRequiredByDefault(fieldId) {
    const definition = FIELD_DEFINITIONS.find(([id]) => id === fieldId);
    return Boolean(definition && definition[2]);
  }

  function onRegionFieldChange() {
    const nextField = text(ui.regionField?.value);
    if (!nextField) return;
    const existing = local.regions.findIndex((entry) => entry.field === nextField);
    if (existing >= 0) {
      local.selectedRegion = existing;
      applyRegionControls();
      renderRegionList();
      return;
    }
    // Selecting a Field that is not drawn yet prepares the next box.
    // Do not rename the currently selected region.
    local.selectedRegion = -1;
    if (ui.regionRequired) {
      ui.regionRequired.value = fieldRequiredByDefault(nextField) ? "true" : "false";
    }
    renderRegionList();
    setCalibrationStatus(`Draw a box for “${FIELD_DEFINITIONS.find(([id]) => id === nextField)?.[1] || nextField}”.`);
  }

  function updateSelectedRegion() {
    const region = local.regions[local.selectedRegion];
    if (!region) return;
    region.required = ui.regionRequired.value === "true";
    region.preprocessing = {
      ...(region.preprocessing || {}),
      threshold: text(ui.thresholdMode.value),
      scale: Math.max(1, Math.min(6, Number(ui.regionScale.value) || 2)),
      morphology: text(ui.regionMorphology?.value) || "none",
      grayscale: ui.regionGrayscale ? ui.regionGrayscale.checked === true : true,
      invert: ui.regionInvert.checked === true,
    };
    renderRegionList();
  }

  function buildProfile() {
    const source = selectedSource() || local.activeProfile?.source;
    const regions = local.regions
      .filter((region) => !REMOVED_OCR_FIELDS.has(text(region.field)))
      .map((region) => {
        const {
          screenStatus,
          screenReason,
          screenRaw,
          ...rest
        } = region;
        return { ...rest };
      });
    const anchors = regions
      .filter((region) => region.field === "calibration_anchor")
      .map((region, index) => ({
        id: `anchor_${index + 1}`,
        x: Number(region.x),
        y: Number(region.y),
        width: Number(region.width),
        height: Number(region.height),
      }));
    return {
      schemaVersion: 1,
      id: local.activeProfile?.id || (crypto?.randomUUID ? crypto.randomUUID() : `profile-${Date.now()}`),
      name: text(ui.profileName?.value) || selectedPresentationStyle() || DEFAULT_PRESENTATION_STYLE,
      presentation: selectedPresentationStyle() || DEFAULT_PRESENTATION_STYLE,
      source: source ? { id: sourceValue(source), name: source.name || sourceValue(source), kind: source.kind || "" } : null,
      obs: { url: text(ui.obsUrl?.value) || "ws://127.0.0.1:4455" },
      reference: {
        width: Number(local.reference?.width || ui.canvas?.width || 0),
        height: Number(local.reference?.height || ui.canvas?.height || 0),
        aspectRatio: ui.canvas?.height ? ui.canvas.width / ui.canvas.height : 0,
        hash: text(local.reference?.hash),
        dataUrl: imageFromReference(local.reference) || undefined,
      },
      anchors,
      regions,
      burst: { settleDelayMs: local.config.settleDelayMs, frames: local.config.burstFrames },
      updatedAt: new Date().toISOString(),
    };
  }

  function validateProfile(profile) {
    if (!profile.source?.id) return "Choose an OBS source.";
    if (!profile.reference.width || !profile.reference.height) return "Capture a reference frame.";
    const requiredFields = FIELD_DEFINITIONS.filter(([, , required]) => required).map(([id]) => id);
    const missing = requiredFields.filter((field) => !profile.regions.some((region) => region.field === field && region.required));
    if (missing.length) return `Draw required regions: ${missing.join(", ")}.`;
    const invalid = profile.regions.find((region) =>
      region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
      || region.x + region.width > 1 || region.y + region.height > 1
    );
    if (invalid) return `Region ${invalid.field} is outside the source.`;
    return "";
  }

  async function saveProfile() {
    const profile = buildProfile();
    const error = validateProfile(profile);
    if (error) return setCalibrationStatus(error, true);
    try {
      const result = await desktop().ocrSaveProfile(profile);
      local.activeProfile = result?.profile || profile;
      setCalibrationStatus(`Saved “${local.activeProfile.name}” for ${canonicalPresentationStyle(local.activeProfile.presentation)}.`);
      await refreshState();
      renderPresentationSelect(local.activeProfile.presentation);
      renderSavedProfileSelect();
    } catch (saveError) {
      setCalibrationStatus(`Save failed: ${text(saveError?.message || saveError)}`, true);
    }
  }

  async function testProfile() {
    const profile = buildProfile();
    const error = validateProfile(profile);
    if (error) return setCalibrationStatus(error, true);
    setCalibrationStatus("Testing crops and OCR…");
    try {
      const result = await desktop().ocrTestProfile({
        profile,
        useReferenceImage: true,
        reference: local.reference,
        includeImages: true,
      });
      const fields = fieldMapOf(result);
      ui.testResults.innerHTML = Object.entries(fields).map(([key, field]) =>
        `<div class="ocrTestRow"><strong>${escapeHtml(key)}</strong><span class="ocrCropPair">${field.rawCrop ? `<img src="${field.rawCrop}" alt="${escapeHtml(key)} raw crop" />` : ""}${field.processedCrop ? `<img src="${field.processedCrop}" alt="${escapeHtml(key)} processed crop" />` : ""}<span>${escapeHtml(field.rawText || field.text || "")}</span></span><span>${field.accepted ? "Accepted" : "Review"} · ${((Number(field.confidence || field.ocrConfidence) || 0) * 100).toFixed(1)}%</span></div>`
      ).join("") || "<div class=\"settingsNote\">No OCR candidates returned.</div>";
      setCalibrationStatus(`Test complete in ${Math.round(Number(result?.timing?.totalMs || result?.totalMs || 0))} ms.`);
    } catch (testError) {
      setCalibrationStatus(`Profile test failed: ${text(testError?.message || testError)}`, true);
    }
  }

  function fieldDisplayValue(field, key) {
    const value = field?.value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (value.play_name || value.playName) return text(value.play_name || value.playName);
      return text(value.label || [value.formation, value.set].filter(Boolean).join(" - ") || "");
    }
    // Previous-play fields are optional: never prefill the editor with raw OCR junk
    // when there is no accepted catalog value (opening-drive "--" / noise crops).
    if (
      (key === "previous_offense_play" || key === "previous_defense_play")
      && (value == null || value === "")
    ) {
      return "";
    }
    return text(value ?? field?.rawText ?? "");
  }

  function renderReviewFields() {
    if (!ui.reviewFields) return;
    const fields = fieldMapOf(local.latestCapture);
    ui.reviewFields.innerHTML = Object.entries(fields).map(([key, field]) => {
      const matched = fieldDisplayValue(field, key);
      const raw = text(field?.rawText || "");
      const showRaw = raw && matched && raw.toUpperCase() !== matched.toUpperCase();
      const showRawOnly = raw && !matched;
      return `<label class="ocrReviewRow"><strong>${escapeHtml(key)}</strong><input class="settingsSelect settingsInput" data-review-field="${escapeHtml(key)}" value="${escapeHtml(matched)}" /><span>${field?.accepted ? "Accepted" : "Correction required"}</span>${showRaw ? `<span class="settingsNote">Raw OCR: ${escapeHtml(raw)}${field?.matchedLabel ? ` → matched: ${escapeHtml(field.matchedLabel)}` : ""}</span>` : (showRawOnly ? `<span class="settingsNote">Raw OCR: ${escapeHtml(raw)}</span>` : "")}</label>`;
    }).join("") || "<div class=\"settingsNote\">No capture fields available.</div>";
  }

  function renderSavedProfileSelect() {
    if (!ui.savedProfileSelect) return;
    const selectedId = text(local.activeProfile?.id);
    ui.savedProfileSelect.innerHTML = [
      `<option value="">New profile…</option>`,
      ...local.profiles.map((profile) => {
        const style = canonicalPresentationStyle(profile.presentation || profile.name);
        const label = text(profile.name) || style;
        const suffix = style && normalizePresentationKey(label) !== normalizePresentationKey(style)
          ? ` · ${style}`
          : "";
        return `<option value="${escapeHtml(profile.id)}"${profile.id === selectedId ? " selected" : ""}>${escapeHtml(label + suffix)}</option>`;
      }),
    ].join("");
  }

  function hydrateCalibrationFromProfile(profile) {
    if (!profile) {
      local.regions = [];
      local.selectedRegion = -1;
      local.reference = null;
      local.referenceBitmap = null;
      const style = selectedPresentationStyle();
      if (ui.profileName) ui.profileName.value = style || DEFAULT_PRESENTATION_STYLE;
      renderPresentationSelect(style || DEFAULT_PRESENTATION_STYLE);
      renderRegionList();
      return;
    }
    local.activeProfile = profile;
    const style = canonicalPresentationStyle(profile.presentation || profile.name);
    if (ui.profileName) ui.profileName.value = text(profile.name) || style;
    renderPresentationSelect(style);
    if (profile.obs?.url && ui.obsUrl) ui.obsUrl.value = text(profile.obs.url);
    if (profile.source && ui.sourceSelect) {
      const sourceId = text(profile.source.id || profile.source.name);
      if (sourceId) {
        const exists = Array.from(ui.sourceSelect.options).some((option) => option.value === sourceId);
        if (!exists) {
          const option = document.createElement("option");
          option.value = sourceId;
          option.textContent = text(profile.source.name || sourceId);
          ui.sourceSelect.appendChild(option);
        }
        ui.sourceSelect.value = sourceId;
      }
    }
    local.regions = Array.isArray(profile.regions)
      ? profile.regions
        .filter((region) => !REMOVED_OCR_FIELDS.has(text(region.field || region.id)))
        .map((region) => {
          const {
            screenStatus,
            screenReason,
            screenRaw,
            ...rest
          } = region;
          return {
            ...rest,
            preprocessing: { ...(region.preprocessing || {}) },
          };
        })
      : [];
    local.selectedRegion = local.regions.length ? 0 : -1;
    local.reference = profile.reference || null;
    local.referenceBitmap = null;
    if (local.reference && imageFromReference(local.reference)) {
      const dataUrl = imageFromReference(local.reference);
      loadReferenceBitmap(dataUrl).then((image) => {
        const width = Number(local.reference.width) || image.naturalWidth;
        const height = Number(local.reference.height) || image.naturalHeight;
        ui.canvas.width = width;
        ui.canvas.height = height;
        if (ui.canvasEmpty) ui.canvasEmpty.classList.add("hidden");
        if (local.selectedRegion >= 0) applyRegionControls();
        renderRegionList();
      }).catch(() => {
        if (local.selectedRegion >= 0) applyRegionControls();
        renderRegionList();
      });
    } else {
      if (local.selectedRegion >= 0) applyRegionControls();
      renderRegionList();
    }
    renderSavedProfileSelect();
    setCalibrationStatus(`Loaded profile “${text(profile.name) || profile.id}” · ${style} (${local.regions.length} regions).`);
  }

  async function openCalibration() {
    await refreshState();
    renderPresentationSelect(local.activeProfile?.presentation || DEFAULT_PRESENTATION_STYLE);
    renderSavedProfileSelect();
    if (local.activeProfile) hydrateCalibrationFromProfile(local.activeProfile);
    else {
      if (ui.profileName) ui.profileName.value = DEFAULT_PRESENTATION_STYLE;
      renderPresentationSelect(DEFAULT_PRESENTATION_STYLE);
    }
    setOverlay(ui.calibrationOverlay, true);
  }

  async function acceptCorrections() {
    if (!local.latestCapture || !desktop().ocrCorrectCapture) return;
    const corrections = {};
    ui.reviewFields.querySelectorAll("[data-review-field]").forEach((input) => {
      corrections[input.dataset.reviewField] = text(input.value);
    });
    try {
      const result = await desktop().ocrCorrectCapture({
        captureId: local.latestCapture.id || local.latestCapture.captureId,
        corrections,
      });
      renderCapture(attachLearningSnapshot(result?.capture || result, result));
      setOverlay(ui.reviewOverlay, false);
    } catch (error) {
      if (ui.status) ui.status.textContent = `Correction failed: ${text(error?.message || error)}`;
    }
  }

  function bindCanvas() {
    ui.canvas.addEventListener("pointerdown", (event) => {
      if (!local.reference) return;
      const start = canvasPoint(event);
      local.drawing = { start, current: start };
      ui.canvas.setPointerCapture(event.pointerId);
      drawCanvas();
    });
    ui.canvas.addEventListener("pointermove", (event) => {
      if (!local.drawing) return;
      local.drawing.current = canvasPoint(event);
      drawCanvas();
    });
    ui.canvas.addEventListener("pointerup", (event) => {
      if (!local.drawing) return;
      const end = canvasPoint(event);
      const start = local.drawing.start;
      local.drawing = null;
      const field = text(ui.regionField.value) || "down_distance";
      const defaultScale = (field === "down_distance" || field === "field_position")
        ? Math.max(3, Number(ui.regionScale.value) || 3)
        : (Number(ui.regionScale.value) || 2);
      const region = {
        field,
        required: ui.regionRequired.value === "true",
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
        preprocessing: {
          threshold: text(ui.thresholdMode.value),
          scale: defaultScale,
          morphology: text(ui.regionMorphology?.value) || "none",
          grayscale: ui.regionGrayscale ? ui.regionGrayscale.checked === true : true,
          invert: ui.regionInvert.checked === true,
        },
      };
      const minW = (field === "down_distance" || field === "field_position") ? 0.02 : 0.005;
      const minH = (field === "down_distance" || field === "field_position") ? 0.012 : 0.005;
      if (region.width < minW || region.height < minH) {
        drawCanvas();
        return;
      }
      const existing = local.regions.findIndex((entry) => entry.field === region.field);
      if (existing >= 0) {
        local.regions[existing] = region;
        local.selectedRegion = existing;
      } else {
        local.regions.push(region);
        local.selectedRegion = local.regions.length - 1;
      }
      applyRegionControls();
      renderRegionList();
      setCalibrationStatus(`Drew “${FIELD_DEFINITIONS.find(([id]) => id === field)?.[1] || field}”. Save profile when all required crops are set.`);
    });
    ui.canvas.addEventListener("pointercancel", () => {
      if (!local.drawing) return;
      local.drawing = null;
      drawCanvas();
    });
  }

  function cacheUi() {
    Object.assign(ui, {
      strip: byId("ocrDcStrip"), status: byId("ocrDcStatus"), context: byId("ocrDcContext"),
      confidence: byId("ocrDcConfidence"), exactCallsCard: byId("ocrExactCallsCard"),
      captureBtn: byId("ocrCaptureBtn"), reviewBtn: byId("ocrReviewBtn"),
      workerPill: byId("ocrWorkerPill"), captureToggle: byId("ocrCaptureToggleBtn"),
      exactToggle: byId("ocrExactToggleBtn"), learningToggle: byId("ocrLearningToggleBtn"),
      debugToggle: byId("ocrDebugToggleBtn"),
      hotkeyInput: byId("ocrHotkeyInput"), saveHotkeyBtn: byId("ocrSaveHotkeyBtn"),
      settingsSummary: byId("ocrSettingsSummary"), openCalibrationBtn: byId("ocrOpenCalibrationBtn"),
      undoSnapBtn: byId("ocrUndoSnapBtn"), resetOpponentBtn: byId("ocrResetOpponentBtn"),
      exportDataBtn: byId("ocrExportDataBtn"), exportDiagnosticBtn: byId("ocrExportDiagnosticBtn"),
      deleteDataBtn: byId("ocrDeleteDataBtn"),
      calibrationOverlay: byId("ocrCalibrationOverlay"), closeCalibrationBtn: byId("ocrCloseCalibrationBtn"),
      profileName: byId("ocrProfileName"), presentationSelect: byId("ocrPresentationSelect"),
      savedProfileSelect: byId("ocrSavedProfileSelect"),
      obsUrl: byId("ocrObsUrl"), obsPassword: byId("ocrObsPassword"),
      obsUrlField: byId("ocrObsUrlField"), obsPasswordField: byId("ocrObsPasswordField"),
      sourceKindField: byId("ocrSourceKindField"), sourceKind: byId("ocrSourceKind"),
      sourceSelectLabel: byId("ocrSourceSelectLabel"),
      captureAdapter: byId("ocrCaptureAdapter"), sourceSelect: byId("ocrSourceSelect"),
      connectObsBtn: byId("ocrConnectObsBtn"), referenceBtn: byId("ocrReferenceBtn"),
      benchmarkBtn: byId("ocrBenchmarkBtn"),
      canvas: byId("ocrCalibrationCanvas"), canvasEmpty: byId("ocrCanvasEmpty"),
      regionField: byId("ocrRegionField"), regionRequired: byId("ocrRegionRequired"),
      thresholdMode: byId("ocrThresholdMode"), regionScale: byId("ocrRegionScale"),
      regionMorphology: byId("ocrRegionMorphology"), regionGrayscale: byId("ocrRegionGrayscale"),
      regionInvert: byId("ocrRegionInvert"), removeRegionBtn: byId("ocrRemoveRegionBtn"),
      regionList: byId("ocrRegionList"), saveProfileBtn: byId("ocrSaveProfileBtn"),
      testProfileBtn: byId("ocrTestProfileBtn"), calibrationStatus: byId("ocrCalibrationStatus"),
      testResults: byId("ocrTestResults"), reviewOverlay: byId("ocrReviewOverlay"),
      diagSamples: byId("ocrDiagSamples"), diagLatency: byId("ocrDiagLatency"),
      diagFrames: byId("ocrDiagFrames"), diagGate: byId("ocrDiagGate"),
      closeReviewBtn: byId("ocrCloseReviewBtn"), reviewFields: byId("ocrReviewFields"),
      recaptureBtn: byId("ocrRecaptureBtn"), acceptCorrectionsBtn: byId("ocrAcceptCorrectionsBtn"),
    });
  }

  function bindEvents() {
    ui.captureToggle?.addEventListener("click", () => updateConfig({ enabled: !local.config.enabled }));
    ui.exactToggle?.addEventListener("click", () => updateConfig({ exactCallsEnabled: !local.config.exactCallsEnabled }));
    ui.learningToggle?.addEventListener("click", () => updateConfig({ learningEnabled: !local.config.learningEnabled }));
    ui.debugToggle?.addEventListener("click", () => updateConfig({
      retainDebugFrames: !local.config.retainDebugFrames,
    }));
    ui.saveHotkeyBtn?.addEventListener("click", () => updateConfig({ hotkey: text(ui.hotkeyInput.value) }));
    ui.captureBtn?.addEventListener("click", triggerCapture);
    ui.reviewBtn?.addEventListener("click", () => setOverlay(ui.reviewOverlay, true));
    ui.openCalibrationBtn?.addEventListener("click", () => { openCalibration(); });
    ui.presentationSelect?.addEventListener("change", () => {
      onPresentationStyleChange().catch((error) => {
        setCalibrationStatus(`Could not switch presentation: ${text(error?.message || error)}`, true);
      });
    });
    ui.savedProfileSelect?.addEventListener("change", () => {
      const profileId = text(ui.savedProfileSelect.value);
      if (!profileId) {
        local.activeProfile = null;
        hydrateCalibrationFromProfile(null);
        setCalibrationStatus(`Drawing a new OCR profile for ${selectedPresentationStyle()}.`);
        return;
      }
      const profile = local.profiles.find((entry) => entry.id === profileId);
      if (profile) {
        hydrateCalibrationFromProfile(profile);
        activateProfile(profile).catch(() => {});
      }
    });
    ui.closeCalibrationBtn?.addEventListener("click", () => setOverlay(ui.calibrationOverlay, false));
    ui.closeReviewBtn?.addEventListener("click", () => setOverlay(ui.reviewOverlay, false));
    ui.connectObsBtn?.addEventListener("click", connectObs);
    ui.captureAdapter?.addEventListener("change", async () => {
      const adapter = normalizeAdapter(ui.captureAdapter.value);
      local.config.adapter = adapter;
      syncAdapterUi();
      await updateConfig({
        adapter,
        pluginFallback: false,
      });
    });
    ui.sourceKind?.addEventListener("change", renderSources);
    ui.sourceSelect?.addEventListener("change", async () => {
      const source = selectedSource();
      if (!source) return;
      const sourceId = sourceValue(source);
      local.config.sourceId = sourceId;
      await updateConfig({ sourceId });
    });
    ui.referenceBtn?.addEventListener("click", captureReference);
    ui.benchmarkBtn?.addEventListener("click", benchmarkCapture);
    ui.saveProfileBtn?.addEventListener("click", saveProfile);
    ui.testProfileBtn?.addEventListener("click", testProfile);
    ui.recaptureBtn?.addEventListener("click", triggerCapture);
    ui.acceptCorrectionsBtn?.addEventListener("click", acceptCorrections);
    ui.regionList?.addEventListener("click", (event) => {
      const row = event.target.closest("[data-region-index]");
      if (!row) return;
      local.selectedRegion = Number(row.dataset.regionIndex);
      applyRegionControls();
      renderRegionList();
    });
    ui.regionField?.addEventListener("change", onRegionFieldChange);
    [ui.regionRequired, ui.thresholdMode, ui.regionScale, ui.regionMorphology, ui.regionGrayscale, ui.regionInvert]
      .forEach((control) => control?.addEventListener("change", updateSelectedRegion));
    ui.removeRegionBtn?.addEventListener("click", () => {
      if (local.selectedRegion < 0) return;
      local.regions.splice(local.selectedRegion, 1);
      local.selectedRegion = local.regions.length
        ? Math.min(local.selectedRegion, local.regions.length - 1)
        : -1;
      if (local.selectedRegion >= 0) applyRegionControls();
      renderRegionList();
    });
    ui.exportDataBtn?.addEventListener("click", async () => {
      try {
        const result = await desktop().ocrExportData();
        ui.settingsSummary.textContent = `OCR data exported to ${result?.path || "the selected folder"}.`;
      } catch (error) {
        ui.settingsSummary.textContent = `Export failed: ${text(error?.message || error)}`;
      }
    });
    ui.exportDiagnosticBtn?.addEventListener("click", async () => {
      try {
        if (!desktop().ocrExportDiagnosticPack) {
          throw new Error("Diagnostic export is unavailable in this build.");
        }
        const result = await desktop().ocrExportDiagnosticPack();
        const where = result?.zipPath || result?.path || "the trace-logs folder";
        const events = Number(result?.eventCount || 0);
        ui.settingsSummary.textContent = events
          ? `Diagnostic pack exported (${events} event(s)) to ${where}.`
          : `Diagnostic pack exported to ${where}. Enable Debug capture and run Test All / Capture first for crops.`;
      } catch (error) {
        ui.settingsSummary.textContent = `Diagnostic export failed: ${text(error?.message || error)}`;
      }
    });
    ui.undoSnapBtn?.addEventListener("click", async () => {
      try {
        const result = await desktop().ocrUndoLastSnap();
        ui.settingsSummary.textContent = result?.undone
          ? "Last accepted OCR snap was undone and learning was rebuilt."
          : "There is no accepted OCR snap to undo.";
      } catch (error) {
        ui.settingsSummary.textContent = `Undo failed: ${text(error?.message || error)}`;
      }
    });
    ui.resetOpponentBtn?.addEventListener("click", async () => {
      const opponent = text(byId("opponentSelect")?.value).toUpperCase();
      if (!opponent || !window.confirm(`Reset OCR learning for ${opponent}? Accepted snap events remain available for export.`)) return;
      try {
        await desktop().ocrResetOpponent({ opponent });
        ui.settingsSummary.textContent = `OCR learning reset for ${opponent}.`;
      } catch (error) {
        ui.settingsSummary.textContent = `Reset failed: ${text(error?.message || error)}`;
      }
    });
    ui.deleteDataBtn?.addEventListener("click", async () => {
      if (!window.confirm("Delete all OCR profiles, snap logs, and OCR learning data? Existing OC/DC data is not affected.")) return;
      try {
        await desktop().ocrDeleteData({ confirm: "DELETE_OCR_DATA" });
        local.latestCapture = null;
        await refreshState();
      } catch (error) {
        ui.settingsSummary.textContent = `Delete failed: ${text(error?.message || error)}`;
      }
    });
    ui.exactCallsCard?.addEventListener("click", (event) => {
      const confirmBtn = event.target.closest('button[data-action="ocr-confirm-play"][data-play-id]');
      if (confirmBtn) {
        const playId = text(confirmBtn.getAttribute("data-play-id"));
        const nextState = ocrHost().confirmExactPlay?.(playId);
        refreshExactCallsFromHost(nextState || exactCallState());
        return;
      }
      if (event.target.closest('button[data-action="ocr-open-audible"]')) {
        ocrHost().openAudible?.();
        return;
      }
      if (event.target.closest('button[data-action="ocr-open-penalty"]')) {
        ocrHost().openPenalty?.();
      }
    });
    byId("teamSelect")?.addEventListener("change", syncTeamContext);
    byId("opponentSelect")?.addEventListener("change", syncTeamContext);
    // Keep OCR context aligned with the OC scoreboard (hotkey capture reads config.context).
    byId("scoreboardSection")?.addEventListener("click", () => {
      setTimeout(syncTeamContext, 0);
    });
    byId("quarterButtonGroup")?.addEventListener("click", () => {
      setTimeout(syncTeamContext, 0);
    });
    byId("halftimeBtn")?.addEventListener("click", () => {
      setTimeout(syncTeamContext, 0);
    });
    if (desktop().onOcrEvent) {
      desktop().onOcrEvent((event) => {
        if (event?.type === "capture:complete" && event.capture) {
          renderCapture(attachLearningSnapshot(event.capture, event));
        }
        if (event?.type === "capture:error" && ui.status) ui.status.textContent = `Capture failed: ${text(event.error)}`;
        if (event?.type === "status") refreshState();
      });
    }
    bindCanvas();
  }

  async function init() {
    if (local.initialized) return;
    local.initialized = true;
    cacheUi();
    populateFields();
    bindEvents();
    try {
      const defensive = desktop().loadDefensivePlays ? await desktop().loadDefensivePlays() : [];
      local.defensivePlays = (Array.isArray(defensive) ? defensive : []).map((play) => ({
        ...play,
        id: play.id || [play.team, play.formation, play.set, play.play_name || play.playName]
          .map((value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, "-"))
          .filter(Boolean)
          .join("|"),
      }));
    } catch (_) {
      local.defensivePlays = [];
    }
    await refreshState();
    syncTeamContext();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.GridironOcrUi = {
    onExactCallStateChanged: refreshExactCallsFromHost,
    refreshExactCalls: () => refreshExactCallsFromHost(exactCallState()),
    onRoleChanged: () => {
      // Strip chrome only — do not sync Exact Calls back into the host (re-enters render).
      if (isOcHostRole()) local.latestExactRecommendations = [];
      renderExactCallsCard(local.latestExactRecommendations || [], exactCallState(), { syncHost: false });
      renderStrip({});
      syncTeamContext();
    },
  };
})();
