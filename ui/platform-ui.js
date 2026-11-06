/* Slice 02 controls extend the existing three-page shell. */
let platformModels = [],
  platformProviders = [],
  attachedFiles = [],
  providerId = "groq";
const platformStatus = (message) => {
  $("provider-status").textContent = message || "";
};
const optionsFor = (select, items, selected) => {
  select.replaceChildren(
    ...items.map(([value, label]) => new Option(label, value)),
  );
  if (selected) select.value = selected;
};
function selectionLabel(id) {
  if (id?.startsWith("auto:"))
    return "Auto · " + id.slice(5).replace(/^./, (c) => c.toUpperCase());
  const m = platformModels.find((m) => m.id === id || m.model === id);
  const p = platformProviders.find((p) => p.id === m?.provider);
  return m ? `${p?.name || m.provider} · ${m.name}` : "Groq · GPT-OSS 20B";
}
async function refreshPlatform() {
  [platformProviders, platformModels] = await Promise.all([
    api.cloudProviders(),
    api.cloudModels({}),
  ]);
  const current = await api.settings();
  settings = current;
  const selections = [
    ["auto:efficient", "Auto · Efficient"],
    ["auto:free", "Auto · Free"],
    ["auto:super", "Auto · Super"],
    ...platformModels
      .filter((m) => m.enabled)
      .map((m) => [m.id, selectionLabel(m.id)]),
  ];
  optionsFor(
    $("model"),
    selections,
    current.model.includes("::") || current.model.startsWith("auto:")
      ? current.model
      : "groq::" + current.model,
  );
  optionsFor(
    $("waterfall-model"),
    platformModels
      .filter((m) => m.enabled)
      .map((m) => [m.id, selectionLabel(m.id)]),
  );
  optionsFor(
    $("provider-select"),
    platformProviders.map((p) => [p.id, p.name]),
    providerId,
  );
  $("model-picker").textContent = selectionLabel(current.model);
  $("search-mode").value = current.search_mode || "auto";
  $("spending-ceiling").value = current.spending_ceiling || "";
  renderWaterfall();
  renderProvider();
}
function renderProvider() {
  const p = platformProviders.find((p) => p.id === providerId);
  if (!p) return;
  const form = $("provider-form");
  for (const input of form.elements)
    if (input.name)
      input.value =
        input.name === "headers"
          ? JSON.stringify(p.headers || {})
          : (p[input.name] ?? "");
  $("provider-docs").href = p.docs || "https://openai.com";
  $("provider-docs").hidden = !p.docs;
  const list = $("credential-list");
  list.replaceChildren();
  for (const c of p.credentials || []) {
    const row = document.createElement("div");
    row.className = "provider-row";
    const label = document.createElement("label"),
      toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = !!c.enabled;
    toggle.onchange = () =>
      api
        .credentialAction({ id: c.id, enabled: toggle.checked })
        .then(refreshPlatform)
        .catch((e) => platformStatus(e.message));
    label.append(toggle, document.createTextNode(c.nickname));
    const detail = document.createElement("small");
    detail.textContent =
      (c.source.startsWith("environment:")
        ? "Environment"
        : "Windows protected") +
      (c.duplicate ? " · Duplicate slot" : "") +
      (c.last_success ? " · Connected " + c.last_success : "") +
      (c.last_error ? " · " + c.last_error : "");
    const remove = document.createElement("button");
    remove.textContent = c.source.startsWith("environment:")
      ? "Disable"
      : "Remove";
    remove.className = "subtle";
    remove.onclick = () =>
      confirm(
        "Remove credential?",
        c.source.startsWith("environment:")
          ? "This disables this environment slot. Its private file remains unchanged."
          : "Remove this protected credential from Settings?",
        () =>
          api
            .credentialAction({ id: c.id, remove: true })
            .then(refreshPlatform),
      );
    const replace = document.createElement("button");
    replace.textContent = "Replace";
    replace.className = "subtle";
    replace.onclick = () => {
      const form = $("credential-form");
      form.dataset.replace = c.id;
      form.elements.nickname.value = c.nickname;
      form.elements.secret.focus();
      platformStatus(
        c.source.startsWith("environment:")
          ? "The replacement is protected in Settings; the original environment slot will be disabled without editing its file."
          : "Enter the replacement credential.",
      );
    };
    const actions = document.createElement("div");
    actions.className = "inline-controls";
    actions.append(replace, remove);
    row.append(label, detail, actions);
    list.append(row);
  }
  if (!p.credentials?.length) list.textContent = "No credentials configured.";
  platformStatus(
    p.protocol === "restricted"
      ? "This restricted Coding Plan is not enabled for general conversation."
      : p.base
        ? ""
        : "Configure the provider’s project/account endpoint before connecting.",
  );
  renderProviderModels();
}
function renderProviderModels() {
  const q = $("model-search").value.toLowerCase();
  const matches = platformModels.filter(
    (m) =>
      m.provider === providerId &&
      `${m.name} ${m.model}`.toLowerCase().includes(q),
  );
  const list = $("provider-models");
  list.replaceChildren();
  for (const m of matches.slice(0, 100)) {
    const row = document.createElement("div");
    row.className = "provider-row";
    const label = document.createElement("label"),
      toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = m.enabled;
    toggle.onchange = () =>
      api
        .toggleModel({ id: m.id, enabled: toggle.checked })
        .then(refreshPlatform)
        .catch((e) => platformStatus(e.message));
    label.append(toggle, document.createTextNode(m.name));
    const capabilities = document.createElement("small");
    capabilities.textContent = [
      m.context ? `${m.context.toLocaleString()} context` : "Context unknown",
      m.vision ? "Images" : "",
      m.free
        ? "Verified free"
        : m.input_price === null
          ? "Price unknown"
          : `$${m.input_price} / $${m.output_price} per M`,
    ]
      .filter(Boolean)
      .join(" · ");
    const edit = document.createElement("button");
    edit.textContent = "Details";
    edit.className = "subtle";
    edit.onclick = () => {
      const form = $("model-form");
      for (const input of form.elements)
        if (input.name) {
          const v = m[input.name];
          input.value = Array.isArray(v) ? v.join(", ") : (v ?? "");
        }
      form.closest("details").open = true;
      form.scrollIntoView({
        block: "nearest",
        behavior: reducedMotion.matches ? "instant" : "smooth",
      });
    };
    const actions = document.createElement("div");
    actions.className = "inline-controls";
    const test = document.createElement("button");
    test.textContent = "Test";
    test.className = "subtle";
    test.onclick = async () => {
      test.disabled = true;
      try {
        const result = await api.testConnection({
          model: m.id,
          allowBillable: $("allow-billable-test").checked,
        });
        platformStatus(
          `Generation and streaming verified: ${result.stream_chunks} deltas received.`,
        );
      } catch (e) {
        platformStatus(e.message);
      } finally {
        test.disabled = false;
      }
    };
    actions.append(edit, test);
    row.append(label, capabilities, actions);
    list.append(row);
  }
  if (!matches.length) list.textContent = "Refresh models or register a model.";
  if (matches.length > 100)
    list.append(
      document.createTextNode(
        `${matches.length} models — refine the search to find more.`,
      ),
    );
}
$("provider-select").onchange = () => {
  providerId = $("provider-select").value;
  $("model-search").value = "";
  renderProvider();
};
$("model-search").oninput = renderProviderModels;
$("add-provider").onclick = () => {
  providerId = "";
  const form = $("provider-form");
  form.reset();
  form.elements.name.value = "Custom provider";
  form.closest("details").open = true;
  form.elements.name.focus();
  platformStatus(
    "Enter the public HTTPS endpoint and its documented compatibility protocol.",
  );
};
$("provider-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const fields = Object.fromEntries(new FormData(e.target));
    if (fields.headers?.trim()) fields.headers = JSON.parse(fields.headers);
    else delete fields.headers;
    if (providerId) fields.id = providerId;
    const p = await api.saveProvider(fields);
    providerId = p.id;
    await refreshPlatform();
    platformStatus(
      "Connection settings saved. Validate before selecting a model.",
    );
  } catch (e) {
    platformStatus(e.message);
  }
};
$("credential-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    if (!providerId) throw new Error("Save the provider connection first.");
    const f = Object.fromEntries(new FormData(e.target));
    await api.saveCredential({
      ...f,
      provider: providerId,
      id: e.target.dataset.replace || undefined,
    });
    delete e.target.dataset.replace;
    e.target.reset();
    await refreshPlatform();
    platformStatus("Credential protected and saved.");
  } catch (e) {
    platformStatus(e.message);
  }
};
$("discover-models").onclick = async () => {
  const b = $("discover-models");
  b.disabled = true;
  platformStatus("Connecting…");
  try {
    const result = await api.discoverModels({ provider: providerId });
    await refreshPlatform();
    platformStatus(
      `${result.models} models refreshed. Enable the models you want to use. Model discovery does not prove every generation capability.`,
    );
  } catch (e) {
    platformStatus(e.message);
  } finally {
    b.disabled = false;
  }
};
$("model-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const fields = Object.fromEntries(new FormData(e.target));
    for (const k of [
      "context",
      "output",
      "quality",
      "input_price",
      "output_price",
    ]) {
      if (fields[k] === "") delete fields[k];
      else fields[k] = Number(fields[k]);
    }
    for (const k of ["vision", "streaming"]) {
      if (fields[k] === "") delete fields[k];
      else fields[k] = fields[k] === "true";
    }
    if (fields.reasoning.trim())
      fields.reasoning = fields.reasoning
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else {
      delete fields.reasoning;
      delete fields.reasoning_parameter;
    }
    await api.registerModel({ ...fields, provider: providerId });
    await refreshPlatform();
    platformStatus(
      "Model registered. Capability overrides are owner-provided metadata, not a live-test claim.",
    );
  } catch (e) {
    platformStatus(e.message);
  }
};
function renderWaterfall() {
  const list = $("waterfall-list");
  list.replaceChildren();
  for (const [i, item] of (settings.waterfall || []).entries()) {
    const row = document.createElement("div");
    row.className = "inline-controls";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = item.enabled !== false;
    enabled.setAttribute("aria-label", "Enable " + selectionLabel(item.model));
    enabled.onchange = () =>
      changeWaterfall((a) => (a[i].enabled = enabled.checked));
    const label = document.createElement("span");
    label.textContent = selectionLabel(item.model);
    row.append(enabled, label);
    const spec = platformModels.find((m) => m.id === item.model);
    const credential = document.createElement("select");
    credential.setAttribute("aria-label", "Fallback credential");
    optionsFor(
      credential,
      [
        ["", "Any enabled credential"],
        ...(
          platformProviders.find((p) => p.id === spec?.provider)?.credentials ||
          []
        ).map((c) => [c.id, c.nickname]),
      ],
      item.credential || "",
    );
    credential.onchange = () =>
      changeWaterfall((a) => (a[i].credential = credential.value));
    const reasoning = document.createElement("select");
    reasoning.setAttribute("aria-label", "Fallback reasoning");
    optionsFor(
      reasoning,
      [["auto", "Auto"], ...(spec?.reasoning || []).map((v) => [v, v])],
      item.reasoning || "auto",
    );
    reasoning.hidden = !spec?.reasoning?.length;
    reasoning.onchange = () =>
      changeWaterfall((a) => (a[i].reasoning = reasoning.value));
    row.append(credential, reasoning);

    for (const [name, delta] of [
      ["↑", -1],
      ["↓", 1],
      ["Remove", 0],
    ]) {
      const b = document.createElement("button");
      b.textContent = name;
      b.setAttribute(
        "aria-label",
        name === "Remove"
          ? "Remove fallback"
          : delta < 0
            ? "Move fallback up"
            : "Move fallback down",
      );
      b.disabled =
        (delta < 0 && i === 0) ||
        (delta > 0 && i === settings.waterfall.length - 1);
      b.onclick = () =>
        changeWaterfall((a) => {
          if (delta === 0) a.splice(i, 1);
          else [a[i], a[i + delta]] = [a[i + delta], a[i]];
        });
      row.append(b);
    }
    list.append(row);
  }
}
async function changeWaterfall(change) {
  try {
    const next = structuredClone(settings.waterfall || []);
    change(next);
    await saveSettings({ waterfall: next });
    renderWaterfall();
  } catch (e) {
    notice(e.message);
  }
}
$("waterfall-add").onclick = () => {
  const model = $("waterfall-model").value;
  if (model)
    changeWaterfall((a) => a.push({ model, enabled: true, reasoning: "auto" }));
};
$("spending-ceiling").onchange = () =>
  saveSettings({ spending_ceiling: $("spending-ceiling").value });
