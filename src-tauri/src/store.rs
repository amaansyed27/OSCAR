use anyhow::{anyhow, Result};
use regex::Regex;
use rusqlite::{params, types::Value as Sql, Connection, ToSql};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
};
pub struct Store {
    pub db: Connection,
}
pub fn re(pattern: &str) -> Regex {
    use std::sync::{OnceLock, RwLock};
    static CACHE: OnceLock<RwLock<std::collections::HashMap<String, Regex>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| RwLock::new(std::collections::HashMap::new()));
    if let Some(regex) = cache.read().unwrap().get(pattern) {
        return regex.clone();
    }
    let regex = Regex::new(pattern).expect("validated regex");
    let mut map = cache.write().unwrap();
    if map.len() >= 256 {
        map.clear();
    }
    map.insert(pattern.to_owned(), regex.clone());
    regex
}
pub fn n(v: &Value, k: &str) -> i64 {
    v[k].as_i64().unwrap_or(0)
}
pub fn st<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}
pub fn terms(s: &str) -> Vec<String> {
    let stop="a an the is are was were i you my me it this that what which do does did about remember please and or to of for in on with have has had can tell know earlier mentioned";
    let mut seen = HashSet::new();
    re(r"[\p{L}\p{N}]+")
        .find_iter(&s.to_lowercase())
        .map(|m| m.as_str().to_owned())
        .filter(|w| {
            w.len() > 2 && !stop.split_whitespace().any(|x| x == w) && seen.insert(w.clone())
        })
        .take(18)
        .collect()
}
pub fn query(s: &str) -> String {
    terms(s)
        .iter()
        .map(|s| format!("\"{s}\""))
        .collect::<Vec<_>>()
        .join(" OR ")
}
pub fn truncate(s: &str, len: usize) -> String {
    s.chars().take(len).collect()
}
pub fn infer(s: &str) -> String {
    re(r"(?i)(?:prefer|like|drink|allergic to|live in|name is)\s+(.{3,80}?)(?:\s+(?:when|while|instead|for|at work)|[.!;,]|$)").captures(s).map(|c|c[1].trim().to_string()).unwrap_or(s.to_string())
}
impl Store {
    pub fn open(file: &Path) -> Result<Self> {
        if let Some(p) = file.parent() {
            std::fs::create_dir_all(p)?;
        }
        let db = Connection::open(file)?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        let exists: i64 = db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='messages'",
            [],
            |r| r.get(0),
        )?;
        if exists > 0 {
            let backup = file.with_extension("before-tauri.sqlite");
            if !backup.exists() {
                db.backup("main", &backup, None::<fn(rusqlite::backup::Progress)>)?;
            }
        }
        let s = Self { db };
        s.db.execute_batch(include_str!("schema.sql"))?;
        for (name, typ) in [("value", "TEXT"), ("aliases", "TEXT"), ("updated", "TEXT")] {
            if !s
                .all("PRAGMA table_info(memories)", &[])?
                .iter()
                .any(|c| st(c, "name") == name)
            {
                s.db.execute_batch(&format!("ALTER TABLE memories ADD COLUMN {name} {typ}"))?;
            }
        }
        s.db.execute_batch("CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(text,aliases,tokenize='porter unicode61');CREATE TRIGGER IF NOT EXISTS memory_search_insert AFTER INSERT ON memories BEGIN INSERT INTO memory_search(rowid,text,aliases) VALUES(new.id,new.text,new.aliases); END;CREATE TRIGGER IF NOT EXISTS memory_search_update AFTER UPDATE OF text,aliases ON memories BEGIN DELETE FROM memory_search WHERE rowid=old.id; INSERT INTO memory_search(rowid,text,aliases) VALUES(new.id,new.text,new.aliases); END;")?;
        if s.all("SELECT 1 FROM memory_search LIMIT 1", &[])?
            .is_empty()
        {
            s.db.execute_batch("INSERT INTO memory_search(rowid,text,aliases) SELECT id,text,coalesce(aliases,key) FROM memories")?;
        }
        if !s
            .all("PRAGMA table_info(working)", &[])?
            .iter()
            .any(|c| st(c, "name") == "resolved_source")
        {
            s.db.execute_batch(
                "ALTER TABLE working ADD COLUMN resolved_source INTEGER REFERENCES messages(id)",
            )?;
        }
        let version: i64 = s.db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version < 2 {
            for m in s.all("SELECT * FROM memories WHERE state!='active'", &[])? {
                s.exclude(&m, st(&m, "state") == "forgotten")?;
            }
        }
        if version < 3 {
            s.db.execute_batch("PRAGMA user_version=3")?;
        }
        s.db.execute_batch("UPDATE jobs SET state='pending' WHERE state='running'; UPDATE messages SET status='interrupted' WHERE status='pending';")?;
        Ok(s)
    }
    pub fn all(&self, sql: &str, args: &[&dyn ToSql]) -> Result<Vec<Value>> {
        let mut stmt = self.db.prepare_cached(sql)?;
        let names: Vec<String> = stmt.column_names().map(|s| s.to_string()).collect();
        let rows = stmt.query_map(args, |r| {
            let mut obj = serde_json::Map::new();
            for (i, name) in names.iter().enumerate() {
                let v: Sql = r.get(i)?;
                obj.insert(
                    name.clone(),
                    match v {
                        Sql::Null => Value::Null,
                        Sql::Integer(n) => json!(n),
                        Sql::Real(n) => json!(n),
                        Sql::Text(s) => json!(s),
                        Sql::Blob(_) => Value::Null,
                    },
                );
            }
            Ok(Value::Object(obj))
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
    pub fn one(&self, sql: &str, args: &[&dyn ToSql]) -> Result<Value> {
        Ok(self
            .all(sql, args)?
            .into_iter()
            .next()
            .unwrap_or(Value::Null))
    }
    pub fn get(&self, key: &str, fallback: &str) -> String {
        self.db
            .query_row("SELECT value FROM settings WHERE key=?", [key], |r| {
                r.get(0)
            })
            .unwrap_or(fallback.to_owned())
    }
    pub fn set(&self, k: &str, v: impl ToString) -> Result<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO settings VALUES(?,?)",
            params![k, v.to_string()],
        )?;
        Ok(())
    }
    pub fn add(&self, role: &str, content: &str, status: &str) -> Result<i64> {
        self.db.execute(
            "INSERT INTO messages(role,content,status) VALUES(?,?,?)",
            params![role, content, status],
        )?;
        Ok(self.db.last_insert_rowid())
    }
    pub fn message(&self, id: i64) -> Result<Value> {
        self.one("SELECT * FROM messages WHERE id=?", &[&id])
    }
    pub fn revision(&self) -> i64 {
        self.get("memory_revision", "0").parse().unwrap_or(0)
    }
    fn bump(&self) -> Result<()> {
        self.set("memory_revision", self.revision() + 1)?;
        self.db.execute("UPDATE summaries SET valid=0", [])?;
        Ok(())
    }
    pub fn transaction<T>(&self, f: impl FnOnce() -> Result<T>) -> Result<T> {
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        match f() {
            Ok(v) => {
                self.db.execute_batch("COMMIT")?;
                Ok(v)
            }
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }
    fn exclude(&self, m: &Value, permanent: bool) -> Result<()> {
        let val = if st(m, "value").is_empty() {
            infer(st(m, "quote"))
        } else {
            st(m, "value").to_owned()
        };
        let mut phrases = vec![val.clone()];
        if re(r"(?i)(tea|coffee)$").is_match(&val) {
            phrases.push(val.split_whitespace().next().unwrap_or("").to_owned());
        }
        let mut seen = HashSet::new();
        for p in phrases {
            if p.len() >= 3 && seen.insert(p.clone()) {
                self.db.execute(
                    "INSERT INTO exclusions(memory_key,phrase,source,permanent) VALUES(?,?,?,?)",
                    params![st(m, "key"), p, n(m, "source"), permanent],
                )?;
            }
        }
        Ok(())
    }
    pub fn safe(&self, text: &str, historical: bool, key: Option<&str>) -> Result<String> {
        let rows = if let Some(k) = key {
            self.all(
                "SELECT phrase FROM exclusions WHERE memory_key=? AND (permanent=1 OR ?=0)",
                &[&k, &historical],
            )?
        } else {
            self.all(
                "SELECT phrase FROM exclusions WHERE permanent=1 OR ?=0",
                &[&historical],
            )?
        };
        let mut text = text.to_owned();
        for row in rows {
            let p = st(&row, "phrase");
            let pattern = if p.is_ascii() {
                format!(r"(?i)\b{}\b", regex::escape(p))
            } else {
                format!("(?i){}", regex::escape(p))
            };
            text = re(&pattern)
                .replace_all(&text, "[memory omitted]")
                .into_owned();
        }
        Ok(text)
    }
    pub fn safe_message(&self, m: &Value, historical: bool) -> Result<String> {
        let mut text = st(m, "content").to_owned();
        let spans=self.all("SELECT d.first_offset,d.last_offset FROM derived_claims d JOIN memories m ON m.id=d.memory WHERE d.message=? AND (m.state='forgotten' OR (?=0 AND m.state='superseded')) ORDER BY d.first_offset DESC",&[&n(m,"id"),&historical])?;
        let mut previous = usize::MAX;
        for span in spans {
            let first = n(&span, "first_offset") as usize;
            let last = n(&span, "last_offset") as usize;
            // Offsets remain JS UTF-16 compatible for existing databases.
            let units: Vec<u16> = text.encode_utf16().collect();
            if last <= previous && first <= last && last <= units.len() {
                let a = String::from_utf16_lossy(&units[..first]);
                let b = String::from_utf16_lossy(&units[last..]);
                text = format!("{a}[memory omitted]. {b}");
                previous = first;
            }
        }
        self.safe(&text, historical, None)
    }
    pub fn save_memory(
        &self,
        key: &str,
        quote: &str,
        source: i64,
        replaces: Option<i64>,
        value: Option<&str>,
        aliases: Option<&str>,
    ) -> Result<i64> {
        if !re(r"^[a-z0-9_.-]{2,80}$").is_match(key)
            || quote.chars().count() > 600
            || quote.trim().len() < 3
        {
            return Err(anyhow!("Invalid memory."));
        }
        let msg = self.message(source)?;
        if st(&msg, "role") != "user" || !st(&msg, "content").contains(quote) {
            return Err(anyhow!("Memory needs an exact user source."));
        }
        let old = if let Some(id) = replaces {
            self.one(
                "SELECT * FROM memories WHERE id=? AND state='active'",
                &[&id],
            )?
        } else {
            self.one(
                "SELECT * FROM memories WHERE key=? AND state='active'",
                &[&key],
            )?
        };
        let value = value
            .filter(|v| !v.is_empty() && quote.contains(v))
            .map(String::from)
            .unwrap_or_else(|| infer(quote));
        if !old.is_null() && (st(&old, "text") == quote || st(&old, "value") == value) {
            return Ok(n(&old, "id"));
        }
        if n(&old, "source") > source {
            return Err(anyhow!("A newer memory already exists."));
        }
        self.transaction(||{
let actual_key=if old.is_null(){
key}
else{
st(&old,"key")}
;
if !old.is_null(){
self.exclude(&old,false)?;
self.db.execute("UPDATE memories SET state='superseded' WHERE id=?",[n(&old,"id")])?;
}
self.db.execute("INSERT INTO memories(key,text,source,quote,replaces,value,aliases,updated) VALUES(?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",params![actual_key,quote,source,quote,if old.is_null(){
None}
else{
Some(n(&old,"id"))}
,value,aliases.unwrap_or(&actual_key.replace(['_','.']," "))])?;
let id=self.db.last_insert_rowid();
self.bump()?;
Ok(id)}
)
    }
    pub fn forget(&self, id: i64) -> Result<()> {
        let m = self.one(
            "SELECT * FROM memories WHERE id=? AND state='active'",
            &[&id],
        )?;
        if m.is_null() {
            return Err(anyhow!("Memory is no longer active."));
        }
        self.transaction(|| {
            for old in self.all("SELECT * FROM memories WHERE key=?", &[&st(&m, "key")])? {
                self.exclude(&old, true)?;
                self.db.execute(
                    "UPDATE memories SET state='forgotten',text='',quote='' WHERE id=?",
                    [n(&old, "id")],
                )?;
            }
            self.bump()
        })
    }
    pub fn around(&self, id: i64, limit: i64) -> Result<Vec<Value>> {
        let mut rows = self.all(
            "SELECT * FROM messages WHERE id<=? ORDER BY id DESC LIMIT ?",
            &[&id, &limit],
        )?;
        rows.reverse();
        rows.extend(self.all(
            "SELECT * FROM messages WHERE id>? ORDER BY id LIMIT ?",
            &[&id, &limit],
        )?);
        Ok(rows)
    }
    pub fn memories(&self, o: &Value) -> Result<Vec<Value>> {
        let state = o["state"].as_str().unwrap_or("active");
        let before = o["before"].as_i64().unwrap_or(i64::MAX);
        let search = format!("%{}%", st(o, "search"));
        self.all("SELECT * FROM memories WHERE state=? AND id<? AND (text LIKE ? OR aliases LIKE ?) ORDER BY id DESC LIMIT 60",&[&state,&before,&search,&search])
    }
    pub fn history(&self, o: &Value) -> Result<Vec<Value>> {
        let before = o["before"].as_i64().unwrap_or(i64::MAX);
        let after = n(o, "after");
        let search = st(o, "search");
        let q = query(search);
        if !search.is_empty() && q.is_empty() {
            return Ok(vec![]);
        }
        let from = if st(o, "from").is_empty() {
            "0000".to_owned()
        } else {
            date_bound(st(o, "from"), false)?
        };
        let to = if st(o, "to").is_empty() {
            "9999".to_owned()
        } else {
            date_bound(st(o, "to"), true)?
        };
        let relevance = st(o, "sort") == "relevance" && !q.is_empty();
        let filters="m.id<? AND m.id>? AND m.created>=? AND m.created<=? AND (m.role!='assistant' OR m.content!='')";
        let mut args: Vec<&dyn ToSql> = vec![&before, &after, &from, &to];
        let score = o["cursor"]["score"].as_f64().unwrap_or(0.);
        let cursor = n(&o["cursor"], "id");
        let sql = if q.is_empty() {
            format!("SELECT m.* FROM messages m WHERE {filters} ORDER BY m.id DESC LIMIT 50")
        } else {
            args.insert(0, &q);
            let extra = if relevance && cursor > 0 {
                args.extend([&score as &dyn ToSql, &score, &cursor]);
                "AND (f.rank>? OR (f.rank=? AND m.id<?))"
            } else {
                ""
            };
            format!("SELECT m.*,f.rank AS score FROM history_fts f JOIN messages m ON m.id=f.rowid WHERE history_fts MATCH ? AND {filters} {extra} ORDER BY {} m.id DESC LIMIT 50",if relevance{
"rank,"}
else{
""}
)
        };
        let mut rows = self.all(&sql, &args)?;
        if !relevance {
            rows.reverse();
        }
        Ok(rows)
    }
    pub fn clear(&self) -> Result<()> {
        self.transaction(|| {
            self.set(
                "context_start",
                n(
                    &self.one("SELECT coalesce(max(id),0)+1 AS id FROM messages", &[])?,
                    "id",
                ),
            )?;
            self.db.execute("UPDATE working SET state='cleared'", [])?;
            Ok(())
        })
    }
    pub fn enqueue(&self, source: i64) -> Result<()> {
        if self.get("learn", "true") == "true" {
            self.db.execute(
                "INSERT OR IGNORE INTO jobs(source,revision) VALUES(?,?)",
                params![source, self.revision()],
            )?;
        }
        Ok(())
    }
    pub fn track_work(&self, source: i64) -> Result<()> {
        let m = self.message(source)?;
        if st(&m, "role") != "user" {
            return Ok(());
        }
        let quote = self.safe(st(&m, "content"), false, None)?;
        if re(r#"(?i)(\?\s*$|^\s*(?:if\b|suppose\b|imagine\b|>|["“]))"#).is_match(&quote) {
            return Ok(());
        }
        let completed =
            re(r"(?i)^(?:I|We)\s+(?:have\s+)?(?:completed|finished|resolved)\s+([^.!?]+)");
        if let Some(c)=completed.captures(&quote){
for w in self.all("SELECT * FROM working WHERE state='open' ORDER BY source DESC LIMIT 100",&[])?{
if let Some(task)=re(r"(?i)(?:need to|must|plan to)\s+(?:finish |complete |implement |build )?([^.!?]+)").captures(st(&w,"quote")){
if task[1].trim().eq_ignore_ascii_case(c[1].trim()){
self.db.execute("UPDATE working SET state='closed',resolved_source=? WHERE source=?",params![source,n(&w,"source")])?;
}
}
}
}
else if re(r"(?i)\b(need to|must|unfinished|working on|goal|decision|decided|deadline|plan to|finish|unresolved|constraint)\b").is_match(&quote){
self.db.execute("INSERT OR IGNORE INTO working(source,quote) VALUES(?,?)",params![source,truncate(&quote,1200)])?;
}
        Ok(())
    }
    pub fn compact(&self, force: bool) -> Result<()> {
        for e in self.all(
            "SELECT * FROM summaries WHERE valid=0 ORDER BY id LIMIT 8",
            &[],
        )? {
            let mut items: Vec<Value> = serde_json::from_str(st(&e, "body"))?;
            for item in &mut items {
                let m = self.message(n(item, "source"))?;
                item["quote"] = json!(self.safe(st(&m, "content"), false, None)?);
            }
            let body = serde_json::to_string(&items)?;
            self.transaction(|| {
                self.db.execute(
                    "INSERT INTO summary_fts(summary_fts,rowid,body) VALUES('delete',?,?)",
                    params![n(&e, "id"), st(&e, "body")],
                )?;
                self.db.execute(
                    "UPDATE summaries SET body=?,revision=?,valid=1 WHERE id=?",
                    params![body, self.revision(), n(&e, "id")],
                )?;
                self.db.execute(
                    "INSERT INTO summary_fts(rowid,body) VALUES(?,?)",
                    params![n(&e, "id"), body],
                )?;
                Ok(())
            })?;
        }
        let start: i64 = self.get("compacted_through", "0").parse().unwrap_or(0);
        let latest = n(
            &self.one(
                "SELECT coalesce(max(id),0) AS id FROM messages WHERE status='complete'",
                &[],
            )?,
            "id",
        );
        if !force && latest - start < 30 {
            return Ok(());
        }
        let rows=self.all("SELECT * FROM messages WHERE id>? AND id<=? AND status='complete' ORDER BY id LIMIT 200",&[&start,&(latest-8).max(start)])?;
        if rows.is_empty() {
            return Ok(());
        }
        let mut claims = vec![];
        for m in &rows {
            let text = self.safe(st(m, "content"), false, None)?;
            if st(m,"role")=="user"&&re(r"(?i)\b(need to|must|unfinished|working on|project|goal|decision|deadline|plan to|finish|remember)\b").is_match(&text){
claims.push(json!({
"source":m["id"],"quote":truncate(&text,1200)}
));
self.track_work(n(m,"id"))?;
}
        }
        if !claims.is_empty() {
            let skip = claims.len().saturating_sub(12);
            self.db.execute(
                "INSERT INTO summaries(first_source,last_source,body,revision) VALUES(?,?,?,?)",
                params![
                    n(&rows[0], "id"),
                    n(rows.last().unwrap(), "id"),
                    serde_json::to_string(&claims[skip..])?,
                    self.revision()
                ],
            )?;
        }
        self.set("compacted_through", n(rows.last().unwrap(), "id"))
    }
    pub fn record_claims(&self, id: i64, text: &str, context: &Value) -> Result<()> {
        let mut candidates: BTreeMap<i64, Value> = BTreeMap::new();
        for m in context["memories"].as_array().into_iter().flatten() {
            let mut m = m.clone();
            m["refs"] = json!([m["source"]]);
            candidates.insert(n(&m, "id"), m);
        }
        for h in context["history"].as_array().into_iter().flatten() {
            for dep in h["dependencies"].as_array().into_iter().flatten() {
                let key = dep.as_i64().unwrap_or(0);
                let m = self.one(
                    "SELECT * FROM memories WHERE id=? AND state!='forgotten'",
                    &[&key],
                )?;
                if !m.is_null() {
                    let m = candidates.entry(key).or_insert_with(|| {
                        let mut v = m;
                        v["refs"] = json!([v["source"]]);
                        v
                    });
                    m["refs"].as_array_mut().unwrap().push(h["id"].clone());
                }
            }
        }
        for sentence in re(r"[^.!?\n]+[.!?]?(?:\s*\[#\d+\])*").find_iter(text) {
            let part = sentence.as_str();
            for m in candidates.values() {
                let value = if st(m, "value").is_empty() {
                    infer(st(m, "quote"))
                } else {
                    st(m, "value").to_owned()
                };
                let matched = Regex::new(&format!("(?i){}", regex::escape(&value)))?.find(part);
                let cited = m["refs"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|r| part.contains(&format!("[#{r}]")));
                let (a, b) = if let Some(v) = matched {
                    (sentence.start() + v.start(), sentence.start() + v.end())
                } else if cited {
                    (sentence.start(), sentence.end())
                } else {
                    continue;
                };
                self.db.execute("INSERT INTO derived_claims(message,first_offset,last_offset,memory) VALUES(?,?,?,?)",params![id,text[..a].encode_utf16().count() as i64,text[..b].encode_utf16().count() as i64,n(m,"id")])?;
            }
        }
        Ok(())
    }
}
fn date_bound(s: &str, end: bool) -> Result<String> {
    use chrono::{Local, TimeZone};
    let d = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")?;
    let t = if end {
        d.and_hms_milli_opt(23, 59, 59, 999)
    } else {
        d.and_hms_opt(0, 0, 0)
    }
    .ok_or_else(|| anyhow!("Invalid date"))?;
    Ok(Local
        .from_local_datetime(&t)
        .earliest()
        .ok_or_else(|| anyhow!("Invalid date"))?
        .to_utc()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}
