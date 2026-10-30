const fs = require("fs/promises");
const path = require("path");
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApi", {
  loadPlays: async (version = "M27") => {
    const isM27 = String(version || "").toUpperCase() === "M27";
    const subPath = isM27 ? path.join("data", "madden27", "plays.json") : path.join("data", "madden26", "plays.json");
    const raw = await fs.readFile(path.join(__dirname, subPath), "utf8");
    return JSON.parse(raw);
  },
  loadDefensivePlays: async (version = "M27") => {
    const isM27 = String(version || "").toUpperCase() === "M27";
    const subPath = isM27 ? path.join("data", "madden27", "defensive_plays.json") : path.join("data", "madden26", "defensive_plays.json");
    try {
      const raw = await fs.readFile(path.join(__dirname, subPath), "utf8");
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
});
