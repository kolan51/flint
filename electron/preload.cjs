const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  openFolder: () => ipcRenderer.invoke("desktop:openFolder"),
  openFiles: () => ipcRenderer.invoke("desktop:openFiles"),
  reveal: (fullPath) => ipcRenderer.invoke("desktop:reveal", fullPath),
  openExternal: (url) => ipcRenderer.invoke("desktop:openExternal", url),
  installUpdate: (asset) => ipcRenderer.invoke("desktop:installUpdate", asset),
  minimize: () => ipcRenderer.invoke("desktop:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("desktop:maximize"),
  close: () => ipcRenderer.invoke("desktop:close"),
  dictate: () => ipcRenderer.invoke("desktop:dictate"),
  dictateStop: () => ipcRenderer.invoke("desktop:dictateStop"),
  onHeard: (callback) => {
    const listener = (_event, text) => callback(text);
    ipcRenderer.on("desktop:heard", listener);
    return () => ipcRenderer.removeListener("desktop:heard", listener);
  },
  onWindow: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on("desktop:window", listener);
    return () => ipcRenderer.removeListener("desktop:window", listener);
  },
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file.path || "";
    }
  },
  onMenu: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("desktop:menu", listener);
    return () => ipcRenderer.removeListener("desktop:menu", listener);
  },
});
