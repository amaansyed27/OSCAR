// Isolated database fixtures only. Production storage and retrieval run entirely in Rust.
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs"),
  path = require("node:path");
class Store {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(
      fs.readFileSync(
        path.join(__dirname, "../src-tauri/src/schema.sql"),
        "utf8",
      ),
    );
  }
  add(role, content, status = "complete") {
    return Number(
      this.db
        .prepare("INSERT INTO messages(role,content,status) VALUES(?,?,?)")
        .run(role, content, status).lastInsertRowid,
    );
  }
  set(key, value) {
    this.db
      .prepare("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)")
      .run(key, String(value));
  }
  clearContext() {
    this.set(
      "context_start",
      this.db.prepare("SELECT coalesce(max(id),0)+1 AS id FROM messages").get()
        .id,
    );
  }
  close() {
    this.db.close();
  }
}
module.exports = { Store };
