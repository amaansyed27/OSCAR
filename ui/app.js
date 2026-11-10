const $ = (id) => document.getElementById(id),
  api = window.oscar;
let page = "conversation",
  rows = [],
  busy = false,
  tab = "personal",
  settings,
  systemTheme = "light",
  selected = null,
  confirmAction,
  searchBefore = null,
  searchRows = [];
let learningWarning = "",
  searchCursor = null,
  lastChatTop = 0,
  chatFollow = true;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const motions = new WeakMap();
function arrive(element, distance = 5, duration = 180) {
  motions.get(element)?.cancel();
  if (reducedMotion.matches) return;
  const animation = element.animate(
    [
      { opacity: 0.45, transform: `translateY(${distance}px)` },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
  motions.set(element, animation);
}
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches)
    document.getAnimations().forEach((animation) => animation.cancel());
});
let settingsSection =
  localStorage.getItem("oscar.settingsSection") || "appearance";
const arrivalIds = new Set();
let textareaAnimation;
const sidebar = document.querySelector(".sidebar");
let sidebarPinned = localStorage.getItem("oscar.sidebarPinned") === "true";
let sidebarHovered = false;
let sidebarKeyboard = false;
function setSidebar() {
  const expanded = sidebarPinned || sidebarHovered || sidebarKeyboard;
  document.body.classList.toggle("collapsed", !expanded);
  $("collapse").setAttribute("aria-expanded", String(expanded));
  $("collapse").setAttribute("aria-pressed", String(sidebarPinned));
  const label = sidebarPinned ? "Unpin sidebar" : "Pin sidebar";
  $("collapse").setAttribute("aria-label", label);
  $("collapse").dataset.tooltip = label;
  hideTooltip();
}
sidebar.addEventListener("mouseenter", () => {
  sidebarHovered = true;
  setSidebar();
});
sidebar.addEventListener("mouseleave", () => {
  sidebarHovered = false;
  setSidebar();
});
sidebar.addEventListener("focusin", () => {
  sidebarKeyboard = document.activeElement.matches(":focus-visible");
  setSidebar();
});
sidebar.addEventListener("focusout", () =>
  requestAnimationFrame(() => {
    sidebarKeyboard =
      sidebar.contains(document.activeElement) &&
      document.activeElement.matches(":focus-visible");
    setSidebar();
  }),
);
sidebar.addEventListener("pointerdown", () => {
  sidebarKeyboard = false;
});
function selectSettings(key, animate = true) {
  const target = $("settings-" + key);
  if (!target) return;
  settingsSection = key;
  document.querySelector(".settings-content").scrollTop = 0;
  $("settings-empty").hidden = true;
  localStorage.setItem("oscar.settingsSection", key);
  document
    .querySelectorAll(".setting-panel")
    .forEach((panel) => (panel.hidden = panel !== target));
  document.querySelectorAll("[data-settings]").forEach((button) => {
    if (button.dataset.settings === key)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (animate) arrive(target, 4, 170);
}
for (const button of document.querySelectorAll("[data-settings]")) {
  button.onclick = () => selectSettings(button.dataset.settings);
  button.onkeydown = (event) => {
    if (
      ![
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const buttons = [...document.querySelectorAll("[data-settings]")].filter(
      (b) => !b.hidden,
    );
    const at = buttons.indexOf(button);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (at +
              (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) +
              buttons.length) %
            buttons.length;
    buttons[next]?.focus();
    buttons[next]?.click();
  };
}
$("settings-search").oninput = () => {
  const query = $("settings-search").value.toLowerCase().trim();
  const buttons = [...document.querySelectorAll("[data-settings]")];
  buttons.forEach(
    (button) =>
      (button.hidden =
        !!query &&
        !query
          .split(/\s+/)
          .every((word) =>
            (button.dataset.search + " " + button.textContent)
              .toLowerCase()
              .includes(word),
          )),
  );
  const visible = buttons.filter((button) => !button.hidden);
  $("settings-empty").hidden = visible.length > 0;
  if (!visible.length)
    document
      .querySelectorAll(".setting-panel")
      .forEach((panel) => (panel.hidden = true));
  else
    selectSettings(
      visible.find((button) => button.dataset.settings === settingsSection)
        ?.dataset.settings || visible[0].dataset.settings,
    );
};
let tooltipTimer, tooltipTarget;
function hideTooltip() {
  clearTimeout(tooltipTimer);
  if (tooltipTarget) tooltipTarget.removeAttribute("aria-describedby");
  tooltipTarget = null;
  $("sidebar-tooltip").hidden = true;
}
function showTooltip(target) {
  hideTooltip();
  if (
    !document.body.classList.contains("collapsed") &&
    target.id !== "collapse"
  )
    return;
  tooltipTimer = setTimeout(() => {
    const rect = target.getBoundingClientRect();
    const tooltip = $("sidebar-tooltip");
    tooltip.textContent = target.dataset.tooltip;
    tooltip.hidden = false;
    tooltip.style.left =
      document.querySelector(".sidebar").getBoundingClientRect().right +
      9 +
      "px";
    tooltip.style.top =
      Math.max(
        8,
        Math.min(
          innerHeight - tooltip.offsetHeight - 8,
          rect.top + (rect.height - tooltip.offsetHeight) / 2,
        ),
      ) + "px";
    target.setAttribute("aria-describedby", "sidebar-tooltip");
    tooltipTarget = target;
    arrive(tooltip, 2, 110);
  }, 250);
}
for (const target of document.querySelectorAll(
  ".sidebar [data-page],#collapse,#profile",
)) {
  target.dataset.tooltip =
    target.getAttribute("aria-label") || target.textContent.trim();
  target.removeAttribute("title");
  target.addEventListener("mouseenter", () => showTooltip(target));
  target.addEventListener("mouseleave", hideTooltip);
  target.addEventListener("focus", () => showTooltip(target));
  target.addEventListener("blur", hideTooltip);
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideTooltip();
});
addEventListener("resize", hideTooltip);
localStorage.removeItem("oscar.sidebarExpanded");
setSidebar();
selectSettings(settingsSection, false);
const date = (v) =>
  new Date(v).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function notice(text = "") {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}
function button(label, action, cls = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.className = cls;
  b.onclick = () =>
    Promise.resolve()
      .then(action)
      .catch((e) => notice(e.message));
  return b;
}
function confirm(title, text, action) {
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;
  confirmAction = action;
  $("confirm-dialog").showModal();
  arrive($("confirm-dialog"), 3, 150);
}
function theme() {
  if (!settings) return;
  document.documentElement.dataset.theme =
    settings.theme === "system" ? systemTheme : settings.theme;
}
function navigate(next) {
  const changed = page !== next;
  hideTooltip();
  if (page === "conversation" && next !== page) {
    lastChatTop = $("chat-scroll").scrollTop;
    chatFollow = nearBottom();
  }
  page = next;
  for (const name of ["conversation", "memories", "settings"]) {
    $("page-" + name).hidden = name !== next;
    const b = document.querySelector(`[data-page="${name}"]`);
    if (name === next) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  $("clear-chat").hidden = next !== "conversation";
  $("page-title").textContent = next[0].toUpperCase() + next.slice(1);
  document
    .querySelector(".workspace")
    .classList.toggle("settings-open", next === "settings");
  if (changed) arrive($("page-" + next));
  if (next === "conversation") {
    if (chatFollow) bottom();
    else $("chat-scroll").scrollTop = lastChatTop;
  }
  if (next === "memories") search();
}
for (const b of document.querySelectorAll("[data-page]"))
  b.onclick = () => navigate(b.dataset.page);
$("collapse").onclick = () => {
  sidebarPinned = !sidebarPinned;
  localStorage.setItem("oscar.sidebarPinned", String(sidebarPinned));
  setSidebar();
};
for (const b of document.querySelectorAll("[data-page]")) {
  b.setAttribute("aria-label", b.textContent.trim());
  b.dataset.tooltip = b.textContent.trim();
  b.removeAttribute("title");
  b.querySelector("svg").setAttribute("aria-hidden", "true");
}
function markdown(text) {
  const div = document.createElement("div");
  div.innerHTML = DOMPurify.sanitize(marked.parse(text), {
    FORBID_TAGS: ["img", "input", "style", "form"],
    FORBID_ATTR: ["style", "id"],
  });
  for (const a of div.querySelectorAll("a")) {
    if (/^https?:\/\//.test(a.getAttribute("href"))) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    } else a.removeAttribute("href");
  }
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT),
    nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement.closest("pre,code,a")) continue;
    const re = /\[#(\d+)\]|\[D:([a-f0-9-]{36}):(\d+)\]/g;
    let m,
      last = 0;
    const fragment = document.createDocumentFragment();
    while ((m = re.exec(node.textContent))) {
      const match = [...m];
      fragment.append(
        node.textContent.slice(last, m.index),
        m[1]
          ? button(m[0], () => showSource(Number(match[1])), "source-link")
          : button(
              "File · passage " + (Number(m[3]) + 1),
              () => previewAttachment(match[2], Number(match[3])),
              "source-link",
            ),
      );
      last = re.lastIndex;
    }
    if (last) {
      fragment.append(node.textContent.slice(last));
      node.replaceWith(fragment);
    }
  }
  return div;
}
function nearBottom() {
  if (page !== "conversation") return chatFollow;
  const e = $("chat-scroll");
  return e.scrollHeight - e.scrollTop - e.clientHeight < 100;
}
function bottom() {
  $("chat-scroll").scrollTop = $("chat-scroll").scrollHeight;
}
function render() {
  const scroll = $("chat-scroll"),
    position = scroll.scrollTop,
    follow = nearBottom();
  const expandedActivity = new Set(Array.from(
    $("messages").querySelectorAll(".reply-activity[open]"),
    (details) => details.closest(".message").dataset.id,
  ));
  $("messages").replaceChildren();
  $("welcome").hidden = rows.length > 0;
  $("page-conversation").classList.toggle(
    "empty-conversation",
    rows.length === 0,
  );
  $("older").hidden = rows.length < 50 && (!rows[0] || rows[0].id === 1);
  for (const row of rows) {
    if (
      row.role === "assistant" &&
      !row.content &&
      ["failed", "interrupted"].includes(row.status)
    )
      continue;
    const article = document.createElement("article");
    article.className = "message " + row.role;
    article.dataset.id = row.id;
    article.dataset.generating = row.status === "pending";
    if (row.role === "user") {
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = row.content;
      article.append(bubble);
    } else {
      const orb = document.createElement("img");
      orb.src = "../assets/brand/oscar-orb.svg";
      orb.className = "orb";
      orb.alt = "OSCAR";
      const body = markdown(row.content);
      body.className = "body";
      article.append(orb);
      if (row.status === "complete")
        article.append(replyActivity(row, expandedActivity.has(String(row.id))));
      article.append(body);
    }
    for (const file of row.attachments || []) {
      article.append(
        button(
          file.name,
          () => previewAttachment(file.id),
          "attachment-reference",
        ),
      );
    }
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const time = document.createElement("time");
    time.dateTime = row.created;
    time.textContent = date(row.created);
    meta.append(time);
    if (typeof row.id === "number")
      meta.append(button("Source", () => showSource(row.id)));
    if (["failed", "interrupted"].includes(row.status)) {
      meta.append(
        document.createTextNode(
          row.status === "interrupted" ? "Stopped" : "Incomplete",
        ),
      );
      if (row.role === "user")
        meta.append(button("Retry", () => send(row.content, row.id)));
    }
    article.append(meta);
    $("messages").append(article);
    if (row.role === "assistant" && row.status !== "pending")
      requestAnimationFrame(() =>
        enhanceRich(article.querySelector(".body"), row.id),
      );
    if (arrivalIds.delete(row.id)) arrive(article, 5, 180);
  }
  if (follow) bottom();
  else scroll.scrollTop = position;
}
async function refresh(follow = false) {
  const old = $("chat-scroll").scrollTop;
  rows = await api.history({ visible: true });
  render();
  if (follow) bottom();
  else $("chat-scroll").scrollTop = old;
}
function setBusy(value) {
  busy = value;
  $("send").hidden = value;
  $("stop").hidden = !value;
  $("thinking").hidden = !value;
  $("context-clear").disabled = value;
  $("clear-chat").disabled = value;
}
function resizeInput() {
  const input = $("message"),
    from = input.getBoundingClientRect().height,
    follow = nearBottom();
  textareaAnimation?.cancel();
  input.style.height = "auto";
  const to = Math.min(input.scrollHeight, 180);
  input.style.height = to + "px";
  if (!reducedMotion.matches && Math.abs(from - to) > 1) {
    textareaAnimation = input.animate(
      [{ height: from + "px" }, { height: to + "px" }],
      { duration: 150, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
    textareaAnimation.onfinish = () => {
      if (follow) bottom();
    };
  }
}
async function send(text, retryId) {
  if (busy || (!text.trim() && !attachedFiles.length)) return;
  if (!text.trim()) text = "Please analyse the attached files.";
  if (new TextEncoder().encode(text).length > 24000) {
    notice("This message is too long. Shorten it before sending.");
    return;
  }
  if (!$("present").hidden) {
    await refresh(true);
    $("present").hidden = true;
    $("newer").hidden = true;
  }
  setBusy(true);
  notice();
  if (!retryId) {
    try {
      await api.saveDraft("");
    } catch (e) {
      setBusy(false);
      notice(e.message);
      return;
    }
    $("message").value = "";
    resizeInput();
  }
  try {
    await api.send({
      text,
      retryId,
      attachments: attachedFiles.map((f) => f.id),
    });
    attachedFiles = [];
    paintAttachments();
  } catch (e) {
    notice(e.message);
  } finally {
    setBusy(false);
    const follow = nearBottom();
    await refresh(follow);
    $("message").focus();
  }
}
$("composer").onsubmit = (e) => {
  e.preventDefault();
  send($("message").value);
};
$("message").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send($("message").value);
  }
};
$("stop").onclick = () => api.cancel();
let draftTimer;
$("message").oninput = () => {
  resizeInput();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(
    () => api.saveDraft($("message").value).catch((e) => notice(e.message)),
    200,
  );
};
$("older").onclick = async () => {
  const e = $("chat-scroll"),
    height = e.scrollHeight;
  const older = await api.history({ before: rows[0].id, visible: true });
  rows = [...older, ...rows].slice(0, 200);
  render();
  e.scrollTop = e.scrollHeight - height;
  $("older").hidden = older.length < 50;
  $("newer").hidden = false;
};
$("newer").onclick = async () => {
  const recent = await api.history({ after: rows.at(-1).id, visible: true });
  rows = [...rows, ...recent].slice(-200);
  render();
  $("newer").hidden = recent.length < 50;
};
$("present").onclick = async () => {
  $("present").hidden = true;
  $("newer").hidden = true;
  await refresh(true);
};
async function jump(id) {
  rows = await api.around(id);
  navigate("conversation");
  render();
  $("present").hidden = false;
  $("older").hidden = rows[0]?.id === 1;
  $("newer").hidden = false;
  const target = document.querySelector(`[data-id="${id}"]`);
  target?.classList.add("jump-highlight");
  target?.scrollIntoView({ block: "center" });
}
function textNode(tag, text, cls = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = cls;
  return node;
}
function switchTab(next) {
  tab = next;
  searchBefore = null;
  selected = null;
  $("detail").hidden = true;
  $("personal-tab").setAttribute("aria-selected", next === "personal");
  $("history-tab").setAttribute("aria-selected", next === "history");
  $("history-filters").hidden = next !== "history";
  $("search").placeholder =
    next === "personal"
      ? "Search personal memory"
      : "Search the whole conversation";
  $("memory-list").hidden = next !== "personal";
  $("results").hidden = next !== "history";
  $("search").value = "";
  search();
}
$("personal-tab").onclick = () => switchTab("personal");
$("history-tab").onclick = () => switchTab("history");
async function showMemory(memory) {
  selected = memory;
  $("detail").hidden = false;
  arrive($("detail"), 4, 170);
  $("memory-edit").hidden = true;
  $("memory-notice").textContent = "";
  const body = $("detail-body");
  body.replaceChildren(
    textNode("h2", "Personal memory"),
    textNode("p", memory.text),
    textNode(
      "p",
      "Recorded " +
        date(memory.created) +
        (memory.replaces
          ? " · Corrected " + date(memory.updated || memory.created)
          : ""),
      "secondary",
    ),
  );
  const source = await api.source(memory.source);
  body.append(
    textNode("h2", "Your original statement"),
    textNode("div", source?.content || "Source unavailable", "source-quote"),
  );
  $("detail-actions").replaceChildren(
    button("Open in conversation", () => jump(memory.source)),
    button("Correct", () => {
      $("memory-edit").hidden = false;
      $("memory-text").value = memory.text;
      $("memory-text").focus();
    }),
    button(
      "Forget",
      () =>
        confirm(
          "Forget this memory?",
          "OSCAR will stop retrieving this memory. Original conversation messages stay readable.",
          async () => {
            await api.forget(memory.id);
            $("detail").hidden = true;
            await search();
          },
        ),
      "danger",
    ),
  );
}
async function showSource(id) {
  const source = await api.source(id);
  if (!source) throw new Error("Source unavailable.");
  navigate("memories");
  $("detail").hidden = false;
  arrive($("detail"), 4, 170);
  $("memory-edit").hidden = true;
  $("memory-notice").textContent = "";
  $("detail-body").replaceChildren(
    textNode(
      "h2",
      source.role === "user" ? "Your statement" : "OSCAR response",
    ),
    textNode("p", date(source.created), "secondary"),
    textNode("div", source.content, "source-quote"),
  );
  const actions = [button("Open in conversation", () => jump(source.id))];
  if (source.role === "user")
    actions.push(
      button("Remember this", async () => {
        await api.edit({
          source: source.id,
          text: source.content.slice(0, 600),
        });
        $("memory-notice").textContent = "Memory saved.";
        await search();
      }),
    );
  $("detail-actions").replaceChildren(...actions);
}
let searchRevision = 0;
async function search(more = false) {
  $("more-results").disabled = true;
  const requestRevision = ++searchRevision,
    requestTab = tab;
  const input = $("search").value;
  const ranked = !!input.trim() && $("sort").value === "relevance";
  if (!more) {
    searchBefore = null;
    searchCursor = null;
    searchRows = [];
  }
  const data =
    tab === "personal"
      ? await api.memories({
          search: input,
          before: searchBefore || Number.MAX_SAFE_INTEGER,
        })
      : await api.history({
          search: input,
          before: ranked
            ? Number.MAX_SAFE_INTEGER
            : searchBefore || Number.MAX_SAFE_INTEGER,
          cursor: ranked ? searchCursor : null,
          from: $("from").value,
          to: $("to").value,
          sort: $("sort").value,
        });
  if (requestRevision !== searchRevision || requestTab !== tab) return;
  $("more-results").disabled = false;
  searchRows = more ? [...searchRows, ...data] : data;
  const container = tab === "personal" ? $("memory-list") : $("results");
  container.replaceChildren();
  $("result-status").textContent = searchRows.length
    ? `${searchRows.length} ${tab === "personal" ? "memories" : "messages"}`
    : input
      ? "No matches. Try a name, topic or exact phrase."
      : tab === "personal"
        ? "No personal memories yet."
        : "No conversation messages yet.";
  for (const row of searchRows) {
    const excerpt = document.createElement("div");
    excerpt.innerHTML = DOMPurify.sanitize(
      marked.parse(row.text || row.content),
    );
    const b = button(
      excerpt.textContent.slice(0, 240),
      () => (tab === "personal" ? showMemory(row) : showSource(row.id)),
      tab === "personal" ? "memory-item" : "result",
    );
    b.append(
      textNode(
        "small",
        (tab === "history"
          ? (row.role === "user" ? "You" : "OSCAR") + " · "
          : "") + date(row.created),
      ),
    );
    container.append(b);
  }
  if (learningWarning && tab === "personal")
    $("result-status").textContent += " · " + learningWarning;
  $("more-results").hidden =
    data.length < (tab === "personal" ? 60 : 50) || false;
  searchBefore = data.length ? Math.min(...data.map((r) => r.id)) : null;
  searchCursor =
    data.length && ranked && Number.isFinite(data.at(-1).score)
      ? { score: data.at(-1).score, id: data.at(-1).id }
      : null;
}
$("search-form").onsubmit = (e) => {
  e.preventDefault();
  search();
};
$("more-results").onclick = () => search(true);
$("from").onchange = () => search();
$("to").onchange = () => search();
$("sort").onchange = () => search();
$("memory-edit").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api.edit({ id: selected.id, text: $("memory-text").value });
    $("detail").hidden = true;
    await search();
  } catch (e) {
    $("memory-notice").textContent = e.message;
  }
};
$("edit-cancel").onclick = () => ($("memory-edit").hidden = true);
async function saveSettings(value, feedback) {
  try {
    settings = await api.setSettings(value);
    theme();
  } catch (e) {
    if (feedback) throw e;
    notice(e.message);
  }
}
$("theme").onchange = () => saveSettings({ theme: $("theme").value });
$("learn").onchange = () => saveSettings({ learn: $("learn").checked });
$("input-budget").onchange = () =>
  saveSettings({ inputTokens: Number($("input-budget").value) });
$("browse-history").onclick = () => {
  navigate("memories");
  switchTab("history");
};
$("browse-memories").onclick = () => {
  navigate("memories");
  switchTab("personal");
};
$("context-clear").onclick = () =>
  confirm(
    "Reset working context?",
    "Keep the full conversation and personal memory. Current working state will be cleared.",
    async () => {
      await api.clear();
      notice("Working context reset. History and personal memory kept.");
    },
  );
$("confirm-cancel").onclick = () => $("confirm-dialog").close();
$("confirm-yes").onclick = async () => {
  $("confirm-dialog").close();
  try {
    await confirmAction();
  } catch (e) {
    notice(e.message);
  }
};
let streamText = "",
  streamId,
  frame;
api.onEvent((event) => {
  if (event.type === "system-theme") {
    systemTheme = event.theme;
    theme();
  }
  if (event.type === "submitted") {
    if (!rows.some((row) => row.id === event.user.id))
      arrivalIds.add(event.user.id);
    rows = rows.filter((r) => r.id !== event.user.id);
    rows.push(event.user);
    render();
    bottom();
  }
  if (event.type === "stream-start") {
    arrivalIds.add(event.id);
    streamId = event.id;
    streamText = "";
    rows.push({
      id: streamId,
      role: "assistant",
      content: "",
      created: new Date().toISOString(),
      status: "pending",
    });
    render();
  }
  if (event.type === "delta") {
    streamText += event.chunk;
    if (!frame)
      frame = setTimeout(() => {
        const follow = nearBottom();
        const row = rows.find((r) => r.id === event.id);
        if (row) row.content = streamText;
        const body = document.querySelector(`[data-id="${event.id}"] .body`);
        if (body) body.replaceChildren(...markdown(streamText).childNodes);
        if (follow) bottom();
        frame = null;
      }, 50);
  }
  if (event.type === "complete") {
    clearTimeout(frame);
    frame = null;
    for (const update of [event.user, event.assistant]) {
      const index = rows.findIndex((r) => r.id === update.id);
      if (index >= 0) rows[index] = update;
    }
    render();
  }
  if (event.type === "memory" && page === "memories") search();
  if (event.type === "maintenance-error") {
    learningWarning = event.message;
    if (page === "memories") $("result-status").textContent = event.message;
  }
});
(async () => {
  try {
    [settings, systemTheme] = await Promise.all([
      api.settings(),
      api.systemTheme(),
    ]);
    theme();
    $("theme").value = settings.theme;
    $("learn").checked = settings.learn;
    $("input-budget").value = settings.inputTokens;
    $("message").value = await api.draft();
    resizeInput();
    await refresh(true);
    $("message").focus();
    const status = await api.status();
    if (status.learningDelayed)
      learningWarning =
        "Memory learning is delayed. You can save a statement manually.";
    if (!status.configured) notice("No Groq key found in local configuration.");
  } catch (e) {
    notice(e.message);
  }
})();

for (const id of ["personal-tab", "history-tab"])
  $(id).onkeydown = (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const next =
        e.key === "Home"
          ? "personal-tab"
          : e.key === "End"
            ? "history-tab"
            : id === "personal-tab"
              ? "history-tab"
              : "personal-tab";
      $(next).click();
      $(next).focus();
    }
  };

