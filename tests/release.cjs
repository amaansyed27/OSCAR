const desktop = require("./desktop-driver.cjs");
const { Store } = require("./fixtures.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.join(__dirname, ".."),
  data = path.join(root, ".oscar", "release-" + Date.now()),
  out = path.join(root, ".oscar", "tauri-evidence");
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
              "src-tauri/target/release/bundle/nsis/OSCAR_0.2.0_x64-setup.exe",
            ),
          ).size,
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
