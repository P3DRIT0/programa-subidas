import path from "node:path";
import { app, BrowserWindow } from "electron";

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.on("console-message", (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });

  win.webContents.on("did-finish-load", async () => {
    try {
      const result = await win.webContents.executeJavaScript(`
        ({
          href: window.location.href,
          hasDesktopApp: typeof window.desktopApp !== "undefined",
          statusText: document.querySelector("#status-box")?.textContent ?? "",
          resultText: document.querySelector("#result-box")?.textContent ?? "",
          scripts: Array.from(document.scripts).map((script) => script.src)
        })
      `);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error("diag execute error", error);
    } finally {
      app.quit();
    }
  });

  win.loadFile(path.join(app.getAppPath(), "ui", "index.html"));
});
