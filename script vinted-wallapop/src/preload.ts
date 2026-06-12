import { contextBridge, ipcRenderer } from "electron";
import type { RendererToMainApi, WallapopFormData } from "./shared";

const api: RendererToMainApi = {
  openWallapopLogin: () => ipcRenderer.invoke("wallapop:open-login"),
  openVintedLogin: () => ipcRenderer.invoke("vinted:open-login"),
  pickImages: () => ipcRenderer.invoke("wallapop:pick-images"),
  publishWallapop: (data: WallapopFormData) => ipcRenderer.invoke("wallapop:publish", data),
  publishVinted: (data: WallapopFormData) => ipcRenderer.invoke("vinted:publish", data),
  onStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("app:status", listener);
    return () => {
      ipcRenderer.removeListener("app:status", listener);
    };
  },
};

contextBridge.exposeInMainWorld("desktopApp", api);
