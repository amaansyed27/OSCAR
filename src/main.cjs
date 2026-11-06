const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { Worker } = require("node:worker_threads");
const root = path.join(__dirname, "..");
if (process.env.OSCAR_DATA_DIR) {
  fs.mkdirSync(process.env.OSCAR_DATA_DIR, { recursive: true });
  app.setPath("userData", process.env.OSCAR_DATA_DIR);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let worker,
    win,
    seq = 0;
  const pending = new Map();
  const call = (name, arg) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, name, arg });
    });
  app
    .whenReady()
    .then(async () => {
      worker = new Worker(path.join(__dirname, "runtime.cjs"), {
        workerData: {
          root,
          file: path.join(app.getPath("userData"), "oscar.sqlite"),
        },
      });
      const ready = new Promise((resolve, reject) => {
        worker.once("error", reject);
        worker.on("message", (message) => {
          if (message.ready) resolve();
          else if (message.event) {
            if (win && !win.isDestroyed())
              win.webContents.send("oscar:event", message.event);
          } else {
            const request = pending.get(message.id);
            if (request) {
              pending.delete(message.id);
              message.error
                ? request.reject(new Error(message.error))
                : request.resolve(message.value);
            }
          }
        });
      });
      worker.on("error", () => {
        for (const p of pending.values())
          p.reject(
            new Error(
              "OSCAR needs to restart. Your saved conversation is kept.",
            ),
          );
        pending.clear();
      });
      await ready;
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
        "draft",
        "saveDraft",
        "maintenance",
        "diagnostics",
      ];
      for (const name of names)
        ipcMain.handle("oscar:" + name, async (_event, arg) => {
          try {
            return { value: await call(name, arg) };
          } catch (e) {
            return { error: e.message };
          }
        });
      ipcMain.handle("oscar:systemTheme", () => ({
        value: nativeTheme.shouldUseDarkColors ? "dark" : "light",
      }));
      nativeTheme.on("updated", () => {
        if (win && !win.isDestroyed())
          win.webContents.send("oscar:event", {
            type: "system-theme",
            theme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
          });
      });
      win = new BrowserWindow({
        width: 1280,
        height: 900,
        minWidth: 600,
        minHeight: 520,
        title: "OSCAR",
        backgroundColor: nativeTheme.shouldUseDarkColors
          ? "#181916"
          : "#ffffff",
        icon: path.join(root, "assets/brand/favicon.ico"),
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      win.setMenuBarVisibility(false);
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: "deny" };
      });
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.loadFile(path.join(root, "ui/index.html"));
      app.on("second-instance", () => {
        if (win.isMinimized()) win.restore();
        win.focus();
      });
    })
    .catch(() => {
      require("electron").dialog.showErrorBox(
        "OSCAR could not start",
        "The local store could not be opened. Your data has not been reset.",
      );
      app.quit();
    });
  let quitting = false;
  app.on("before-quit", (event) => {
    if (worker && !quitting) {
      event.preventDefault();
      quitting = true;
      Promise.race([
        call("close"),
        new Promise((resolve) => setTimeout(resolve, 2200)),
      ])
        .catch(() => {})
        .finally(() => {
          worker.terminate();
          worker = null;
          app.quit();
        });
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => worker?.terminate());
}
