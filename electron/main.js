import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const icon = path.join(here, "..", "public", "icon.png");

let mainWindow = null;
let apiPort = 8787;
let dictateJob = null;

const DICTATE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Speech
$infos = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
if ($infos.Count -lt 1) { throw 'Windows has no speech language installed. Add one in Settings, Time and language, Speech.' }
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($infos[0].Culture)
try {
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.SetInputToDefaultAudioDevice()
  $engine.add_SpeechRecognized({
    param($sender, $eventArgs)
    $heard = $eventArgs.Result.Text
    if ($heard) {
      [Console]::Out.WriteLine($heard)
      [Console]::Out.Flush()
    }
  })
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  Start-Sleep -Seconds 45
} finally {
  $engine.RecognizeAsyncCancel()
  $engine.Dispose()
}
`.trim();

function stopDictation() {
  const job = dictateJob;
  if (!job) return;
  job.stopped = true;
  job.child.kill();
}

function preparePackaged() {
  const dest = path.join(app.getPath("userData"), "data");
  process.env.FLINT_DATA = dest;
  const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", "dist");
  const packed = path.join(app.getAppPath(), "dist");
  process.env.FLINT_DIST = fs.existsSync(path.join(unpacked, "index.html")) ? unpacked : packed;
  if (fs.existsSync(path.join(dest, "settings.json"))) return;
  const seed = path.join(process.resourcesPath, "seed-data");
  fs.mkdirSync(dest, { recursive: true });
  if (!fs.existsSync(seed)) return;
  for (const name of fs.readdirSync(seed)) {
    if (!name.endsWith(".json")) continue;
    fs.copyFileSync(path.join(seed, name), path.join(dest, name));
  }
}

async function ensureApi() {
  if (app.isPackaged) preparePackaged();
  const { startServer } = await import("../server/index.js");
  const preferred = Number(process.env.PORT || 8787);
  try {
    const started = await startServer(preferred);
    apiPort = started.port;
  } catch (err) {
    if (err.code !== "EADDRINUSE") throw err;
    if (!app.isPackaged) {
      console.log("Local Bot API already running");
      return;
    }
    const started = await startServer(0);
    apiPort = started.port;
  }
}

const CORNER = 16;

function roundedRects(width, height, radius) {
  const r = Math.min(radius, Math.floor(Math.min(width, height) / 2));
  const rects = [{ x: 0, y: r, width, height: Math.max(0, height - r * 2) }];
  for (let y = 0; y < r; y += 1) {
    const dy = r - y - 0.5;
    const inset = Math.max(0, Math.ceil(r - Math.sqrt(Math.max(0, r * r - dy * dy))));
    const w = Math.max(0, width - inset * 2);
    rects.push({ x: inset, y, width: w, height: 1 });
    rects.push({ x: inset, y: height - 1 - y, width: w, height: 1 });
  }
  return rects;
}

let clipTimer = null;

function clearClip(win) {
  if (!win || win.isDestroyed() || win.isMaximized()) return;
  clearTimeout(clipTimer);
  win.setShape([]);
}

function applyRoundedClip(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) {
    win.setShape([]);
    return;
  }
  const [width, height] = win.getSize();
  win.setShape(roundedRects(width, height, CORNER));
}

function settleClip(win) {
  clearTimeout(clipTimer);
  clipTimer = setTimeout(() => applyRoundedClip(win), 140);
}

function sendMenu(action) {
  mainWindow?.webContents.send("desktop:menu", action);
}

function zoomAction(input) {
  if (input.alt) return "";
  const key = String(input.key || "").toLowerCase();
  const code = input.code || "";
  if (key === "+" || key === "=" || key === "add" || code === "NumpadAdd" || code === "Equal") return "zoomIn";
  if (key === "-" || key === "_" || key === "subtract" || code === "NumpadSubtract" || code === "Minus") return "zoomOut";
  if (!input.shift && (key === "0" || code === "Digit0" || code === "Numpad0")) return "zoomReset";
  return "";
}

function bindKeys(win) {
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta)) return;
    const zoom = zoomAction(input);
    if (zoom) {
      sendMenu(zoom);
      event.preventDefault();
      return;
    }
    const key = String(input.key || "").toLowerCase();
    if (key === "o" && input.shift) {
      sendMenu("openFolder");
      event.preventDefault();
    } else if (key === "o") {
      sendMenu("openFiles");
      event.preventDefault();
    } else if (key === "s") {
      sendMenu("save");
      event.preventDefault();
    }
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Flint",
    icon,
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#10100e",
    show: false,
    frame: false,
    transparent: false,
    roundedCorners: true,
    hasShadow: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  bindKeys(mainWindow);
  const tellWindow = () => mainWindow?.webContents.send("desktop:window", mainWindow.isMaximized());
  mainWindow.on("maximize", () => {
    clearTimeout(clipTimer);
    mainWindow.setShape([]);
    tellWindow();
  });
  mainWindow.on("unmaximize", () => {
    settleClip(mainWindow);
    tellWindow();
  });
  mainWindow.on("move", () => clearClip(mainWindow));
  mainWindow.on("moved", () => settleClip(mainWindow));
  mainWindow.on("resize", () => clearClip(mainWindow));
  mainWindow.on("resized", () => settleClip(mainWindow));
  mainWindow.once("ready-to-show", () => {
    applyRoundedClip(mainWindow);
    mainWindow.show();
  });

  mainWindow.webContents.on("context-menu", (_event, params) => {
    const editable = params.isEditable || Boolean(params.selectionText);
    if (!editable) return;
    Menu.buildFromTemplate([
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    ]).popup({ window: mainWindow });
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.LOCAL_BOT_URL || "http://127.0.0.1:5173");
  } else {
    await mainWindow.loadURL(`http://127.0.0.1:${apiPort}`);
  }
}

