const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.join(__dirname, ".."),
  data =
    process.env.OSCAR_TEST_DATA ||
    path.join(root, ".oscar", "revision-acceptance-" + Date.now()),
  evidence = path.join(root, ".oscar", "revision-evidence");
fs.mkdirSync(evidence, { recursive: true });
let app, page;
const log = [];
async function launch() {
  const env = { ...process.env, OSCAR_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [root], env });
  page = await app.firstWindow();
  page.on("pageerror", (e) => log.push({ uiError: e.message }));
  await page.locator("html[data-theme]").waitFor();
}
async function ask(text, retryId) {
  await page.locator("[data-page=conversation]").click();
  if (retryId) {
    const prior = await page.evaluate(() => window.oscar.history());
    const user = prior.find((m) => m.id === retryId);
    await page.evaluate(
      ({ text, id }) =>
        window.oscar.send({ text, retryId: id }).catch(() => {}),
      { text: user.content, id: retryId },
    );
  } else {
    await page.locator("#message").fill(text);
    await page.locator("#send").click();
  }
  if (!retryId) {
    await page.locator("#stop").waitFor({ state: "visible" });
    await page.locator("#stop").waitFor({ state: "hidden", timeout: 120000 });
  }
  let notice = await page.locator("#notice").textContent();
  if (/Groq rate limit/.test(notice)) {
    log.push({ providerFailure: notice, user: text });
    const seconds = Number(notice.match(/(\d+) seconds/)?.[1] || 20);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(seconds + 2, 60) * 1000),
    );
    await page
      .getByRole("button", { name: "Retry", exact: true })
      .last()
      .click();
    await page.locator("#stop").waitFor({ state: "visible" });
    await page.locator("#stop").waitFor({ state: "hidden", timeout: 120000 });
    notice = await page.locator("#notice").textContent();
  }
  const answer = await page.locator(".assistant .body").last().innerText();
  log.push({ user: text, answer, notice });
  assert(!notice, "no foreground failure: " + notice);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return answer;
}
async function memoryContains(term) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const memories = await page.evaluate(() => window.oscar.memories());
    if (memories.some((m) => m.text.toLowerCase().includes(term)))
      return memories;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Personal memory did not commit: " + term);
}
(async () => {
  try {
    if (!process.env.OSCAR_TEST_DATA) {
      await launch();
      await ask(
        "For this conversation exercise the lighthouse archive code is MARIGOLD-73. Keep this in history only; do not save it as personal memory.",
      );
      // Observe actual progressive stream deltas in the sandboxed renderer.
      await page.evaluate(() => {
        window.streamDeltas = 0;
        window.oscar.onEvent((e) => {
          if (e.type === "delta") window.streamDeltas++;
        });
      });
      await ask("Remember that I prefer jasmine tea while working.");
      assert(
        (await page.evaluate(() => window.streamDeltas)) > 1,
        "multiple actual stream deltas reached the UI",
      );
      await memoryContains("jasmine");
      await ask("Remember that my OSCAR prototype deadline is December 12.");
      await memoryContains("december");
      await app.close();
      await launch();
      assert((await page.locator(".user").count()) >= 3);
      assert.match(
        await ask("Which beverage would suit me while I code?"),
        /jasmine/i,
      );
      await ask(
        "Correction: I now prefer peppermint tea while working instead of jasmine tea.",
      );
      await memoryContains("peppermint");
      const corrected = await ask("Which beverage do I prefer for work now?");
      assert.match(corrected, /peppermint/i);
      assert.match(
        await ask("Which tea did I prefer previously, before the correction?"),
        /jasmine/i,
      );
      await page.locator("[data-page=memories]").click();
      await page.locator("#search").fill("peppermint");
      await page.locator("#search-form button").first().click();
      await page.locator(".memory-item").first().click();
      await page.getByRole("button", { name: "Correct", exact: true }).click();
      await page
        .locator("#memory-text")
        .fill("I prefer oolong tea while working.");
      await page.locator("#memory-edit button").last().click();
      await page.locator("#detail").waitFor({ state: "hidden" });
      assert.match(
        await ask("Which beverage should I have while coding?"),
        /oolong/i,
      );
      await page.locator("[data-page=memories]").click();
      await page.locator("#search").fill("oolong");
      await page.locator("#search-form button").first().click();
      await page.locator(".memory-item").first().click();
      await page.getByRole("button", { name: "Forget", exact: true }).click();
      await page.locator("#confirm-yes").click();
      await page.locator("#detail").waitFor({ state: "hidden" });
      await app.close();
      await launch();
      const forgotten = await ask("What beverage do I prefer at work?");
      assert(
        !/jasmine|peppermint|oolong/i.test(forgotten),
        "forgotten value is absent",
      );
      assert.match(
        await ask("When is my OSCAR prototype due?"),
        /December\s+12/i,
        "unrelated memory survives forgetting",
      );
      await ask(
        "For this exercise, I need to finish OSCAR keyboard navigation before the prototype is ready. This is unfinished work. Keep it in history only, not personal memory.",
      );
      await app.close();
      const { Store } = require("../src/store.cjs");
      const s = new Store(path.join(data, "oscar.sqlite"));
      s.db.exec("BEGIN");
      for (let i = 0; i < 10000; i++)
        s.add(
          i % 2 ? "assistant" : "user",
          "Ordinary intervening message " + i + " about notes and planning.",
        );
      s.db.exec("COMMIT");
      s.compact(true);
      s.clearContext();
      s.set("last_active", Date.now() - 121 * 60000);
      s.close();
    }
    await launch();
    assert.match(
      await ask("What was the lighthouse archive code I mentioned earlier?"),
      /MARIGOLD[-\u2010-\u2015]73/i,
    );
    assert.match(
      await ask("What work is still unfinished for the prototype?"),
      /keyboard/i,
    );
    await page.locator("[data-page=memories]").click();
    await page.locator("#history-tab").click();
    await page.locator("#search").fill("lighthouse");
    await page.locator("#search-form button").first().click();
    await page.locator(".result").first().click();
    await page
      .getByRole("button", { name: "Open in conversation", exact: true })
      .click();
    await page.locator(".jump-highlight").waitFor();
    assert(
      (await page.locator(".message").count()) > 1,
      "surrounding context loaded",
    );
    await page.locator("#present").click();
    // Theme controls appear exclusively in Settings; record all six real application views.
    await page.setViewportSize({ width: 1536, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.locator("[data-page=settings]").click();
      await page.locator('[data-settings="appearance"]').click();
      await page.locator("#theme").selectOption(theme);
      await page.waitForFunction(
        (theme) => document.documentElement.dataset.theme === theme,
        theme,
      );
      for (const name of ["conversation", "memories", "settings"]) {
        await page.locator(`[data-page=${name}]`).click();
        if (name === "memories") {
          await page.locator("#personal-tab").click();
          await page.locator(".memory-item").first().waitFor();
        }
        await page.screenshot({
          animations: "disabled",
          path: path.join(evidence, name + "-" + theme + ".png"),
        });
      }
    }
    await page.locator("[data-page=conversation]").click();
    await page.setViewportSize({ width: 760, height: 700 });
    await page.screenshot({
      animations: "disabled",
      path: path.join(evidence, "conversation-small.png"),
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "narrow layout does not overflow",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator("#thinking span")
        .evaluate((e) => getComputedStyle(e).animationName),
      "none",
    );
    const metrics = await page.evaluate(() => window.oscar.diagnostics());
    const calls = await page.evaluate(
      async (metrics) =>
        Promise.all(
          metrics.map(async (metric) => ({
            metric,
            text: (await window.oscar.source(metric.user)).content,
          })),
        ),
      metrics,
    );
    for (const { metric, text } of calls)
      assert.equal(
        metric.foreground_requests,
        /^Correction:/.test(text) ? 2 : 1,
        "normal turns use exactly one foreground request",
      );
    assert(metrics.filter((m) => m.foreground_requests === 1).length >= 10);
    log.push({ metrics, data, evidence });
    assert(!log.some((x) => x.uiError), "no renderer errors");
    fs.writeFileSync(
      path.join(evidence, "acceptance.json"),
      JSON.stringify(log, null, 2),
    );
    console.log(JSON.stringify(log, null, 2));
  } catch (e) {
    console.error(e);
    fs.writeFileSync(
      path.join(evidence, "failed.json"),
      JSON.stringify(log, null, 2),
    );
    process.exitCode = 1;
  } finally {
    if (app) await app.close();
  }
})();
