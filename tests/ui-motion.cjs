const desktop = require("./desktop-driver.cjs");
const { Store } = require("./fixtures.cjs");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.join(__dirname, ".."),
  data = path.join(root, ".oscar", "ui-motion-" + Date.now()),
  out = path.join(root, ".oscar", "motion-evidence");
fs.mkdirSync(out, { recursive: true });
let app, p;
const errors = [];
async function launch() {
  const env = { ...process.env, OSCAR_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await desktop.launch({ args: [root], env });
  p = await app.firstWindow();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.locator("html[data-theme]").waitFor();
  await p.emulateMedia({ reducedMotion: "no-preference" });
}
async function togglePin() {
  await p.locator(".sidebar").hover({ position: { x: 30, y: 30 } });
  await p.locator("#collapse").click();
}
(async () => {
  try {
    const s = new Store(path.join(data, "oscar.sqlite"));
    s.add("user", "Help me keep OSCAR simple.");
    s.add(
      "assistant",
      "Keep the conversation clear, and let memory work quietly in the background.\n\n- One continuous conversation\n- Sources you can inspect\n- Settings that stay out of the way",
    );
    s.close();
    await launch();
    await p.setViewportSize({ width: 1536, height: 900 });
    assert.equal(
      await p.locator("#collapse").getAttribute("aria-expanded"),
      "false",
    );
    const geometry = await p.evaluate(() => ({
      settings: document
        .querySelector("[data-page=settings]")
        .getBoundingClientRect().top,
      profile: document.getElementById("profile").getBoundingClientRect().top,
      height: innerHeight,
    }));
    assert(geometry.settings > geometry.height - 150);
    assert(geometry.profile > geometry.settings);
    await p.locator("[data-page=memories]").hover();
    await p.waitForTimeout(260);
    assert.equal(
      await p.locator("#collapse").getAttribute("aria-expanded"),
      "true",
    );
    assert.equal(
      await p.locator("#collapse").getAttribute("aria-pressed"),
      "false",
    );
    const pin = await p.locator("#collapse").boundingBox();
    assert(pin.y < 90, "pin is beside identity at top");
    await p.locator("#collapse").hover();
    await p.locator("#sidebar-tooltip").waitFor();
    assert.equal(
      await p.locator("#sidebar-tooltip").innerText(),
      "Pin sidebar",
    );
    await p.keyboard.press("Escape");
    assert(await p.locator("#sidebar-tooltip").isHidden());
    await p.mouse.move(500, 20);
    await p.waitForTimeout(260);
    assert.equal(
      await p.locator("#collapse").getAttribute("aria-expanded"),
      "false",
    );
    // Start a real width transition and sample it while the renderer paints.
    const motion = await p.evaluate(async () => {
      const side = document.querySelector(".sidebar");
      const before = side.getBoundingClientRect().width;
      side.dispatchEvent(new MouseEvent("mouseenter"));
      const samples = [];
      const start = performance.now();
      await new Promise((resolve) => {
        function tick() {
          samples.push({
            t: performance.now() - start,
            width: side.getBoundingClientRect().width,
          });
          if (performance.now() - start > 280) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      return { before, samples };
    });
    assert(
      motion.samples.some((x) => x.width > motion.before + 1 && x.width < 195),
    );
    assert(motion.samples.at(-1).width >= 195);
    await p.locator(".sidebar").hover({ position: { x: 30, y: 30 } });
    await p.mouse.move(500, 20);
    await p.locator("[data-page=settings]").click();
    await p.locator("[data-settings=model]").click();
    assert(await p.locator("#model").isVisible());
    assert(await p.locator("#theme").isHidden());
    await p.locator("#settings-search").fill("privacy");
    assert(await p.locator("#settings-privacy").isVisible());
    await p.locator("#settings-search").fill("no-such-option");
    assert(await p.locator("#settings-empty").isVisible());
    await p.locator("#settings-search").fill("");
    await p.locator("[data-settings=appearance]").click();
    await p.locator("[data-settings=appearance]").press("ArrowDown");
    assert(await p.locator("#settings-model").isVisible());
    await p.locator("#profile").click();
    assert(await p.locator("#page-settings").isVisible());
    assert.equal(await p.locator("dialog[open]").count(), 0);
    // Rapid navigation must settle on the last selection, with no retained outgoing view.
    await p.evaluate(() => {
      for (let i = 0; i < 8; i++) {
        document.querySelector("[data-page=conversation]").click();
        document.querySelector("[data-page=memories]").click();
        document.querySelector("[data-page=settings]").click();
      }
    });
    assert(await p.locator("#page-settings").isVisible());
    assert(await p.locator("#page-conversation").isHidden());
    await p.locator("[data-page=conversation]").click();
    await p
      .locator("#message")
      .fill("Line one\nLine two\nLine three\nLine four");
    await p.waitForTimeout(180);
    assert(
      (await p
        .locator("#message")
        .evaluate((e) => e.getBoundingClientRect().height)) > 70,
    );
    for (const theme of ["light", "dark"]) {
      await p.locator("[data-page=settings]").click();
      await p.locator("[data-settings=appearance]").click();
      await p.locator("#theme").selectOption(theme);
      await p.waitForFunction(
        (t) => document.documentElement.dataset.theme === t,
        theme,
      );
      await p.locator("[data-settings=model]").click();
      await p.mouse.move(500, 20);
      await p.screenshot({
        path: path.join(out, "settings-" + theme + ".png"),
        animations: "disabled",
      });
      await p.locator("[data-page=conversation]").click();
      await p.screenshot({
        path: path.join(out, "conversation-" + theme + ".png"),
        animations: "disabled",
      });
    }
    await togglePin();
    await p.locator("[data-page=settings]").click();
    await p.screenshot({
      path: path.join(out, "settings-expanded.png"),
      animations: "disabled",
    });
    await app.close();
    await launch();
    assert.equal(
      await p.locator("#collapse").getAttribute("aria-expanded"),
      "true",
    );
    await p.locator("[data-page=settings]").click();
    assert(await p.locator("#settings-model").isVisible());
    await p.setViewportSize({ width: 760, height: 700 });
    await togglePin();
    await p.screenshot({
      path: path.join(out, "settings-small.png"),
      animations: "disabled",
    });
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.locator("[data-settings=memory]").click();
    await p.locator("[data-page=conversation]").click();
    await togglePin();
    assert.equal(
      await p
        .locator(".sidebar")
        .evaluate((e) => getComputedStyle(e).transitionDuration),
      "0s",
    );
    assert.equal(
      await p.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "running")
            .length,
      ),
      0,
    );
    // Unpin via keyboard, then leaving navigation must collapse it.
    await p.locator("#collapse").focus();
    await p.keyboard.press("Space");
    await p.locator("#message").click();
    assert.equal(
      await p.locator("#collapse").getAttribute("aria-expanded"),
      "false",
    );
    await p.locator("[data-page=conversation]").focus();
    await p.keyboard.press("Tab");
    assert.equal(
      await p.locator("#collapse").getAttribute("aria-expanded"),
      "true",
    );
    await p.locator("#message").click();
    await app.close();
    await launch();
    assert.equal(
      await p.locator("#collapse").getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(
      await p.locator("#collapse").getAttribute("aria-expanded"),
      "false",
    );
    assert.deepEqual(errors, []);
    const intervals = motion.samples
      .slice(1)
      .map((s, i) => s.t - motion.samples[i].t)
      .sort((a, b) => a - b);
    const receipt = {
      geometry,
      motionFrames: motion.samples.length,
      frameMedianMs: intervals[Math.floor(intervals.length / 2)],
      frameP95Ms: intervals[Math.floor(intervals.length * 0.95)],
      checks: [
        "sidebar placement",
        "hover expansion and collapse",
        "top pin and restart persistence",
        "hover tooltip and Escape",
        "inert profile",
        "settings search and keyboard",
        "rapid navigation",
        "composer resizing",
        "light/dark",
        "small layout",
        "reduced motion",
      ],
      data,
      out,
    };
    fs.writeFileSync(
      path.join(out, "review.json"),
      JSON.stringify(receipt, null, 2),
    );
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
