'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const MAX_DEBUG_EVENTS = 40;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function stamp(now = Date.now()) {
  return new Date(now).toISOString().replace(/[:.]/g, '-');
}

function dataUrlToBuffer(dataUrl) {
  const raw = clean(dataUrl);
  const match = raw.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return null;
  try {
    return Buffer.from(match[1], 'base64');
  } catch (_error) {
    return null;
  }
}

class OcrDebugPack {
  constructor(options = {}) {
    if (!options.userData) throw new TypeError('userData is required');
    this.userData = options.userData;
    this.now = options.now || (() => Date.now());
    this.root = path.join(this.userData, 'ocr-debug');
    this.sessionId = null;
    this.sessionDir = null;
    this.eventCount = 0;
    this.enabled = false;
  }

  async setEnabled(enabled) {
    const next = enabled === true;
    if (next === this.enabled && this.sessionDir) return this.sessionSummary();
    this.enabled = next;
    if (!next) {
      return { enabled: false, sessionId: this.sessionId, sessionDir: this.sessionDir };
    }
    await this.startSession('debug_enabled');
    return this.sessionSummary();
  }

  sessionSummary() {
    return {
      enabled: this.enabled,
      sessionId: this.sessionId,
      sessionDir: this.sessionDir,
      eventCount: this.eventCount,
    };
  }

