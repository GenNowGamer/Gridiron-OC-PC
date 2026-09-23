const fs = require("fs/promises");
const path = require("path");
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  loadPlays: async () => {
    const filePath = path.join(__dirname, "plays.json");
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  },
  loadDefensivePlays: async () => {
    const filePath = path.join(__dirname, "defensive_plays.json");
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
  },
  readTraceLog: () => ipcRenderer.invoke("desktop:trace-read"),
  writeTraceLog: (text) => ipcRenderer.invoke("desktop:trace-write", text),
  exportTraceLog: (text) => ipcRenderer.invoke("desktop:trace-export", text),
  openTraceFolder: () => ipcRenderer.invoke("desktop:trace-open-folder"),
  readPreferences: () => ipcRenderer.invoke("desktop:preferences-read"),
  writePreferences: (preferences) => ipcRenderer.invoke("desktop:preferences-write", preferences),
  writePreferencesSync: (preferences) => ipcRenderer.sendSync("desktop:preferences-write-sync", preferences),
  getWhisperStatus: () => ipcRenderer.invoke("desktop:whisper-status"),
  transcribeWithWhisper: (payload) => ipcRenderer.invoke("desktop:whisper-transcribe", payload),
  cancelWhisperTranscription: () => ipcRenderer.invoke("desktop:whisper-cancel"),
  ocrGetStatus: () => ipcRenderer.invoke("desktop:ocr-status"),
  ocrUpdateConfig: (patch) => ipcRenderer.invoke("desktop:ocr-config-update", patch),
  ocrListSources: (obs) => ipcRenderer.invoke("desktop:ocr-list-sources", obs),
  ocrCaptureReference: (args) => ipcRenderer.invoke("desktop:ocr-reference", args),
  ocrBenchmarkCapture: (args) => ipcRenderer.invoke("desktop:ocr-benchmark", args),
  ocrSaveProfile: (profile) => ipcRenderer.invoke("desktop:ocr-profile-save", profile),
  ocrTestProfile: (args) => ipcRenderer.invoke("desktop:ocr-profile-test", args),
  ocrCapture: (args) => ipcRenderer.invoke("desktop:ocr-capture", args),
  ocrCorrectCapture: (args) => ipcRenderer.invoke("desktop:ocr-correct", args),
  ocrUndoLastSnap: () => ipcRenderer.invoke("desktop:ocr-undo-last-snap"),
  ocrResetOpponent: (args) => ipcRenderer.invoke("desktop:ocr-reset-opponent", args),
  ocrExportData: () => ipcRenderer.invoke("desktop:ocr-export"),
  ocrExportDiagnosticPack: () => ipcRenderer.invoke("desktop:ocr-export-diagnostic"),
  ocrDeleteData: (args) => ipcRenderer.invoke("desktop:ocr-delete", args),
  onOcrEvent: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("desktop:ocr-event", listener);
    return () => ipcRenderer.removeListener("desktop:ocr-event", listener);
  },
});