$("model-picker").onclick = () => {
  optionsFor($("picker-provider"), [
    ["auto", "Auto"],
    ...platformProviders
      .filter((p) => p.kind === "inference" && p.protocol !== "restricted")
      .map((p) => [p.id, p.name]),
  ]);
  const id = settings.model.includes("::")
    ? settings.model
    : "groq::" + settings.model;
  $("picker-provider").value = settings.model.startsWith("auto:")
    ? "auto"
    : id.split("::")[0];
  populatePicker(id);
  $("model-dialog").showModal();
};
function populatePicker(selected) {
  const provider = $("picker-provider").value;
  optionsFor(
    $("picker-model"),
    provider === "auto"
      ? [
          ["auto:efficient", "Efficient"],
          ["auto:free", "Free"],
          ["auto:super", "Super"],
        ]
      : platformModels
          .filter((m) => m.enabled && m.provider === provider)
          .map((m) => [m.id, m.name]),
    selected || settings.model,
  );
  reasoningPicker();
}
function reasoningPicker() {
  const m = platformModels.find((m) => m.id === $("picker-model").value);
  const levels = m?.reasoning || [];
  optionsFor(
    $("picker-reasoning"),
    [["auto", "Auto"], ...levels.map((l) => [l, l])],
    settings.reasoning || "auto",
  );
  $("picker-reasoning-label").hidden = !levels.length;
  let slider = $("reasoning-slider");
  if (!slider) {
    slider = document.createElement("input");
    slider.id = "reasoning-slider";
    slider.type = "range";
    slider.setAttribute("aria-label", "Reasoning effort");
    $("picker-reasoning-label").append(slider);
  }
  slider.hidden = levels.length < 2;
  slider.min = 0;
  slider.max = levels.length;
  slider.step = 1;
  slider.value = Math.max(
    0,
    ["auto", ...levels].indexOf($("picker-reasoning").value),
  );
  slider.setAttribute("aria-valuetext", $("picker-reasoning").value);
  slider.oninput = () => {
    $("picker-reasoning").value = ["auto", ...levels][Number(slider.value)];
    slider.setAttribute("aria-valuetext", $("picker-reasoning").value);
  };
  $("picker-reasoning").onchange = () => {
    slider.value = Math.max(
      0,
      ["auto", ...levels].indexOf($("picker-reasoning").value),
    );
    slider.setAttribute("aria-valuetext", $("picker-reasoning").value);
  };

  $("picker-capabilities").textContent = m
    ? [
        m.vision
          ? "Image input verified"
          : m.vision === false
            ? "Text input"
            : "Vision unknown",
        m.context
          ? `${m.context.toLocaleString()} context tokens`
          : "Set context limits in AI Providers",
        m.evidence,
      ].join(" · ")
    : "Auto uses enabled, configured models. Free never falls back to paid inference. Efficient requires known pricing; Super requires recorded quality evidence.";
}
$("picker-provider").onchange = () => populatePicker();
$("picker-model").onchange = reasoningPicker;
$("close-model-picker").onclick = () => $("model-dialog").close();
$("apply-model").onclick = async () => {
  const model = $("picker-model").value;
  if (!model) return;
  await saveSettings({
    model,
    reasoning: $("picker-reasoning").value || "auto",
  });
  $("model-picker").textContent = selectionLabel(model);
  $("model").value = model;
  $("model-dialog").close();
};
$("model").onchange = async () => {
  await saveSettings({ model: $("model").value, reasoning: "auto" });
  $("model-picker").textContent = selectionLabel(settings.model);
};
$("search-mode").onchange = () =>
  saveSettings({ search_mode: $("search-mode").value });