ipcMain.handle("desktop:openFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open project folder",
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle("desktop:openFiles", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open files",
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle("desktop:openExternal", async (_event, url) => {
  if (!/^https?:\/\//i.test(String(url || ""))) return;
  await shell.openExternal(url);
});

ipcMain.handle("desktop:installUpdate", async (_event, asset) => {
  const url = String(asset?.url || "");
  const name = String(asset?.name || "Flint-update").replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!/^https:\/\/(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//i.test(url)) return;
  const dest = path.join(app.getPath("temp"), name);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
  if (process.platform === "win32" && /\.exe$/i.test(dest)) {
    spawn(dest, [], { detached: true, stdio: "ignore" }).unref();
    app.quit();
    return;
  }
  await shell.openPath(dest);
});

ipcMain.handle("desktop:reveal", async (_event, fullPath) => {
  if (!fullPath) return;
  shell.showItemInFolder(fullPath);
});

ipcMain.handle("desktop:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("desktop:maximize", () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});

ipcMain.handle("desktop:close", () => {
  mainWindow?.close();
});

ipcMain.handle("desktop:dictate", async (event) => {
  if (process.platform !== "win32") throw new Error("Dictation uses the Windows speech engine.");
  stopDictation();
  const encoded = Buffer.from(DICTATE_SCRIPT, "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    windowsHide: true,
  });
  const job = { child, stopped: false, settled: false };
  dictateJob = job;
  let pending = "";
  let errorText = "";
  const sendLine = (line) => {
    const text = String(line || "").trim();
    if (!text || text.startsWith("#<") || text.startsWith("<") || /CLIXML/i.test(text)) return;
    event.sender.send("desktop:heard", text);
  };
  child.stdout.on("data", (chunk) => {
    pending += chunk.toString("utf8");
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    lines.forEach(sendLine);
  });
  child.stderr.on("data", (chunk) => {
    errorText += chunk.toString("utf8");
  });
  await new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      if (job.settled) return;
      job.settled = true;
      if (dictateJob === job) dictateJob = null;
      fn(value);
    };
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      sendLine(pending);
      if (job.stopped || code === 0 || code === null) finish(resolve, undefined);
      else finish(reject, new Error(speechError(errorText)));
    });
  });
});

ipcMain.handle("desktop:dictateStop", () => {
  stopDictation();
});

function speechError(raw) {
  const text = String(raw || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (/no speech language/i.test(text)) return "Windows has no speech language installed. Add one in Settings, Time and language, Speech.";
  if (/audio/i.test(text)) return "The microphone did not start.";
  return text.slice(0, 180) || "The microphone did not start.";
}

app.whenReady().then(async () => {
  if (process.platform === "win32") app.setAppUserModelId("dev.flint.desktop");
  app.setName("Flint");
  Menu.setApplicationMenu(null);
  await ensureApi();
  await createWindow();
});

app.on("window-all-closed", () => {
  stopDictation();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
