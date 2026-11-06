const { contextBridge, ipcRenderer } = require("electron");
const names = [
  "status",
  "history",
  "around",
  "source",
  "memories",
  "send",
  "cancel",
  "clear",
  "forget",
  "edit",
  "settings",
  "setSettings",
  "systemTheme",
  "draft",
  "saveDraft",
  "maintenance",
  "diagnostics",
];
contextBridge.exposeInMainWorld("oscar", {
  ...Object.fromEntries(
    names.map((name) => [
      name,
      async (arg) => {
        const result = await ipcRenderer.invoke("oscar:" + name, arg);
        if (result.error) throw new Error(result.error);
        return result.value;
      },
    ]),
  ),
  onEvent: (callback) => {
    const listener = (_event, event) => callback(event);
    ipcRenderer.on("oscar:event", listener);
    return () => ipcRenderer.removeListener("oscar:event", listener);
  },
});
