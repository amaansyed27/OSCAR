/* Slice 02 controls extend the existing three-page shell. */
let platformModels = [],
  platformProviders = [],
  attachedFiles = [],
  providerId = "groq";
const platformStatus = (message) => {
  $("provider-status").textContent = message || "";
  $("provider-status").hidden = !message;
};
function showProviderTab(name) {
  for (const tab of document.querySelectorAll("[data-provider-tab]"))
    tab.setAttribute("aria-pressed", String(tab.dataset.providerTab === name));
  for (const pane of document.querySelectorAll("[data-provider-pane]"))
    pane.hidden = pane.dataset.providerPane !== name;
}
for (const tab of document.querySelectorAll("[data-provider-tab]"))
  tab.onclick = () => showProviderTab(tab.dataset.providerTab);
function resetCredentialEditor() {
  const form = $("credential-form");
  form.reset();
  delete form.dataset.replace;
  $("credential-editor").open = false;
  $("credential-editor").querySelector("summary").textContent =
    "Add an API key";
}
function describeRouting() {
  $("current-model-name").textContent = selectionLabel(settings.model);
  const descriptions = {
    "auto:free": "Uses only currently verified free models.",
    "auto:efficient": "Chooses a suitable model with known pricing.",
    "auto:super": "Prefers suitable models with recorded quality ratings.",
  };
  $("routing-description").textContent =
    descriptions[settings.model] ||
    "Uses the selected model first. You can set fallback models below.";
}
const optionsFor = (select, items, selected) => {
  select.replaceChildren(
    ...items.map(([value, label]) => new Option(label, value)),
  );
  if (selected) select.value = selected;
};
function selectionLabel(id) {
  if (id?.startsWith("auto:"))
    return "Auto · " + id.slice(5).replace(/^./, (c) => c.toUpperCase());
  if (id?.startsWith("waterfall:"))
    return settings?.waterfall_profiles?.find((p) => `waterfall:${p.id}` === id)?.name || "Custom waterfall";
  const m = platformModels.find((m) => m.id === id || m.model === id);
  const p = platformProviders.find((p) => p.id === m?.provider);
  const gptOss = /^openai\/gpt-oss-(20b|120b)$/.exec(m?.name || "");
  const name = gptOss ? `GPT-OSS ${gptOss[1].toUpperCase()}` : m?.name;
  return m ? `${p?.name || m.provider} · ${name}` : id || "Choose a model";
}
function updateModelTrigger(model) {
  const label = selectionLabel(model);
  $("model-picker-label").textContent = label;
  $("model-picker").title = label;
}
async function refreshPlatform() {
  [platformProviders, platformModels] = await Promise.all([
    api.cloudProviders(),
    api.cloudModels({}),
  ]);
  const current = await api.settings();
  settings = current;
  optionsFor(
    $("waterfall-model"),
    platformModels
      .filter((m) => m.enabled)
      .map((m) => [m.id, selectionLabel(m.id)]),
  );
  const providerSelect = $("provider-select");
  providerSelect.replaceChildren();
  for (const [name, configured] of [
    ["With credentials", true],
    ["Provider catalog", false],
  ]) {
    const group = document.createElement("optgroup");
    group.label = name;
    for (const provider of platformProviders.filter(
      (p) => Boolean(p.credentials?.length) === configured,
    ))
      group.append(new Option(provider.name, provider.id));
    if (group.children.length) providerSelect.append(group);
  }
  providerSelect.value = providerId;
  updateModelTrigger(current.model);
  $("search-mode").value = current.search_mode || "auto";
  $("spending-ceiling").value = current.spending_ceiling || "";
  $("search-paid-budget").value = current.search_paid_credits || "0";
  renderWaterfall();
  describeRouting();
  renderProvider();
}
function renderProvider() {
  const p = platformProviders.find((p) => p.id === providerId);
  if (!p) return;
  const search = p.protocol === "search";
  const restricted = p.protocol === "restricted";
  const enabledKeys = (p.credentials || []).filter((c) => c.enabled);
  const active = enabledKeys.length;
  $("provider-next").hidden = !active || search || restricted;
  const keySelect = $("test-credential");
  optionsFor(
    keySelect,
    [
      ["", "Any enabled key"],
      ...enabledKeys.map((key) => [key.id, key.nickname]),
    ],
    keySelect.value,
  );
  const enabledModels = platformModels.filter(
    (m) => m.provider === p.id && m.enabled,
  ).length;
  $("provider-summary").textContent = [
    active
      ? `${active} enabled ${active === 1 ? "key" : "keys"}`
      : "No enabled keys",
    search
      ? "Web search"
      : restricted
        ? "Restricted plan"
        : `${enabledModels} enabled models`,
  ].join(" · ");
  document.querySelector('[data-provider-tab="models"]').hidden =
    search || restricted;
  document.querySelector('[data-provider-tab="connection"]').hidden =
    search || restricted;
  const refresh = $("discover-models");
  refresh.hidden = restricted;
  refresh.textContent = search ? "Check search access" : "Refresh models";
  document
    .querySelector(
      `[data-provider-pane="${search ? "access" : "models"}"] .provider-section-heading`,
    )
    .append(refresh);
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
    toggle.setAttribute("aria-label", `Enable ${c.nickname}`);
    const detail = document.createElement("small");
    detail.textContent =
      (c.source.startsWith("environment:")
        ? "From local configuration"
        : "Saved on this device") +
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
      resetCredentialEditor();
      form.dataset.replace = c.id;
      form.elements.nickname.value = c.nickname;
      $("credential-editor").open = true;
      $("credential-editor").querySelector("summary").textContent =
        "Replace API key";
      form.elements.secret.focus();
      platformStatus(
        c.source.startsWith("environment:")
          ? "The replacement is protected in Settings; the original environment slot will be disabled without editing its file."
          : "Enter the replacement credential.",
      );
    };
    const actions = document.createElement("div");
    actions.className = "inline-controls";
    actions.append(replace);
    if (!c.source.startsWith("environment:")) actions.append(remove);
    row.append(label, detail, actions);
    list.append(row);
  }
  if (!p.credentials?.length) {
    const empty = document.createElement("p");
    empty.className = "settings-empty-state";
    empty.textContent = "No API keys for this provider yet.";
    list.append(empty);
    if (!restricted) $("credential-editor").open = true;
  }
  platformStatus(
    p.protocol === "restricted"
      ? "This restricted Coding Plan is not enabled for general conversation."
      : p.base
        ? ""
        : "Configure the provider’s project/account endpoint before connecting.",
  );
  renderProviderModels();
}
$("provider-next").onclick = () => {
  showProviderTab("models");
  $("discover-models").focus();
};
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
      m.free &&
      m.free_verified_at &&
      Date.now() / 1000 - m.free_verified_at < 86400
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
          credential: $("test-credential").value || undefined,
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
  resetCredentialEditor();
  resetConnectionEditor();
  $("allow-billable-test").checked = false;
  $("model-search").value = "";
  $("model-form").reset();
  $("model-form").closest("details").open = false;
  showProviderTab("access");
  renderProvider();
};
$("model-search").oninput = renderProviderModels;
function resetConnectionEditor() {
  delete $("provider-form").dataset.create;
  $("connection-title").textContent = "Connection details";
  $("cancel-provider").hidden = true;
  document.querySelector(".provider-tabs").hidden = false;
}
$("cancel-provider").onclick = () => {
  resetConnectionEditor();
  showProviderTab("access");
  renderProvider();
  $("add-provider").focus();
};
$("add-provider").onclick = () => {
  resetCredentialEditor();
  const form = $("provider-form");
  form.reset();
  form.dataset.create = "true";
  $("connection-title").textContent = "Add a custom provider";
  $("cancel-provider").hidden = false;
  document.querySelector(".provider-tabs").hidden = true;
  showProviderTab("connection");
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
    if (!e.target.dataset.create) fields.id = providerId;
    const p = await api.saveProvider(fields);
    providerId = p.id;
    resetConnectionEditor();
    showProviderTab("access");
    await refreshPlatform();
    platformStatus(
      "Connection saved. Add a key if the provider requires one, then refresh its models.",
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
    resetCredentialEditor();
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
      result.usage
        ? "Tavily credentials verified."
        : `${result.models} models found. Enable the ones you want to use.`,
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
    if (fields.evaluation_task) {
      if (fields.task_score === "" || !fields.evaluation_evidence.trim()) throw new Error("Add a task score and its evaluation evidence.");
      fields.task_quality = { [fields.evaluation_task]: Number(fields.task_score) };
    }
    delete fields.evaluation_task;
    delete fields.task_score;
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
let editingWaterfall = "";
let renameWaterfall = false;
function selectedWaterfall() {
  return settings.waterfall_profiles?.find((p) => p.id === editingWaterfall);
}
function waterfallEntries() {
  return selectedWaterfall()?.models || settings.waterfall || [];
}
function renderWaterfall() {
  const profiles = settings.waterfall_profiles || [];
  optionsFor($("waterfall-profile"), [["", "Manual model fallbacks"], ...profiles.map(p => [p.id, p.name])], editingWaterfall);
  $("waterfall-rename").hidden = $("waterfall-delete").hidden = !selectedWaterfall();
  const list = $("waterfall-list");
  list.replaceChildren();
  for (const [i, item] of waterfallEntries().entries()) {
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
        (delta > 0 && i === waterfallEntries().length - 1);
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
    const next = structuredClone(waterfallEntries());
    change(next);
    const profile = selectedWaterfall();
    if (profile) {
      const profiles = settings.waterfall_profiles.map(p => p.id === profile.id ? {...p, models: next} : p);
      const reset = settings.model === `waterfall:${profile.id}` && !next.some(m => m.enabled !== false);
      await saveSettings({waterfall_profiles: profiles, ...(reset ? {model: "auto:free", reasoning: "auto"} : {})}, true);
    } else await saveSettings({waterfall: next}, true);
    updateModelTrigger(settings.model);
    describeRouting();
    renderWaterfall();
  } catch (e) { notice(e.message); }
}
$("waterfall-profile").onchange = () => {
  editingWaterfall = $("waterfall-profile").value;
  $("waterfall-editor").hidden = true;
  renderWaterfall();
};
function openWaterfallEditor(rename) {
  renameWaterfall = rename;
  $("waterfall-editor").hidden = false;
  $("waterfall-name").value = rename ? selectedWaterfall().name : "";
  $("waterfall-name").focus();
}
$("waterfall-new").onclick = () => openWaterfallEditor(false);
$("waterfall-rename").onclick = () => openWaterfallEditor(true);
$("waterfall-cancel").onclick = () => { $("waterfall-editor").hidden = true; };
$("waterfall-editor").onsubmit = async (event) => {
  event.preventDefault();
  const name = $("waterfall-name").value.trim();
  if (!name) return;
  const id = renameWaterfall ? editingWaterfall : crypto.randomUUID();
  const profiles = settings.waterfall_profiles || [];
  const next = renameWaterfall ? profiles.map(p => p.id === id ? {...p, name} : p) : [...profiles, {id, name, models: []}];
  try {
    await saveSettings({waterfall_profiles: next}, true);
    editingWaterfall = id;
    $("waterfall-editor").hidden = true;
    updateModelTrigger(settings.model);
    describeRouting();
    renderWaterfall();
  } catch (e) { notice(e.message); }
};
$("waterfall-delete").onclick = () => {
  const profile = selectedWaterfall();
  if (!profile) return;
  confirm("Delete waterfall?", profile.name, async () => {
    const reset = settings.model === `waterfall:${profile.id}`;
    await saveSettings({
      waterfall_profiles: settings.waterfall_profiles.filter(p => p.id !== profile.id),
      ...(reset ? {model: "auto:free", reasoning: "auto"} : {}),
    }, true);
    editingWaterfall = "";
    updateModelTrigger(settings.model);
    describeRouting();
    renderWaterfall();
  });
};
$("waterfall-add").onclick = () => {
  const model = $("waterfall-model").value;
  if (model)
    changeWaterfall((a) => a.push({ model, enabled: true, reasoning: "auto" }));
};
$("spending-ceiling").onchange = () =>
  saveSettings({ spending_ceiling: $("spending-ceiling").value });
function modelPrice(model) {
  if (model.free && model.input_price === 0 && model.output_price === 0) return "free";
  if (model.input_price > 0 || model.output_price > 0) return "paid";
  return "unknown";
}
let showUnpricedModels = false;
function openModelPicker(event) {
  const profiles = (settings.waterfall_profiles || []).filter(p => p.models.some(m => m.enabled !== false));
  optionsFor($("picker-provider"), [
    ["auto", "Automatic routing"],
    ...(profiles.length ? [["waterfalls", "Custom waterfalls"]] : []),
    ...platformProviders
      .filter(p => p.enabled !== false && p.kind === "inference" && p.protocol !== "restricted" &&
        (p.auth === "none" || p.credentials?.some(key => key.enabled)))
      .map(p => [p.id, p.name]),
  ]);
  const id = settings.model.includes("::") || /^(auto|waterfall):/.test(settings.model)
    ? settings.model : "groq::" + settings.model;
  const current = platformModels.find(m => m.id === id);
  showUnpricedModels = Boolean(current && modelPrice(current) === "unknown");
  $("picker-paid").checked = current ? modelPrice(current) === "paid" : false;
  $("picker-provider").value = settings.model.startsWith("auto:") ? "auto"
    : id.startsWith("waterfall:") ? "waterfalls" : id.split("::")[0];
  if (!$("picker-provider").value) $("picker-provider").value = "auto";
  populatePicker(id);
  const dialog = $("model-dialog");
  const anchor = event.currentTarget;
  dialog.classList.toggle("composer-picker", anchor.id === "model-picker");
  if (anchor.id === "model-picker") {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(348, innerWidth - 24);
    const right = Math.min(Math.max(12, innerWidth - rect.right), innerWidth - width - 12);
    dialog.style.setProperty("--picker-right", `${right}px`);
    dialog.style.setProperty("--picker-bottom", `${Math.max(12, innerHeight - rect.top + 8)}px`);
  }
  dialog.showModal();
}
$("model-picker").onclick = openModelPicker;
$("change-model").onclick = openModelPicker;
function populatePicker(selected) {
  const provider = $("picker-provider").value;
  const direct = !["auto", "waterfalls"].includes(provider);
  const paid = $("picker-paid").checked;
  $("picker-price-label").hidden = !direct;
  const unpriced = $("picker-unpriced");
  unpriced.hidden = !direct || !platformModels.some(m => m.enabled && m.provider === provider && modelPrice(m) === "unknown");
  unpriced.textContent = showUnpricedModels ? "Back to price filter" : "Show models with unknown pricing";
  const options = provider === "auto" ? [
    ["auto:efficient", "Lowest known cost"],
    ["auto:free", "Free only"],
    ["auto:super", "Highest rated"],
  ] : provider === "waterfalls" ? (settings.waterfall_profiles || [])
    .filter(p => p.models.some(m => m.enabled !== false))
    .map(p => [`waterfall:${p.id}`, p.name])
    : platformModels.filter(m => m.enabled && m.provider === provider &&
        modelPrice(m) === (showUnpricedModels ? "unknown" : paid ? "paid" : "free"))
      .map(m => [m.id, m.name + (modelPrice(m) === "unknown" ? " · price unknown" : "")]);
  const preferred = selected || settings.model;
  selectedPickerModel = options.some(([id]) => id === preferred) ? preferred : options[0]?.[0] || "";
  const list = $("picker-model-list");
  list.replaceChildren();
  for (const [id, label] of options) {
    const row = document.createElement("button");
    row.type = "button";
    row.dataset.model = id;
    row.textContent = label;
    row.setAttribute("aria-pressed", String(id === selectedPickerModel));
    row.onclick = () => {
      selectedPickerModel = id;
      for (const entry of list.children)
        entry.setAttribute("aria-pressed", String(entry.dataset.model === id));
      reasoningPicker();
    };
    list.append(row);
  }
  reasoningPicker();
}
let selectedPickerModel = "";
let pickerEfforts = ["auto"];
function updateEffortLabel() {
  const value = pickerEfforts[Number($("picker-reasoning").value)] || "auto";
  const label = pickerEfforts.length === 1
    ? platformModels.some(m => m.id === selectedPickerModel) ? "Instant" : "Automatic"
    : value.charAt(0).toUpperCase() + value.slice(1);
  $("picker-effort-value").textContent = label;
  $("picker-reasoning").setAttribute("aria-valuetext", label);
}
function reasoningPicker() {
  const m = platformModels.find(m => m.id === selectedPickerModel);
  pickerEfforts = ["auto", ...(m?.reasoning || [])];
  const slider = $("picker-reasoning");
  slider.max = pickerEfforts.length - 1;
  slider.disabled = pickerEfforts.length === 1;
  slider.value = Math.max(0, pickerEfforts.indexOf(settings.reasoning));
  updateEffortLabel();
  $("apply-model").disabled = !selectedPickerModel;
  $("picker-capabilities").textContent = m
    ? m.vision === true ? "Supports image input" : "Visual files use the vision helper when available."
    : selectedPickerModel ? "Uses your configured model routes." : "No enabled models in this view.";
}
$("picker-provider").onchange = () => {
  const list = platformModels.filter(m => m.enabled && m.provider === $("picker-provider").value);
  showUnpricedModels = list.length > 0 && list.every(m => modelPrice(m) === "unknown");
  populatePicker();
};
$("picker-paid").onchange = () => { showUnpricedModels = false; populatePicker(); };
$("picker-unpriced").onclick = () => { showUnpricedModels = !showUnpricedModels; populatePicker(); };
$("picker-reasoning").oninput = updateEffortLabel;
$("close-model-picker").onclick = () => $("model-dialog").close();
$("apply-model").onclick = async () => {
  const model = selectedPickerModel;
  if (!model) return;
  $("apply-model").disabled = true;
  try {
    await saveSettings({ model, reasoning: pickerEfforts[Number($("picker-reasoning").value)] || "auto" }, true);
  } catch (error) {
    $("picker-capabilities").textContent = error.message;
    return;
  } finally {
    $("apply-model").disabled = false;
  }
  updateModelTrigger(model);
  describeRouting();
  $("model-dialog").close();
};
$("search-mode").onchange = () =>
  saveSettings({ search_mode: $("search-mode").value });
$("personalization-form").onsubmit = async (e) => {
  e.preventDefault();
  const fields = Object.fromEntries(new FormData(e.target));
  const rich = e.target.elements.rich_ui.checked;
  delete fields.rich_ui;
  try {
    await saveSettings({ personalization: fields, rich_ui: rich }, true);
    $("personalization-status").textContent = "Preferences saved.";
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
for (const name of ["dragover", "drop"]) {
  document.addEventListener(name, (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
}
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

$("search-paid-budget").onchange = () =>
  saveSettings({ search_paid_credits: $("search-paid-budget").value });