$("personalization-form").onsubmit = async (e) => {
  e.preventDefault();
  const fields = Object.fromEntries(new FormData(e.target));
  const rich = e.target.elements.rich_ui.checked;
  delete fields.rich_ui;
  try {
    await saveSettings({ personalization: fields, rich_ui: rich });
    $("personalization-status").textContent = "Saved";
  } catch (e) {
    $("personalization-status").textContent = e.message;
  }
};
function paintAttachments() {
  const list = $("attachment-list");
  list.replaceChildren();
  for (const file of attachedFiles) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    const label = document.createElement("span");
    label.textContent = file.name;
    label.title = `${file.mime} · ${file.bytes.toLocaleString()} bytes`;
    const preview = document.createElement("button");
    preview.textContent = "Preview";
    preview.onclick = () => previewAttachment(file.id);
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove " + file.name);
    remove.onclick = () => {
      attachedFiles = attachedFiles.filter((f) => f.id !== file.id);
      api.saveDraftAttachments(attachedFiles.map((f) => f.id));
      paintAttachments();
    };
    chip.append(label, preview, remove);
    list.append(chip);
  }
}
async function addFiles(files) {
  for (const file of files) {
    if (attachedFiles.length >= 8) {
      notice("Attach at most eight files.");
      break;
    }
    if (file.size > 25 * 1024 * 1024) {
      notice(`${file.name} exceeds 25 MiB.`);
      continue;
    }
    try {
      $("attach-file").disabled = true;
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      const saved = await api.importAttachment({
        name: file.name,
        data: btoa(binary),
      });
      attachedFiles.push(saved);
      await api.saveDraftAttachments(attachedFiles.map((f) => f.id));
      paintAttachments();
      notice();
    } catch (e) {
      notice(e.message);
    } finally {
      $("attach-file").disabled = false;
    }
  }
}
$("attach-file").onclick = () => $("file-input").click();
$("file-input").onchange = (e) => {
  addFiles([...e.target.files]);
  e.target.value = "";
};
$("page-conversation").addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    $("composer").classList.add("drop-target");
  }
});
$("page-conversation").addEventListener("dragleave", () =>
  $("composer").classList.remove("drop-target"),
);
$("page-conversation").addEventListener("drop", (e) => {
  e.preventDefault();
  $("composer").classList.remove("drop-target");
  addFiles([...e.dataTransfer.files]);
});
$("message").addEventListener("paste", (e) => {
  const files = [...e.clipboardData.files];
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  } else {
    const text = e.clipboardData.getData("text");
    if (new TextEncoder().encode(text).length > 24000) {
      e.preventDefault();
      addFiles([new File([text], "pasted-text.txt", { type: "text/plain" })]);
    }
  }
});
$("clear-chat").onclick = () =>
  confirm(
    "Clear this chat view?",
    "Only the visible conversation is cleared. Working context, memories and the full searchable history remain.",
    async () => {
      await api.clearChat();
      await refresh(true);
    },
  );
