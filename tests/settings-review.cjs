const desktop = require("./desktop-driver.cjs");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { parseEnv } = require("node:util");

(async () => {
  const out = path.resolve(".oscar/settings-review");
  fs.mkdirSync(out, { recursive: true });
  const app = await desktop.launch({
    env: { ...process.env, OSCAR_DATA_DIR: path.join(out, "profile-" + Date.now()) }
  });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on("pageerror", e => errors.push(e.message));
    await page.locator("html[data-theme]").waitFor();
    await page.setViewportSize({width: 1536, height: 900});
    await page.locator("[data-page=settings]").click();
    await page.locator("[data-settings=providers]").click();
    const api = (name, arg) => page.evaluate(([n,a]) => window.oscar[n](a), [name,arg]);
    const providers = await api("cloudProviders");
    const imported = new Set(providers.flatMap(p => p.credentials.map(c => c.source)));
    const template = Object.keys(parseEnv(fs.readFileSync(".env.example", "utf8"))).filter(k => /API_KEY_\d+$/.test(k));
    const missing = template.filter(k => !imported.has("environment:" + k));
    const results = {templateSlots: template.length, importedTemplateSlots: template.length - missing.length, missing, providers: [], errors};
    for (const id of ["groq","openrouter","nvidia","gemini","zai","zai-coding","ollama","tavily"]) {
      const provider = providers.find(p => p.id === id);
      results.providers.push({id, slots: provider.credentials.length, enabled: provider.credentials.filter(c => c.enabled).length});
    }
    await page.locator("#provider-select").selectOption("openrouter");
    await page.locator("[data-provider-tab=models]").click();
    assert(await page.locator("[data-provider-pane=models]").isVisible());
    assert(await page.locator("[data-provider-pane=access]").isHidden());
    await page.locator("summary").filter({hasText:"Connection test options"}).click();
    assert.equal(await page.locator("#test-credential option").count(), 1 + providers.find(p => p.id === "openrouter").credentials.filter(c => c.enabled).length);
    await page.locator("#add-provider").click();
    assert(await page.locator("#provider-form").isVisible());
    await page.locator("#cancel-provider").click();
    assert(await page.locator("[data-provider-pane=access]").isVisible());
    await page.locator("#provider-select").selectOption("zai-coding");
    assert(await page.locator("[data-provider-tab=models]").isHidden());
    await page.locator("#provider-select").selectOption("tavily");
    assert(await page.locator("#discover-models").isVisible());
    assert.equal(await page.locator("#discover-models").innerText(), "Check search access");
    await page.locator("#provider-select").selectOption("groq");
    await page.locator("[data-settings=personalization]").click();
    await page.locator("#personalization-form [name=name]").fill("Review fixture");
    await page.getByRole("button",{name:"Save preferences"}).click();
    await page.getByText("Preferences saved.",{exact:true}).waitFor();
    assert.equal((await api("settings")).personalization.name, "Review fixture");
    for (const theme of ["light","dark"]) {
      await page.locator("[data-settings=appearance]").click();
      await page.locator("#theme").selectOption(theme);
      await page.locator(`html[data-theme=${theme}]`).waitFor();
      for (const section of ["appearance","model","providers","personalization","memory","privacy"]) {
        await page.locator(`[data-settings=${section}]`).click();
        assert(await page.locator(`#settings-${section}`).isVisible());
        await page.screenshot({path:path.join(out,`${section}-${theme}.png`),animations:"disabled"});
      }
    }
    await page.setViewportSize({width:600,height:650});
    await page.locator("[data-settings=providers]").click();
    await page.mouse.move(450,100);
    assert(await page.evaluate(() => {
      const content=document.querySelector(".settings-content");
      return content.scrollWidth<=content.clientWidth+1;
    }));
    await page.screenshot({path:path.join(out,"providers-narrow.png"),animations:"disabled"});
    assert.deepEqual(errors,[]);
    if (process.env.OSCAR_VERIFY_CONNECTIONS === "1") {
      results.discovery = await Promise.all(["groq","openrouter","nvidia","gemini","zai","ollama","tavily"].map(async provider => {
        try {
          const result = await api("discoverModels", {provider});
          return {provider, models: result.models, connected: true};
        } catch (error) {
          return {provider, connected: false, status: error.message.match(/HTTP [0-9]+/)?.[0] || "Connection failed"};
        }
      }));
    }
    fs.writeFileSync(path.join(out,"receipt.json"), JSON.stringify(results,null,2));
    console.log(JSON.stringify(results,null,2));
  } finally { await app.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});

