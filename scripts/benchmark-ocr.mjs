import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pcDir = path.resolve(here, "..");
const sidecarDir = path.join(pcDir, "ocr-sidecar");
const manifestPath = path.resolve(process.argv[2] || path.join(pcDir, "ocr-golden", "fixtures", "manifest.json"));
const threshold = Number(process.env.OCR_ACCEPT_THRESHOLD || 0.92);
const PRECISION_GATE = 0.99;
const RECALL_GATE = 0.95;
const P95_GATE_MS = 800;

const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const percentile = (values, amount) => {
  if (!values.length) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * amount) - 1)];
};

class JsonLineClient {
  constructor() {
    const useBundled = process.env.OCR_SIDECAR_EXE || "";
    const venvPython = path.join(sidecarDir, ".venv", "Scripts", "python.exe");
    const pythonCmd = process.env.OCR_SIDECAR_PYTHON
      || (fsSync.existsSync(venvPython) ? venvPython : "py");
    const pythonArgs = useBundled ? [] : (pythonCmd === "py" ? ["-3.12", "-m", "ocr_sidecar"] : ["-m", "ocr_sidecar"]);
    this.child = spawn(useBundled || pythonCmd, useBundled ? [] : pythonArgs, {
      cwd: sidecarDir,
      stdio: ["pipe", "pipe", "inherit"],
      windowsHide: true,
    });
    this.pending = new Map();
    this.buffer = "";
    this.sequence = 0;
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        const pending = this.pending.get(String(message.id));
        if (!pending) continue;
        this.pending.delete(String(message.id));
        message.ok ? pending.resolve(message.result) : pending.reject(Object.assign(new Error(message.error?.message), message.error));
      }
    });
    this.child.on("exit", (code) => {
      for (const pending of this.pending.values()) pending.reject(new Error(`OCR sidecar exited with ${code}`));
      this.pending.clear();
    });
  }

  request(command, params = {}) {
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, command, params })}\n`);
    });
  }

  async close() {
    try { await this.request("shutdown"); } catch {}
    this.child.stdin.end();
  }
}

async function loadManifest() {
  const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (!Array.isArray(parsed.samples) || !parsed.samples.length) throw new Error("Golden manifest has no samples.");
  return parsed;
}

async function main() {
  const manifest = await loadManifest();
  const client = new JsonLineClient();
  let expectedCount = 0;
  let acceptedCount = 0;
  let correctAccepted = 0;
  const elapsed = [];
  try {
    await client.request("hello");
    const warmup = manifest.samples[0];
    const warmupFile = path.resolve(path.dirname(manifestPath), warmup.image);
    await client.request("profile.test", {
      imagePath: warmupFile,
      engine: manifest.engine || "auto",
      profile: warmup.profile || manifest.profile,
    });
    for (const sample of manifest.samples) {
      const imageFile = path.resolve(path.dirname(manifestPath), sample.image);
      const started = performance.now();
      const params = {
        engine: sample.engine || manifest.engine || "auto",
        profile: sample.profile || manifest.profile,
      };
      // Prefer imagePath for large frames; fall back to base64 for tiny fixtures.
      if (process.env.OCR_BENCHMARK_BASE64 === "1") {
        params.imageBase64 = await fs.readFile(imageFile, "base64");
      } else {
        params.imagePath = imageFile;
      }
      const result = await client.request("profile.test", params);
      elapsed.push(performance.now() - started);
      for (const [field, expected] of Object.entries(sample.expected || {})) {
        expectedCount += 1;
        const actual = result.rois?.[field] || {};
        if (Number(actual.confidence || 0) < threshold || !normalize(actual.text)) continue;
        acceptedCount += 1;
        if (normalize(actual.text) === normalize(expected)) correctAccepted += 1;
      }
    }
  } finally {
    await client.close();
  }
  const precision = acceptedCount ? correctAccepted / acceptedCount : 0;
  const recall = expectedCount ? correctAccepted / expectedCount : 0;
  const p95Ms = percentile(elapsed, 0.95);
  const passed = precision >= PRECISION_GATE && recall >= RECALL_GATE && p95Ms <= P95_GATE_MS;
  console.log(JSON.stringify({
    manifest: manifestPath,
    samples: manifest.samples.length,
    expectedFields: expectedCount,
    acceptedFields: acceptedCount,
    correctAccepted,
    precision,
    recall,
    p50Ms: percentile(elapsed, 0.5),
    p95Ms,
    gates: { precision: PRECISION_GATE, recall: RECALL_GATE, p95Ms: P95_GATE_MS },
    passed,
  }, null, 2));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
