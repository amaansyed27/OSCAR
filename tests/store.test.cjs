const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Store, cost } = require("../src/store.cjs");
function fixture() {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "oscar-test-")),
    "db.sqlite",
  );
  return { s: new Store(file), file };
}
test("history and memory survive reopen; context reset preserves both", () => {
  let { s, file } = fixture();
  const id = s.add("user", "I prefer green tea.");
  s.saveMemory(
    "drink.preference",
    "User prefers green tea.",
    id,
    "I prefer green tea.",
  );
  s.close();
  s = new Store(file);
  s.clearContext();
  assert.equal(s.history().length, 1);
  assert.equal(s.memories().length, 1);
  assert.equal(s.context("Which tea?").memories.length, 1);
  s.close();
});
test("correction supersedes old source; forgetting blocks every version and recall-linked replies", () => {
  const { s } = fixture();
  const a = s.add("user", "I prefer green tea.");
  const m = s.saveMemory(
    "drink.preference",
    "User prefers green tea.",
    a,
    "green tea",
  );
  const reply = s.add("assistant", "You like green tea.");
  s.db.prepare("INSERT INTO recall_links VALUES(?,?)").run(reply, m);
  const b = s.add("user", "Correction: I prefer black coffee.");
  const n = s.saveMemory(
    "drink.preference",
    "User prefers black coffee.",
    b,
    "black coffee",
    m,
  );
  let c = s.context("tea coffee");
  assert.equal(c.memories.length, 1);
  assert.match(c.memories[0].text, /black coffee/);
  assert(!JSON.stringify(c).includes("green tea"));
  assert(
    s
      .context("What did I prefer previously?")
      .memories.some((m) => /green tea/.test(m.text)),
  );
  s.forget(n);
  c = s.context("tea coffee");
  assert.equal(c.memories.length, 0);
  assert(!/green tea|black coffee/.test(JSON.stringify(c)));
  assert.equal(s.history().length, 3);
  s.close();
});
test("FTS retrieves older history under a fixed context budget with 3000 messages", () => {
  const { s } = fixture();
  const id = s.add("user", "The lighthouse archive code is MARIGOLD-73.");
  s.db.exec("BEGIN");
  for (let i = 0; i < 3000; i++)
    s.add(
      i % 2 ? "assistant" : "user",
      "Unrelated chronological entry " +
        i +
        " " +
        "ordinary content ".repeat(50),
    );
  s.db.exec("COMMIT");
  s.clearContext();
  const c = s.context("What was the lighthouse archive code?", 10000);
  assert(c.history.some((h) => h.id === id));
  assert(c.tokens <= 10000);
  assert(c.history.length <= 34);
  assert.equal(s.history({ search: "lighthouse" })[0].id, id);
  assert.equal(s.history().length, 50);
  s.close();
});
test("sources must be user statements with exact quotes", () => {
  const { s } = fixture();
  const id = s.add("assistant", "You live on Mars");
  assert.throws(() => s.saveMemory("home", "User lives on Mars", id, "Mars"));
  const user = s.add("user", "Where do I live?");
  assert.throws(() => s.saveMemory("home", "User lives on Mars", user, "Mars"));
  const question = s.add("user", "Do I need to finish OSCAR today?");
  s.trackWork(question);
  s.trackWork(id);
  assert.equal(s.db.prepare("SELECT count(*) AS n FROM working").get().n, 0);
  s.close();
});
test("inactivity rollover is invisible and leaves originals intact", () => {
  const { s } = fixture();
  s.add("user", "A past moment");
  s.set("last_active", Date.now() - 121 * 60000);
  const c = s.context("hello");
  assert.equal(c.history.length, 1);
  assert.equal(s.history().length, 1);
  s.close();
});
test("interrupted requests are recoverable after process restart", () => {
  let { s, file } = fixture();
  s.add("user", "A pending message", "pending");
  s.close();
  s = new Store(file);
  assert.equal(s.history()[0].status, "interrupted");
  s.close();
});
test("forget also suppresses replies derived from older history excerpts", () => {
  const { s } = fixture();
  const source = s.add("user", "I prefer mint tea.");
  const memory = s.saveMemory(
    "tea.preference",
    "I prefer mint tea.",
    source,
    "mint tea",
  );
  const direct = s.add("assistant", "Mint tea.");
  const later = s.add("assistant", "Your drink is mint tea.");
  s.db.prepare("INSERT INTO history_links VALUES(?,?)").run(later, direct);
  const indirect = s.add("assistant", "Remember your mint tea.");
  s.db.prepare("INSERT INTO history_links VALUES(?,?)").run(indirect, later);
  s.forget(memory);
  const context = s.context("mint tea drink");
  assert(!/mint/i.test(JSON.stringify(context)));
  assert.equal(s.history().length, 4);
  s.close();
});
test("network failure keeps the original user message and retry does not duplicate it", async () => {
  const { Conversation } = require("../src/conversation.cjs");
  const { s } = fixture();
  const model = {
    config: { inputBudget: 10000, contextWindow: 131072, outputBudget: 4000 },
    stream: async () => {
      throw new Error("Network unavailable");
    },
    complete: async () => {
      throw new Error("Network unavailable");
    },
  };
  const conversation = new Conversation(s, model);
  s.set("last_active", Date.now() - 121 * 60000);
  await assert.rejects(
    conversation.send("A real pending request"),
    /Network unavailable/,
  );
  const original = s.history()[0];
  assert.equal(original.status, "failed");
  await assert.rejects(
    conversation.send(original.content, original.id),
    /Network unavailable/,
  );
  assert.equal(s.history().filter((m) => m.role === "user").length, 1);
  assert.equal(conversation.busy, false);
  conversation.close();
  s.close();
});
