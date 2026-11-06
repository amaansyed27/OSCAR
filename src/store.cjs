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
  history({ before = Number.MAX_SAFE_INTEGER, search = "" } = {}) {
    const q = query(search);
    if (search && !q) return [];
    const rows = q
      ? this.db
          .prepare(
            "SELECT m.* FROM history_fts f JOIN messages m ON m.id=f.rowid WHERE history_fts MATCH ? AND m.id<? ORDER BY m.id DESC LIMIT 50",
          )
          .all(q, before)
      : this.db
          .prepare(
            "SELECT * FROM messages WHERE id<? ORDER BY id DESC LIMIT 50",
          )
          .all(before);
    return rows.reverse();
  }
  memories() {
    return this.db
      .prepare("SELECT * FROM memories WHERE state='active' ORDER BY id DESC")
      .all();
  }
  suppress(memory) {
    // Also suppress later replies that used these history excerpts, transitively.
    this.db
      .prepare(
        `WITH RECURSIVE affected(id) AS (
      SELECT ? UNION SELECT message FROM recall_links WHERE memory=?
      UNION SELECT id FROM messages WHERE id=? AND role='assistant'
      UNION SELECT h.message FROM history_links h JOIN affected a ON h.source=a.id
    ) INSERT OR IGNORE INTO suppressed SELECT id FROM affected`,
      )
      .run(memory.source, memory.id, memory.source + 1);
  }
  saveMemory(key, text, source, quote, replaces = null) {
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
    const old = replaces
      ? this.db
          .prepare("SELECT * FROM memories WHERE id=? AND state='active'")
          .get(replaces)
      : this.db
          .prepare("SELECT * FROM memories WHERE key=? AND state='active'")
          .get(key);
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
        this.suppress(m);
        this.db
          .prepare(
            "UPDATE memories SET state='forgotten',text='',quote='' WHERE id=?",
          )
          .run(m.id);
      }
      this.clearContext();
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
  context(text, budget = 10000) {
    const last = Number(this.get("last_active"));
    if (last && Date.now() - last > 120 * 60000) this.clearContext();
    this.set("last_active", Date.now());
    const q = query(text);
    const relevant = q
      ? this.db
          .prepare(
            "SELECT m.* FROM memory_fts f JOIN memories m ON m.id=f.rowid WHERE memory_fts MATCH ? AND m.state='active' ORDER BY rank LIMIT 12",
          )
          .all(q)
      : [];
    const memories = [
      ...new Map(
        [...relevant, ...this.memories().slice(0, 12)].map((m) => [m.id, m]),
      ).values(),
    ];
    const recent = this.db
      .prepare(
        "SELECT * FROM messages WHERE id>=? AND status='complete' AND id NOT IN (SELECT message FROM suppressed) ORDER BY id DESC LIMIT 24",
      )
      .all(Number(this.get("context_start")));
    const older = q
      ? this.db
          .prepare(
            "SELECT m.* FROM history_fts f JOIN messages m ON m.id=f.rowid WHERE history_fts MATCH ? AND m.status='complete' AND m.id NOT IN (SELECT message FROM suppressed) ORDER BY rank LIMIT 10",
          )
          .all(q)
      : [];
    const facts = [];
    const history = [];
    let used = 0;
    const add = (item, list, max) => {
      const n = cost(JSON.stringify(item));
      if (n <= max && used + n <= budget) {
        list.push(item);
        used += n;
      }
    };
    for (const m of memories)
      add(
        {
          id: m.id,
          key: m.key,
          text: m.text,
          source: m.source,
          quote: m.quote,
        },
        facts,
        1600,
      );
    const selected = new Set();
    for (const m of [...recent.slice(0, 10), ...older, ...recent.slice(10)]) {
      if (selected.has(m.id)) continue;
      const item = { id: m.id, role: m.role, content: m.content };
      const before = history.length;
      add(item, history, budget / 2);
      if (history.length > before) selected.add(m.id);
    }
    history.sort((a, b) => a.id - b.id);
    return { memories: facts, history, bytes: used };
  }
  close() {
    this.db.close();
  }
}
module.exports = { Store, terms, cost };
