use oscar_core::store::*;
use serde_json::{json, Value};
fn metric(mut values: Vec<f64>) -> Value {
    values.sort_by(f64::total_cmp);
    json!({"p50_ms":values[10],"p95_ms":values[18]})
}
fn main() -> anyhow::Result<()> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let dir = root.join(".oscar").join(format!(
        "performance-rust-{}",
        chrono::Utc::now().timestamp_millis()
    ));
    let s = Store::open(&dir.join("oscar.sqlite"))?;
    let source = s.add(
        "user",
        "The lighthouse archive code is MARIGOLD-73.",
        "complete",
    )?;
    s.transaction(|| {
        for i in 0..100000 {
            s.add(
                if i % 2 == 0 { "user" } else { "assistant" },
                &format!(
                    "{}{i} with a short chronological message.",
                    if i % 5 == 0 {
                        "OSCAR project memory roadmap "
                    } else {
                        "Daily planning notes "
                    }
                ),
                "complete",
            )?;
        }
        Ok(())
    })?;
    s.set("context_start", 100002)?;
    let mut results = json!({"scope":"Synthetic warm-cache Rust retrieval and packing; excludes provider and UI latency","records":100001,"sqlite":s.one("SELECT sqlite_version() AS version",&[])?["version"]});
    for (name, query) in [
        ("specific", "lighthouse archive code"),
        ("broad", "project memory planning"),
    ] {
        for _ in 0..3 {
            s.context(query, 16000)?;
        }
        let (mut retrieval, mut packing, mut max_tokens) = (vec![], vec![], 0);
        for _ in 0..20 {
            let c = s.context(query, 16000)?;
            retrieval.push(c["retrievalMs"].as_f64().unwrap());
            packing.push(c["packingMs"].as_f64().unwrap());
            max_tokens = max_tokens.max(n(&c, "tokens"));
            if name == "specific" {
                assert!(c["history"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|h| n(h, "id") == source));
            }
        }
        results[name] =
            json!({"retrieval":metric(retrieval),"packing":metric(packing),"maxTokens":max_tokens});
    }
    let start = 100002;
    s.transaction(|| {
        for i in 0..24 {
            s.add(
                if i % 2 == 0 { "user" } else { "assistant" },
                &format!(
                    "Recent exchange {i} {}",
                    "Detailed recent work context. ".repeat(150)
                ),
                "complete",
            )?;
        }
        Ok(())
    })?;
    s.set("context_start", start)?;
    let mut budgets = vec![];
    for limit in [8000, 16000, 32000] {
        let c = s.context("lighthouse archive code", limit)?;
        assert!(n(&c, "tokens") <= limit as i64);
        assert!(c["history"]
            .as_array()
            .unwrap()
            .iter()
            .any(|h| n(h, "id") == source));
        budgets.push(json!({"limit":limit,"used":c["tokens"],"recentMessages":c["history"].as_array().unwrap().iter().filter(|h|n(h,"id")>=start).count(),"originalSourceRetained":true}));
    }
    results["budgets"] = json!(budgets);
    let out = root.join(".oscar/tauri-evidence");
    std::fs::create_dir_all(&out)?;
    let text = serde_json::to_string_pretty(&results)?;
    std::fs::write(out.join("performance.json"), &text)?;
    println!("{text}");
    Ok(())
}