  async startSession(reason = 'manual') {
    this.sessionId = `ocr-debug-${stamp(this.now())}`;
    this.sessionDir = path.join(this.root, this.sessionId);
    this.eventCount = 0;
    await fs.mkdir(path.join(this.sessionDir, 'events'), { recursive: true });
    await fs.mkdir(path.join(this.sessionDir, 'crops'), { recursive: true });
    const header = {
      version: 1,
      sessionId: this.sessionId,
      startedAt: this.now(),
      reason: clean(reason) || 'manual',
      note: 'Local OCR diagnostic session. Share this folder/zip for capture debugging.',
    };
    await fs.writeFile(
      path.join(this.sessionDir, 'session.json'),
      `${JSON.stringify(header, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(this.sessionDir, 'README.txt'),
      [
        'Gridiron OCR diagnostic pack',
        '============================',
        '',
        '1. Turn on "Debug capture" in OCR settings before testing.',
        '2. Run Calibrate → Test All and/or live OCR Capture (hotkey).',
        '3. Correct any wrong fields in Review when prompted.',
        '4. Click "Export Diagnostic Pack" and share the zip/folder.',
        '',
        'Contents:',
        '- session.json / session.summary.json — engine, profile, counts',
        '- events/*.json — per capture/test/correction diagnostics',
        '- crops/* — raw + processed ROI PNGs (when debug was on)',
        '- decisions-tail.jsonl — recent decision traces',
        '',
        `Session: ${this.sessionId}`,
        '',
      ].join('\n'),
      'utf8',
    );
    return this.sessionSummary();
  }

  async ensureSession() {
    if (!this.enabled) return null;
    if (!this.sessionDir) await this.startSession('auto');
    return this.sessionDir;
  }

  async writeSessionSummary(summary = {}) {
    if (!this.sessionDir) return;
    const payload = {
      version: 1,
      sessionId: this.sessionId,
      updatedAt: this.now(),
      eventCount: this.eventCount,
      ...summary,
    };
    await fs.writeFile(
      path.join(this.sessionDir, 'session.summary.json'),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8',
    );
  }

  async recordEvent(kind, payload = {}, options = {}) {
    if (!this.enabled) return null;
    await this.ensureSession();
    if (this.eventCount >= MAX_DEBUG_EVENTS) {
      await this.startSession('rotated_max_events');
    }
    this.eventCount += 1;
    const index = String(this.eventCount).padStart(4, '0');
    const eventId = clean(payload.id) || `event-${index}`;
    const retainCrops = options.retainCrops !== false;
    const fields = {};
    const cropFiles = [];

    for (const [key, field] of Object.entries(payload.fields || {})) {
      const entry = {
        key,
        rawText: field.rawText || field.text || '',
        sanitizedText: field.sanitizedText || '',
        value: field.value,
        accepted: field.accepted === true,
        acceptanceReasons: field.acceptanceReasons || field.reasons || [],
        ocrConfidence: field.ocrConfidence ?? field.confidence,
        resolverConfidence: field.resolverConfidence,
        framesAgree: field.framesAgree ?? field.agreement,
        bandSource: field.bandSource || null,
        bandScore: field.bandScore ?? null,
        fieldSide: field.fieldSide || null,
        fieldSideDirection: field.fieldSideDirection || null,
        roi: field.roi || null,
      };
      if (retainCrops) {
        const rawName = `${index}_${key}_raw.png`;
        const processedName = `${index}_${key}_processed.png`;
        const rawBuf = dataUrlToBuffer(field.rawCrop);
        const processedBuf = dataUrlToBuffer(field.processedCrop);
        if (rawBuf) {
          await fs.writeFile(path.join(this.sessionDir, 'crops', rawName), rawBuf);
          entry.rawCropFile = `crops/${rawName}`;
          cropFiles.push(entry.rawCropFile);
        }
        if (processedBuf) {
          await fs.writeFile(path.join(this.sessionDir, 'crops', processedName), processedBuf);
          entry.processedCropFile = `crops/${processedName}`;
          cropFiles.push(entry.processedCropFile);
        }
      }
      fields[key] = entry;
    }

    const event = {
      version: 1,
      index: this.eventCount,
      id: eventId,
      kind: clean(kind) || 'capture',
      at: payload.at || this.now(),
      engine: payload.engine || null,
      engineWarm: payload.engineWarm || null,
      profileId: payload.profileId || null,
      presentation: payload.presentation || null,
      source: payload.source || null,
      role: payload.role || null,
      team: payload.team || null,
      opponent: payload.opponent || null,
      timing: payload.timing || null,
      validation: payload.validation || null,
      frameCount: payload.frameCount ?? null,
      duplicateFrames: payload.duplicateFrames ?? null,
      staleFrames: payload.staleFrames ?? null,
      captureAdapters: payload.captureAdapters || null,
      rois: payload.rois || null,
      fields,
      cropFiles,
      notes: payload.notes || null,
    };

    await fs.writeFile(
      path.join(this.sessionDir, 'events', `${index}-${clean(kind) || 'event'}.json`),
      `${JSON.stringify(event, null, 2)}\n`,
      'utf8',
    );
    return event;
  }

  async exportPack(options = {}) {
    const exportRoot = options.destinationDir
      || path.join(this.userData, `gridiron-ocr-diagnostic-${stamp(this.now())}`);
    await fs.mkdir(exportRoot, { recursive: true });

    if (this.sessionDir) {
      await this._copyDir(this.sessionDir, path.join(exportRoot, 'session'));
    } else {
      await fs.writeFile(
        path.join(exportRoot, 'README.txt'),
        'No active debug session. Enable Debug capture, run Test All / Capture, then export again.\n',
        'utf8',
      );
    }

    if (options.sessionSummary) {
      await fs.writeFile(
        path.join(exportRoot, 'export-summary.json'),
        `${JSON.stringify({ ...options.sessionSummary, exportedAt: this.now() }, null, 2)}\n`,
        'utf8',
      );
    }

    if (Array.isArray(options.decisionLines) && options.decisionLines.length) {
      await fs.writeFile(
        path.join(exportRoot, 'decisions-tail.jsonl'),
        `${options.decisionLines.join('\n')}\n`,
        'utf8',
      );
    }

    if (options.profileSnapshot) {
      await fs.writeFile(
        path.join(exportRoot, 'active-profile.json'),
        `${JSON.stringify(options.profileSnapshot, null, 2)}\n`,
        'utf8',
      );
    }

    let zipPath = null;
    try {
      zipPath = `${exportRoot}.zip`;
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path "${exportRoot}\\*" -DestinationPath "${zipPath}" -Force`,
      ], { windowsHide: true });
    } catch (_error) {
      zipPath = null;
    }

    return {
      path: exportRoot,
      zipPath,
      sessionId: this.sessionId,
      eventCount: this.eventCount,
    };
  }

  async _copyDir(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) await this._copyDir(from, to);
      else await fs.copyFile(from, to);
    }
  }
}

module.exports = {
  OcrDebugPack,
  MAX_DEBUG_EVENTS,
};
