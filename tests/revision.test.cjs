const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readdirSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Store } = require("../src/store.cjs");
const { Conversation } = require("../src/conversation.cjs");
const { countText, countMessages } = require("../src/tokens.cjs");
const fixture = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "oscar-revision-"));
  return {
    dir,
    file: path.join(dir, "db.sqlite"),
    s: new Store(path.join(dir, "db.sqlite")),
  };
};
test("forget isolates the claim in mixed messages and preserves unrelated recall after restart", () => {
  let { s, file } = fixture();
  const source = s.add(
    "user",
    "I prefer jasmine tea. My project deadline is December 12.",
  );
  const m = s.saveMemory(
    "work.drink",
    "I prefer jasmine tea.",
    source,
    "I prefer jasmine tea.",
    null,
    "jasmine tea",
    "work beverage",
  );
  const later = s.add(
    "assistant",
    "Jasmine tea is your preference. The project deadline is December 12.",
  );
  s.forget(m);
  s.close();
  s = new Store(file);
  const ctx = s.context("What is my project deadline and beverage?");
  assert(!/jasmine/i.test(JSON.stringify(ctx)));
  assert(JSON.stringify(ctx).includes("December 12"));
  assert(s.message(source).content.includes("jasmine tea"));
  assert(/jasmine/i.test(s.message(later).content));
  const chinese = s.add("user", "我喜欢茉莉花茶。");
  const cm = s.saveMemory(
    "drink.chinese",
    "茉莉花茶",
    chinese,
    "茉莉花茶",
    null,
    "茉莉花茶",
  );
  s.forget(cm);
  assert(!s.safeText("我喜欢茉莉花茶。").includes("茉莉花茶"));
  s.close();
});
test("a stale extraction result and queued job cannot restore forgotten memory", async () => {
  const { s } = fixture();
  const id = s.add("user", "I prefer mint tea.");
  const m = s.saveMemory(
    "work.drink",
    "I prefer mint tea.",
    id,
    "mint tea",
    null,
    "mint tea",
  );
  const revision = s.revision();
  s.enqueue(id);
  const model = {
    config: { inputBudget: 16000, contextWindow: 131072, outputBudget: 4000 },
    complete: async () => {
      throw new Error("Stale job must not call provider");
    },
  };
  const c = new Conversation(s, model);
  s.forget(m);
  assert.equal(
    c.apply(
      [
        {
          operation: "remember",
          key: "work.drink",
          quote: "mint tea",
          value: "mint tea",
        },
      ],
      [],
      "I prefer mint tea.",
      id,
      revision,
    ),
    false,
  );
  await c.maintain();
  assert.equal(s.memories().length, 0);
  assert.equal(s.db.prepare("SELECT state FROM jobs").get().state, "stale");
  c.close();
  s.close();
});
test("compaction and inactivity preserve unfinished work with original source references", () => {
  const { s } = fixture();
  const source = s.add(
    "user",
    "I need to finish the OSCAR renderer migration. The release is unfinished until keyboard navigation works.",
  );
  for (let i = 0; i < 100; i++)
    s.add(i % 2 ? "assistant" : "user", "Ordinary later message " + i);
  s.compact(true);
  s.clearContext();
  s.set("last_active", Date.now() - 121 * 60000);
  const ctx = s.context("What remains to be done?");
  assert(
    ctx.working.some(
      (w) => w.source === source && /keyboard navigation/.test(w.quote),
    ),
  );
  assert(s.message(source).content.includes("renderer migration"));
  assert(s.db.prepare("SELECT count(*) AS n FROM messages").get().n === 101);
  s.close();
});
test("summary invalidation redacts a forgotten claim without losing another task", () => {
  const { s } = fixture();
  const source = s.add(
    "user",
    "I need to finish the renderer. I prefer jasmine tea.",
  );
  const m = s.saveMemory(
    "work.drink",
    "I prefer jasmine tea.",
    source,
    "jasmine tea",
    null,
    "jasmine tea",
  );
  for (let i = 0; i < 40; i++) s.add("user", "Ordinary message " + i);
  s.compact(true);
  s.forget(m);
  s.rebuildSummaries();
  const ctx = s.context("What renderer work is unfinished?");
  assert(!/jasmine/i.test(JSON.stringify(ctx)));
  assert(JSON.stringify(ctx).includes("renderer"));
  s.close();
});
test("paraphrased beverage recall uses scoped lexical aliases, and historical correction stays dated", () => {
  const { s } = fixture();
  const a = s.add("user", "I prefer jasmine tea while working.");
  const old = s.saveMemory(
    "work.drink",
    "I prefer jasmine tea while working.",
    a,
    "jasmine tea",
    null,
    "jasmine tea",
    "beverage cup drink work code",
  );
  const b = s.add("user", "I now prefer peppermint tea while working.");
  s.saveMemory(
    "work.drink",
    "I now prefer peppermint tea while working.",
    b,
    "peppermint tea",
    old,
    "peppermint tea",
    "beverage cup drink work code",
  );
  const now = s.context("Which beverage should I have while I code?");
  assert(now.memories.some((m) => m.value === "peppermint tea"));
  assert(!JSON.stringify(now).includes("jasmine"));
  const past = s.context("Which beverage did I prefer previously?");
  assert(
    past.memories.some(
      (m) => m.state === "superseded" && m.created && m.value === "jasmine tea",
    ),
  );
  s.close();
});
test("indexed search can open original position and surrounding messages without loading all records", () => {
  const { s } = fixture();
  for (let i = 0; i < 5000; i++)
    s.add(
      i % 2 ? "assistant" : "user",
      i === 2600
        ? "OSCAR renderer checkpoint MANGO-42"
        : "Chronological note " + i,
    );
  const hit = s.history({ search: "renderer", sort: "relevance" })[0];
  const around = s.around(hit.id);
  assert(around.length <= 24);
  assert(around.some((r) => r.id === hit.id - 1));
  assert(around.some((r) => r.id === hit.id + 1));
  assert.equal(s.history().length, 50);
  s.close();
});
test("migration backs up and preserves an existing Slice 01 database", () => {
  const { dir, file, s } = fixture();
  s.close();
  const legacyFile = path.join(dir, "legacy.sqlite");
  const { DatabaseSync } = require("node:sqlite");
  const legacy = new DatabaseSync(legacyFile);
  legacy.exec(`CREATE TABLE messages(id INTEGER PRIMARY KEY,role TEXT,content TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP,status TEXT DEFAULT 'complete');
    CREATE TABLE memories(id INTEGER PRIMARY KEY,key TEXT,text TEXT,source INTEGER,quote TEXT,state TEXT DEFAULT 'active',replaces INTEGER,created TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO messages(id,role,content) VALUES(1,'user','An original owner statement.');
    INSERT INTO memories(id,key,text,source,quote) VALUES(1,'owner.fact','An original owner statement.',1,'owner statement');
    CREATE VIRTUAL TABLE history_fts USING fts5(content,content='messages',content_rowid='id');
    INSERT INTO history_fts(rowid,content) SELECT id,content FROM messages;
  `);
  legacy.close();
  const id = 1;
  const migrated = new Store(legacyFile);
  assert.equal(migrated.message(id).content, "An original owner statement.");
  assert.equal(migrated.memories().length, 1);
  assert(
    readdirSync(dir).some((f) =>
      f.startsWith("legacy.sqlite.before-revision-"),
    ),
  );
  migrated.close();
});
test("token accounting handles Unicode and reserves model framing", () => {
  assert(countText("你好，OSCAR 👋") > 0);
  assert(
    countMessages([{ role: "user", content: "hello" }]) > countText("hello"),
  );
  assert(
    countMessages([{ role: "user", content: "hello" }], "unknown-model") >=
      Buffer.byteLength("hello") + 24,
  );
});
test("completed work keeps its completion source and cannot be reopened by later compaction", () => {
  const { s } = fixture();
  const task = s.add("user", "I need to finish OSCAR keyboard navigation.");
  s.trackWork(task);
  const done = s.add("user", "I completed OSCAR keyboard navigation.");
  s.trackWork(done);
  for (let i = 0; i < 40; i++) s.add("user", "A later note " + i);
  s.compact(true);
  s.clearContext();
  const ctx = s.context("What is the status of OSCAR keyboard navigation?");
  assert(
    ctx.working.some(
      (w) =>
        w.source === done && w.state === "closed" && /completed/.test(w.quote),
    ),
  );
  assert.equal(
    s.db.prepare("SELECT state FROM working WHERE source=?").get(task).state,
    "closed",
  );
  s.close();
});
test("large original messages return source-positioned relevant passages", () => {
  const { s } = fixture();
  const id = s.add(
    "user",
    "Ordinary text. ".repeat(1500) +
      " The telescope access identifier is HELIOS-89. " +
      "Additional text. ".repeat(1000),
  );
  s.clearContext();
  const ctx = s.context("What is the telescope identifier?", 8000);
  const passage = ctx.history.find((m) => m.id === id);
  assert(passage);
  assert(passage.start > 0);
  assert(passage.content.includes("HELIOS-89"));
  assert(ctx.tokens <= 8000);
  assert(s.message(id).content.length > 20000);
  s.close();
});
test("relevance cursor searches the whole archive without duplicated hits", () => {
  const { s } = fixture();
  s.db.exec("BEGIN");
  for (let i = 0; i < 120; i++) s.add("user", "Project archive note " + i);
  s.db.exec("COMMIT");
  const a = s.history({ search: "archive", sort: "relevance" });
  const last = a.at(-1);
  const b = s.history({
    search: "archive",
    sort: "relevance",
    cursor: { score: last.score, id: last.id },
  });
  assert.equal(a.length, 50);
  assert.equal(b.length, 50);
  assert(!b.some((row) => a.some((first) => first.id === row.id)));
  s.close();
});
test("literal tokenizer control strings remain ordinary user text", () => {
  assert(countText("<|endoftext|>") > 1);
});
test("historical recall uses one foreground request and is not treated as a correction", async () => {
  const { s } = fixture();
  let extra = 0;
  const model = {
    config: {
      model: "openai/gpt-oss-20b",
      inputBudget: 16000,
      contextWindow: 131072,
      outputBudget: 4000,
    },
    complete: async () => {
      extra++;
      throw new Error("Unexpected extraction");
    },
    stream: async (_messages, chunk) => {
      chunk("No evidence.", "No evidence.");
      return { content: "No evidence.", usage: { prompt_tokens: 200 } };
    },
  };
  const c = new Conversation(s, model);
  await c.send("Which preference did I have before the correction?");
  assert.equal(extra, 0);
  assert.equal(
    s.db.prepare("SELECT foreground_requests FROM metrics").get()
      .foreground_requests,
    1,
  );
  c.close();
  s.close();
});
test("delayed learning cannot overwrite a newer correction even under the current revision", () => {
  const { s } = fixture();
  const original = s.add("user", "I prefer jasmine tea.");
  const correction = s.add("user", "I now prefer peppermint tea.");
  const current = s.saveMemory(
    "work.drink",
    "peppermint tea",
    correction,
    "peppermint tea",
    null,
    "peppermint tea",
  );
  const c = new Conversation(s, { config: {} });
  c.apply(
    [
      {
        operation: "remember",
        key: "work.drink",
        quote: "jasmine tea",
        value: "jasmine tea",
        replaces: current,
      },
    ],
    s.memories(),
    "I prefer jasmine tea.",
    original,
    s.revision(),
  );
  assert.equal(s.memories()[0].value, "peppermint tea");
  c.close();
  s.close();
});
test("unrelated queued learning survives another memory being forgotten", async () => {
  const { s } = fixture();
  const deadline = s.add("user", "My prototype deadline is December 12.");
  s.enqueue(deadline);
  const drink = s.add("user", "I prefer jasmine tea.");
  const m = s.saveMemory(
    "work.drink",
    "jasmine tea",
    drink,
    "jasmine tea",
    null,
    "jasmine tea",
  );
  s.forget(m);
  const c = new Conversation(s, {
    config: {},
    complete: async () => ({
      content: JSON.stringify({
        changes: [
          {
            operation: "remember",
            key: "prototype.deadline",
            quote: "December 12",
            value: "December 12",
            aliases: "prototype deadline",
            replaces: null,
          },
        ],
      }),
    }),
  });
  await c.maintain();
  assert(s.memories().some((m) => m.value === "December 12"));
  assert(!s.memories().some((m) => /jasmine/i.test(m.text)));
  c.close();
  s.close();
});
test("disabling automatic learning prevents queued provider requests", async () => {
  const { s } = fixture();
  const source = s.add("user", "My preferred editor is VS Code.");
  s.enqueue(source);
  s.set("learn", "false");
  let called = false;
  const c = new Conversation(s, {
    config: {},
    complete: async () => {
      called = true;
      throw new Error("Disabled");
    },
  });
  await c.maintain();
  assert.equal(called, false);
  assert.equal(s.memories().length, 0);
  c.close();
  s.close();
});
test("sourced paraphrases are forgotten at sentence granularity while unrelated text survives", () => {
  const { s } = fixture();
  const source = s.add(
    "user",
    "I prefer jasmine tea. The review deadline is December 12.",
  );
  const memory = s.saveMemory(
    "work.drink",
    "jasmine tea",
    source,
    "jasmine tea",
    null,
    "jasmine tea",
  );
  const text =
    "A floral brew would suit you. [#" +
    source +
    "] The prototype is due December 12.";
  const reply = s.add("assistant", text);
  s.recordClaims(reply, text, { memories: s.memories(), history: [] });
  s.forget(memory);
  const safe = s.safeMessage(s.message(reply));
  assert(!safe.includes("floral brew"));
  assert(safe.includes("December 12"));
  assert.equal(s.message(reply).content, text);
  s.close();
});
test("redacted personal clauses never reach the answering model and working citations remain valid", async () => {
  const { s } = fixture();
  const source = s.add("user", "I prefer jasmine tea.");
  const memory = s.saveMemory(
    "work.drink",
    "jasmine tea",
    source,
    "jasmine tea",
    null,
    "jasmine tea",
  );
  s.add("assistant", "You prefer jasmine tea.");
  s.forget(memory);
  const task = s.add("user", "I need to finish OSCAR keyboard navigation.");
  s.trackWork(task);
  s.clearContext();
  let captured;
  const c = new Conversation(s, {
    config: {
      model: "openai/gpt-oss-20b",
      inputBudget: 16000,
      contextWindow: 131072,
      outputBudget: 4000,
    },
    stream: async (messages, chunk) => {
      captured = JSON.stringify(messages);
      const content = "Your keyboard task is unfinished. [#" + task + "]";
      chunk(content, content);
      return { content, usage: { prompt_tokens: 200 } };
    },
  });
  const result = await c.send("What is still unfinished?");
  assert(!/jasmine|\[memory omitted\]/i.test(captured));
  assert(result.assistant.content.includes("[#" + task + "]"));
  c.close();
  s.close();
});
test("forgetting one scoped relationship preserves another fact with the same value", () => {
  const { s } = fixture();
  const lead = s.add("user", "My project lead is Alex.");
  const a = s.saveMemory(
    "work.project_lead",
    "Alex",
    lead,
    "Alex",
    null,
    "Alex",
    "project lead",
  );
  const cousin = s.add("user", "My cousin is Alex.");
  s.saveMemory(
    "family.cousin",
    "My cousin is Alex.",
    cousin,
    "My cousin is Alex.",
    null,
    "Alex",
    "family cousin",
  );
  s.forget(a);
  const ctx = s.context("Who is my cousin?");
  assert(
    ctx.memories.some((m) => m.key === "family.cousin" && m.value === "Alex"),
  );
  assert(!ctx.memories.some((m) => m.key === "work.project_lead"));
  assert.equal(
    s.safeText("Minted coins are unrelated."),
    "Minted coins are unrelated.",
  );
  s.close();
});