(async () => {
  try {
    await refreshPlatform();
    const prefs = settings.personalization || {};
    for (const input of $("personalization-form").elements)
      if (input.name && prefs[input.name] !== undefined)
        input.value = prefs[input.name];
    $("personalization-form").elements.rich_ui.checked =
      settings.rich_ui !== false;
    const ids = await api.draftAttachments();
    attachedFiles = (
      await Promise.all(ids.map((id) => api.attachmentInfo(id)))
    ).filter(Boolean);
    paintAttachments();
  } catch (e) {
    notice(e.message);
  }
})();

async function previewAttachment(id, chunk = 0) {
  try {
    const file = await api.attachmentPreview({ id, chunk }),
      dialog = document.createElement("dialog");
    dialog.className = "attachment-preview";
    const heading = document.createElement("h2");
    heading.textContent = file.name;
    const body = document.createElement(file.image ? "img" : "pre");
    if (file.image) {
      body.src = file.image;
      body.alt = file.name;
    } else body.textContent = file.text || "No extracted text";
    const label = document.createElement("p");
    label.className = "secondary";
    label.textContent = file.excerpt
      ? "Preview excerpt. Original file is retained locally."
      : "";
    const close = document.createElement("button");
    close.textContent = "Close";
    close.onclick = () => {
      dialog.close();
      dialog.remove();
    };
    dialog.append(heading, label, body, close);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  } catch (e) {
    notice(e.message);
  }
}
