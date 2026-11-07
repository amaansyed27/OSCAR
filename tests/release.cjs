const desktop = require("./desktop-driver.cjs");
const { Store } = require("./fixtures.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.join(__dirname, ".."),
  data = path.join(root, ".oscar", "release-" + Date.now()),
  out = path.join(root, ".oscar", "slice02-evidence", "release");
fs.mkdirSync(out, { recursive: true });
let app;
(async () => {
  try {
    const s = new Store(path.join(data, "oscar.sqlite"));
    s.add("user", "I prefer concise answers with practical examples.");
    s.add(
      "assistant",
      "I can keep answers focused and use examples when useful.",
    );
    s.close();
    const launch = async () => {
      app = await desktop.launch({
        env: { ...process.env, OSCAR_DATA_DIR: data },
        executablePath: path.join(
          root,
          "src-tauri/target/release/oscar-desktop.exe",
        ),
      });
      const p = await app.firstWindow();
      await p.locator("html[data-theme]").waitFor();
      return p;
    };
    let p = await launch();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    assert.equal(await p.evaluate(() => typeof window.require), "undefined");
    assert((await p.evaluate(() => window.oscar.status())).configured);
    const api = (name, arg) =>
      p.evaluate(([n, a]) => window.oscar[n](a), [name, arg]);
    await api("discoverModels", { provider: "openrouter" });
    const models = await api("cloudModels", { provider: "openrouter" });
    const free = models.find(
      (m) => m.free && m.model === "nvidia/nemotron-3.5-super-vl:free",
    );
    assert(
      free,
      "The release fixture needs its OpenRouter free model to be currently listed at zero price.",
    );
    await api("registerModel", {
      provider: "openrouter",
      model: free.model,
      output: 2048,
    });
    await api("toggleModel", { id: free.id, enabled: true });
    const custom = await api("saveProvider", {
      name: "Release routing fixture",
      protocol: "openai",
      base: "https://example.com/v1",
      auth: "none",
    });
    const unpriced = await api("registerModel", {
      provider: custom.id,
      model: "unpriced",
      context: 32768,
      output: 1024,
    });
    await api("setSettings", {
      model: unpriced.id,
      waterfall: [{ model: free.id }],
      spending_ceiling: "0",
      search_mode: "off",
      learn: false,
    });
    await p.evaluate(() =>
      window.oscar.edit({
        source: 1,
        text: "I prefer concise answers with practical examples.",
      }),
    );
    await p.evaluate(() => {
      window.releaseDeltas = 0;
      window.oscar.onEvent((e) => {
        if (e.type === "delta") window.releaseDeltas++;
      });
    });
    await p
      .locator("#message")
      .fill("Reply with exactly: native release works.");
    await p.locator("#send").click();
    await p.locator("#stop").waitFor();
    await p.locator("#stop").waitFor({ state: "hidden", timeout: 120000 });
    assert.match(
      await p.locator(".assistant .body").last().innerText(),
      /native release works/i,
    );
    assert(await p.evaluate(() => window.releaseDeltas > 0));
    const completed = (await api("history"))
      .filter((m) => m.role === "assistant")
      .at(-1);
    const { usage, route } = await api("responseDetails", completed.id);
    assert.equal(usage.model, free.model);
    assert.equal(usage.cost, 0);
    assert.deepEqual(route, [unpriced.id, free.id]);
    await api("setSettings", { model: "auto:free", waterfall: [] });
    const count = await p.evaluate(
      async () => (await window.oscar.history()).length,
    );
    await app.close();
    p = await launch();
    assert.equal(
      await p.evaluate(async () => (await window.oscar.history()).length),
      count,
    );
    await p.setViewportSize({ width: 1536, height: 900 });
    for (const theme of ["light", "dark"]) {
      await p.locator("[data-page=settings]").click();
      await p.locator("[data-settings=appearance]").click();
      await p.locator("#theme").selectOption(theme);
      await p.waitForFunction(
        (t) => document.documentElement.dataset.theme === t,
        theme,
      );
      await p.evaluate(() => document.fonts.ready);
      assert(await p.evaluate(() => document.fonts.check("15px Neuhade")));
      for (const page of ["conversation", "memories", "settings"]) {
        await p.locator(`[data-page=${page}]`).click();
        if (page === "memories") {
          await p.locator("#personal-tab").click();
          await p.locator(".memory-item").first().waitFor();
        }
        await p.screenshot({
          path: path.join(out, `${page}-${theme}.png`),
          animations: "disabled",
        });
      }
    }
    assert.equal(errors.length, 0);
    fs.writeFileSync(
      path.join(out, "release.json"),
      JSON.stringify(
        {
          checks: [
            "native release executable",
            "real model stream",
            "manual waterfall skips unpriced route under a zero spending ceiling",
            "restart persistence",
            "source-backed memory",
            "local fonts",
            "six light/dark screenshots",
            "no renderer Node API",
          ],
          data,
          exeBytes: fs.statSync(
            path.join(root, "src-tauri/target/release/oscar-desktop.exe"),
          ).size,
          installerBytes: fs.statSync(
            path.join(
              root,
              "src-tauri/target/release/bundle/nsis/OSCAR_0.3.0_x64-setup.exe",
            ),
          ).size,
          usage: {
            model: usage.model,
            promptTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            cost: usage.cost,
          },
        },
        null,
        2,
      ),
    );
    console.log(
      "Native release: real streamed reply, restart, memory, fonts and six theme screenshots passed.",
    );
  } finally {
    await app?.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
