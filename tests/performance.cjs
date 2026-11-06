const { Store } = require("../src/store.cjs");
const path = require("node:path");
const fs = require("node:fs");
const { performance } = require("node:perf_hooks");
const file = path.join(
  __dirname,
  "..",
  ".oscar",
  "performance-" + Date.now(),
  "oscar.sqlite",
);
const s = new Store(file);
s.db.exec("BEGIN");
const source = s.add("user", "The lighthouse archive code is MARIGOLD-73.");
for (let i = 0; i < 100000; i++)
  s.add(
    i % 2 ? "assistant" : "user",
    (i % 5 === 0 ? "OSCAR project memory roadmap " : "Daily planning notes ") +
      i +
      " with a short chronological message.",
  );
s.db.exec("COMMIT");
s.clearContext();
const results = {
  scope:
    "Synthetic, warm-cache local retrieval and packing; excludes provider and UI latency",
  records: 100001,
  node: process.version,
  sqlite: s.db.prepare("select sqlite_version() as version").get().version,
};
for (const [name, query] of [
  ["specific", "lighthouse archive code"],
  ["broad", "project memory planning"],
]) {
  for (let i = 0; i < 3; i++) s.context(query);
  const retrieval = [],
    packing = [];
  let maxTokens = 0;
  for (let i = 0; i < 20; i++) {
    const c = s.context(query);
    retrieval.push(c.retrievalMs);
    packing.push(c.packingMs);
    maxTokens = Math.max(maxTokens, c.tokens);
    if (name === "specific" && !c.history.some((m) => m.id === source))
      throw new Error("Original history missing");
  }
  const metric = (xs) => {
    xs.sort((a, b) => a - b);
    return { p50_ms: +xs[10].toFixed(2), p95_ms: +xs[18].toFixed(2) };
  };
  results[name] = {
    retrieval: metric(retrieval),
    packing: metric(packing),
    maxTokens,
  };
}
const recentStart = s.db
  .prepare("SELECT max(id)+1 AS id FROM messages")
  .get().id;
s.db.exec("BEGIN");
for (let i = 0; i < 24; i++)
  s.add(
    i % 2 ? "assistant" : "user",
    "Recent exchange " + i + " " + "Detailed recent work context. ".repeat(150),
  );
s.db.exec("COMMIT");
s.set("context_start", recentStart);
results.budgets = [];
for (const limit of [8000, 16000, 32000]) {
  const c = s.context("lighthouse archive code", limit);
  if (c.tokens > limit || !c.history.some((m) => m.id === source))
    throw new Error("Budget failed");
  results.budgets.push({
    limit,
    used: c.tokens,
    recentMessages: c.history.filter((m) => m.id >= recentStart).length,
    originalSourceRetained: true,
  });
}
s.close();
const out = path.join(__dirname, "..", ".oscar", "revision-evidence");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "performance.json"),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
