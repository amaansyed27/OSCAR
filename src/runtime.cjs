const { parentPort, workerData } = require("node:worker_threads");
const { Store } = require("./store.cjs");
const { Model, loadConfig } = require("./model.cjs");
const { Conversation } = require("./conversation.cjs");
const s = new Store(workerData.file),
  config = loadConfig(workerData.root);
config.model = s.get("model", config.model);
const conversation = new Conversation(s, new Model(config), (event) =>
  parentPort.postMessage({ event }),
);
const actions = {
  status: () => ({
    model: config.model,
    configured: !!config.key,
    busy: conversation.busy,
    learningDelayed: !!s.db
      .prepare(
        "SELECT 1 FROM jobs WHERE state='pending' AND attempts>0 LIMIT 1",
      )
      .get(),
  }),
  history: (options) => s.history(options),
  around: (id) => s.around(id),
  source: (id) => s.message(Number(id)),
  memories: (options) => s.memories(options),
  send: ({ text, retryId }) => conversation.send(text, retryId),
  cancel: () => conversation.cancel(),
  clear: () => {
    conversation.changed();
    s.clearContext();
    s.db.prepare("UPDATE working SET state='cleared'").run();
  },
  forget: (id) => {
    s.forget(Number(id));
    conversation.changed();
  },
  edit: ({ id, text, source }) => {
    if (typeof text !== "string" || !text.trim() || text.length > 600)
      throw new Error("Use 1–600 characters.");
    const old = id
      ? s.db
          .prepare("SELECT * FROM memories WHERE id=? AND state='active'")
          .get(Number(id))
      : null;
    if (id && !old) throw new Error("Memory is no longer active.");
    const message = old
      ? s.add("user", "Memory correction: " + text.trim())
      : Number(source);
    if (!s.message(message) || s.message(message).role !== "user")
      throw new Error("Choose a user statement as the source.");
    s.saveMemory(
      old?.key || "manual." + message,
      text.trim(),
      message,
      old ? text.trim() : s.message(message).content.slice(0, 600),
      old?.id,
    );
    conversation.changed();
  },
  settings: () => ({
    theme: s.get("theme", "system"),
    model: config.model,
    learn: s.get("learn", "true") === "true",
    inputTokens: Number(s.get("input_tokens", String(config.inputBudget))),
  }),
  setSettings: (changes) => {
    if (changes.theme && ["light", "dark", "system"].includes(changes.theme))
      s.set("theme", changes.theme);
    if (typeof changes.learn === "boolean") {
      s.set("learn", changes.learn);
      if (!changes.learn) {
        conversation.maintenanceController?.abort();
        s.db.exec(
          "UPDATE jobs SET state='disabled' WHERE state IN ('pending','running')",
        );
      }
    }
    if (changes.model) {
      if (
        !["openai/gpt-oss-20b", "openai/gpt-oss-120b"].includes(changes.model)
      )
        throw new Error("Model unavailable.");
      conversation.cancel();
      conversation.maintenanceController?.abort();
      config.model = changes.model;
      s.set("model", changes.model);
    }
    if (changes.inputTokens) {
      if (![8000, 16000, 32000].includes(Number(changes.inputTokens)))
        throw new Error("Invalid context size.");
      s.set("input_tokens", Number(changes.inputTokens));
    }
    return actions.settings();
  },
  draft: () => s.get("draft", ""),
  saveDraft: (text) => {
    if (typeof text === "string" && text.length <= 24000) s.set("draft", text);
  },
  maintenance: async () => {
    await conversation.maintain();
    return {
      pending: s.db
        .prepare(
          "SELECT count(*) AS n FROM jobs WHERE state IN ('pending','running')",
        )
        .get().n,
    };
  },
  diagnostics: () =>
    s.db.prepare("SELECT * FROM metrics ORDER BY id DESC LIMIT 50").all(),
  close: async () => {
    conversation.close();
    const until = Date.now() + 1800;
    while (
      (conversation.busy || conversation.runningMaintenance) &&
      Date.now() < until
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    s.close();
  },
};
parentPort.on("message", async ({ id, name, arg }) => {
  try {
    if (!actions[name]) throw new Error("Unknown action.");
    parentPort.postMessage({ id, value: await actions[name](arg) });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
parentPort.postMessage({ ready: true });
conversation.schedule();
