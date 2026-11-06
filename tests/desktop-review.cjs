const desktop = require("./desktop-driver.cjs");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.join(__dirname, "..");
const receipt = JSON.parse(
  fs.readFileSync(path.join(root, ".oscar/revision-evidence/acceptance.json")),
);
const data = receipt.at(-1).data,
  evidence = path.join(root, ".oscar/revision-evidence");
let app, p;
const results = process.env.OSCAR_REVIEW_RESUME
  ? JSON.parse(fs.readFileSync(path.join(evidence, "review-failed.json")))
  : [];
async function launch() {
  const env = { ...process.env, OSCAR_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await desktop.launch({ args: [root], env });
  p = await app.firstWindow();
  p.on("pageerror", (e) => results.push({ uiError: e.message }));
  await p.locator("html[data-theme]").waitFor();
}
async function ask(text) {
  await p.locator("[data-page=conversation]").click();
  await p.locator("#message").fill(text);
  await p.locator("#send").click();
  await p.locator("#stop").waitFor({ state: "visible" });
  await p.locator("#stop").waitFor({ state: "hidden", timeout: 120000 });
  let error = await p.locator("#notice").textContent();
  if (/rate limit/.test(error)) {
    results.push({ providerFailure: error });
    await new Promise((r) =>
      setTimeout(
        r,
        Math.max(30, Number(error.match(/(\d+) seconds/)?.[1]) || 60) * 1000,
      ),
    );
    await p.getByRole("button", { name: "Retry", exact: true }).last().click();
    await p.locator("#stop").waitFor({ state: "visible" });
    await p.locator("#stop").waitFor({ state: "hidden", timeout: 120000 });
    error = await p.locator("#notice").textContent();
  }
  assert.equal(error, "");
  const answer = await p.locator(".assistant .body").last().innerText();
  results.push({ user: text, answer });
  return answer;
}
(async () => {
  try {
    await launch();
    if (!process.env.OSCAR_REVIEW_RESUME) {
      await p.locator("[data-page=settings]").click();
      await p.locator('[data-settings="model"]').click();
      await p.locator("#model").selectOption("openai/gpt-oss-120b");
      assert.match(
        await ask("Reply with exactly: model selection works."),
        /model selection works/i,
      );
      await p.locator("[data-page=settings]").click();
      await p.locator('[data-settings="model"]').click();
      await p.locator("#model").selectOption("openai/gpt-oss-20b");
      await ask(
        "Remember that I prefer concise responses with practical examples.",
      );
      const until = Date.now() + 120000;
      let learned = false;
      while (Date.now() < until) {
        learned = (await p.evaluate(() => window.oscar.memories())).some((m) =>
          /concise/i.test(m.text),
        );
        if (learned) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      assert(learned, "second representative personal memory committed");
      await p.evaluate(() => {
        window.observedDelta = "";
        window.oscar.onEvent((e) => {
          if (e.type === "delta") window.observedDelta += e.chunk;
        });
      });
      await p
        .locator("#message")
        .fill(
          "Write 200 different desktop app test scenarios. Start each line with Item and the number, then a sentence.",
        );
      await p.locator("#send").click();
      await p.waitForFunction(
        () =>
          window.observedDelta.length > 60 ||
          !document.getElementById("notice").hidden,
        {},
        { timeout: 120000 },
      );
      const error = await p.locator("#notice").textContent();
      if (error) {
        results.push({ providerFailure: error });
        assert(/rate limit/.test(error), error);
        await new Promise((r) =>
          setTimeout(
            r,
            Math.max(30, Number(error.match(/(\d+) seconds/)?.[1]) || 60) *
              1000,
          ),
        );
        await p
          .getByRole("button", { name: "Retry", exact: true })
          .last()
          .click();
        await p.waitForFunction(
          () => window.observedDelta.length > 60,
          {},
          { timeout: 120000 },
        );
      }
      await p.locator("#stop").click();
      await p.locator("#stop").waitFor({ state: "hidden" });
      let records = await p.evaluate(() => window.oscar.history());
      assert.equal(records.at(-1).status, "interrupted");
      assert(records.at(-1).content.length > 0);
      results.push({ cancelledPartialChars: records.at(-1).content.length });
      await app.close();
      await launch();
      records = await p.evaluate(() => window.oscar.history());
      assert.equal(records.at(-1).status, "interrupted");
      assert(records.at(-1).content.length > 0);
      await ask(
        "Explain how to display untrusted text safely in a web page. Include a compact textContent versus innerHTML table, three short bullet points, and a tiny JavaScript example. Under 140 words.",
      );
      assert((await p.locator(".assistant .body table").count()) > 0);
      assert((await p.locator(".assistant .body pre").count()) > 0);
      // Reading position remains stable while opening and closing other pages.
      await p.locator("#chat-scroll").evaluate((e) => (e.scrollTop = 100));
      const old = await p.locator("#chat-scroll").evaluate((e) => e.scrollTop);
      await p.locator("[data-page=settings]").click();
      await p.locator("[data-page=conversation]").click();
      assert.equal(
        await p.locator("#chat-scroll").evaluate((e) => e.scrollTop),
        old,
      );
      await p
        .locator("#chat-scroll")
        .evaluate((e) => (e.scrollTop = e.scrollHeight));
      await p.setViewportSize({ width: 1536, height: 900 });
      for (const theme of ["light", "dark"]) {
        await p.locator("[data-page=settings]").click();
        await p.locator('[data-settings="appearance"]').click();
        await p.locator("#theme").selectOption(theme);
        await p.waitForFunction(
          (theme) => document.documentElement.dataset.theme === theme,
          theme,
        );
        for (const name of ["conversation", "memories", "settings"]) {
          await p.locator(`[data-page=${name}]`).click();
          if (name === "memories") {
            await p.locator("#personal-tab").click();
            await p.locator(".memory-item").first().click();
          }
          await p.mouse.move(1500, 35);
          await p.evaluate(() => document.fonts.ready);
          await p.screenshot({
            animations: "disabled",
            path: path.join(evidence, name + "-" + theme + ".png"),
          });
        }
      }
      for (const name of ["conversation", "memories", "settings"]) {
        await p.locator(`[data-page=${name}]`).click();
        await p.setViewportSize({ width: 760, height: 700 });
        await p.screenshot({ path: path.join(evidence, name + "-small.png") });
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      }
    }
    await p.locator("[data-page=settings]").click();
    await p.locator('[data-settings="appearance"]').click();
    await p.locator("#theme").selectOption("dark");
    await app.close();
    await launch();
    assert.equal(
      await p.evaluate(() => document.documentElement.dataset.theme),
      "dark",
    );
    assert.equal(
      (await p.evaluate(() => window.oscar.settings())).model,
      "openai/gpt-oss-20b",
    );
    await p.locator("[data-page=memories]").click();
    await p.locator("#history-tab").click();
    await p.locator("#search").fill("Ordinary");
    await p.locator("#search-form button").first().click();
    await p.locator(".result").first().waitFor();
    await p.locator("#more-results").click();
    await p.locator(".result").nth(99).waitFor();
    assert.equal(await p.locator(".result").count(), 100);
    // A busy SQLite retrieval runs in a worker while the renderer continues to paint frames.
    const frames = await p.evaluate(async () => {
      const search = window.oscar.history({
        search: "notes planning",
        sort: "relevance",
      });
      let count = 0;
      await Promise.all([
        search,
        new Promise((resolve) => {
          const tick = () => {
            count++;
            if (count === 10) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      ]);
      return count;
    });
    assert.equal(frames, 10);
    assert((await p.locator(".message").count()) <= 200);
    await p.locator("[data-page=settings]").click();
    await p.locator('[data-settings="appearance"]').click();
    await p.locator("#theme").selectOption("system");
    await p.emulateMedia({ colorScheme: "light" });
    await p.waitForFunction(
      () => document.documentElement.dataset.theme === "light",
    );
    await p.emulateMedia({ colorScheme: "dark" });
    await p.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await p.emulateMedia({ colorScheme: "no-preference" });
    await p.locator('[data-settings="appearance"]').click();
    await p.locator("#theme").selectOption("dark");
    results.push({
      latestMetrics: (await p.evaluate(() => window.oscar.diagnostics())).slice(
        0,
        5,
      ),
      data,
      evidence,
    });
    assert(!results.some((x) => x.uiError));
    fs.writeFileSync(
      path.join(evidence, "review.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(JSON.stringify(results, null, 2));
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  fs.writeFileSync(
    path.join(evidence, "review-failed.json"),
    JSON.stringify(results, null, 2),
  );
  process.exitCode = 1;
});
