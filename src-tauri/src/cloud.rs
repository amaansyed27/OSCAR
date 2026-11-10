use crate::{network, secure, store::*};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};
#[derive(Clone, Serialize, Deserialize)]
pub struct Spec {
    pub id: String,
    pub provider: String,
    pub model: String,
    pub name: String,
    pub context: Option<usize>,
    pub output: Option<usize>,
    pub vision: Option<bool>,
    pub tools: Option<bool>,
    pub structured: Option<bool>,
    pub streaming: Option<bool>,
    pub reasoning: Vec<String>,
    pub reasoning_parameter: Option<String>,
    pub input_price: Option<f64>,
    pub output_price: Option<f64>,
    pub free: bool,
    #[serde(default)]
    pub free_verified_at: Option<i64>,
    #[serde(default)]
    pub latency_ms: Option<f64>,
    pub quality: Option<f64>,
    #[serde(default)]
    pub task_quality: HashMap<String, f64>,
    #[serde(default)]
    pub task_evidence: String,
    pub evidence: String,
}
impl Spec {
    pub fn manual(provider: &str, model: &str) -> Self {
        Self {
            id: format!("{provider}::{model}"),
            provider: provider.into(),
            model: model.into(),
            name: model.into(),
            context: None,
            output: None,
            vision: None,
            tools: None,
            structured: None,
            streaming: None,
            reasoning: vec![],
            reasoning_parameter: None,
            input_price: None,
            output_price: None,
            free: false,
            free_verified_at: None,
            latency_ms: None,
            quality: None,
            task_quality: HashMap::new(),
            task_evidence: String::new(),
            evidence: "manual registration; limits/capabilities unknown until supplied or tested"
                .into(),
        }
    }
}
pub struct Platform {
    pub store: Arc<Mutex<Store>>,
    env: HashMap<String, String>,
}
pub fn environment(root: &Path) -> Result<HashMap<String, String>> {
    let mut env: HashMap<_, _> = std::env::vars().collect();
    for name in [".env", ".env.local"] {
        let path = root.join(name);
        if path.exists() {
            for entry in dotenvy::from_path_iter(path)? {
                let (k, v) = entry?;
                env.insert(k, v);
            }
        }
    }
    Ok(env)
}
impl Platform {
    pub fn new(root: &Path, store: Arc<Mutex<Store>>) -> Result<Arc<Self>> {
        let env = environment(root)?;
        let platform = Arc::new(Self { store, env });
        {
            let s = platform.store.lock().unwrap();
            if s.one(
                "SELECT name FROM sqlite_master WHERE name='cloud_providers'",
                &[],
            )?
            .is_null()
            {
                if let Some(file) = s.db.path() {
                    let backup = std::path::Path::new(file).with_extension("before-slice02.sqlite");
                    if !backup.exists() {
                        s.db.backup("main", backup, None::<fn(rusqlite::backup::Progress)>)?;
                    }
                }
            }
            s.db.execute_batch(include_str!("slice02.sql"))?;
            let catalog: Vec<Value> = serde_json::from_str(include_str!("providers.json"))?;
            for p in catalog {
                s.db.execute(
                    "INSERT OR IGNORE INTO cloud_providers VALUES(?,?)",
                    rusqlite::params![st(&p, "id"), p.to_string()],
                )?;
                let prefix = st(&p, "env");
                if prefix.is_empty() {
                    continue;
                }
                let mut vars: Vec<_> = platform
                    .env
                    .iter()
                    .filter(|(k, v)| {
                        !v.trim().is_empty()
                            && (*k == prefix
                                || k.strip_prefix(&format!("{prefix}_"))
                                    .is_some_and(|suffix| suffix.parse::<usize>().is_ok()))
                    })
                    .collect();
                vars.sort_by_key(|(k, _)| *k);
                for (k, v) in vars {
                    let id = format!("{}:{k}", st(&p, "id"));
                    let fp = format!("{:x}", Sha256::digest(v.as_bytes()));
                    s.db.execute("INSERT INTO cloud_credentials(id,provider,nickname,source,fingerprint) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint",rusqlite::params![id,st(&p,"id"),k,format!("environment:{k}"),fp])?;
                }
            }
            for name in ["openai/gpt-oss-20b", "openai/gpt-oss-120b"] {
                let mut m = Spec::manual("groq", name);
                m.context = Some(131072);
                m.output = Some(4000);
                m.vision = Some(false);
                m.streaming = Some(true);
                m.structured = Some(true);
                m.reasoning = vec!["low".into(), "medium".into(), "high".into()];
                m.reasoning_parameter = Some("reasoning_effort".into());
                m.evidence =
                    "https://console.groq.com/docs/reasoning; Slice 01 live verified".into();
                s.db.execute(
                    "INSERT OR IGNORE INTO cloud_models VALUES(?,?,?,1,datetime('now'))",
                    rusqlite::params![m.id, m.provider, serde_json::to_string(&m)?],
                )?;
            }
        }
        Ok(platform)
    }
    pub fn provider(&self, id: &str) -> Result<Value> {
        let s = self.store.lock().unwrap();
        let p = s.one("SELECT definition FROM cloud_providers WHERE id=?", &[&id])?;
        if p.is_null() {
            return Err(anyhow!("Provider not found."));
        }
        Ok(serde_json::from_str(st(&p, "definition"))?)
    }
    pub fn providers(&self) -> Result<Value> {
        let s = self.store.lock().unwrap();
        let mut providers = vec![];
        for row in s.all("SELECT definition FROM cloud_providers ORDER BY rowid", &[])? {
            let mut p: Value = serde_json::from_str(st(&row, "definition"))?;
            let credentials=s.all("SELECT c.id,c.nickname,c.source,c.enabled,c.cooldown_until,c.last_success,c.last_error,(SELECT count(*) FROM cloud_credentials d WHERE d.provider=c.provider AND d.fingerprint=c.fingerprint)>1 AS duplicate FROM cloud_credentials c WHERE c.provider=? ORDER BY c.id",&[&st(&p,"id")])?;
            p["credentials"] = json!(credentials);
            p["model_count"] = json!(n(
                &s.one(
                    "SELECT count(*) AS n FROM cloud_models WHERE provider=?",
                    &[&st(&p, "id")]
                )?,
                "n"
            ));
            providers.push(p);
        }
        Ok(json!(providers))
    }
    pub fn models(&self, provider: Option<&str>) -> Result<Vec<Value>> {
        let s = self.store.lock().unwrap();
        let rows = if let Some(id) = provider {
            s.all("SELECT definition,enabled,updated FROM cloud_models WHERE provider=? ORDER BY enabled DESC,id",&[&id])?
        } else {
            s.all(
                "SELECT definition,enabled,updated FROM cloud_models ORDER BY provider,id",
                &[],
            )?
        };
        rows.into_iter()
            .map(|r| {
                let mut v: Value = serde_json::from_str(st(&r, "definition"))?;
                v["enabled"] = json!(n(&r, "enabled") == 1);
                v["updated"] = r["updated"].clone();
                Ok(v)
            })
            .collect()
    }
    pub fn spec(&self, id: &str) -> Result<Spec> {
        let id = if id.contains("::") {
            id.to_owned()
        } else {
            format!("groq::{id}")
        };
        let s = self.store.lock().unwrap();
        let row = s.one(
            "SELECT definition FROM cloud_models WHERE id=? AND enabled=1",
            &[&id],
        )?;
        if row.is_null() {
            return Err(anyhow!(
                "Model is disabled or unavailable. Enable or register it in AI Providers."
            ));
        }
        Ok(serde_json::from_str(st(&row, "definition"))?)
    }
    pub fn credential(&self, provider: &str, preferred: Option<&str>) -> Result<(String, String)> {
        if self
            .provider(provider)
            .ok()
            .is_some_and(|p| st(&p, "auth") == "none")
        {
            return Ok(("anonymous".into(), String::new()));
        }
        let s = self.store.lock().unwrap();
        let now = chrono::Utc::now().timestamp();
        let rows=s.all("SELECT * FROM cloud_credentials WHERE provider=? AND enabled=1 AND cooldown_until<=? ORDER BY last_success DESC,id",&[&provider,&now])?;
        for row in rows {
            if preferred.is_some_and(|id| id != st(&row, "id")) {
                continue;
            }
            let source = st(&row, "source");
            let secret = if let Some(env) = source.strip_prefix("environment:") {
                self.env.get(env).cloned().unwrap_or_default()
            } else {
                secure::unprotect(st(&row, "secret")).unwrap_or_default()
            };
            if !secret.is_empty() {
                return Ok((st(&row, "id").into(), secret));
            }
        }
        Err(anyhow!("No enabled credential is available for this provider. Check AI Providers or its cooldown."))
    }
    pub fn save_credential(&self, arg: &Value) -> Result<Value> {
        let provider = st(arg, "provider");
        self.provider(provider)?;
        let secret = st(arg, "secret");
        if secret.len() < 8 || secret.len() > 16000 {
            return Err(anyhow!("Enter a valid credential."));
        }
        let nickname = truncate(st(arg, "nickname"), 80);
        let nickname = if nickname.is_empty() {
            "Personal credential".into()
        } else {
            nickname
        };
        let mut id = arg["id"]
            .as_str()
            .map(String::from)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let fp = format!("{:x}", Sha256::digest(secret.as_bytes()));
        let sealed = secure::protect(secret)?;
        let s = self.store.lock().unwrap();
        let duplicate = !s
            .one(
                "SELECT id FROM cloud_credentials WHERE provider=? AND fingerprint=? AND id!=?",
                &[&provider, &fp, &id],
            )?
            .is_null();
        if duplicate {
            return Err(anyhow!(
                "This credential is already configured for this provider."
            ));
        }
        let old = s.one(
            "SELECT source,provider FROM cloud_credentials WHERE id=?",
            &[&id],
        )?;
        if !old.is_null() && st(&old, "provider") != provider {
            return Err(anyhow!("Credential belongs to another provider."));
        }
        if provider!="zai-coding"&&!s.one("SELECT id FROM cloud_credentials WHERE provider='zai-coding' AND fingerprint=?",&[&fp])?.is_null(){return Err(anyhow!("A restricted Coding Plan credential cannot be used for general inference."))}
        let tx = s.db.unchecked_transaction()?;
        if st(&old, "source").starts_with("environment:") {
            s.db.execute("UPDATE cloud_credentials SET enabled=0 WHERE id=?", [&id])?;
            id = uuid::Uuid::new_v4().to_string();
        }
        s.db.execute("INSERT INTO cloud_credentials(id,provider,nickname,source,secret,enabled,fingerprint) VALUES(?,?,?,'settings',?,1,?) ON CONFLICT(id) DO UPDATE SET secret=excluded.secret,nickname=excluded.nickname,fingerprint=excluded.fingerprint,enabled=1",rusqlite::params![id,provider,nickname,sealed,fp])?;
        tx.commit()?;
        Ok(json!({"id":id,"saved":true}))
    }
    pub fn credential_action(&self, arg: &Value) -> Result<Value> {
        let id = st(arg, "id");
        let s = self.store.lock().unwrap();
        if arg["remove"] == true {
            let row = s.one("SELECT source FROM cloud_credentials WHERE id=?", &[&id])?;
            if st(&row, "source").starts_with("environment:") {
                s.db.execute("UPDATE cloud_credentials SET enabled=0 WHERE id=?", [id])?;
            } else {
                s.db.execute("DELETE FROM cloud_credentials WHERE id=?", [id])?;
            }
        } else {
            s.db.execute(
                "UPDATE cloud_credentials SET enabled=? WHERE id=?",
                rusqlite::params![arg["enabled"].as_bool().unwrap_or(false), id],
            )?;
        }
        Ok(Value::Null)
    }
    pub fn save_provider(&self, arg: &Value) -> Result<Value> {
        let id = if st(arg, "id").is_empty() {
            format!("custom-{}", uuid::Uuid::new_v4())
        } else {
            st(arg, "id").to_owned()
        };
        let mut definition = self
            .provider(&id)
            .unwrap_or(json!({"id":id,"enabled":true,"kind":"inference","env":"","auth":"bearer"}));
        if st(&definition, "kind") == "restricted" || id == "zai-coding" {
            return Err(anyhow!(
                "Coding Plan access cannot be converted to general inference."
            ));
        }
        let protocol = st(arg, "protocol");
        if ![
            "openai",
            "anthropic",
            "gemini",
            "responses",
            "cloudflare",
            "bedrock",
            "replicate",
            "cohere",
            "ollama",
        ]
        .contains(&protocol)
        {
            return Err(anyhow!("Choose a supported API protocol."));
        }
        let base = st(arg, "base").trim_end_matches('/');
        let url = network::cloud_url(base)?;
        let oldbase = st(&definition, "base");
        let s = self.store.lock().unwrap();
        if !oldbase.is_empty()
            && reqwest::Url::parse(oldbase)?.host_str() != url.host_str()
            && n(
                &s.one(
                    "SELECT count(*) AS n FROM cloud_credentials WHERE provider=?",
                    &[&id],
                )?,
                "n",
            ) > 0
        {
            return Err(anyhow!(
                "Create a new provider to change the host while credentials exist."
            ));
        }
        if let Some(headers) = arg["headers"].as_object() {
            if headers.len() > 8 {
                return Err(anyhow!("At most eight connection headers are allowed."));
            }
            let allowed = [
                "x-project-id",
                "openai-organization",
                "openai-project",
                "anthropic-version",
                "x-goog-user-project",
                "x-client-name",
                "x-region",
                "x-api-version",
                "http-referer",
                "x-title",
            ];
            for (k, v) in headers {
                let value = v
                    .as_str()
                    .ok_or_else(|| anyhow!("Header values must be text."))?;
                if !allowed.contains(&k.to_lowercase().as_str())
                    || value.len() > 300
                    || value.contains(['\r', '\n'])
                {
                    return Err(anyhow!("Unsupported or unsafe connection header."));
                }
            }
            definition["headers"] = arg["headers"].clone();
        }
        definition["name"] = json!(truncate(st(arg, "name"), 80));
        definition["base"] = json!(base);
        definition["protocol"] = json!(protocol);
        definition["auth"] = json!(arg["auth"].as_str().unwrap_or(if protocol == "anthropic" {
            "anthropic-key"
        } else {
            "bearer"
        }));
        for k in ["account", "region", "project", "location", "discovery"] {
            if let Some(v) = arg[k].as_str() {
                if v.len() > 300 || v.contains(['\r', '\n']) {
                    return Err(anyhow!("Invalid connection option."));
                }
                definition[k] = json!(v);
            }
        }
        if ![
            "bearer",
            "anthropic-key",
            "google-key",
            "azure-key",
            "api-key",
            "account-token",
            "bedrock-key-or-iam",
            "oauth-project",
            "configurable",
            "none",
        ]
        .contains(&st(&definition, "auth"))
        {
            return Err(anyhow!("Unsupported authentication scheme."));
        }
        s.db.execute(
            "INSERT OR REPLACE INTO cloud_providers VALUES(?,?)",
            rusqlite::params![id, definition.to_string()],
        )?;
        Ok(definition)
    }
    pub fn register(&self, arg: &Value) -> Result<Value> {
        let provider = st(arg, "provider");
        let p = self.provider(provider)?;
        if st(&p, "protocol") == "restricted" {
            return Err(anyhow!(
                "Restricted Coding Plan cannot be used for general conversation."
            ));
        }
        let model = st(arg, "model");
        if model.is_empty()
            || model.len() > 200
            || model.contains(['\r', '\n', '?', '#', '%'])
            || model.split('/').any(|p| p == ".." || p == ".")
        {
            return Err(anyhow!("Invalid model identifier."));
        }
        let key = format!("{provider}::{model}");
        let prior = self
            .store
            .lock()
            .unwrap()
            .one("SELECT definition FROM cloud_models WHERE id=?", &[&key])?;
        let mut spec = if prior.is_null() {
            Spec::manual(provider, model)
        } else {
            serde_json::from_str(st(&prior, "definition"))?
        };
        if let Some(n) = arg["context"].as_u64() {
            if !(2048..=10_000_000).contains(&n) {
                return Err(anyhow!("Invalid context limit."));
            }
            spec.context = Some(n as usize);
        }
        if let Some(value) = arg["output"].as_u64() {
            spec.output = Some(value.min(200000) as usize);
        }
        if let Some(value) = arg["vision"].as_bool() {
            spec.vision = Some(value);
        }
        if let Some(value) = arg["streaming"].as_bool() {
            spec.streaming = Some(value);
        }
        if let Some(value) = arg["structured"].as_bool() {
            spec.structured = Some(value);
        }
        if let Some(value) = arg["tools"].as_bool() {
            spec.tools = Some(value);
        }
        if !arg["quality"].is_null() {
            spec.quality = arg["quality"]
                .as_f64()
                .filter(|n| n.is_finite() && *n >= 0. && *n <= 100.);
        }
        if let Some(ratings) = arg["task_quality"].as_object() {
            if ratings.len() > 10 || st(arg, "evaluation_evidence").trim().is_empty() {
                return Err(anyhow!(
                    "Task ratings require evaluation evidence and at most ten tasks."
                ));
            }
            for (task, rating) in ratings {
                if !crate::routing::TASKS.contains(&task.as_str()) {
                    return Err(anyhow!("Unknown evaluation task."));
                }
                let score = rating
                    .as_f64()
                    .filter(|n| n.is_finite() && (0.0..=100.0).contains(n))
                    .ok_or_else(|| anyhow!("Evaluation scores must be between zero and 100."))?;
                spec.task_quality.insert(task.clone(), score);
            }
            spec.task_evidence = truncate(st(arg, "evaluation_evidence"), 2000);
        }
        if !arg["input_price"].is_null() {
            spec.input_price = arg["input_price"]
                .as_f64()
                .filter(|n| *n >= 0. && n.is_finite());
        }
        if !arg["output_price"].is_null() {
            spec.output_price = arg["output_price"]
                .as_f64()
                .filter(|n| *n >= 0. && n.is_finite());
        }
        let allowed = [
            "none", "minimal", "low", "medium", "high", "xhigh", "max", "on", "off",
        ];
        if let Some(options) = arg["reasoning"].as_array() {
            spec.reasoning.clear();
            for opt in options {
                let level = opt.as_str().unwrap_or("");
                if !allowed.contains(&level) {
                    return Err(anyhow!("Invalid reasoning option."));
                }
                spec.reasoning.push(level.into());
            }
            if options.is_empty() {
                spec.reasoning_parameter = None;
                self.persist(&spec, true)?;
                return Ok(serde_json::to_value(spec)?);
            }
            let parameter = st(arg, "reasoning_parameter");
            if ![
                "reasoning_effort",
                "reasoning.effort",
                "reasoning.effort.openrouter",
                "thinking.budget",
                "thinking.level",
                "thinking.adaptive",
                "thinking.enabled",
                "ollama.think",
                "bedrock.thinking",
            ]
            .contains(&parameter)
            {
                return Err(anyhow!(
                    "Choose the provider's documented reasoning parameter."
                ));
            }
            let valid = match parameter {
                "thinking.budget" | "thinking.level" => st(&p, "protocol") == "gemini",
                "thinking.adaptive" | "thinking.enabled" => st(&p, "protocol") == "anthropic",
                "reasoning.effort" => st(&p, "protocol") == "responses",
                "reasoning.effort.openrouter" => provider == "openrouter",
                "ollama.think" => st(&p, "protocol") == "ollama",
                "bedrock.thinking" => st(&p, "protocol") == "bedrock",
                _ => ["openai", "cloudflare", "cohere"].contains(&st(&p, "protocol")),
            };
            if !valid {
                return Err(anyhow!(
                    "Reasoning parameter does not match this API protocol."
                ));
            }
            spec.reasoning_parameter = Some(parameter.into());
        }
        spec.free = spec.free
            && spec.input_price == Some(0.)
            && spec.output_price == Some(0.)
            && spec.model.ends_with(":free");
        self.persist(&spec, true)?;
        Ok(serde_json::to_value(spec)?)
    }
    pub fn persist(&self, spec: &Spec, enabled: bool) -> Result<()> {
        let s = self.store.lock().unwrap();
        s.db.execute("INSERT INTO cloud_models VALUES(?,?,?,?,datetime('now')) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition,updated=excluded.updated",rusqlite::params![spec.id,spec.provider,serde_json::to_string(spec)?,enabled])?;
        Ok(())
    }
    pub fn toggle_model(&self, id: &str, enabled: bool) -> Result<Value> {
        self.store.lock().unwrap().db.execute(
            "UPDATE cloud_models SET enabled=? WHERE id=?",
            rusqlite::params![enabled, id],
        )?;
        Ok(Value::Null)
    }
    pub fn record_status(&self, id: &str, status: u16, retry: u64) -> Result<()> {
        let s = self.store.lock().unwrap();
        if status == 429 {
            let provider = s.one("SELECT provider FROM cloud_credentials WHERE id=?", &[&id])?; // Account-wide cooldown: never rotate keys to evade a quota.
            s.db.execute("UPDATE cloud_credentials SET cooldown_until=?,last_error='Rate limited' WHERE provider=?",rusqlite::params![chrono::Utc::now().timestamp()+retry.max(1)as i64,st(&provider,"provider")])?;
        } else if status == 401 || status == 403 {
            s.db.execute("UPDATE cloud_credentials SET last_error='Credential rejected',cooldown_until=? WHERE id=?",rusqlite::params![chrono::Utc::now().timestamp()+300,id])?;
        } else if (200..300).contains(&status) {
            s.db.execute("UPDATE cloud_credentials SET last_success=datetime('now'),last_error=NULL WHERE id=?",[id])?;
        }
        Ok(())
    }
    pub fn headers(&self, p: &Value, key: &str) -> Result<reqwest::header::HeaderMap> {
        use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
        let mut h = HeaderMap::new();
        let (name, value) = match st(p, "auth") {
            "anthropic-key" => ("x-api-key", key.to_owned()),
            "google-key" => ("x-goog-api-key", key.to_owned()),
            "azure-key" => ("api-key", key.to_owned()),
            "api-key" => ("authorization", format!("Api-Key {key}")),
            "none" => return Ok(h),
            _ => ("authorization", format!("Bearer {key}")),
        };
        h.insert(
            HeaderName::from_bytes(name.as_bytes())?,
            HeaderValue::from_str(&value)
                .map_err(|_| anyhow!("Credential contains invalid header characters."))?,
        );
        if let Some(extra) = p["headers"].as_object() {
            for (k, v) in extra {
                h.insert(
                    HeaderName::from_bytes(k.as_bytes())?,
                    HeaderValue::from_str(v.as_str().unwrap_or(""))
                        .map_err(|_| anyhow!("Invalid connection header."))?,
                );
            }
        }
        if st(p, "protocol") == "anthropic" {
            h.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        }
        Ok(h)
    }
    pub async fn discover(&self, id: &str) -> Result<Value> {
        self.discover_with(id, None).await
    }
    pub async fn discover_with(&self, id: &str, credential: Option<&str>) -> Result<Value> {
        let p = self.provider(id)?;
        if st(&p, "protocol") == "restricted" {
            return Err(anyhow!("Coding Plan is excluded from unrestricted chat."));
        }
        let base = st(&p, "base");
        if base.is_empty() {
            return Err(anyhow!(
                "Set this provider's cloud endpoint and required project/account options first."
            ));
        }
        let protocol = st(&p, "protocol");
        if ["bedrock", "vertex"].contains(&id) {
            return Err(anyhow!("Register a model with its documented limits. Account-specific catalog discovery is not available through this inference endpoint."));
        }
        if protocol == "search" {
            let (cid, key) = self.credential(id, credential)?;
            let response = network::client_for("https://api.tavily.com/usage")
                .await?
                .get("https://api.tavily.com/usage")
                .bearer_auth(key)
                .send()
                .await
                .map_err(|_| anyhow!("Search usage could not be checked."))?;
            let status = response.status().as_u16();
            self.record_status(&cid, status, 60)?;
            if status != 200 {
                return Err(anyhow!("Search validation returned HTTP {status}."));
            }
            let usage: Value = serde_json::from_slice(&network::bounded(response, 50000).await?)?;
            return Ok(json!({"models":0,"provider":id,"usage":usage}));
        }
        let path = if !st(&p, "discovery").is_empty() {
            st(&p, "discovery")
        } else {
            match protocol {
                "ollama" => "tags",
                "cloudflare" => "ai/models/search",
                "replicate" => "models",
                _ => "models",
            }
        };
        if path.starts_with('/') || path.contains("..") || path.contains("://") {
            return Err(anyhow!("Discovery must be a relative API path."));
        }
        let url = if id == "cohere" {
            "https://api.cohere.com/v1/models".into()
        } else if protocol == "cloudflare" {
            format!("{base}/accounts/{}/ai/models/search", st(&p, "account"))
        } else {
            format!("{base}/{path}")
        };
        let client = network::client_for(&url).await?;
        let (cid, key) = self.credential(id, credential)?;
        let response = client
            .get(&url)
            .headers(self.headers(&p, &key)?)
            .send()
            .await
            .map_err(|_| anyhow!("Provider could not be reached."))?;
        let status = response.status().as_u16();
        self.record_status(&cid, status, 60)?;
        if !(200..300).contains(&status) {
            return Err(anyhow!("Model discovery returned HTTP {status}. Check this provider's connection options or register a model manually."));
        }
        let raw: Value = serde_json::from_slice(&network::bounded(response, 8_000_000).await?)?;
        let list = raw["data"]
            .as_array()
            .or(raw["models"].as_array())
            .or(raw["results"].as_array())
            .or(raw["result"].as_array())
            .ok_or_else(|| {
                anyhow!("Provider did not return a model list. Use manual registration.")
            })?;
        let cached: HashMap<String, Spec> = self
            .models(Some(id))?
            .into_iter()
            .filter_map(|row| serde_json::from_value::<Spec>(row).ok())
            .map(|spec| (spec.id.clone(), spec))
            .collect();
        let mut count = 0;
        for item in list.iter().take(3000) {
            let model = item["id"]
                .as_str()
                .or(item["name"].as_str())
                .or(item["model"].as_str())
                .unwrap_or("")
                .trim_start_matches("models/");
            if model.is_empty() {
                continue;
            }
            if item["supportedGenerationMethods"]
                .as_array()
                .is_some_and(|a| !a.iter().any(|m| m == "generateContent"))
            {
                continue;
            }
            let mut spec = Spec::manual(id, model);
            if let Some(old) = cached.get(&spec.id) {
                spec = old.clone();
            }
            spec.name = item["name"].as_str().unwrap_or(model).to_owned();
            spec.context = item["context_length"]
                .as_u64()
                .or(item["inputTokenLimit"].as_u64())
                .map(|n| n as usize)
                .or(spec.context);
            spec.output = item["top_provider"]["max_completion_tokens"]
                .as_u64()
                .or(item["outputTokenLimit"].as_u64())
                .map(|n| n as usize)
                .or(spec.output);
            if id == "openrouter" {
                let modes = &item["architecture"]["input_modalities"];
                spec.vision = modes.as_array().map(|m| m.iter().any(|v| v == "image"));
                let price = |k| {
                    item["pricing"][k]
                        .as_str()
                        .and_then(|s| s.parse::<f64>().ok())
                        .map(|n| n * 1_000_000.)
                };
                spec.input_price = price("prompt");
                spec.output_price = price("completion");
                spec.free = spec.input_price == Some(0.)
                    && spec.output_price == Some(0.)
                    && model.ends_with(":free");
                if spec.free {
                    spec.free_verified_at = Some(chrono::Utc::now().timestamp());
                } else {
                    spec.free_verified_at = None;
                }
                spec.tools = item["supported_parameters"]
                    .as_array()
                    .map(|a| a.iter().any(|p| p == "tools"));
                spec.structured = item["supported_parameters"].as_array().map(|a| {
                    a.iter()
                        .any(|p| p == "response_format" || p == "structured_outputs")
                });
            }
            if id == "openrouter"
                && item["architecture"]["output_modalities"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|v| v == "text"))
            {
                spec.streaming = Some(true);
            }

            spec.evidence = format!(
                "{url}; provider API metadata {}",
                chrono::Utc::now().to_rfc3339()
            );
            self.persist(&spec, id == "groq")?;
            count += 1;
        }
        Ok(json!({"models":count,"provider":id}))
    }
}
