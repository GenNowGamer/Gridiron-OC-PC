'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { OcrDebugPack } = require('../debug-pack');

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('OcrDebugPack records crops and exports a folder', async (t) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'gridiron-ocr-debug-'));
  t.after(async () => {
    await fs.rm(userData, { recursive: true, force: true });
  });

  const pack = new OcrDebugPack({ userData, now: () => 1700000000000 });
  await pack.setEnabled(true);
  assert.equal(pack.enabled, true);
  assert.ok(pack.sessionDir);

  await pack.recordEvent('capture', {
    id: 'cap-1',
    engine: 'onnx_ppocrv5',
    fields: {
      down_distance: {
        rawText: '1st & 10',
        value: { down: 1, distance: 10 },
        accepted: true,
        ocrConfidence: 0.97,
        bandSource: 'roi',
        rawCrop: TINY_PNG,
        processedCrop: TINY_PNG,
        roi: { x: 0.1, y: 0.8, width: 0.12, height: 0.04 },
      },
    },
  });

  const summary = pack.sessionSummary();
  assert.equal(summary.eventCount, 1);

  const exportRoot = path.join(userData, 'export-out');
  const exported = await pack.exportPack({
    destinationDir: exportRoot,
    decisionLines: ['{"version":2,"id":"cap-1"}'],
    profileSnapshot: { id: 'profile-1', regions: [] },
    sessionSummary: { retainDebugFrames: true },
  });

  assert.equal(exported.path, exportRoot);
  assert.equal(exported.eventCount, 1);
  const eventFiles = await fs.readdir(path.join(exportRoot, 'session', 'events'));
  assert.equal(eventFiles.length, 1);
  const crops = await fs.readdir(path.join(exportRoot, 'session', 'crops'));
  assert.ok(crops.some((name) => name.includes('down_distance_raw')));
  const decisions = await fs.readFile(path.join(exportRoot, 'decisions-tail.jsonl'), 'utf8');
  assert.match(decisions, /cap-1/);
  const profile = JSON.parse(await fs.readFile(path.join(exportRoot, 'active-profile.json'), 'utf8'));
  assert.equal(profile.id, 'profile-1');
});
