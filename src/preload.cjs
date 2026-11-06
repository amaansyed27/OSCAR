const { contextBridge, ipcRenderer } = require("electron");
const names = [
  "status",
  "history",
  "source",
  "memories",
  "send",
  "clear",
  "forget",
  "edit",
  "draft",
  "saveDraft",
];
contextBridge.exposeInMainWorld(
  "oscar",
  Object.fromEntries(
    names.map((name) => [
      name,
      async (arg) => {
        const result = await ipcRenderer.invoke("oscar:" + name, arg);
        if (result.error) throw new Error(result.error);
        return result.value;
      },
    ]),
  ),
);
