const path = require("path");
const fsSync = require("fs");
const fs = require("fs/promises");
const crypto = require("crypto");
const { app, BrowserWindow, ipcMain, shell } = require("electron");

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


function appAssetBaseDir() {
  return app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : __dirname;
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

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
