const { _electron: electron } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const root = path.join(__dirname, "..");
const data = path.join(root, ".oscar", "desktop-acceptance-" + Date.now());
fs.mkdirSync(data, { recursive: true });
const evidence = path.join(root, ".oscar", "evidence");
fs.mkdirSync(evidence, { recursive: true });
let app, page;
const log = [];
async function launch() {
  const env = { ...process.env, OSCAR_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [root], env });
  page = await app.firstWindow();
  page.on("pageerror", (e) => log.push({ uiError: e.message }));
  await page.locator("#model").filter({ hasText: "Groq" }).waitFor();
}
async function ask(text) {
  await page.locator("#message").fill(text);
  await page.locator("#send").click();
  await page.locator("#thinking").waitFor({ state: "visible" });
  await page.locator("#thinking").waitFor({ state: "hidden", timeout: 120000 });
  const notice = await page.locator("#notice").textContent();
  const answer = await page
    .locator(".message.assistant .body")
    .last()
    .innerText();
  log.push({ user: text, answer, notice });
  if (notice) throw new Error(notice);
  return answer;
}
(async () => {
  try {
    await launch();
    await page.screenshot({ path: path.join(evidence, "empty.png") });
    await ask(
      "For this conversation exercise, the lighthouse archive code is MARIGOLD-73. Keep it in chat history only; do not save it as personal memory.",
    );
    assert.equal(
      (await page.evaluate(() => window.oscar.memories())).length,
      0,
      "history-only statement is not personal memory",
    );
    await ask(
      "For this acceptance check, remember that I prefer jasmine tea when working.",
    );
    let memories = await page.evaluate(() => window.oscar.memories());
    assert(
      memories.some((m) => /jasmine/i.test(m.text)),
      "preference extracted",
    );
    await app.close();
    await launch();
    assert(
      (await page.locator(".message.user").count()) >= 1,
      "history restored",
    );
    const resumed = await ask("What drink do I prefer when working?");
    assert.match(resumed, /jasmine/i);
    await ask(
      "Correction: I now prefer peppermint tea when working, instead of jasmine tea.",
    );
    memories = await page.evaluate(() => window.oscar.memories());
    assert.equal(
      memories.filter((m) => /tea/i.test(m.text)).length,
      1,
      "correction supersedes",
    );
    assert.match(memories[0].text, /peppermint/i);
    const corrected = await ask("Which tea should I have while working?");
    assert.match(corrected, /peppermint/i);
    assert.match(
      corrected.split(/[.!?]/)[0],
      /peppermint/i,
      "recommends corrected preference",
    );
    await page.locator("#memory-open").click();
    await page.getByRole("button", { name: "Correct", exact: true }).click();
    await page
      .locator("#memory-text")
      .fill("I prefer oolong tea when working.");
    await page.locator("#memory-edit button").last().click();
    await page.locator("#memory-edit").waitFor({ state: "hidden" });
    await page.locator("#memory-close").click();
    const edited = await ask("Which tea do I prefer when working?");
    assert.match(edited, /oolong/i);
    memories = await page.evaluate(() => window.oscar.memories());
    assert(
      edited.includes("[#" + memories[0].source + "]"),
      "citation points to actual user source",
    );
    await page.locator("#memory-open").click();
    await page.screenshot({ path: path.join(evidence, "memory.png") });
    await page
      .getByRole("button", { name: "Forget", exact: true })
      .first()
      .click();
    await page.locator("#confirm-yes").click();
    await page.locator(".memory-item").waitFor({ state: "hidden" });
    await page.locator("#memory-close").click();
    await app.close();
    await launch();
    const forgotten = await ask("What drink do I prefer when working?");
    assert(
      !/jasmine|peppermint|oolong/i.test(forgotten),
      "forgotten preference not recalled",
    );
    await app.close();
    const { Store } = require("../src/store.cjs");
    const s = new Store(path.join(data, "oscar.sqlite"));
    const old = s
      .history({ search: "lighthouse" })
      .find((m) => m.role === "user").id;
    s.db.exec("BEGIN");
    for (let i = 0; i < 3000; i++)
      s.add(
        i % 2 ? "assistant" : "user",
        "Unrelated entry " + i + " " + "ordinary content ".repeat(30),
      );
    s.db.exec("COMMIT");
    s.clearContext();
    s.close();
    await launch();
    const recalled = await ask(
      "What was the lighthouse archive code I mentioned earlier?",
    );
    assert.match(
      recalled.normalize("NFKC").replace(/[\u2010-\u2015]/g, "-"),
      /MARIGOLD-73/i,
    );
    await page.locator("#search-open").click();
    await page.locator("#search").fill("lighthouse");
    await page.locator("#search-form button").first().click();
    await page.locator(".result").first().waitFor();
    await page.screenshot({ path: path.join(evidence, "search.png") });
    await page.locator("#search-close").click();
    await page.screenshot({ path: path.join(evidence, "conversation.png") });
    await page.setViewportSize({ width: 640, height: 700 });
    await page.screenshot({ path: path.join(evidence, "narrow.png") });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "no horizontal page overflow",
    );
    await app.close();
    app = null;
    const check = new Store(path.join(data, "oscar.sqlite"));
    const turns = check.db
      .prepare("SELECT input_bytes,prompt_tokens,model FROM turns")
      .all();
    assert(
      turns.every((t) => t.input_bytes < 26000),
      "bounded total prompts",
    );
    log.push({
      turns,
      historyCount: check.db.prepare("SELECT count(*) AS n FROM messages").get()
        .n,
      oldSource: old,
      data,
      evidence,
    });
    check.close();
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
