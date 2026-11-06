const $ = (id) => document.getElementById(id);
const api = window.oscar;
let rows = [],
  busy = false,
  editId = null,
  sourceId = null,
  confirmAction = null,
  searchReturnTop = 0;
const date = (value) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function notice(text) {
  $("notice").textContent = text || "";
  $("notice").hidden = !text;
}
function button(label, action, className = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.className = className;
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
  // Source references are native buttons, never injected markup from model output.
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement.closest("code,pre,a")) continue;
    const regex = /\[#(\d+)\]/g;
    let match,
      last = 0;
    const fragment = document.createDocumentFragment();
    while ((match = regex.exec(node.textContent))) {
      fragment.append(
        node.textContent.slice(last, match.index),
        button(match[0], () => showSource(Number(match[1])), "source-link"),
      );
      last = regex.lastIndex;
    }
    if (last) {
      fragment.append(node.textContent.slice(last));
      node.replaceWith(fragment);
    }
  }
  return div;
}
function render() {
  $("messages").replaceChildren();
  $("welcome").hidden = rows.length > 0;
  $("older").hidden = rows.length < 50;
  for (const row of rows) {
    const article = document.createElement("article");
    article.className = "message " + row.role;
    article.dataset.id = row.id;
    if (row.role === "user") {
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = row.content;
      article.append(bubble);
    } else {
      const author = document.createElement("div");
      author.className = "author";
      const img = document.createElement("img");
      img.src = "../assets/brand/oscar-orb.svg";
      img.alt = "";
      author.append(img, "OSCAR");
      const body = markdown(row.content);
      body.className = "body";
      article.append(author, body);
    }
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const time = document.createElement("time");
    time.dateTime = row.created;
    time.textContent = date(row.created);
    meta.append(
      time,
      button("#" + row.id, () => showSource(row.id)),
    );
    if (["failed", "interrupted"].includes(row.status)) {
      meta.append(
        document.createTextNode(
          row.status === "failed" ? "Not answered" : "Interrupted",
        ),
        button("Retry", () => send(row.content, row.id)),
      );
    }
    article.append(meta);
    $("messages").append(article);
  }
}
async function refresh(scroll = false) {
  rows = await api.history();
  render();
  const memories = await api.memories();
  $("memory-count").textContent = memories.length || "";
  if (scroll)
    document.querySelector("main").scrollTo({
      top: document.querySelector("main").scrollHeight,
      behavior: "instant",
    });
}
function setBusy(value) {
  busy = value;
  $("send").disabled = value;
  $("context-clear").disabled = value;
  $("save-memory").disabled = value;
  $("thinking").hidden = !value;
  $("send-state").textContent = value ? "Thinking…" : "";
  document.body.classList.toggle("busy", value);
}
async function send(text, retryId) {
  if (busy || !text.trim()) return;
  if (new TextEncoder().encode(text).length > 12000) {
    notice("This message is too long. Shorten it before sending.");
    return;
  }
  setBusy(true);
  notice("");
  if (!retryId) {
    try {
      await api.saveDraft("");
    } catch (e) {
      notice(e.message);
      setBusy(false);
      return;
    }
    $("message").value = "";
    resizeInput();
  }
  // IPC writes before network work; show the submitted message immediately.
  if (!retryId) {
    rows.push({
      id: "pending",
      role: "user",
      content: text,
      created: new Date().toISOString(),
      status: "pending",
    });
    render();
  }
  const main = document.querySelector("main");
  main.scrollTo({ top: main.scrollHeight, behavior: "instant" });
  try {
    const result = await api.send({ text, retryId });
    notice(result.memoryWarning);
  } catch (e) {
    notice(e.message);
  } finally {
    setBusy(false);
    await refresh(true);
    $("message").focus();
  }
}
async function showSource(id) {
  const source = await api.source(id);
  if (!source) throw new Error("Source is unavailable.");
  sourceId = source.id;
  $("source-title").textContent =
    `${source.role === "user" ? "You" : "OSCAR"} · #${source.id}`;
  $("source-content").textContent = source.content;
  $("save-memory").hidden = source.role !== "user";
  $("source-dialog").showModal();
}
async function showMemories() {
  const memories = await api.memories();
  $("memory-list").replaceChildren();
  $("memory-edit").hidden = true;
  $("memory-notice").textContent = busy
    ? "Wait for the current response to change memory."
    : memories.length
      ? ""
      : "No personal memories yet.";
  for (const memory of memories) {
    const item = document.createElement("div");
    item.className = "memory-item";
    const p = document.createElement("p");
    p.textContent = memory.text;
    const small = document.createElement("small");
    small.textContent = "From your statement · " + date(memory.created);
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      button("Source #" + memory.source, () => showSource(memory.source)),
      button("Correct", () => {
        editId = memory.id;
        $("memory-text").value = memory.text;
        $("memory-edit").hidden = false;
        $("memory-text").focus();
      }),
      button("Forget", () =>
        confirm(
          "Forget this memory?",
          "OSCAR will stop retrieving this memory and its sources. The original conversation stays readable.",
          async () => {
            await api.forget(memory.id);
            await showMemories();
            await refresh();
          },
        ),
      ),
    );
    if (busy)
      for (const action of [...actions.children].slice(1))
        action.disabled = true;
    item.append(p, small, actions);
    $("memory-list").append(item);
  }
}
function resizeInput() {
  $("message").style.height = "auto";
  $("message").style.height = Math.min($("message").scrollHeight, 180) + "px";
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
  const main = document.querySelector("main"),
    height = main.scrollHeight;
  const earlier = await api.history({ before: rows[0].id });
  rows = [...earlier, ...rows];
  render();
  if (earlier.length < 50) $("older").hidden = true;
  main.scrollTop = main.scrollHeight - height;
};
$("search-open").onclick = () => {
  searchReturnTop = document.querySelector("main").scrollTop;
  $("search-panel").hidden = false;
  $("search").focus();
  document.querySelector("main").scrollTo({ top: 0, behavior: "instant" });
};
$("search-close").onclick = () => {
  $("search-panel").hidden = true;
  $("search-open").focus();
  document
    .querySelector("main")
    .scrollTo({ top: searchReturnTop, behavior: "instant" });
};
$("search-form").onsubmit = async (e) => {
  e.preventDefault();
  const results = await api.history({ search: $("search").value });
  $("results").replaceChildren();
  $("search-status").textContent = results.length
    ? `${results.length} results${results.length === 50 ? " · first 50, narrow your search" : ""}`
    : "No matching messages.";
  for (const row of results) {
    const excerpt = document.createElement("div");
    excerpt.innerHTML = DOMPurify.sanitize(marked.parse(row.content));
    const b = button(
      excerpt.textContent.slice(0, 240),
      () => showSource(row.id),
      "result",
    );
    const small = document.createElement("small");
    small.textContent = `${row.role === "user" ? "You" : "OSCAR"} · ${date(row.created)} · #${row.id}`;
    b.prepend(small);
    $("results").append(b);
  }
};
$("memory-open").onclick = async () => {
  await showMemories();
  $("memory-dialog").showModal();
};
$("memory-close").onclick = () => $("memory-dialog").close();
$("source-close").onclick = () => $("source-dialog").close();
$("memory-edit").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api.edit({ id: editId, text: $("memory-text").value });
    await showMemories();
    await refresh();
  } catch (err) {
    $("memory-notice").textContent = err.message;
  }
};
$("edit-cancel").onclick = () => ($("memory-edit").hidden = true);
$("save-memory").onclick = async () => {
  const source = await api.source(sourceId);
  try {
    await api.edit({ source: sourceId, text: source.content.slice(0, 600) });
    $("source-dialog").close();
    await refresh();
    if ($("memory-dialog").open) await showMemories();
  } catch (e) {
    notice(e.message);
  }
};
$("context-clear").onclick = () =>
  confirm(
    "Reset working context?",
    "Keep the full conversation and personal memory. OSCAR can still retrieve relevant earlier messages.",
    async () => {
      await api.clear();
      notice("Working context reset. History and memory kept.");
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
(async () => {
  try {
    const status = await api.status();
    $("model").textContent = "Groq · " + status.model;
    if (!status.configured) notice("No Groq key found in local configuration.");
    $("message").value = await api.draft();
    resizeInput();
    await refresh(true);
    $("message").focus();
  } catch (e) {
    notice(e.message);
  }
})();
