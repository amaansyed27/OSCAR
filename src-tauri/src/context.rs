use crate::store::*;
use anyhow::Result;
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::OnceLock, time::Instant};
static TOKENIZER: OnceLock<tiktoken_rs::CoreBPE> = OnceLock::new();
pub fn count(text: &str) -> usize {
    TOKENIZER
        .get_or_init(|| tiktoken_rs::o200k_harmony().expect("embedded tokenizer"))
        .encode_ordinary(text)
        .len()
}
pub fn clean(text: &str) -> String {
    if !text.contains("[memory omitted]") {
        return text.to_owned();
    }
    let text =
        re(r"(?i)\s*(?:instead of|rather than|not)\s*\[memory omitted\]").replace_all(text, "");
    re(r"[^.!?;\n]+[.!?;]?")
        .find_iter(&text)
        .map(|m| m.as_str())
        .filter(|c| !c.contains("[memory omitted]"))
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_owned()
}
fn passage(text: &str, query: &str) -> Value {
    if count(text) <= 1200 {
        return json!({
        "content":text}
        );
    }
    let mut keys = terms(query);
    keys.sort_by_key(|k| std::cmp::Reverse(k.len()));
    let lower = text.to_lowercase();
    let at = keys.iter().find_map(|k| lower.find(k)).unwrap_or(0);
    let char_at = lower[..at].chars().count();
    let start = char_at.saturating_sub(800);
    let excerpt: String = text.chars().skip(start).take(2800).collect();
    json!({
    "content":format!("[Source excerpt] {excerpt}"),"start":start,"end":start+excerpt.chars().count()}
    )
}
fn add(item: Value, list: &mut Vec<Value>, used: &mut usize, budget: usize, max: usize) -> bool {
    let n = count(&item.to_string()) + 12;
    if n <= max && *used + n <= budget {
        list.push(item);
        *used += n;
        true
    } else {
        false
    }
}
impl Store {
    pub fn context(&self, text: &str, budget: usize) -> Result<Value> {
        let begin = Instant::now();
        let now = chrono::Utc::now().timestamp_millis();
        let last: i64 = self.get("last_active", "0").parse().unwrap_or(0);
        if last > 0 && now - last > 120 * 60000 {
            self.compact(true)?;
        }
        self.set("last_active", now)?;
        let historical=re(r"(?i)\b(before|previously|used to|last year|last month|in 20\d\d|earlier preference)\b").is_match(text);
        let mut search = text.to_string();
        for (pattern, extra) in [
            (r"(?i)\b(prefer|favourite|favorite)\b", "preference"),
            (r"(?i)\b(drink|beverage|cup)\b", "tea coffee beverage"),
            (r"(?i)\b(live|reside|home)\b", "location city home"),
            (r"(?i)\b(food|meal|eat)\b", "diet food preference"),
        ] {
            if re(pattern).is_match(text) {
                search.push(' ');
                search.push_str(extra);
            }
        }
        if re(r"(?i)\b(it|that|this project)\b").is_match(text) {
            let prev=self.one("SELECT content FROM messages WHERE role='user' AND status='complete' ORDER BY id DESC LIMIT 1",&[])?;
            search.push_str(&format!(" {}", truncate(st(&prev, "content"), 200)));
        }
        let q = query(&search);
        let candidates = if q.is_empty() {
            vec![]
        } else {
            self.all("SELECT m.* FROM history_fts f JOIN messages m ON m.id=f.rowid WHERE history_fts MATCH ? AND m.status='complete' ORDER BY rank LIMIT 12",&[&q])?
        };
        let start: i64 = self.get("context_start", "0").parse().unwrap_or(0);
        let recent = self.all(
            "SELECT * FROM messages WHERE id>=? AND status='complete' ORDER BY id DESC LIMIT 24",
            &[&start],
        )?;
        let memories = if q.is_empty() {
            vec![]
        } else {
            self.all(&format!("SELECT m.* FROM memory_search f JOIN memories m ON m.id=f.rowid WHERE memory_search MATCH ? AND m.state {} ORDER BY rank LIMIT 12",if historical{
"IN ('active','superseded')"}
else{
"='active'"}
),&[&q])?
        };
        let working = self.all(
            "SELECT * FROM working WHERE state IN ('open','closed') ORDER BY source DESC LIMIT 8",
            &[],
        )?;
        let summaries = if q.is_empty() {
            vec![]
        } else {
            self.all("SELECT e.* FROM summary_fts f JOIN summaries e ON e.id=f.rowid WHERE summary_fts MATCH ? AND e.valid=1 ORDER BY rank LIMIT 4",&[&q])?
        };
        let retrieval = begin.elapsed().as_secs_f64() * 1000.;
        let packing = Instant::now();
        let mut used = 0;
        let (mut facts, mut state, mut episodes) = (vec![], vec![], vec![]);
        let mut selected = BTreeMap::new();
        let mut recent_used = 0;
        let record = |m: &Value| -> Result<Value> {
            let safe = self.safe_message(m, historical)?;
            let mut v = passage(&safe, &search);
            v["id"] = m["id"].clone();
            v["role"] = m["role"].clone();
            v["content"] = json!(clean(st(&v, "content")));
            v["dependencies"] = json!(self
                .all(
                    "SELECT DISTINCT memory FROM derived_claims WHERE message=? LIMIT 24",
                    &[&n(m, "id")]
                )?
                .iter()
                .map(|d| d["memory"].clone())
                .collect::<Vec<_>>());
            Ok(v)
        };
        for m in recent {
            let item = record(&m)?;
            let size = count(&item.to_string()) + 12;
            if st(&item, "content").is_empty() {
                continue;
            }
            let mut tmp = vec![];
            if recent_used + size <= budget * 55 / 100
                && add(item.clone(), &mut tmp, &mut used, budget, budget * 60 / 100)
            {
                selected.insert(n(&m, "id"), item);
                recent_used += size;
            }
        }
        for w in working {
            let resolved = if st(&w, "state") == "closed" {
                self.message(n(&w, "resolved_source"))?
            } else {
                Value::Null
            };
            let quote = clean(&self.safe(
                if resolved.is_null() {
                    st(&w, "quote")
                } else {
                    st(&resolved, "content")
                },
                historical,
                None,
            )?);
            if !quote.is_empty() {
                add(
                    json!({
                    "source":if resolved.is_null(){
                    w["source"].clone()}
                    else{
                    w["resolved_source"].clone()}
                    ,"quote":quote,"state":w["state"]}
                    ),
                    &mut state,
                    &mut used,
                    budget,
                    1500,
                );
            }
        }
        for mut m in memories {
            let key = st(&m, "key").to_owned();
            let val = self.safe(st(&m, "value"), historical, Some(&key))?;
            let safe = clean(&self.safe(st(&m, "text"), historical, Some(&key))?);
            if val.contains("[memory omitted]") || safe.is_empty() {
                continue;
            }
            m["text"] = json!(safe);
            m["value"] = json!(val);
            m["quote"] = json!(self.safe(st(&m, "quote"), historical, Some(&key))?);
            m["aliases"] = json!(self.safe(st(&m, "aliases"), historical, Some(&key))?);
            add(m, &mut facts, &mut used, budget, 1200);
        }
        for hit in candidates {
            for m in self.around(n(&hit, "id"), 2)? {
                if st(&m, "status") != "complete" || selected.contains_key(&n(&m, "id")) {
                    continue;
                }
                let item = record(&m)?;
                let mut tmp = vec![];
                if !st(&item, "content").is_empty()
                    && add(item.clone(), &mut tmp, &mut used, budget, 1600)
                {
                    selected.insert(n(&m, "id"), item);
                }
            }
        }
        for e in summaries {
            let mut items: Vec<Value> = serde_json::from_str(st(&e, "body"))?;
            for item in &mut items {
                item["quote"] = json!(clean(&self.safe(st(item, "quote"), historical, None)?));
            }
            items.retain(|i| !st(i, "quote").is_empty());
            if !items.is_empty() {
                add(
                    json!({
                    "first":e["first_source"],"last":e["last_source"],"body":serde_json::to_string(&items)?}
                    ),
                    &mut episodes,
                    &mut used,
                    budget,
                    1200,
                );
            }
        }
        Ok(json!({
        "memories":facts,"history":selected.into_values().collect::<Vec<_>>(),"working":state,"summaries":episodes,"tokens":used,"retrievalMs":retrieval,"packingMs":packing.elapsed().as_secs_f64()*1000.,"revision":self.revision()}
        ))
    }
}
