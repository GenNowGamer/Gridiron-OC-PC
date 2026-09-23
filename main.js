const path = require("path");
const fsSync = require("fs");
const fs = require("fs/promises");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { app, BrowserWindow, ipcMain, shell, globalShortcut } = require("electron");
const { IntegrationOcrManager } = require("./ocr/main/integration-manager");


let activeWhisperProcess = null;
let activeWhisperCanceled = false;
let ocrManager = null;

function traceDir() {
  return path.join(app.getPath("userData"), "trace-logs");
}

function currentTracePath() {
  return path.join(traceDir(), "gridiron-trace-current.txt");
}

function formatMainProcessLog(tag, payload) {
  return `MAIN [${String(tag || "main")}] ${JSON.stringify(payload || {})}`;
}

function preferencesPath() {
  return path.join(app.getPath("userData"), "preferences.json");
}

function whisperAudioDir() {
  return path.join(app.getPath("userData"), "whisper-audio");
}


function appAssetBaseDir() {
  return app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : __dirname;
}

function ocrSidecarOptions() {
  const workerDir = app.isPackaged
    ? path.join(process.resourcesPath, "ocr-worker")
    : path.join(__dirname, "ocr-sidecar", "dist", "gridiron-ocr-sidecar");
  const executable = path.join(workerDir, "gridiron-ocr-sidecar.exe");
  const frozenOptions = () => ({
    spawn,
    command: executable,
    args: [],
    spawnOptions: { cwd: workerDir, windowsHide: true },
    requestTimeoutMs: 12000,
  });
  // Packaged installs (or GRIDIRON_OCR_USE_FROZEN=1) use the PyInstaller exe.
  if ((app.isPackaged || process.env.GRIDIRON_OCR_USE_FROZEN === "1")
      && fsSync.existsSync(executable)) {
    return frozenOptions();
  }
  // Unpackaged: prefer the sidecar venv so OpenCV/onnx deps resolve, while
  // still running live Python source (capture-bridge, etc.).
  const sourceDir = path.join(__dirname, "ocr-sidecar");
  const venvPython = path.join(sourceDir, ".venv", "Scripts", "python.exe");
  if (fsSync.existsSync(venvPython)) {
    return {
      spawn,
      command: venvPython,
      args: ["-m", "ocr_sidecar"],
      spawnOptions: {
        cwd: sourceDir,
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      },
      requestTimeoutMs: 12000,
    };
  }
  if (fsSync.existsSync(executable)) {
    return frozenOptions();
  }
  return {
    spawn,
    command: "py",
    args: ["-3.12", "-m", "ocr_sidecar"],
    spawnOptions: {
      cwd: sourceDir,
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    },
    requestTimeoutMs: 12000,
  };
}

function ocrBridgeOptions() {
  const bridgeDir = app.isPackaged
    ? path.join(process.resourcesPath, "capture-bridge")
    : path.join(__dirname, "capture-bridge", "dist");
  const executable = path.join(bridgeDir, "GridironCaptureBridge.exe");
  if (!fsSync.existsSync(executable)) {
    return null;
  }
  return {
    spawn,
    command: executable,
    args: [],
    spawnOptions: { cwd: bridgeDir, windowsHide: true },
    requestTimeoutMs: 20000,
    helloTimeoutMs: 8000,
  };
}

async function loadOcrCatalogs() {
  const readJson = async (fileName) => {
    try {
      return JSON.parse(await fs.readFile(path.join(__dirname, fileName), "utf8"));
    } catch (_error) {
      return [];
    }
  };
  const [offensive, defensive] = await Promise.all([
    readJson("plays.json"),
    readJson("defensive_plays.json"),
  ]);
  const withIds = (items) => (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    id: item.id || [item.team, item.formation, item.set, item.play_name || item.playName]
      .map((value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"))
      .filter(Boolean)
      .join("|"),
  }));
  return { offensive: withIds(offensive), defensive: withIds(defensive) };
}

function publishOcrEvent(event) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("desktop:ocr-event", event);
  }
}


function whisperRuntimeDir() {
  return path.join(appAssetBaseDir(), "vendor", "whisper", "runtime", "whisper", "Release");
}

function whisperModelDir() {
  return path.join(appAssetBaseDir(), "vendor", "whisper", "model");
}

function ffmpegRuntimeDir() {
  return path.join(appAssetBaseDir(), "vendor", "ffmpeg", "runtime");
}


function whisperExecutablePath() {
  return path.join(whisperRuntimeDir(), "whisper-cli.exe");
}

