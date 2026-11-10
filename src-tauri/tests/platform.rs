use oscar_core::{
    adapters::{event_text, request_body, Target},
    cloud::{Platform, Spec},
    routing,
    store::*,
};
use serde_json::json;
use std::sync::{Arc, Mutex};
fn platform() -> (tempfile::TempDir, Arc<Platform>) {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join(".env.local"),"GROQ_API_KEY_1=test-environment-key-one\nGROQ_API_KEY_2=test-environment-key-one\nGROQ_API_KEY_3=test-environment-key-three\nZAI_CODING_API_KEY_1=test-restricted-coding-key\n").unwrap();
    let s = Store::open(&d.path().join("oscar.sqlite")).unwrap();
    let p = Platform::new(d.path(), Arc::new(Mutex::new(s))).unwrap();
    (d, p)
}
#[test]
fn numbered_credentials_and_duplicates() {
    let (d, p) = platform();
    let before = std::fs::read(d.path().join(".env.local")).unwrap();
    let all = p.providers().unwrap();
    let groq = all
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "groq")
        .unwrap();
    assert_eq!(groq["credentials"].as_array().unwrap().len(), 3);
    assert_eq!(
        groq["credentials"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["duplicate"] == 1)
            .count(),
        2
    );
    assert!(!all.to_string().contains("test-environment-key"));
    assert_eq!(std::fs::read(d.path().join(".env.local")).unwrap(), before);
}

#[test]
fn task_ratings_override_overall_without_weakening_constraints() {
    let mut a = Spec::manual("one", "general");
    a.context = Some(32000);
    a.quality = Some(95.);
    let mut b = a.clone();
    b.id = "specialist".into();
    b.quality = Some(60.);
    b.task_quality.insert("programming".into(), 99.);
    let d = routing::decide("debug this Rust function", "off", false, false);
    assert_eq!(
        routing::rank(vec![a.clone(), b.clone()], "super", &d, 100, None).unwrap()[0].id,
        "specialist"
    );
    assert!(routing::rank(vec![a, b], "super", &d, 100, Some(0.)).is_err());
    let (_dir, p) = platform();
    assert!(p
        .register(&json!({"provider":"groq","model":"test","task_quality":{"programming":95}}))
        .is_err());
    let saved=p.register(&json!({"provider":"groq","model":"test","task_quality":{"programming":95},"evaluation_evidence":"Three coding fixtures, 2026-11-10"})).unwrap();
    assert_eq!(saved["task_quality"]["programming"], 95.);
}

#[test]
fn decision_model_cannot_override_search_off_or_vision() {
    let original = routing::decide(
        "Can you explain which of these options would be appropriate for my situation",
        "off",
        false,
        false,
    );
    assert!(routing::ambiguous(
        "Can you explain which of these options would be appropriate for my situation",
        &original
    ));
    let refined = routing::classified(
        &json!({"task":"research","complex":true,"search":true,"vision":true}),
        &original,
        "off",
    )
    .unwrap();
    assert!(!refined.search);
    assert!(!refined.vision);
    assert!(routing::classified(
        &json!({"task":"execute shell","complex":true,"search":true}),
        &original,
        "auto"
    )
    .is_err());
    assert!(!routing::ambiguous("Hello", &original));
}