function replyActivity(row, open) {
  const details = document.createElement("details");
  details.className = "reply-activity";
  const summary = document.createElement("summary");
  const elapsed = row.elapsed_ms;
  const seconds = elapsed / 1000;
  summary.textContent = Number.isFinite(elapsed)
    ? `Worked for ${seconds < 60 ? `${Math.max(0.1, seconds).toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`}`
    : "Reply activity";
  const list = document.createElement("dl");
  details.append(summary, list);
  const add = (label, value) => {
    if (value == null || value === "") return;
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    list.append(term, description);
  };
  let loaded = false;
  async function load() {
    if (loaded || !details.open) return;
    loaded = true;
    add("Status", "Loading…");
    try {
      const data = await api.responseDetails(row.id);
      list.replaceChildren();
      const usage = data?.usage;
      if (!data) {
        add("Status", "Activity was not recorded for this reply.");
        return;
      }
      if (usage?.model)
        add("Model used", selectionLabel(`${usage.provider}::${usage.model}`));
      const first = data.route?.[0];
      if (first && usage?.model && first !== `${usage.provider}::${usage.model}`)
        add("First route", selectionLabel(first));
      const requests = data.foreground_requests ?? usage?.answer_requests;
      if (Number.isInteger(requests)) add("Model calls", String(requests));
      if (usage?.output_limit_recovery) add("Recovery", "Retried with a shorter answer request");
      if (data.vision_helper?.model) add("Vision helper", `${selectionLabel(`${data.vision_helper.provider}::${data.vision_helper.model}`)} · ${data.vision_helper.views} views`);
      if (data.decision?.task) add("Task", data.decision.task);
      if (data.decision?.search && data.sources?.length)
        add("Web research", `${data.sources.length} sources gathered`);
      const reasoning = usage?.completion_tokens_details?.reasoning_tokens;
      if (Number.isInteger(reasoning)) add("Reasoning tokens", reasoning.toLocaleString());
      if (Number.isInteger(usage?.completion_tokens))
        add("Output tokens", usage.completion_tokens.toLocaleString());
      if (typeof usage?.cost === "number") add("Reported inference cost", `$${usage.cost}`);
      else if (typeof usage?.estimated_cost === "number")
        add("Estimated inference cost", `$${usage.estimated_cost.toFixed(6)}`);
      if (!list.children.length) add("Status", "No activity details available.");
    } catch {
      list.replaceChildren();
      add("Status", "Could not load activity. Reopen to try again.");
      loaded = false;
    }
  }
  details.addEventListener("toggle", load);
  details.open = open;
  return details;
}
