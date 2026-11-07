use oscar_core::{context::count, runtime::Runtime, store::*};
use serde_json::json;
use tempfile::tempdir;
fn fresh() -> (tempfile::TempDir, Store) {
    let d = tempdir().unwrap();
    let s = Store::open(&d.path().join("oscar.sqlite")).unwrap();
    (d, s)
}
#[test]
fn token_compaction_and_repeated_project_recall() {
    let (_d, s) = fresh();
    let mut sources = vec![];
    for round in 0..4 {
        let fact = format!("Project Meridian{round} archive code is LANTERN-{round}7. I need to finish its access review.");
        let id = s.add("user", &fact, "complete").unwrap();
        sources.push((id, fact, round));
        for _ in 0..18 {
            s.add("assistant", "Context fixture only.", "complete")
                .unwrap();
        }
        s.set("episode_tokens", 3000).unwrap();
        s.set("episode_threshold", 2048).unwrap();
        s.context("Continue the unfinished review", 4000).unwrap();
        assert_eq!(s.get("episode_tokens", "-1"), "0");
    }
    for (id, text, round) in sources {
        for limit in [4000, 8000, 16000] {
            let c = s
                .context(
                    &format!("What is the archive code for Meridian{round}?"),
                    limit,
                )
                .unwrap();
            assert!(c.to_string().contains(&format!("LANTERN-{round}7")));
            assert!(n(&c, "tokens") <= limit as i64);
            assert_eq!(st(&s.message(id).unwrap(), "content"), text);
        }
    }
}
#[tokio::test]
async fn clear_chat_boundary_is_persistent_and_separate() {
    let (d, s) = fresh();
    let id = s
        .add("user", "Project Cedar deadline is December 12.", "complete")
        .unwrap();
    s.set("context_start", 0).unwrap();
    drop(s);
    let rt = Runtime::open(d.path(), &d.path().join("oscar.sqlite"), |_| {}).unwrap();
    rt.action("clearChat", json!(null)).await.unwrap();
    assert!(rt
        .action("history", json!({"visible":true}))
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        rt.action("source", json!(id)).await.unwrap()["content"],
        "Project Cedar deadline is December 12."
    );
    assert_eq!(
        rt.db(|s| Ok(s.get("context_start", "-1"))).await.unwrap(),
        "0"
    );
    drop(rt);
    let rt = Runtime::open(d.path(), &d.path().join("oscar.sqlite"), |_| {}).unwrap();
    assert!(rt
        .action("history", json!({"visible":true}))
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .is_empty());
    assert!(rt
        .db(|s| s.context("What is the Cedar deadline?", 4000))
        .await
        .unwrap()
        .to_string()
        .contains("December 12"));
}
#[test]
fn restart_and_reset_preserve_records() {
    let (d, s) = fresh();
    let id = s
        .add("user", "I prefer peppermint tea at work.", "complete")
        .unwrap();
    s.save_memory(
        "work.drink",
        "I prefer peppermint tea at work.",
        id,
        None,
        Some("peppermint tea"),
        Some("beverage preference"),
    )
    .unwrap();
    s.set("draft", "unfinished text").unwrap();
    s.clear().unwrap();
    drop(s);
    let s = Store::open(&d.path().join("oscar.sqlite")).unwrap();
    assert_eq!(
        st(&s.message(id).unwrap(), "content"),
        "I prefer peppermint tea at work."
    );
    assert_eq!(s.memories(&json!({})).unwrap().len(), 1);
    assert_eq!(s.get("draft", ""), "unfinished text");
    assert!(d.path().join("oscar.before-tauri.sqlite").exists());
}
#[test]
fn correction_historical_and_forget_isolation() {
    let (_d, s) = fresh();
    let a = s
        .add(
            "user",
            "I prefer coffee at work. My project deadline is December 12.",
            "complete",
        )
        .unwrap();
    let old = s
        .save_memory(
            "work.drink",
            "I prefer coffee at work.",
            a,
            None,
            Some("coffee"),
            Some("beverage preference"),
        )
        .unwrap();
    s.save_memory(
        "project.deadline",
        "My project deadline is December 12.",
        a,
        None,
        Some("December 12"),
        Some("project deadline"),
    )
    .unwrap();
    let b = s
        .add("user", "I now prefer peppermint tea at work.", "complete")
        .unwrap();
    let new = s
        .save_memory(
            "work.drink",
            "I now prefer peppermint tea at work.",
            b,
            Some(old),
            Some("peppermint tea"),
            Some("beverage preference"),
        )
        .unwrap();
    let c = s
        .context("What beverage do I prefer at work?", 4000)
        .unwrap();
    assert!(!c.to_string().contains("I prefer coffee"));
    let h = s
        .context("What beverage did I prefer previously?", 4000)
        .unwrap();
    assert!(h.to_string().contains("superseded"));
    s.forget(new).unwrap();
    let c = s
        .context("What is my beverage preference and project deadline?", 5000)
        .unwrap();
    assert!(!c.to_string().contains("peppermint"));
    assert!(!c.to_string().contains("coffee"));
    assert!(c.to_string().contains("December 12"));
    assert!(st(&s.message(a).unwrap(), "content").contains("coffee"));
}
#[test]
fn exact_source_only() {
    let (_d, s) = fresh();
    let a = s
        .add("assistant", "You like green tea.", "complete")
        .unwrap();
    assert!(s
        .save_memory(
            "drink.preference",
            "You like green tea.",
            a,
            None,
            None,
            None
        )
        .is_err());
    let u = s.add("user", "I like tea.", "complete").unwrap();
    assert!(s
        .save_memory("drink.preference", "I like coffee.", u, None, None, None)
        .is_err());
}
#[test]
fn compaction_keeps_work_and_sources() {
    let (_d, s) = fresh();
    let id = s
        .add(
            "user",
            "I need to finish OSCAR keyboard navigation. This is unfinished work.",
            "complete",
        )
        .unwrap();
    for i in 0..100 {
        s.add("user", &format!("Ordinary note {i}"), "complete")
            .unwrap();
    }
    s.compact(true).unwrap();
    s.set("context_start", 102).unwrap();
    let c = s.context("What work is unfinished?", 4000).unwrap();
    assert!(c.to_string().contains("keyboard navigation"));
    assert!(c.to_string().contains(&format!("\"source\":{id}")));
    assert!(!s.message(id).unwrap().is_null());
}
#[test]
fn long_history_and_pagination() {
    let (_d, s) = fresh();
    let id = s
        .add(
            "user",
            "The lighthouse archive code is MARIGOLD-73.",
            "complete",
        )
        .unwrap();
    s.transaction(|| {
        for i in 0..3000 {
            s.add("user", &format!("Ordinary note {i}"), "complete")?;
        }
        Ok(())
    })
    .unwrap();
    s.clear().unwrap();
    let c = s
        .context("What was the lighthouse archive code?", 1800)
        .unwrap();
    assert!(c.to_string().contains("MARIGOLD-73"));
    assert!(n(&c, "tokens") <= 1800);
    let hits = s.history(&json!({"search":"lighthouse archive"})).unwrap();
    assert_eq!(n(&hits[0], "id"), id);
    assert!(s.around(id, 12).unwrap().len() <= 24);
    let page = s.history(&json!({})).unwrap();
    assert_eq!(page.len(), 50);
    let older = s.history(&json!({"before":page[0]["id"]})).unwrap();
    assert!(n(older.last().unwrap(), "id") < n(&page[0], "id"));
}
#[test]
fn interrupted_recovery() {
    let (d, s) = fresh();
    let u = s.add("user", "A request", "pending").unwrap();
    let a = s.add("assistant", "A partial reply", "pending").unwrap();
    drop(s);
    let s = Store::open(&d.path().join("oscar.sqlite")).unwrap();
    assert_eq!(st(&s.message(u).unwrap(), "status"), "interrupted");
    assert_eq!(st(&s.message(a).unwrap(), "content"), "A partial reply");
}
#[test]
fn unicode_and_literal_special_tokens() {
    assert!(count("こんにちは世界") > 0);
    assert!(count("<|im_start|> user") > 1);
    assert!(count(&"🙂".repeat(100)) >= 100);
}
#[test]
fn scoped_forget_same_value() {
    let (_d, s) = fresh();
    let id = s
        .add(
            "user",
            "My brother is Alex. My colleague is Alex.",
            "complete",
        )
        .unwrap();
    let a = s
        .save_memory(
            "family.brother",
            "My brother is Alex.",
            id,
            None,
            Some("Alex"),
            Some("brother"),
        )
        .unwrap();
    s.save_memory(
        "work.colleague",
        "My colleague is Alex.",
        id,
        None,
        Some("Alex"),
        Some("colleague"),
    )
    .unwrap();
    s.forget(a).unwrap();
    let c = s.context("Who is my colleague?", 3000).unwrap();
    assert!(c["memories"].to_string().contains("My colleague is Alex"));
}
#[test]
fn derived_claim_offsets_are_utf16_compatible() {
    let (_d, s) = fresh();
    let id = s
        .add("user", "I prefer peppermint tea at work.", "complete")
        .unwrap();
    let memory = s
        .save_memory(
            "work.drink",
            "I prefer peppermint tea at work.",
            id,
            None,
            Some("peppermint tea"),
            Some("beverage"),
        )
        .unwrap();
    let ctx = s.context("What beverage?", 3000).unwrap();
    let text = "🙂 You prefer a herbal beverage. [#1] Other work is ongoing.";
    let aid = s.add("assistant", text, "complete").unwrap();
    s.record_claims(aid, text, &ctx).unwrap();
    s.forget(memory).unwrap();
    let safe = s.safe_message(&s.message(aid).unwrap(), false).unwrap();
    assert!(!safe.contains("herbal beverage"));
    assert!(safe.contains("Other work"));
}
#[tokio::test]
async fn delayed_jobs_cannot_resurrect_and_unrelated_remain() {
    let (d, s) = fresh();
    let id = s
        .add("user", "I prefer peppermint tea at work.", "complete")
        .unwrap();
    let memory = s
        .save_memory(
            "work.drink",
            "I prefer peppermint tea at work.",
            id,
            None,
            Some("peppermint tea"),
            Some("beverage"),
        )
        .unwrap();
    let revision = s.revision();
    let existing = s.memories(&json!({})).unwrap();
    s.forget(memory).unwrap();
    drop(s);
    let rt = Runtime::open(
        std::path::Path::new(".."),
        &d.path().join("oscar.sqlite"),
        |_| {},
    )
    .unwrap();
    let changes = vec![
        json!({"operation":"remember","key":"work.drink","quote":"I prefer peppermint tea at work.","value":"peppermint tea","aliases":"beverage","replaces":memory}),
    ];
    assert!(!rt
        .apply(
            changes.clone(),
            existing.clone(),
            "I prefer peppermint tea at work.".into(),
            id,
            revision
        )
        .await
        .unwrap());
    let rev = rt.db(|s| Ok(s.revision())).await.unwrap();
    rt.apply(
        changes,
        existing,
        "I prefer peppermint tea at work.".into(),
        id,
        rev,
    )
    .await
    .unwrap();
    assert!(rt
        .action("memories", json!({}))
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .is_empty());
}
#[test]
fn invalidated_summary_retains_unrelated_work() {
    let (_d, s) = fresh();
    let id = s
        .add(
            "user",
            "Remember I prefer peppermint tea. I need to finish lighthouse report.",
            "complete",
        )
        .unwrap();
    let memory = s
        .save_memory(
            "drink.preference",
            "I prefer peppermint tea.",
            id,
            None,
            Some("peppermint tea"),
            None,
        )
        .unwrap();
    for _ in 0..40 {
        s.add("assistant", "Other chronological content", "complete")
            .unwrap();
    }
    s.compact(true).unwrap();
    s.forget(memory).unwrap();
    s.compact(false).unwrap();
    let c = s.context("lighthouse report peppermint tea", 4000).unwrap();
    assert!(!c.to_string().contains("peppermint"));
    assert!(c.to_string().contains("lighthouse report"));
    assert!(!s.message(id).unwrap().is_null());
}
#[test]
fn completion_cannot_reopen_after_compaction() {
    let (_d, s) = fresh();
    let a = s
        .add("user", "I need to finish lighthouse report.", "complete")
        .unwrap();
    s.track_work(a).unwrap();
    let b = s
        .add("user", "I completed lighthouse report.", "complete")
        .unwrap();
    s.track_work(b).unwrap();
    for _ in 0..40 {
        s.add("assistant", "A chronological record", "complete")
            .unwrap();
    }
    s.compact(true).unwrap();
    let w = s
        .one("SELECT * FROM working WHERE source=?", &[&a])
        .unwrap();
    assert_eq!(st(&w, "state"), "closed");
    assert_eq!(n(&w, "resolved_source"), b);
    let c = s.context("What work on lighthouse report?", 4000).unwrap();
    assert_eq!(c["working"][0]["source"], b);
}
#[test]
fn inactivity_preserves_work() {
    let (_d, s) = fresh();
    let id = s
        .add("user", "I must finish lighthouse report.", "complete")
        .unwrap();
    s.track_work(id).unwrap();
    for _ in 0..40 {
        s.add("assistant", "Routine record", "complete").unwrap();
    }
    s.set(
        "last_active",
        chrono::Utc::now().timestamp_millis() - 121 * 60000,
    )
    .unwrap();
    s.set("context_start", 42).unwrap();
    let c = s.context("What is unfinished?", 3000).unwrap();
    assert!(c.to_string().contains("lighthouse report"));
    assert_eq!(c["working"][0]["source"], id);
}
#[test]
fn large_original_passages_have_positions() {
    let (_d, s) = fresh();
    let text = format!(
        "{}The lighthouse archive code is MARIGOLD-73. {}",
        "Routine text. ".repeat(4000),
        "Other text. ".repeat(4000)
    );
    let id = s.add("user", &text, "complete").unwrap();
    s.set("context_start", id + 1).unwrap();
    let c = s.context("lighthouse archive code", 4000).unwrap();
    let h = c["history"]
        .as_array()
        .unwrap()
        .iter()
        .find(|h| n(h, "id") == id)
        .unwrap();
    assert!(st(h, "content").contains("MARIGOLD-73"));
    assert!(n(h, "start") > 0);
    assert!(n(h, "end") > n(h, "start"));
    assert_eq!(st(&s.message(id).unwrap(), "content"), text);
}
#[test]
fn relevance_cursor_no_duplicates() {
    let (_d, s) = fresh();
    for i in 0..120 {
        s.add("user", &format!("lighthouse record {i}"), "complete")
            .unwrap();
    }
    let first = s
        .history(&json!({"search":"lighthouse","sort":"relevance"}))
        .unwrap();
    let last = first.last().unwrap();
    let second=s.history(&json!({"search":"lighthouse","sort":"relevance","cursor":{"id":last["id"],"score":last["score"]}})).unwrap();
    assert_eq!(first.len(), 50);
    assert_eq!(second.len(), 50);
    for row in second {
        assert!(!first.iter().any(|a| a["id"] == row["id"]));
    }
}
#[tokio::test]
async fn old_source_cannot_overwrite_new_fact_even_at_current_revision() {
    let (d, s) = fresh();
    let a = s.add("user", "I prefer jasmine tea.", "complete").unwrap();
    let old = s
        .save_memory(
            "drink.preference",
            "I prefer jasmine tea.",
            a,
            None,
            Some("jasmine tea"),
            None,
        )
        .unwrap();
    let b = s
        .add("user", "I prefer peppermint tea.", "complete")
        .unwrap();
    s.save_memory(
        "drink.preference",
        "I prefer peppermint tea.",
        b,
        Some(old),
        Some("peppermint tea"),
        None,
    )
    .unwrap();
    let revision = s.revision();
    let existing = s.memories(&json!({})).unwrap();
    drop(s);
    let rt = Runtime::open(
        std::path::Path::new(".."),
        &d.path().join("oscar.sqlite"),
        |_| {},
    )
    .unwrap();
    rt.apply(vec![json!({"key":"drink.preference","operation":"remember","quote":"I prefer jasmine tea.","value":"jasmine tea","aliases":"beverage","replaces":existing[0]["id"]})],existing,"I prefer jasmine tea.".into(),a,revision).await.unwrap();
    let m = rt.action("memories", json!({})).await.unwrap();
    assert!(m.to_string().contains("peppermint tea"));
    assert!(!m.to_string().contains("jasmine tea"));
}
#[tokio::test]
async fn disabled_learning_does_not_contact_provider() {
    let (d, s) = fresh();
    let id = s.add("user", "I prefer jasmine tea.", "complete").unwrap();
    s.enqueue(id).unwrap();
    drop(s);
    let rt = Runtime::open(
        std::path::Path::new(".."),
        &d.path().join("oscar.sqlite"),
        |_| {},
    )
    .unwrap();
    rt.action("setSettings", json!({"learn":false}))
        .await
        .unwrap();
    rt.maintain().await.unwrap();
    let j = rt
        .db(|s| s.one("SELECT state,attempts FROM jobs LIMIT 1", &[]))
        .await
        .unwrap();
    assert_eq!(st(&j, "state"), "disabled");
    assert_eq!(n(&j, "attempts"), 0);
}
#[test]
fn budget_sizes_respect_limits() {
    let (_d, s) = fresh();
    let source = s
        .add(
            "user",
            "Lighthouse archive code is MARIGOLD-73.",
            "complete",
        )
        .unwrap();
    for i in 0..24 {
        s.add(
            if i % 2 == 0 { "user" } else { "assistant" },
            &format!(
                "Recent exchange {i} {}",
                "Detailed recent work context. ".repeat(150)
            ),
            "complete",
        )
        .unwrap();
    }
    for budget in [8000, 16000, 32000] {
        let c = s.context("lighthouse archive code", budget).unwrap();
        assert!(n(&c, "tokens") <= budget as i64);
        assert!(c["history"]
            .as_array()
            .unwrap()
            .iter()
            .any(|h| n(h, "id") == source));
    }
}
#[test]
fn legacy_database_is_backed_up_and_upgraded() {
    let d = tempdir().unwrap();
    let file = d.path().join("oscar.sqlite");
    let db = rusqlite::Connection::open(&file).unwrap();
    db.execute_batch("CREATE TABLE messages(id INTEGER PRIMARY KEY,role TEXT NOT NULL,content TEXT NOT NULL,created TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'complete');CREATE TABLE memories(id INTEGER PRIMARY KEY,key TEXT NOT NULL,text TEXT NOT NULL,source INTEGER NOT NULL,quote TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'active',replaces INTEGER,created TEXT NOT NULL); INSERT INTO messages VALUES(1,'user','I prefer jasmine tea.','2026-01-01T00:00:00Z','complete'); INSERT INTO memories VALUES(1,'drink.preference','I prefer jasmine tea.',1,'I prefer jasmine tea.','active',NULL,'2026-01-01T00:00:00Z');PRAGMA user_version=1;").unwrap();
    drop(db);
    let s = Store::open(&file).unwrap();
    assert_eq!(s.memories(&json!({})).unwrap().len(), 1);
    assert_eq!(
        st(&s.message(1).unwrap(), "content"),
        "I prefer jasmine tea."
    );
    let backup = d.path().join("oscar.before-tauri.sqlite");
    assert!(backup.exists());
    let old = rusqlite::Connection::open(backup).unwrap();
    let version: i64 = old
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 1);
    let version: i64 =
        s.db.query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
    assert_eq!(version, 3);
}
