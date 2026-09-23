#!/usr/bin/env node
/**
 * Composite OCR packaging gate (Phase 7 scaffolding).
 * Live OBS/Xbox/installed-app checks remain manual via OCR_RELEASE_VALIDATION_CHECKLIST.md.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function run(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
    ...options,
  });
  if (result.status !== 0) {
    failures.push(`${label} (exit ${result.status})`);
    return false;
  }
  return true;
}

function checkExists(label, relativePath) {
  const full = path.join(root, relativePath);
  const ok = fs.existsSync(full);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${relativePath}`);
  if (!ok) failures.push(label);
  return ok;
}

console.log('Gridiron OCR verify-package (automated subset)');

run('syntax main.js', 'node', ['--check', 'main.js']);
run('syntax preload.js', 'node', ['--check', 'preload.js']);
run('OCR unit + domain smoke', 'npm', ['run', 'test:ocr:js']);
run('OCR worker tests', 'npm', ['run', 'test:ocr:worker']);

const workerExe = path.join(
  'ocr-sidecar',
  'dist',
  'gridiron-ocr-sidecar',
  'gridiron-ocr-sidecar.exe',
);
if (!fs.existsSync(path.join(root, workerExe))) {
  run('build OCR worker', 'npm', ['run', 'build:ocr-worker']);
}
checkExists('packaged worker exe', workerExe);
checkExists(
  'bundled tesseract',
  path.join('ocr-sidecar', 'dist', 'gridiron-ocr-sidecar', 'tesseract', 'tesseract.exe'),
);
run('OCR license guard', 'npm', ['run', 'check:ocr-license']);

const fixtureManifest = path.join('ocr-golden', 'fixtures', 'manifest.json');
const privateManifest = path.join('ocr-golden', 'private', 'manifest.json');
if (fs.existsSync(path.join(root, fixtureManifest))) {
  run('fixture OCR benchmark', 'npm', ['run', 'benchmark:ocr', '--', fixtureManifest]);
} else if (fs.existsSync(path.join(root, privateManifest))) {
  run('private golden OCR benchmark', 'npm', ['run', 'benchmark:ocr', '--', privateManifest]);
} else {
  console.log('SKIP golden benchmark (no fixtures/ or private/ manifest yet)');
}

const pluginDll = path.join('obs-plugin', 'dist', '64bit', 'gridiron-ocr-capture.dll');
if (fs.existsSync(path.join(root, pluginDll))) {
  checkExists('OBS shared-frame plugin', pluginDll);
} else {
  console.log('SKIP OBS plugin artifact (not built yet)');
}

const bridgeExe = path.join('capture-bridge', 'dist', 'GridironCaptureBridge.exe');
if (!fs.existsSync(path.join(root, bridgeExe))) {
  run('build Capture Bridge', 'npm', ['run', 'build:capture-bridge']);
}
checkExists('Capture Bridge exe', bridgeExe);

console.log('\nManual remaining gates: Capture Bridge + OBS/Xbox live checklist, installer install, 100-snap attribution.');
if (failures.length) {
  console.error(`\nverify-ocr-package FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nverify-ocr-package automated subset PASSED');