function whisperModelCandidates() {
  return [
    path.join(whisperModelDir(), "ggml-tiny.en.bin"),
    path.join(whisperModelDir(), "ggml-base.en.bin"),
  ];
}

async function resolveWhisperModelPath() {
  for (const candidate of whisperModelCandidates()) {
    if (await fileExists(candidate)) return candidate;
  }
  return "";
}

function ffmpegExecutablePath() {
  return path.join(ffmpegRuntimeDir(), "ffmpeg.exe");
}


async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}


async function ensureWhisperAudioDir() {
  await fs.mkdir(whisperAudioDir(), { recursive: true });
}


async function pruneOldWhisperFiles() {
  await ensureWhisperAudioDir();
  const files = await fs.readdir(whisperAudioDir(), { withFileTypes: true });
  const retainedFiles = await Promise.all(files
    .filter((entry) => entry.isFile())
    .map(async (entry) => {
      const fullPath = path.join(whisperAudioDir(), entry.name);
      const stat = await fs.stat(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    }));
  retainedFiles
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(12)
    .forEach(({ fullPath }) => {
      fs.unlink(fullPath).catch(() => {});
    });
}

async function getWhisperStatus() {
  const executableReady = await fileExists(whisperExecutablePath());
  const modelPath = await resolveWhisperModelPath();
  const modelReady = Boolean(modelPath);
  const ffmpegReady = await fileExists(ffmpegExecutablePath());
  const available = executableReady && modelReady && ffmpegReady;
  return {
    available,
    executableReady,
    modelReady,
    ffmpegReady,
    busy: Boolean(activeWhisperProcess),
    model: modelReady ? path.basename(modelPath) : "",
    modelPath,
    language: "en",
    reason: available
      ? ""
      : (!executableReady
        ? "Whisper runtime files are missing."
        : (!modelReady
          ? "Whisper model files are missing."
          : "FFmpeg conversion files are missing.")),
  };
}

async function stopActiveWhisperProcess() {
  if (!activeWhisperProcess) return;
  activeWhisperCanceled = true;
  try {
    activeWhisperProcess.kill();
  } catch (_error) {
  }
  activeWhisperProcess = null;
}

function extractWhisperTranscript(parsedJson) {
  const directText = String(parsedJson?.text || parsedJson?.result?.text || "").trim();
  if (directText) return directText;

  if (Array.isArray(parsedJson?.transcription)) {
    const transcriptionText = parsedJson.transcription
      .map((entry) => String(entry?.text || entry || "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (transcriptionText) return transcriptionText;
  }

  if (Array.isArray(parsedJson?.segments)) {
    const segmentText = parsedJson.segments
      .map((segment) => String(segment?.text || "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (segmentText) return segmentText;
  }

  return "";
}

function normalizeAudioBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Buffer.from(value);
  throw new Error("Whisper transcription did not receive valid audio bytes.");
}

function whisperInputExtension(payload = {}) {
  const explicit = String(payload.fileExtension || "").trim().toLowerCase().replace(/^\./, "");
  if (["wav", "ogg", "mp3", "flac", "webm"].includes(explicit)) return `.${explicit}`;

  const mimeType = String(payload.audioMimeType || "").trim().toLowerCase();
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("wav")) return ".wav";
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return ".mp3";
  if (mimeType.includes("flac")) return ".flac";

  throw new Error("The recorded audio format is not supported. Whisper needs WebM, OGG, WAV, MP3, or FLAC input.");
}

async function convertAudioToWhisperWav(sourcePath, targetPath) {
  const args = [
    "-y",
    "-i", sourcePath,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "pcm_s16le",
    targetPath,
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegExecutablePath(), args, {
      cwd: ffmpegRuntimeDir(),
      windowsHide: true,
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
    });
  });
}

async function transcribeWithWhisper(payload = {}) {
  const status = await getWhisperStatus();
  if (!status.available) {
    throw new Error(status.reason || "Whisper is not available.");
  }
  const resolvedModelPath = String(status.modelPath || "");
  if (!resolvedModelPath) {
    throw new Error("Whisper model files are missing.");
  }

  const audioBuffer = normalizeAudioBytes(payload.audioBytes);
  const inputExtension = whisperInputExtension(payload);
  if (!audioBuffer.length) {
    throw new Error("No recorded audio was provided for Whisper transcription.");
  }

  await ensureWhisperAudioDir();
  await stopActiveWhisperProcess();

  const baseName = `whisper-${Date.now()}-${crypto.randomUUID()}`;
  const audioPath = path.join(whisperAudioDir(), `${baseName}${inputExtension}`);
  const convertedAudioPath = path.join(whisperAudioDir(), `${baseName}.wav`);
  const outputBasePath = path.join(whisperAudioDir(), `${baseName}-out`);
  const jsonPath = `${outputBasePath}.json`;

  await fs.writeFile(audioPath, audioBuffer);
  const shouldBypassConversion = inputExtension === ".wav" && String(payload.audioMimeType || "").toLowerCase().includes("wav");
  if (!shouldBypassConversion) {
    await convertAudioToWhisperWav(audioPath, convertedAudioPath);
  }
  const whisperInputPath = shouldBypassConversion ? audioPath : convertedAudioPath;

  const args = [
    "-m", resolvedModelPath,
    "-f", whisperInputPath,
    "-l", "en",
    "-nt",
    "-np",
    "-oj",
    "-of", outputBasePath,
  ];

  try {
    await new Promise((resolve, reject) => {
      activeWhisperCanceled = false;
      const child = spawn(whisperExecutablePath(), args, {
        cwd: whisperRuntimeDir(),
        windowsHide: true,
      });
      activeWhisperProcess = child;

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk || "");
      });
      child.on("error", (error) => {
        activeWhisperProcess = null;
        reject(error);
      });
      child.on("exit", (code) => {
        const canceled = activeWhisperCanceled;
        activeWhisperProcess = null;
        activeWhisperCanceled = false;
        if (canceled) {
          reject(new Error("Whisper transcription was canceled."));
          return;
        }
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `Whisper exited with code ${code}`));
      });
    });

    const rawJson = await fs.readFile(jsonPath, "utf8");
    const parsedJson = JSON.parse(rawJson);
    const transcript = extractWhisperTranscript(parsedJson);
    if (!transcript) {
      throw new Error("Whisper finished, but no transcript text was returned.");
    }

    await pruneOldWhisperFiles();

    return {
      transcript,
      audioPath: convertedAudioPath,
      sourceAudioPath: audioPath,
      jsonPath,
    };
  } catch (error) {
    throw error;
  }
}



