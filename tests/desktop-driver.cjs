const { chromium } = require("@playwright/test");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
exports.launch = async ({ env, executablePath }) => {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  const child = spawn(
    executablePath ||
      path.join(__dirname, "../src-tauri/target/debug/oscar-desktop.exe"),
    [],
    {
      cwd: path.join(__dirname, ".."),
      env: {
        ...env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
        WEBVIEW2_USER_DATA_FOLDER: path.join(env.OSCAR_DATA_DIR, "webview"),
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (output += b));
  let browser;
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error("Tauri exited: " + output);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const version = await response.json();
      browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
      break;
    } catch {}
    await delay(100);
  }
  if (!browser) {
    child.kill();
    throw new Error("Could not attach to isolated Tauri WebView: " + output);
  }
  let page = browser.contexts()[0].pages()[0];
  while (!page) {
    await delay(50);
    page = browser.contexts()[0].pages()[0];
  }
  return {
    firstWindow: async () => page,
    close: async () => {
      await page
        .evaluate(() => window.__TAURI__.window.getCurrentWindow().close())
        .catch(() => {});
      const until = Date.now() + 5000;
      while (child.exitCode === null && Date.now() < until) await delay(50);
      await browser.close().catch(() => {});
      if (child.exitCode === null) {
        child.kill();
        throw new Error("Tauri did not close gracefully.");
      }
    },
    process: () => child,
  };
};
