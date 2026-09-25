import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "THIRD_PARTY_NOTICES.md",
  "licenses/OCR_RUNTIME_NOTICES.md",
  "licenses/Apache-2.0.LICENSE",
  "licenses/MIT.LICENSE",
  "ocr-sidecar/dist/gridiron-ocr-sidecar/gridiron-ocr-sidecar.exe",
  "ocr-sidecar/dist/gridiron-ocr-sidecar/tesseract/tesseract.exe",
  "ocr-sidecar/dist/gridiron-ocr-sidecar/tesseract/tessdata/eng.traineddata",
];
const missing = required.filter((relative) => !fs.existsSync(path.join(pcDir, relative)));
if (missing.length) {
  throw new Error(`OCR package/license guard: missing ${missing.join(", ")}`);
}

const modelRoot = path.join(pcDir, "ocr-sidecar", "models");
if (fs.existsSync(modelRoot)) {
  const modelFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(onnx|pdmodel|pdiparams)$/i.test(entry.name)) modelFiles.push(full);
    }
  };
  walk(modelRoot);
  if (modelFiles.length && !fs.existsSync(path.join(modelRoot, "MODEL_LICENSE.txt"))) {
    throw new Error("OCR package/license guard: model binaries require models/MODEL_LICENSE.txt");
  }
}

const notices = fs.readFileSync(path.join(pcDir, "THIRD_PARTY_NOTICES.md"), "utf8");
for (const name of ["NumPy", "OpenCV", "pytesseract", "PyInstaller", "Tesseract", "PP-OCRv5", "Apache-2.0"]) {
  if (!notices.includes(name)) throw new Error(`OCR package/license guard: THIRD_PARTY_NOTICES.md omits ${name}`);
}

const runtimeNotices = fs.readFileSync(path.join(pcDir, "licenses/OCR_RUNTIME_NOTICES.md"), "utf8");
if (!/Apache-2\.0/.test(runtimeNotices) || !/PP-OCRv5_mobile_rec_onnx/.test(runtimeNotices)) {
  throw new Error("OCR package/license guard: OCR_RUNTIME_NOTICES.md must record PP-OCRv5 ONNX Apache-2.0 policy");
}

console.log("OCR package/license guard passed (worker, baseline runtime, notices, model policy).");