async function ensureTraceDir() {
  await fs.mkdir(traceDir(), { recursive: true });
}

async function readPreferencesFile() {
  try {
    const raw = await fs.readFile(preferencesPath(), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    throw error;
  }
}

async function writePreferencesFile(preferences) {
  await fs.mkdir(path.dirname(preferencesPath()), { recursive: true });
  await fs.writeFile(preferencesPath(), JSON.stringify(preferences || {}, null, 2), "utf8");
  return { path: preferencesPath() };
}

function writePreferencesFileSync(preferences) {
  fsSync.mkdirSync(path.dirname(preferencesPath()), { recursive: true });
  fsSync.writeFileSync(preferencesPath(), JSON.stringify(preferences || {}, null, 2), "utf8");
  return { path: preferencesPath() };
}

function allowMediaPermissionsForWindow(win) {
  const permissionSession = win.webContents.session;
  const mediaPermissions = new Set(["media", "microphone"]);

  permissionSession.setPermissionCheckHandler((webContents, permission) => (
    webContents?.id === win.webContents.id && mediaPermissions.has(permission)
  ));

  permissionSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(webContents?.id === win.webContents.id && mediaPermissions.has(permission));
  });

  if (typeof permissionSession.setDevicePermissionHandler === "function") {
    permissionSession.setDevicePermissionHandler((details) => (
      details.deviceType === "audioCapture"
      && details.webContents?.id === win.webContents.id
    ));
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: "#0b0f14",
    icon: app.isPackaged
      ? path.join(path.dirname(process.resourcesPath), "icon.ico")
      : path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  allowMediaPermissionsForWindow(win);
  win.webContents.on("render-process-gone", async (_event, details) => {
    try {
      await ensureTraceDir();
      const line = formatMainProcessLog("renderer-gone", {
        at: new Date().toISOString(),
        reason: details?.reason || "unknown",
        exitCode: details?.exitCode ?? null,
      });
      await fs.appendFile(currentTracePath(), `${line}\n`, "utf8");
    } catch (_error) {
    }
  });

  win.webContents.on("unresponsive", async () => {
    try {
      await ensureTraceDir();
      const line = formatMainProcessLog("renderer-unresponsive", {
        at: new Date().toISOString(),
      });
      await fs.appendFile(currentTracePath(), `${line}\n`, "utf8");
    } catch (_error) {
    }
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

app.setAppUserModelId("com.gridiron.playadvisor.pc");
app.whenReady().then(() => {
  ipcMain.handle("desktop:trace-read", async () => {
    await ensureTraceDir();
    try {
      const text = await fs.readFile(currentTracePath(), "utf8");
      return { path: currentTracePath(), text };
    } catch (error) {
      if (error && error.code === "ENOENT") return { path: currentTracePath(), text: "" };
      throw error;
    }
  });

  ipcMain.handle("desktop:trace-write", async (_event, text) => {
    await ensureTraceDir();
    await fs.writeFile(currentTracePath(), String(text || ""), "utf8");
    return { path: currentTracePath() };
  });

  ipcMain.handle("desktop:trace-export", async (_event, text) => {
    await ensureTraceDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const exportPath = path.join(traceDir(), `gridiron-trace-${stamp}.txt`);
    await fs.writeFile(exportPath, String(text || ""), "utf8");
    return { path: exportPath };
  });

  ipcMain.handle("desktop:trace-open-folder", async () => {
    await ensureTraceDir();
    const dir = traceDir();
    const errorMessage = await shell.openPath(dir);
    if (errorMessage) throw new Error(errorMessage);
    return { path: dir };
  });

  ipcMain.handle("desktop:preferences-read", async () => {
    const preferences = await readPreferencesFile();
    return { path: preferencesPath(), preferences };
  });

  ipcMain.handle("desktop:preferences-write", async (_event, preferences) => (
    writePreferencesFile(preferences)
  ));

  ipcMain.on("desktop:preferences-write-sync", (event, preferences) => {
    try {
      event.returnValue = writePreferencesFileSync(preferences);
    } catch (error) {
      event.returnValue = {
        error: error?.message || String(error),
      };
    }
  });

  ocrManager = new IntegrationOcrManager({
    userData: app.getPath("userData"),
    globalShortcut,
    sidecarOptions: ocrSidecarOptions(),
    bridgeOptions: ocrBridgeOptions(),
    loadCatalogs: loadOcrCatalogs,
    exportDirectory: () => path.join(app.getPath("userData"), "trace-logs"),
  });
  ocrManager.on("event", publishOcrEvent);

  ipcMain.handle("desktop:ocr-status", async () => ocrManager.getStatus());
  ipcMain.handle("desktop:ocr-config-update", async (_event, patch) => ocrManager.updateConfig(patch));
  ipcMain.handle("desktop:ocr-list-sources", async (_event, obs) => ocrManager.listSources(obs));
  ipcMain.handle("desktop:ocr-reference", async (_event, args) => ocrManager.captureReference(args));
  ipcMain.handle("desktop:ocr-benchmark", async (_event, args) => ocrManager.benchmarkCapture(args));
  ipcMain.handle("desktop:ocr-profile-save", async (_event, profile) => ocrManager.saveProfile(profile));
  ipcMain.handle("desktop:ocr-profile-test", async (_event, args) => ocrManager.testProfile(args));
  ipcMain.handle("desktop:ocr-capture", async (_event, args) => ocrManager.capture(args));
  ipcMain.handle("desktop:ocr-correct", async (_event, args) => ocrManager.correctCapture(args));
  ipcMain.handle("desktop:ocr-undo-last-snap", async () => ocrManager.undoLastSnap());
  ipcMain.handle("desktop:ocr-reset-opponent", async (_event, args) => ocrManager.resetOpponent(args));
  ipcMain.handle("desktop:ocr-export", async () => {
    await ensureTraceDir();
    return ocrManager.exportData();
  });
  ipcMain.handle("desktop:ocr-export-diagnostic", async () => {
    await ensureTraceDir();
    return ocrManager.exportDiagnosticPack();
  });
  ipcMain.handle("desktop:ocr-delete", async (_event, args) => ocrManager.deleteData(args));

  ipcMain.handle("desktop:whisper-status", async () => getWhisperStatus());
  ipcMain.handle("desktop:whisper-transcribe", async (_event, payload) => transcribeWithWhisper(payload));
  ipcMain.handle("desktop:whisper-cancel", async () => {
    await stopActiveWhisperProcess();
    return { ok: true };
  });

  createWindow();
  ocrManager.initialize().then(publishOcrEvent).catch((error) => {
    publishOcrEvent({ type: "status", error: error?.message || String(error) });
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (ocrManager) ocrManager.stop().catch(() => {});
  stopActiveWhisperProcess().catch(() => {});
});
