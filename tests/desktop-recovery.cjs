const { _electron: electron } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const http = require("node:http");
const root = path.join(__dirname, "..");
(async () => {
  const data = path.join(root, ".oscar", "recovery-revision-" + Date.now());
  const server = http.createServer((req) => req.socket.destroy());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = { ...process.env, OSCAR_DATA_DIR: data };
  delete base.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({
    args: [root],
    env: {
      ...base,
      OSCAR_GROQ_ENDPOINT:
        "http://127.0.0.1:" + server.address().port + "/v1/chat/completions",
    },
  });
  try {
    let page = await app.firstWindow();
    await page.locator("html[data-theme]").waitFor();
    await page
      .locator("#message")
      .fill("Reply with exactly: connection restored.");
    await page.locator("#send").click();
    await page
      .locator("#notice")
      .filter({ hasText: "could not reach Groq" })
      .waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Retry", exact: true }).waitFor();
    await page.screenshot({
      animations: "disabled",
      path: path.join(root, ".oscar/revision-evidence/network-error.png"),
    });
    await app.close();
    server.close();
    app = await electron.launch({ args: [root], env: base });
    page = await app.firstWindow();
    await page.locator("html[data-theme]").waitFor();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.locator("#stop").waitFor({ state: "hidden", timeout: 120000 });
    assert.match(
      await page.locator(".assistant .body").last().innerText(),
      /connection restored/i,
    );
    assert.equal(
      (await page.evaluate(() => window.oscar.history())).filter(
        (m) => m.role === "user",
      ).length,
      1,
    );
    console.log(
      "Desktop transport failure, restart, real provider retry: passed without duplicated user turn.",
    );
  } finally {
    if (server.listening) server.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
