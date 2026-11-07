// Actual isolated Tauri/WebView2 integration. Synthetic replies are transport fixtures only.
const desktop = require("./desktop-driver.cjs"),
  { Store } = require("./fixtures.cjs"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const root = path.join(__dirname, ".."),
  data = path.join(root, ".oscar", "slice02-integration-" + Date.now()),
  out = path.join(root, ".oscar/slice02-evidence");
fs.mkdirSync(out, { recursive: true });
const components = [
  {
    type: "table",
    title: "Project comparison",
    columns: ["Project", "Budget"],
    rows: [
      ["Juniper", 4200],
      ["Cedar", 900],
    ],
  },
  {
    type: "chart",
    title: "Budget movement",
    data: [
      { label: "Juniper", value: 4200 },
      { label: "Cedar", value: -900 },
    ],
  },
  { type: "timeline", items: [{ date: "18 Dec", text: "Juniper launch" }] },
  {
    type: "calculator",
    operation: "sum",
    inputs: [
      { label: "A", value: 20 },
      { label: "B", value: 22 },
    ],
  },
  {
    type: "checklist",
    title: "Review",
    items: ["Inspect sources", "Confirm launch"],
  },
  { type: "slider", min: 0, max: 100, value: 30, label: "Progress" },
];
const s = new Store(path.join(data, "oscar.sqlite"));
s.set("learn", false);
s.set("search_mode", "off");
s.add("user", "Compare the Juniper project plans.");
const rich = s.add(
  "assistant",
  "## Juniper review\n\nFixture data for interface verification. $E=mc^2$\n\n```javascript\nconst launch = 18;\n```\n\n```mermaid\nflowchart LR\n A[Review] --> B[Launch]\n```\n\n" +
    components
      .map(
        (v) => "```oscar-ui\n" + JSON.stringify({ version: 1, ...v }) + "\n```",
      )
      .join("\n\n") +
    '\n\n```oscar-ui\n{"version":1,"type":"javascript","code":"window.__injected=true"}\n```',
);
s.close();
let requests = [],
  fail = true,
  app,
  p;
const errors = [];
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const b of req) body += b;
  requests.push(JSON.parse(body));
  if (fail) {
    req.socket.destroy();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const text of ["Connection ", "restored."]) {
    res.write(
      "data: " +
        JSON.stringify({ choices: [{ delta: { content: text } }] }) +
        "\n\n",
    );
    await new Promise((r) => setTimeout(r, 90));
  }
  res.end(
    "data: " +
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 5 },
      }) +
      "\n\ndata: [DONE]\n\n",
  );
});
async function launch() {
  app = await desktop.launch({
    env: {
      ...process.env,
      OSCAR_DATA_DIR: data,
      OSCAR_GROQ_ENDPOINT: `http://127.0.0.1:${server.address().port}/v1/chat/completions`,
    },
  });
  p = await app.firstWindow();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.locator("html[data-theme]").waitFor();
  await p.setViewportSize({ width: 1536, height: 900 });
}
async function api(name, arg) {
  return p.evaluate(([n, a]) => window.oscar[n](a), [name, arg]);
}
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await launch();
    await p.locator(".rich-component").nth(5).waitFor();
    await p.locator(".diagram svg").waitFor();
    assert(await p.locator(".katex").count());
    assert(await p.locator(".copy-code").count());
    assert.equal(await p.evaluate(() => window.__injected), undefined);
    assert.match(
      await p.locator(".body").last().innerText(),
      /original data shown/,
    );
    assert.equal(await p.locator("#notice").innerText(), "");
    const table = p
      .locator(".rich-component")
      .filter({ hasText: "Project comparison" });
    await table.locator("input").fill("Cedar");
    assert.equal(await table.locator("tbody tr").count(), 1);
    const check = p.locator(".rich-component input[type=checkbox]").first();
    await check.check();
    await p.waitForTimeout(300);
    assert.equal(
      (
        await api("componentState", { message: rich, component: "component-5" })
      )["0"],
      true,
    );
    const imported = [];
    for (const name of [
      "project.txt",
      "project.docx",
      "project.xlsx",
      "project.pptx",
      "project.pdf",
      "square.png",
    ]) {
      const result = await api("importAttachment", {
        name,
        data: fs
          .readFileSync(path.join(root, "tests/attachments", name))
          .toString("base64"),
      });
      imported.push(result);
      const preview = await api("attachmentPreview", result.id);
      if (name.endsWith(".png")) assert(preview.image);
      else assert.match(preview.text, /Juniper/);
    }
    await assert.rejects(
      api("importAttachment", {
        name: "unsafe.docx",
        data: fs
          .readFileSync(path.join(root, "tests/attachments/unsafe.docx"))
          .toString("base64"),
      }),
      /Unsafe/,
    );
    await assert.rejects(
      api("importAttachment", {
        name: "bad.exe",
        data: Buffer.from("test").toString("base64"),
      }),
      /Unsupported/,
    );
    await p
      .locator("#file-input")
      .setInputFiles(path.join(root, "tests/attachments/project.pdf"));
    await p
      .getByRole("button", { name: "Remove project.pdf", exact: true })
      .waitFor();
    await p.evaluate(() => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(
        new File(["Dropped fixture"], "dropped.txt", { type: "text/plain" }),
      );
      document
        .getElementById("page-conversation")
        .dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));
    });
    await p
      .getByRole("button", { name: "Remove dropped.txt", exact: true })
      .waitFor();
    await p.evaluate(() => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "Large text fixture. ".repeat(1500));
      document
        .getElementById("message")
        .dispatchEvent(
          new ClipboardEvent("paste", { bubbles: true, clipboardData }),
        );
    });
    await p
      .getByRole("button", { name: "Remove pasted-text.txt", exact: true })
      .waitFor();
    await p
      .getByRole("button", { name: "Remove dropped.txt", exact: true })
      .click();
    assert(
      await p
        .getByRole("button", { name: "Remove dropped.txt", exact: true })
        .isHidden(),
    );
    await api(
      "saveDraftAttachments",
      imported.slice(0, 2).map((f) => f.id),
    );
    await api("setSettings", {
      personalization: {
        name: "Mira",
        style: "Analytical",
        length: "Detailed",
        instructions: "Explain assumptions.",
      },
    });
    const providers = await api("cloudProviders");
    assert(providers.length >= 32);
    const custom = await api("saveProvider", {
      name: "Contract fixture",
      protocol: "openai",
      base: "https://example.com/v1",
      auth: "bearer",
    });
    await api("saveCredential", {
      provider: custom.id,
      nickname: "Test only",
      secret: "synthetic-never-a-real-key",
    });
    assert(
      !JSON.stringify(await api("cloudProviders")).includes("synthetic-never"),
    );
    for (const theme of ["light", "dark"]) {
      await api("setSettings", { theme });
      await p.reload();
      await p.locator("html[data-theme=" + theme + "]").waitFor();
      await p.locator(".rich-component").nth(5).waitFor();
      await p.screenshot({
        path: path.join(out, `rich-${theme}.png`),
        animations: "disabled",
      });
      await p.locator("[data-page=settings]").click();
      await p.locator("[data-settings=providers]").click();
      await p.screenshot({
        path: path.join(out, `providers-${theme}.png`),
        animations: "disabled",
      });
      await p.locator("[data-settings=personalization]").click();
      await p.screenshot({
        path: path.join(out, `personalization-${theme}.png`),
        animations: "disabled",
      });
      await p.locator("[data-page=conversation]").click();
    }
    await app.close();
    await launch();
    assert.equal((await api("settings")).personalization.name, "Mira");
    assert.equal((await api("draftAttachments")).length, 2);
    assert.equal(
      await p
        .locator(".rich-component input[type=checkbox]")
        .first()
        .isChecked(),
      true,
    );
    await p.setViewportSize({ width: 760, height: 700 });
    await p.locator("[data-page=settings]").click();
    await p.locator("[data-settings=providers]").click();
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await p.screenshot({
      path: path.join(out, "providers-small.png"),
      animations: "disabled",
    });
    await p.locator("[data-page=conversation]").click();
    await api("saveDraftAttachments", []);
    await p.reload();
    await p.locator("html[data-theme]").waitFor();
    await p
      .locator("#message")
      .fill("Reply with exactly: Connection restored.");
    await p.locator("#send").click();
    await p
      .getByRole("button", { name: "Retry", exact: true })
      .waitFor({ timeout: 30000 });
    const before = (await api("history")).filter(
      (m) => m.role === "user",
    ).length;
    fail = false;
    await p.getByRole("button", { name: "Retry", exact: true }).click();
    await p.locator("#stop").waitFor({ state: "hidden", timeout: 30000 });
    assert.match(
      await p.locator(".assistant .body").last().innerText(),
      /Connection restored/,
    );
    assert.equal(
      (await api("history")).filter((m) => m.role === "user").length,
      before,
    );
    const boundary = await api("clearChat");
    assert(boundary.boundary > rich);
    assert.equal((await api("history", { visible: true })).length, 0);
    assert((await api("history")).length >= 4);
    assert(
      requests
        .at(-1)
        .messages.some((m) => JSON.stringify(m).includes("Juniper")),
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    const receipt = {
      passed: true,
      files: imported.map((f) => ({ name: f.name, bytes: f.bytes })),
      rendererErrors: errors,
      transportRequests: requests.length,
      checks: [
        "native parser job isolation",
        "original attachments",
        "file picker, drop event, large-text paste and chip removal",
        "macro/path rejection",
        "rich native state restart",
        "math/mermaid/highlight",
        "no arbitrary component JS",
        "personalization restart",
        "provider secure CRUD",
        "both themes",
        "small window",
        "network retry no duplicate",
        "display boundary retains archive",
      ],
    };
    fs.writeFileSync(
      path.join(out, "integration.json"),
      JSON.stringify(receipt, null, 2),
    );
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    await app?.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
