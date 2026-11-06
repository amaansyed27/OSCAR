const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const STOP = new Set(
  "a an the is are was were i you my me it this that what which do does did about remember please and or to of for in on with have has had can tell know earlier mentioned".split(
    " ",
  ),
);
function terms(text) {
  return [
    ...new Set(
      (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
        (w) => w.length > 2 && !STOP.has(w),
      ),
    ),
  ].slice(0, 18);
}
function query(text) {
  return terms(text)
    .map((t) => '"' + t + '"')
    .join(" OR ");
}
// UTF-8 byte count overestimates token count for byte-level tokenizers; reserve framing separately.
function cost(text) {
  return Buffer.byteLength(text, "utf8");
}
class Store {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    if (
      version < 3 &&
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE name='messages'")
        .get()
    ) {
      const backup = file + ".before-revision-" + Date.now() + ".sqlite";
      this.db.prepare("VACUUM INTO ?").run(backup);
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), status TEXT NOT NULL DEFAULT 'complete');
      CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(content, content='messages', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS history_insert AFTER INSERT ON messages BEGIN INSERT INTO history_fts(rowid,content) VALUES(new.id,new.content); END;
      CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY, key TEXT NOT NULL, text TEXT NOT NULL, source INTEGER NOT NULL REFERENCES messages(id), quote TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active', replaces INTEGER REFERENCES memories(id), created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      CREATE UNIQUE INDEX IF NOT EXISTS active_key ON memories(key) WHERE state='active';
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(text, content='memories', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS memory_insert AFTER INSERT ON memories BEGIN INSERT INTO memory_fts(rowid,text) VALUES(new.id,new.text); END;
      CREATE TABLE IF NOT EXISTS suppressed(message INTEGER PRIMARY KEY REFERENCES messages(id));
      CREATE TABLE IF NOT EXISTS history_links(message INTEGER REFERENCES messages(id), source INTEGER REFERENCES messages(id));
      CREATE INDEX IF NOT EXISTS history_source ON history_links(source);
      CREATE TABLE IF NOT EXISTS recall_links(message INTEGER REFERENCES messages(id), memory INTEGER REFERENCES memories(id));
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS turns(id INTEGER PRIMARY KEY, user INTEGER REFERENCES messages(id), assistant INTEGER REFERENCES messages(id), input_bytes INTEGER, prompt_tokens INTEGER, model TEXT, retrieved TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS derived_claims(message INTEGER REFERENCES messages(id), first_offset INTEGER, last_offset INTEGER, memory INTEGER REFERENCES memories(id));
      CREATE INDEX IF NOT EXISTS derived_memory ON derived_claims(memory,message);
      CREATE INDEX IF NOT EXISTS derived_message ON derived_claims(message);
      CREATE TABLE IF NOT EXISTS exclusions(id INTEGER PRIMARY KEY, memory_key TEXT, phrase TEXT NOT NULL, source INTEGER, permanent INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS exclusion_key ON exclusions(memory_key);
      CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, source INTEGER UNIQUE, revision INTEGER, state TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, error TEXT);
      CREATE TABLE IF NOT EXISTS summaries(id INTEGER PRIMARY KEY, first_source INTEGER, last_source INTEGER, body TEXT, revision INTEGER, valid INTEGER DEFAULT 1);
      CREATE VIRTUAL TABLE IF NOT EXISTS summary_fts USING fts5(body,content='summaries',content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS summary_insert AFTER INSERT ON summaries BEGIN INSERT INTO summary_fts(rowid,body) VALUES(new.id,new.body); END;
      CREATE TABLE IF NOT EXISTS working(source INTEGER PRIMARY KEY REFERENCES messages(id), quote TEXT NOT NULL, state TEXT DEFAULT 'open');
      CREATE TABLE IF NOT EXISTS metrics(id INTEGER PRIMARY KEY, user INTEGER, retrieval_ms REAL, packing_ms REAL, estimated_tokens INTEGER, prompt_tokens INTEGER, first_token_ms REAL, total_ms REAL, foreground_requests INTEGER, revision INTEGER);
      CREATE TRIGGER IF NOT EXISTS history_update AFTER UPDATE OF content ON messages BEGIN INSERT INTO history_fts(history_fts,rowid,content) VALUES('delete',old.id,old.content); INSERT INTO history_fts(rowid,content) VALUES(new.id,new.content); END;
      CREATE INDEX IF NOT EXISTS message_status ON messages(status,id);
      CREATE INDEX IF NOT EXISTS memory_state ON memories(state,id);
      CREATE INDEX IF NOT EXISTS job_state ON jobs(state,id);
    `);
    const cols = this.db
      .prepare("PRAGMA table_info(memories)")
      .all()
      .map((c) => c.name);
    for (const [name, type] of [
      ["value", "TEXT"],
      ["aliases", "TEXT"],
      ["updated", "TEXT"],
    ])
      if (!cols.includes(name))
        this.db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${type}`);
    this.db
      .exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(text,aliases,tokenize='porter unicode61');
      CREATE TRIGGER IF NOT EXISTS memory_search_insert AFTER INSERT ON memories BEGIN INSERT INTO memory_search(rowid,text,aliases) VALUES(new.id,new.text,new.aliases); END;
      CREATE TRIGGER IF NOT EXISTS memory_search_update AFTER UPDATE OF text,aliases ON memories BEGIN DELETE FROM memory_search WHERE rowid=old.id; INSERT INTO memory_search(rowid,text,aliases) VALUES(new.id,new.text,new.aliases); END;`);
    if (!this.db.prepare("SELECT 1 FROM memory_search LIMIT 1").get())
      this.db.exec(
        "INSERT INTO memory_search(rowid,text,aliases) SELECT id,text,coalesce(aliases,key) FROM memories",
      );
    if (
      !this.db
        .prepare("PRAGMA table_info(working)")
        .all()
        .some((c) => c.name === "resolved_source")
    )
      this.db.exec(
        "ALTER TABLE working ADD COLUMN resolved_source INTEGER REFERENCES messages(id)",
      );
    if (version === 2) this.db.exec("PRAGMA user_version=3");
    if (version < 2) {
      this.db.exec("BEGIN");
      try {
        for (const m of this.db
          .prepare("SELECT * FROM memories WHERE state!='active'")
          .all()) {
          const original = this.message(m.source)?.content || "";
          this.exclude(m, m.quote || original, m.state === "forgotten");
        }
        this.db.exec("PRAGMA user_version=3; COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
    this.db.exec("UPDATE jobs SET state='pending' WHERE state='running'");
    this.db
      .prepare(
        "UPDATE messages SET status='interrupted' WHERE status='pending'",
      )
      .run();
  }
  get(key, fallback = "0") {
    return (
      this.db.prepare("SELECT value FROM settings WHERE key=?").get(key)
        ?.value ?? fallback
    );
  }
  set(key, value) {
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES(?,?)")
      .run(key, String(value));
  }
  add(role, content, status = "complete") {
    return Number(
      this.db
        .prepare("INSERT INTO messages(role,content,status) VALUES(?,?,?)")
        .run(role, content, status).lastInsertRowid,
    );
  }
  message(id) {
    return this.db.prepare("SELECT * FROM messages WHERE id=?").get(id);
  }
  revision() {
    return Number(this.get("memory_revision"));
  }
  bumpRevision() {
    const value = this.revision() + 1;
    this.set("memory_revision", value);
    this.db.prepare("UPDATE summaries SET valid=0").run();
    return value;
  }
  exclude(memory, quote, permanent = false) {
    const value = memory.value || inferValue(quote);
    // Exclude the exact source claim and its value, not all turns that consumed it.
    for (const phrase of new Set(
      [
        value,
        /(?:tea|coffee)$/i.test(value || "") ? value.split(/\s+/)[0] : null,
      ].filter((x) => x && x.length >= 3),
    ))
      this.db
        .prepare(
          "INSERT INTO exclusions(memory_key,phrase,source,permanent) VALUES(?,?,?,?)",
        )
        .run(memory.key, phrase, memory.source, permanent ? 1 : 0);
  }
  suppress(memory) {
    this.exclude(memory, memory.quote || memory.text);
  }
  safeText(text, historical = false, memoryKey = null) {
    const revision = this.revision();
    if (this.exclusionCache?.revision !== revision)
      this.exclusionCache = { revision, entries: new Map() };
    const cacheKey = historical + ":" + memoryKey;
    let rows = this.exclusionCache.entries.get(cacheKey);
    if (!rows) {
      rows =
        memoryKey === null
          ? this.db
              .prepare("SELECT phrase FROM exclusions WHERE permanent=1 OR ?=0")
              .all(historical ? 1 : 0)
          : this.db
              .prepare(
                "SELECT phrase FROM exclusions WHERE memory_key=? AND (permanent=1 OR ?=0)",
              )
              .all(memoryKey, historical ? 1 : 0);
      this.exclusionCache.entries.set(cacheKey, rows);
      if (this.exclusionCache.entries.size > 256)
        this.exclusionCache.entries.delete(
          this.exclusionCache.entries.keys().next().value,
        );
    }
    for (const { phrase } of rows)
      text = text.replace(
        new RegExp(
          (/^[\x00-\x7F]*$/.test(phrase) ? "(?<![\\p{L}\\p{N}_])" : "") +
            phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
            (/^[\x00-\x7F]*$/.test(phrase) ? "(?![\\p{L}\\p{N}_])" : ""),
          "giu",
        ),
        (match) =>
          "[memory omitted]" + (/[.!?;]$/.test(match) ? match.at(-1) : ""),
      );
    return text;
  }
  safeMessage(message, historical = false) {
    let text = message.content;
    const spans = this.db
      .prepare(
        `SELECT d.first_offset,d.last_offset FROM derived_claims d JOIN memories m ON m.id=d.memory WHERE d.message=? AND (m.state='forgotten' OR (?=0 AND m.state='superseded')) ORDER BY d.first_offset DESC`,
      )
      .all(message.id, historical ? 1 : 0);
    let previous = text.length + 1;
    for (const span of spans) {
      if (span.last_offset <= previous) {
        text =
          text.slice(0, span.first_offset) +
          "[memory omitted]" +
          (/[.!?](?:\s*\[#\d+\])?\s*$/.test(
            text.slice(span.first_offset, span.last_offset),
          )
            ? ". "
            : "") +
          text.slice(span.last_offset);
        previous = span.first_offset;
      }
    }
    return this.safeText(text, historical);
  }
  claimDependencies(message) {
    return this.db
      .prepare(
        "SELECT DISTINCT memory FROM derived_claims WHERE message=? LIMIT 24",
      )
      .all(message)
      .map((row) => row.memory);
  }
  recordClaims(message, text, context) {
    const candidates = new Map(
      context.memories.map((m) => [m.id, { ...m, refs: [m.source] }]),
    );
    for (const h of context.history)
      for (const id of h.dependencies || []) {
        const memory = this.db
          .prepare("SELECT * FROM memories WHERE id=? AND state!='forgotten'")
          .get(id);
        if (memory) {
          const candidate = candidates.get(id) || {
            ...memory,
            refs: [memory.source],
          };
          candidate.refs.push(h.id);
          candidates.set(id, candidate);
        }
      }
    const insert = this.db.prepare(
      "INSERT INTO derived_claims(message,first_offset,last_offset,memory) VALUES(?,?,?,?)",
    );
    for (const sentence of text.matchAll(/[^.!?\n]+[.!?]?(?:\s*\[#\d+\])*/g)) {
      const part = sentence[0];
      for (const m of candidates.values()) {
        const value = m.value || inferValue(m.quote || m.text);
        const at = value ? part.toLowerCase().indexOf(value.toLowerCase()) : -1;
        if (at >= 0)
          insert.run(
            message,
            sentence.index + at,
            sentence.index + at + value.length,
            m.id,
          );
        else if (m.refs.some((ref) => part.includes("[#" + ref + "]")))
          insert.run(
            message,
            sentence.index,
            sentence.index + part.length,
            m.id,
          );
      }
    }
  }
  saveMemory(
    key,
    text,
    source,
    quote,
    replaces = null,
    value = null,
    aliases = null,
  ) {
    if (
      typeof key !== "string" ||
      !/^[a-z0-9_.-]{2,80}$/.test(key) ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 600 ||
      typeof quote !== "string" ||
      quote.length < 3
    )
      throw new Error("Invalid memory.");
    const msg = this.message(source);
    if (msg?.role !== "user" || !msg.content.includes(quote))
      throw new Error("Memory needs an exact user source.");
    text = quote;
    if (text.length > 600)
      throw new Error("Memory quote must be at most 600 characters.");
    const old = replaces
      ? this.db
          .prepare("SELECT * FROM memories WHERE id=? AND state='active'")
          .get(replaces)
      : this.db
          .prepare("SELECT * FROM memories WHERE key=? AND state='active'")
          .get(key);
    const incomingValue =
      value && quote.includes(value) ? value : inferValue(quote);
    if (
      old &&
      (old.text === text.trim() || (old.value && old.value === incomingValue))
    )
      return old.id;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (old) {
        this.suppress(old);
        this.db
          .prepare("UPDATE memories SET state='superseded' WHERE id=?")
          .run(old.id);
        key = old.key;
      }
      const id = Number(
        this.db
          .prepare(
            "INSERT INTO memories(key,text,source,quote,replaces) VALUES(?,?,?,?,?)",
          )
          .run(key, text.trim(), source, quote, old?.id ?? null)
          .lastInsertRowid,
      );
      this.db
        .prepare("UPDATE memories SET value=?,aliases=?,updated=? WHERE id=?")
        .run(
          value && quote.includes(value) ? value : inferValue(quote),
          aliases || key.replace(/[_.]/g, " "),
          new Date().toISOString(),
          id,
        );
      this.bumpRevision();
      this.db.exec("COMMIT");
      return id;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  forget(id) {
    const memory = this.db
      .prepare("SELECT * FROM memories WHERE id=? AND state='active'")
      .get(id);
    if (!memory) throw new Error("Memory is no longer active.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Suppress all versions, sources, and responses that used them. History stays readable.
      for (const m of this.db
        .prepare("SELECT * FROM memories WHERE key=?")
        .all(memory.key)) {
        this.exclude(
          m,
          m.quote || this.message(m.source)?.content || m.text,
          true,
        );
        this.db
          .prepare(
            "UPDATE memories SET state='forgotten',text='',quote='' WHERE id=?",
          )
          .run(m.id);
      }
      this.bumpRevision();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  clearContext() {
    this.set(
      "context_start",
      this.db.prepare("SELECT coalesce(max(id),0)+1 AS id FROM messages").get()
        .id,
    );
  }
  around(id, limit = 12) {
    id = Number(id);
    const before = this.db
      .prepare("SELECT * FROM messages WHERE id<=? ORDER BY id DESC LIMIT ?")
      .all(id, limit)
      .reverse();
    return [
      ...before,
      ...this.db
        .prepare("SELECT * FROM messages WHERE id>? ORDER BY id LIMIT ?")
        .all(id, limit),
    ];
  }
  memories({
    search = "",
    before = Number.MAX_SAFE_INTEGER,
    state = "active",
  } = {}) {
    return this.db
      .prepare(
        "SELECT * FROM memories WHERE state=? AND id<? AND (text LIKE ? OR aliases LIKE ?) ORDER BY id DESC LIMIT 60",
      )
      .all(state, before, "%" + search + "%", "%" + search + "%");
  }
  history({
    before = Number.MAX_SAFE_INTEGER,
    after = 0,
    search = "",
    from = "",
    to = "",
    sort = "date",
    cursor = null,
  } = {}) {
    const q = query(search);
    if (search && !q) return [];
    const filters =
      "m.id<? AND m.id>? AND m.created>=? AND m.created<=? AND (m.role!='assistant' OR m.content!='')";
    const args = [
      before,
      after,
      from ? new Date(from + "T00:00:00").toISOString() : "0000",
      to ? new Date(to + "T23:59:59.999").toISOString() : "9999",
    ];
    const rows = q
      ? this.db
          .prepare(
            `SELECT m.*,f.rank AS score FROM history_fts f JOIN messages m ON m.id=f.rowid WHERE history_fts MATCH ? AND ${filters} ${cursor && sort === "relevance" ? "AND (f.rank>? OR (f.rank=? AND m.id<?))" : ""} ORDER BY ${sort === "relevance" ? "rank," : ""} m.id DESC LIMIT 50`,
          )
          .all(
            q,
            ...args,
            ...(cursor && sort === "relevance"
              ? [cursor.score, cursor.score, cursor.id]
              : []),
          )
      : this.db
          .prepare(
            `SELECT m.* FROM messages m WHERE ${filters} ORDER BY m.id DESC LIMIT 50`,
          )
          .all(...args);
    return sort === "relevance" && q ? rows : rows.reverse();
  }
  enqueue(source) {
    if (this.get("learn", "true") !== "true") return;
    this.db
      .prepare("INSERT OR IGNORE INTO jobs(source,revision) VALUES(?,?)")
      .run(source, this.revision());
  }
  trackWork(source) {
    const m = this.message(source);
    if (!m || m.role !== "user") return;
    const quote = this.safeText(m.content);
    if (
      /\?\s*$/.test(quote) ||
      /^\s*(?:if\b|suppose\b|imagine\b|>|["“])/i.test(quote)
    )
      return;
    if (
      /\b(completed|finished|resolved)\b/i.test(quote) &&
      !/\b(unfinished|not finished|not completed)\b/i.test(quote)
    ) {
      const keys = terms(quote).filter(
        (t) =>
          ![
            "completed",
            "finished",
            "resolved",
            "have",
            "now",
            "task",
          ].includes(t),
      );
      for (const work of this.db
        .prepare(
          "SELECT * FROM working WHERE state='open' ORDER BY source DESC LIMIT 100",
        )
        .all())
        if (
          keys.filter((t) => work.quote.toLowerCase().includes(t)).length >=
            2 &&
          work.quote
            .match(
              /(?:need to|must|plan to)\s+(?:finish |complete |implement |build )?([^.!?]+)/i,
            )?.[1]
            ?.trim()
            .toLowerCase() ===
            quote
              .match(
                /^(?:I|We)\s+(?:have\s+)?(?:completed|finished|resolved)\s+([^.!?]+)/i,
              )?.[1]
              ?.trim()
              .toLowerCase()
        )
          this.db
            .prepare(
              "UPDATE working SET state='closed',resolved_source=? WHERE source=?",
            )
            .run(source, work.source);
    } else if (
      /\b(need to|must|unfinished|working on|goal|decision|decided|deadline|plan to|finish|unresolved|constraint)\b/i.test(
        quote,
      )
    )
      this.db
        .prepare("INSERT OR IGNORE INTO working(source,quote) VALUES(?,?)")
        .run(
          source,
          quote.length <= 1200
            ? quote
            : quote.slice(0, 1200) + " [source continues]",
        );
  }
  rebuildSummaries() {
    for (const summary of this.db
      .prepare("SELECT * FROM summaries WHERE valid=0 ORDER BY id LIMIT 8")
      .all()) {
      const items = JSON.parse(summary.body)
        .map((item) => ({
          ...item,
          quote: this.safeText(
            this.message(item.source)?.content || item.quote,
          ),
        }))
        .filter((item) => item.quote !== "[memory omitted]");
      this.db
        .prepare(
          "INSERT INTO summary_fts(summary_fts,rowid,body) VALUES('delete',?,?)",
        )
        .run(summary.id, summary.body);
      const body = JSON.stringify(items);
      this.db
        .prepare("UPDATE summaries SET body=?,revision=?,valid=1 WHERE id=?")
        .run(body, this.revision(), summary.id);
      this.db
        .prepare("INSERT INTO summary_fts(rowid,body) VALUES(?,?)")
        .run(summary.id, body);
    }
  }
  compact(force = false) {
    this.rebuildSummaries();
    const start = Number(this.get("compacted_through"));
    const latest = this.db
      .prepare(
        "SELECT coalesce(max(id),0) AS id FROM messages WHERE status='complete'",
      )
      .get().id;
    if (!force && latest - start < 30) return;
    const rows = this.db
      .prepare(
        "SELECT * FROM messages WHERE id>? AND id<=? AND status='complete' ORDER BY id LIMIT 200",
      )
      .all(start, Math.max(start, latest - 8));
    if (!rows.length) return;
    const claims = [];
    for (const m of rows) {
      const safe = this.safeText(m.content);
      if (
        m.role === "user" &&
        /\b(need to|must|unfinished|working on|project|goal|decision|deadline|plan to|finish|remember)\b/i.test(
          safe,
        )
      ) {
        const quote =
          safe.length <= 1200
            ? safe
            : safe.slice(0, 1200) + " [source continues]";
        claims.push({ source: m.id, quote });
        this.trackWork(m.id);
      }
    }
    if (claims.length)
      this.db
        .prepare(
          "INSERT INTO summaries(first_source,last_source,body,revision) VALUES(?,?,?,?)",
        )
        .run(
          rows[0].id,
          rows.at(-1).id,
          JSON.stringify(claims.slice(-12)),
          this.revision(),
        );
    this.set("compacted_through", rows.at(-1).id);
  }
  context(text, budget = 16000, count = require("./tokens.cjs").countText) {
    const begin = performance.now();
    const last = Number(this.get("last_active"));
    if (last && Date.now() - last > 120 * 60000) this.compact(true);
    this.set("last_active", Date.now());
    const historical =
      /\b(before|previously|used to|last year|last month|in 20\d\d|earlier preference)\b/i.test(
        text,
      );
    const extras = [];
    if (/\b(prefer|favourite|favorite)\b/i.test(text))
      extras.push("preference");
    if (/\b(drink|beverage|cup)\b/i.test(text))
      extras.push("tea coffee beverage");
    if (/\b(live|reside|home)\b/i.test(text)) extras.push("location city home");
    if (/\b(food|meal|eat)\b/i.test(text)) extras.push("diet food preference");
    const lastUser = this.db
      .prepare(
        "SELECT content FROM messages WHERE role='user' AND status='complete' ORDER BY id DESC LIMIT 1",
      )
      .get();
    const searchText =
      text +
      " " +
      extras.join(" ") +
      (/\b(it|that|this project)\b/i.test(text)
        ? " " + (lastUser?.content || "").slice(0, 200)
        : "");
    const q = query(searchText);
    const candidates = q
      ? this.db
          .prepare(
            "SELECT m.* FROM history_fts f JOIN messages m ON m.id=f.rowid WHERE history_fts MATCH ? AND m.status='complete' ORDER BY rank LIMIT 12",
          )
          .all(q)
      : [];
    const recent = this.db
      .prepare(
        "SELECT * FROM messages WHERE id>=? AND status='complete' ORDER BY id DESC LIMIT 24",
      )
      .all(Number(this.get("context_start")))
      .reverse();
    const memories = q
      ? this.db
          .prepare(
            `SELECT m.* FROM memory_search f JOIN memories m ON m.id=f.rowid WHERE memory_search MATCH ? AND m.state ${historical ? "IN ('active','superseded')" : "='active'"} ORDER BY rank LIMIT 12`,
          )
          .all(q)
      : [];
    const working = this.db
      .prepare(
        "SELECT * FROM working WHERE state IN ('open','closed') ORDER BY source DESC LIMIT 8",
      )
      .all();
    const summaries = q
      ? this.db
          .prepare(
            "SELECT e.* FROM summary_fts f JOIN summaries e ON e.id=f.rowid WHERE summary_fts MATCH ? AND e.valid=1 ORDER BY rank LIMIT 4",
          )
          .all(q)
      : [];
    const retrievalMs = performance.now() - begin;
    const packStart = performance.now();
    const selected = new Map();
    let used = 0;
    const facts = [],
      state = [],
      episodes = [];
    const add = (item, list, max = budget) => {
      const n = count(JSON.stringify(item)) + 12;
      if (n <= max && used + n <= budget) {
        list.push(item);
        used += n;
        return true;
      }
      return false;
    };
    // Protect recent complete exchanges before optional retrieved facts.
    let recentUsed = 0;
    for (const m of [...recent].reverse()) {
      const safe = this.safeMessage(m, historical);
      if (safe === "[memory omitted]") continue;
      const item = {
        id: m.id,
        role: m.role,
        ...passage(safe, searchText, count),
        dependencies: this.claimDependencies(m.id),
      };
      const tmp = [];
      const n = count(JSON.stringify(item)) + 12;
      if (recentUsed + n <= budget * 0.55 && add(item, tmp, budget * 0.6)) {
        selected.set(m.id, item);
        recentUsed += n;
      }
    }
    for (const w of working) {
      const quote = this.safeText(
        w.state === "closed"
          ? this.message(w.resolved_source)?.content || w.quote
          : w.quote,
        historical,
      );
      if (quote !== "[memory omitted]")
        add(
          { source: w.resolved_source || w.source, quote, state: w.state },
          state,
          1500,
        );
    }
    for (const m of memories) {
      const safe = this.safeText(m.text, historical, m.key);
      if (
        safe !== "[memory omitted]" &&
        this.safeText(m.value || m.text, historical, m.key) !==
          "[memory omitted]"
      )
        add(
          {
            ...m,
            text: safe,
            quote: this.safeText(m.quote, historical, m.key),
            value: this.safeText(m.value || "", historical, m.key),
            aliases: this.safeText(m.aliases || "", historical, m.key),
          },
          facts,
          1200,
        );
    }
    for (const hit of candidates)
      for (const m of this.around(hit.id, 2)) {
        if (m.status !== "complete" || selected.has(m.id)) continue;
        const safe = this.safeMessage(m, historical);
        if (safe === "[memory omitted]") continue;
        const item = {
          id: m.id,
          role: m.role,
          ...passage(safe, searchText, count),
          dependencies: this.claimDependencies(m.id),
        };
        const tmp = [];
        if (add(item, tmp, 1600)) selected.set(m.id, item);
      }
    for (const e of summaries) {
      const body = this.safeText(e.body, historical);
      if (body !== "[memory omitted]")
        add(
          { first: e.first_source, last: e.last_source, body },
          episodes,
          1200,
        );
    }
    return {
      memories: facts,
      history: [...selected.values()].sort((a, b) => a.id - b.id),
      working: state,
      summaries: episodes,
      bytes: Buffer.byteLength(
        JSON.stringify({
          memories: facts,
          history: [...selected.values()],
          working: state,
          summaries: episodes,
        }),
      ),
      tokens: used,
      retrievalMs,
      packingMs: performance.now() - packStart,
      revision: this.revision(),
    };
  }
  close() {
    this.db.close();
  }
}
function inferValue(quote) {
  const match = quote.match(
    /(?:prefer|like|drink|allergic to|live in|name is)\s+(.{3,80}?)(?:\s+(?:when|while|instead|for|at work)|[.!;,]|$)/i,
  );
  return match?.[1]?.trim() || quote;
}
function passage(text, searchText, count) {
  if (count(text) <= 1200) return { content: text };
  const keys = terms(searchText).sort((a, b) => b.length - a.length);
  let at = 0;
  for (const key of keys) {
    const found = text.toLowerCase().indexOf(key);
    if (found >= 0) {
      at = found;
      break;
    }
  }
  const start = Math.max(0, at - 800),
    end = Math.min(text.length, start + 2800);
  return { content: "[Source excerpt] " + text.slice(start, end), start, end };
}
module.exports = { Store, terms, cost, inferValue };
