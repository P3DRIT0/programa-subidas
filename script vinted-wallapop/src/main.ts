import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { wallapopFormSchema } from "./shared";
import { openWallapopLogin, publishToWallapop } from "./wallapop";
import { openVintedLogin, publishToVinted } from "./vinted";
import { openErpLogin, publishToErp } from "./erp";

let mainWindow: BrowserWindow | null = null;
const debugLogPath = path.join(process.cwd(), "debug.log");

function writeDebug(message: string) {
  fs.appendFileSync(debugLogPath, `${new Date().toISOString()} ${message}\n`);
}

function sendStatus(message: string) {
  writeDebug(`[status] ${message}`);
  mainWindow?.webContents.send("app:status", message);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 920,
    minWidth: 980,
    minHeight: 780,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on("console-message", (_event, level, message) => {
    writeDebug(`[renderer:${level}] ${message}`);
  });

  mainWindow.webContents.on("did-finish-load", async () => {
    try {
      const diagnostics = await mainWindow?.webContents.executeJavaScript(`
        ({
          href: window.location.href,
          hasDesktopApp: typeof window.desktopApp !== "undefined",
          hasStatusBox: !!document.querySelector("#status-box"),
          scriptCount: document.scripts.length
        })
      `);
      writeDebug(`[diagnostics] ${JSON.stringify(diagnostics)}`);
    } catch (error) {
      writeDebug(`[diagnostics:error] ${String(error)}`);
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    writeDebug(`[did-fail-load] code=${errorCode} description=${errorDescription} url=${validatedURL}`);
  });

  mainWindow.loadFile(path.join(app.getAppPath(), "ui", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("wallapop:pick-images", async () => {
  const result = await dialog.showOpenDialog({
    title: "Selecciona las fotos del anuncio",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Imagenes",
        extensions: ["webp", "jpg", "jpeg", "png"],
      },
    ],
  });

  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("wallapop:open-login", async () => {
  return openWallapopLogin(sendStatus);
});

ipcMain.handle("vinted:open-login", async () => {
  return openVintedLogin(sendStatus);
});

ipcMain.handle("erp:open-login", async () => {
  return openErpLogin(sendStatus);
});

ipcMain.handle("wallapop:publish", async (_event, rawData) => {
  const parsed = wallapopFormSchema.safeParse(rawData);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Datos invalidos.",
    };
  }

  return publishToWallapop(parsed.data, sendStatus);
});

ipcMain.handle("vinted:publish", async (_event, rawData) => {
  const parsed = wallapopFormSchema.safeParse(rawData);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Datos invalidos.",
    };
  }

  return publishToVinted(parsed.data, sendStatus);
});

ipcMain.handle("erp:publish", async (_event, rawData) => {
  const parsed = wallapopFormSchema.safeParse(rawData);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Datos invalidos.",
    };
  }

  return publishToErp(parsed.data, sendStatus);
});
