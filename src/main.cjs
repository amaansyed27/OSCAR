const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const { Store } = require("./store.cjs");
const { Model, loadConfig } = require("./model.cjs");
const { Conversation } = require("./conversation.cjs");
const root = path.join(__dirname, "..");
let store;
if (process.env.OSCAR_DATA_DIR) {
  require("node:fs").mkdirSync(process.env.OSCAR_DATA_DIR, { recursive: true });
  app.setPath("userData", process.env.OSCAR_DATA_DIR);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(() => {
    store = new Store(
      path.join(
        process.env.OSCAR_DATA_DIR || app.getPath("userData"),
        "oscar.sqlite",
      ),
    );
    const config = loadConfig(root);
    const conversation = new Conversation(store, new Model(config));
    const actions = {
      status: () => ({
        model: config.model,
        configured: Boolean(config.key),
        busy: conversation.busy,
      }),
      history: (options) => store.history(options),
      source: (id) => store.message(Number(id)),
      memories: () => store.memories(),
      send: ({ text, retryId }) => conversation.send(text, retryId),
      clear: () => {
        if (conversation.busy)
          throw new Error("Wait for the current response.");
        store.clearContext();
      },
      forget: (id) => {
        if (conversation.busy)
          throw new Error("Wait for the current response.");
        store.forget(Number(id));
      },
      edit: ({ id, text, source }) => {
        if (conversation.busy)
          throw new Error("Wait for the current response.");
        if (typeof text !== "string" || !text.trim() || text.length > 600)
          throw new Error("Memory must be 1–600 characters.");
        if (id) {
          const old = store.memories().find((m) => m.id === Number(id));
          if (!old) throw new Error("Memory is no longer active.");
          const sourceId = store.add(
            "user",
            `Memory correction: ${text.trim()}`,
          );
          return store.saveMemory(
            old.key,
            text.trim(),
            sourceId,
            text.trim(),
            old.id,
          );
        }
        const msg = store.message(Number(source));
        if (!msg || msg.role !== "user")
          throw new Error("Choose a user message as the source.");
        return store.saveMemory(
          "manual." + msg.id + "." + Date.now(),
          text.trim(),
          msg.id,
          msg.content.slice(0, 600),
        );
      },
      draft: () => store.get("draft", ""),
      saveDraft: (text) => {
        if (typeof text === "string" && text.length <= 12000)
          store.set("draft", text);
      },
    };
    for (const [name, action] of Object.entries(actions))
      ipcMain.handle("oscar:" + name, async (_event, arg) => {
        try {
          return { value: await action(arg) };
        } catch (e) {
          return { error: e.message };
        }
      });
    const win = new BrowserWindow({
      width: 1180,
      height: 860,
      minWidth: 620,
      minHeight: 520,
      backgroundColor: "#FCF8F5",
      title: "OSCAR",
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
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => store?.close());
}