#[test]
fn prediction_lifecycle_never_uses_foreign_urls_or_nontext_outputs() {
    use oscar_core::adapters::{prediction_url, replicate_output};
    assert_eq!(
        prediction_url("https://api.replicate.com/v1", "abc123").unwrap(),
        "https://api.replicate.com/v1/predictions/abc123"
    );
    for id in ["../keys", "https://evil.example", "a?b", "a/b", ""] {
        assert!(prediction_url("https://api.replicate.com/v1", id).is_err());
    }
    assert_eq!(
        replicate_output(&json!({"output":["one ","two"]})).unwrap(),
        "one two"
    );
    assert!(replicate_output(&json!({"output":{"image":"file"}})).is_err());
}
#[test]
fn arbitrary_protected_credentials_and_replacement() {
    let (d, p) = platform();
    for i in 0..6 {
        p.save_credential(&json!({"provider":"openrouter","nickname":format!("Key {i}"),"secret":format!("test-only-settings-secret-{i}")})).unwrap();
    }
    let s = p.store.lock().unwrap();
    assert_eq!(
        n(
            &s.one(
                "SELECT count(*) AS n FROM cloud_credentials WHERE provider='openrouter'",
                &[]
            )
            .unwrap(),
            "n"
        ),
        6
    );
    assert!(!json!(s
        .all(
            "SELECT secret FROM cloud_credentials WHERE source='settings'",
            &[]
        )
        .unwrap())
    .to_string()
    .contains("test-only"));
    drop(s);
    let env_before = std::fs::read(d.path().join(".env.local")).unwrap();
    p.save_credential(&json!({"id":"groq:GROQ_API_KEY_3","provider":"groq","nickname":"Replacement","secret":"test-new-protected-replacement"})).unwrap();
    assert_eq!(
        std::fs::read(d.path().join(".env.local")).unwrap(),
        env_before
    );
    assert_eq!(
        n(
            &p.store
                .lock()
                .unwrap()
                .one(
                    "SELECT enabled FROM cloud_credentials WHERE id='groq:GROQ_API_KEY_3'",
                    &[]
                )
                .unwrap(),
            "enabled"
        ),
        0
    );
}
#[test]
fn restricted_product_cannot_escape_catalog() {
    let (_d, p) = platform();
    assert!(p
        .register(&json!({"provider":"zai-coding","model":"glm"}))
        .is_err());
    assert!(p.save_credential(&json!({"provider":"groq","nickname":"restricted","secret":"test-restricted-coding-key"})).is_err());
}
#[test]
fn custom_cloud_blocks_unsafe_destinations() {
    let (_d, p) = platform();
    for base in [
        "http://example.com/v1",
        "https://127.0.0.1/v1",
        "https://169.254.169.254/latest",
        "https://user:secret@example.com",
    ] {
        assert!(p
            .save_provider(&json!({"name":"custom","base":base,"protocol":"openai"}))
            .is_err());
    }
    let provider = p
        .save_provider(
            &json!({"name":"custom","base":"https://api.example.com/v1","protocol":"anthropic"}),
        )
        .unwrap();
    assert_eq!(provider["auth"], "anthropic-key");
}
#[test]
fn every_catalog_entry_has_documented_protocol() {
    let (_d, p) = platform();
    let all = p.providers().unwrap();
    assert!(all.as_array().unwrap().len() >= 34);
    for entry in all.as_array().unwrap() {
        assert!(st(entry, "docs").starts_with("https://"));
        assert!(!st(entry, "auth").is_empty());
        assert!([
            "openai",
            "responses",
            "anthropic",
            "gemini",
            "cohere",
            "ollama",
            "bedrock",
            "replicate",
            "cloudflare",
            "search",
            "restricted"
        ]
        .contains(&st(entry, "protocol")));
    }
}
fn target(protocol: &str) -> Target {
    let mut s = Spec::manual("test", "test-model");
    s.context = Some(32768);
    s.output = Some(1024);
    Target {
        spec: s,
        provider: json!({"id":"test","protocol":protocol,"base":"https://api.example.com/v1","auth":"bearer","account":"test-account"}),
        credential: None,
        reasoning: None,
    }
}
#[test]
fn adapter_families_use_actual_protocol_shapes() {
    let messages =
        json!([{"role":"system","content":"System"},{"role":"user","content":"Question"}]);
    for protocol in [
        "openai",
        "responses",
        "anthropic",
        "gemini",
        "cohere",
        "ollama",
        "bedrock",
        "replicate",
        "cloudflare",
    ] {
        let t = target(protocol);
        let (url, body) = request_body(&t, messages.clone(), false, true).unwrap();
        assert!(url.starts_with("https://api.example.com/"));
        assert!(body.to_string().contains("Question"));
        match protocol {
            "anthropic" => {
                assert_eq!(body["system"], "System");
                assert_eq!(body["messages"].as_array().unwrap().len(), 1);
            }
            "gemini" => assert!(body["contents"].is_array()),
            "responses" => assert_eq!(body["store"], false),
            "bedrock" => assert!(body["inferenceConfig"].is_object()),
            "replicate" => assert!(body["input"]["prompt"].is_string()),
            _ => {}
        }
        assert!(body["reasoning_effort"].is_null());
    }
}
#[test]
fn reasoning_is_model_specific() {
    let mut t = target("openai");
    t.spec.reasoning = vec!["low".into(), "high".into()];
    t.spec.reasoning_parameter = Some("reasoning_effort".into());
    let d = routing::decide("Prove this theorem", "auto", false, false);
    assert_eq!(
        routing::select_reasoning(&t.spec, "auto", &d).unwrap(),
        Some("high".into())
    );
    assert!(routing::select_reasoning(&t.spec, "xhigh", &d).is_err());
    t.reasoning = Some("high".into());
    assert_eq!(
        request_body(&t, json!([]), false, true).unwrap().1["reasoning_effort"],
        "high"
    );
}
#[test]
fn provider_wide_cooldowns_do_not_rotate_keys() {
    let (_d, p) = platform();
    p.record_status("groq:GROQ_API_KEY_1", 429, 30).unwrap();
    assert!(p.credential("groq", None).is_err());
    let all = p.providers().unwrap();
    assert!(!all.to_string().contains("test-environment-key"));
}
#[test]
fn automatic_modes_respect_unknown_and_ceiling() {
    let mut a = target("openai").spec;
    a.id = "a".into();
    a.input_price = Some(1.);
    a.output_price = Some(2.);
    a.quality = Some(50.);
    let mut b = a.clone();
    b.id = "b".into();
    b.input_price = Some(0.);
    b.output_price = Some(0.);
    b.free = true;
    b.free_verified_at = Some(chrono::Utc::now().timestamp());
    b.quality = Some(40.);
    let d = routing::decide("hello", "auto", false, false);
    assert_eq!(
        routing::rank(vec![a.clone(), b.clone()], "efficient", &d, 100, None).unwrap()[0].id,
        "b"
    );
    assert_eq!(
        routing::rank(vec![a.clone(), b.clone()], "super", &d, 100, None).unwrap()[0].id,
        "a"
    );
    assert_eq!(
        routing::rank(vec![a, b], "free", &d, 100, Some(0.)).unwrap()[0].id,
        "b"
    );
}
#[test]
fn stream_delta_never_exposes_thinking() {
    let event = json!({"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"private reasoning"}});
    assert_eq!(event_text("anthropic", &event), None);
}
#[test]
fn source_links_cannot_be_fabricated() {
    let sources = vec![json!({"title":"Official docs","url":"https://docs.example.com/page"})];
    let answer = oscar_core::research::ground_links(
        "Verified [W1]. Invalid [W9]. [invented](https://evil.example)",
        &sources,
    );
    assert!(answer.contains("[Official docs](https://docs.example.com/page)"));
    assert!(!answer.contains("https://evil.example"));
    assert!(answer.contains("source unavailable"));
}
#[test]
fn text_and_office_parser_bounds() {
    assert_eq!(
        oscar_core::documents::extract(b"original text", "notes.txt").unwrap(),
        "original text"
    );
    assert!(oscar_core::documents::extract(b"not a pdf", "fake.pdf").is_err());
    assert!(oscar_core::documents::extract(b"macro", "file.docm").is_err());
}

#[test]
fn citation_and_conflict_guards() {
    let e = json!([{"attachment":"abc-123","chunk":2,"text":"Launch 18 December"}]);
    assert_eq!(
        oscar_core::documents::ground_references("[D:abc-123:2] [D:abc-123:3]", &e),
        "[D:abc-123:2] [document source unavailable]"
    );
    let a =
        json!({"ref":"W1","excerpt":"Juniper public project launch target deadline December 12"});
    let b =
        json!({"ref":"W2","excerpt":"Juniper public project launch target deadline December 18"});
    assert_eq!(oscar_core::research::possible_conflicts(&[a, b]).len(), 1);
    let grounded = oscar_core::research::ground_links(
        "Raw https://madeup.example/x <a href=\"https://invented.example\">bad</a>",
        &[],
    );
    assert!(!grounded.contains("https://"));
}

#[test]
fn research_dedup_retains_document_identity_and_search_off() {
    use oscar_core::research::{canonical_source, queries};
    assert_eq!(
        canonical_source("https://example.com/doc?id=1&utm_source=test#heading").unwrap(),
        "https://example.com/doc?id=1"
    );
    assert_ne!(
        canonical_source("https://example.com/doc?id=1").unwrap(),
        canonical_source("https://example.com/doc?id=2").unwrap()
    );
    assert!(canonical_source("https://127.0.0.1/doc").is_err());
    assert_eq!(queries("Rust versus Go", true), vec!["Rust", "Go"]);
    assert!(!routing::decide("research current news", "off", false, false).search);
}
#[test]
fn stale_free_and_image_constraints() {
    let mut m = target("openai").spec;
    m.free = true;
    m.input_price = Some(0.);
    m.output_price = Some(0.);
    m.free_verified_at = Some(chrono::Utc::now().timestamp() - 90000);
    assert!(routing::rank(
        vec![m.clone()],
        "free",
        &routing::decide("hello", "off", false, false),
        100,
        None
    )
    .is_err());
    m.free_verified_at = Some(chrono::Utc::now().timestamp());
    assert!(routing::rank(
        vec![m.clone()],
        "free",
        &routing::decide("image", "off", true, false),
        100,
        None
    )
    .is_err());
    m.vision = Some(true);
    assert!(routing::rank(
        vec![m],
        "free",
        &routing::decide("image", "off", true, false),
        100,
        None
    )
    .is_ok());
}
#[test]
fn image_translation_all_native_families() {
    let messages = json!([{"role":"user","content":[{"type":"text","text":"Inspect"},{"type":"image_url","image_url":{"url":"data:image/png;base64,aGVsbG8="}}]}]);
    for protocol in ["anthropic", "gemini", "responses", "ollama", "bedrock"] {
        let (_, body) = request_body(&target(protocol), messages.clone(), false, true).unwrap();
        assert!(body.to_string().contains("aGVsbG8="), "{protocol}");
        if protocol != "responses" {
            assert!(!body.to_string().contains("image_url"), "{protocol}");
        }
    }
}
