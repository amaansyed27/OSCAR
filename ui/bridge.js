// The UI contract stays independent of its desktop shell. No keys enter this bridge.
(() => {
  const callbacks = new Set();
  const ready = window.__TAURI__.event.listen("oscar:event", (event) => {
    for (const callback of callbacks) callback(event.payload);
  });
  const names = [
    "cloudProviders",
    "cloudModels",
    "discoverModels",
    "saveProvider",
    "saveCredential",
    "credentialAction",
    "registerModel",
    "toggleModel",
    "testConnection",
    "importAttachment",
    "attachmentInfo",
    "attachmentPreview",
    "draftAttachments",
    "saveDraftAttachments",
    "clearChat",
    "responseDetails",
    "componentState",
    "saveComponentState",
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
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    for (const callback of callbacks)
      callback({
        type: "system-theme",
        theme: media.matches ? "dark" : "light",
      });
  });
  window.oscar = {
    ...Object.fromEntries(
      names.map((action) => [
        action,
        async (arg) => {
          await ready;
          try {
            return await window.__TAURI__.core.invoke("oscar", {
              action,
              arg: arg ?? null,
            });
          } catch (error) {
            throw new Error(
              typeof error === "string"
                ? error
                : "OSCAR could not complete this request.",
            );
          }
        },
      ]),
    ),
    systemTheme: async () => (media.matches ? "dark" : "light"),
    onEvent: (callback) => {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
  };
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (link && /^https?:/.test(link.href)) {
      event.preventDefault();
      window.__TAURI__.core
        .invoke("open_link", { url: link.href })
        .catch(console.error);
    }
  });
})();
