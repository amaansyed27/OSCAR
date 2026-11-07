use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path, time::Duration};
use tokio_util::sync::CancellationToken;
#[derive(Clone)]
pub struct Model {
    pub platform: Option<std::sync::Arc<crate::cloud::Platform>>,
    legacy_transport: bool,
    pub targets: Vec<crate::adapters::Target>,
    pub client: reqwest::Client,
    key: String,
    pub model: String,
    endpoint: String,
    pub budget: usize,
}
impl Model {
    pub fn load(root: &Path) -> Result<Self> {
        let mut vars: HashMap<String, String> = std::env::vars().collect();
        for name in [".env", ".env.local"] {
            let p = root.join(name);
            if p.exists() {
                for entry in dotenvy::from_path_iter(p)? {
                    let (k, v) = entry?;
                    vars.insert(k, v);
                }
            }
        }
        let model = vars
            .get("OSCAR_MODEL")
            .cloned()
            .unwrap_or("openai/gpt-oss-20b".into());
        if model.is_empty() || model.len() > 260 || model.contains(['\r', '\n']) {
            return Err(anyhow!("Invalid OSCAR_MODEL selection."));
        }
        let endpoint = vars
            .get("OSCAR_GROQ_ENDPOINT")
            .cloned()
            .unwrap_or("https://api.groq.com/openai/v1/chat/completions".into());
        if vars.contains_key("OSCAR_GROQ_ENDPOINT") {
            if !cfg!(debug_assertions) {
                return Err(anyhow!(
                    "The loopback transport fixture is available only in debug builds."
                ));
            }
            let url = reqwest::Url::parse(&endpoint)?;
            if url.scheme() != "http"
                || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
            {
                return Err(anyhow!("Test endpoint must be HTTP loopback."));
            }
        }
        Ok(Self {
            platform: None,
            legacy_transport: vars.contains_key("OSCAR_GROQ_ENDPOINT"),
            targets: vec![],
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(90))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            key: if vars.contains_key("OSCAR_GROQ_ENDPOINT") {
                "loopback-fixture-only".into()
            } else {
                vars.get("GROQ_API_KEY")
                    .filter(|s| !s.trim().is_empty())
                    .or_else(|| vars.get("GROQ_API_KEY_1").filter(|s| !s.trim().is_empty()))
                    .cloned()
                    .unwrap_or_default()
            },
            model,
            endpoint,
            budget: vars
                .get("OSCAR_INPUT_TOKENS")
                .and_then(|s| s.parse().ok())
                .unwrap_or(16000),
        })
    }
    pub fn configured(&self) -> bool {
        self.platform
            .as_ref()
            .map(|p| {
                p.providers()
                    .ok()
                    .and_then(|v| v.as_array().cloned())
                    .unwrap_or_default()
                    .iter()
                    .any(|v| {
                        v["kind"] == "inference"
                            && p.credential(crate::store::st(v, "id"), None).is_ok()
                    })
            })
            .unwrap_or(!self.key.is_empty())
    }
    pub fn prepare(
        &self,
        text: &str,
        vision: bool,
        documents: bool,
    ) -> Result<(Self, crate::routing::Decision)> {
        let mut model = self.clone();
        if let Some(platform) = self.platform.as_ref().filter(|_| !self.legacy_transport) {
            let (targets, decision) = platform.targets(&self.model, text, vision, documents)?;
            let first = &targets[0].spec;
            if first.context.is_none() {
                return Err(anyhow!("This model's context limit is unknown. Register its documented limit in AI Providers before using it."));
            }

            model.budget = first
                .context
                .unwrap_or(8192)
                .saturating_sub(first.output.unwrap_or(4000).min(16000) + 1024)
                .clamp(1024, 32000);
            model.targets = targets;
            Ok((model, decision))
        } else {
            Ok((
                model,
                crate::routing::decide(text, "off", vision, documents),
            ))
        }
    }

    async fn request(
        &self,
        messages: Value,
        json_mode: bool,
        stream: bool,
        cancel: &CancellationToken,
    ) -> Result<reqwest::Response> {
        if !self.configured() {
            return Err(anyhow!(
                "Add a Groq key to the local configuration, then restart OSCAR."
            ));
        }
        let mut body = json!({
        "model":self.model,"messages":messages,"temperature":0.2,"reasoning_effort":"low","max_tokens":4000,"stream":stream}
        );
        if stream {
            body["stream_options"] = json!({
            "include_usage":true}
            );
        }
        if json_mode {
            body["response_format"] = memory_format();
        }
        let response = tokio::select! {
        _=cancel.cancelled()=>return Err(anyhow!("Stopped")),r=self.client.post(&self.endpoint).bearer_auth(&self.key).json(&body).send()=>r.map_err(|_|anyhow!("OSCAR could not reach Groq. Check your connection and retry."))?};
        if !response.status().is_success() {
            return Err(if response.status().as_u16() == 429 {
                let wait = response
                    .headers()
                    .get("retry-after")
                    .and_then(|s| s.to_str().ok())
                    .unwrap_or("15");
                anyhow!("Groq rate limit reached. Retry in {wait} seconds.")
            } else {
                anyhow!(
                    "Groq could not answer (HTTP {}). Check your model and configuration.",
                    response.status().as_u16()
                )
            });
        }
        Ok(response)
    }
    pub async fn complete(&self, messages: Value, cancel: &CancellationToken) -> Result<String> {
        if let Some(platform) = self.platform.as_ref().filter(|_| !self.legacy_transport) {
            let prepared = if self.targets.is_empty() {
                self.prepare("Extract personal memory JSON", false, false)?
                    .0
            } else {
                self.clone()
            };
            return crate::adapters::complete(platform, &prepared.targets[0], messages, cancel)
                .await;
        }

        let response = self.request(messages, true, false, cancel).await?;
        let value: Value = tokio::select! {
        _=cancel.cancelled()=>return Err(anyhow!("Stopped")),v=response.json()=>v.map_err(|_|anyhow!("The model returned an incomplete response."))?};
        let content = value["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("");
        if content.is_empty() || value["choices"][0]["finish_reason"] == "length" {
            return Err(anyhow!("The model returned an incomplete response."));
        }
        Ok(content.into())
    }
    pub async fn stream(
        &self,
        messages: Value,
        cancel: &CancellationToken,
        mut delta: impl FnMut(&str, &str) -> Result<()>,
    ) -> Result<(String, Value)> {
        if let Some(platform) = self.platform.as_ref().filter(|_| !self.legacy_transport) {
            return crate::adapters::stream(platform, &self.targets, messages, cancel, delta).await;
        }
        let response = self.request(messages, false, true, cancel).await?;
        let mut stream = response.bytes_stream();
        let (mut pending, mut content, mut usage, mut done, mut reason) = (
            Vec::<u8>::new(),
            String::new(),
            Value::Null,
            false,
            String::new(),
        );
        loop {
            let next = tokio::select! {
            _=cancel.cancelled()=>return Err(anyhow!("Stopped")),b=stream.next()=>b};
            let Some(bytes) = next else { break };
            let bytes=bytes.map_err(|_|anyhow!("The connection was interrupted. Your partial reply is saved; retry to continue."))?;
            pending.extend(bytes);
            if pending.len() > 2_000_000 {
                return Err(anyhow!("Provider event exceeded safe limits."));
            }
            while let Some(at) = pending.iter().position(|b| *b == b'\n') {
                let raw: Vec<_> = pending.drain(..=at).collect();
                let line = std::str::from_utf8(&raw)?.trim();
                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data == "[DONE]" {
                    done = true;
                    continue;
                }
                let event: Value = serde_json::from_str(data)?;
                if !event["error"].is_null() {
                    return Err(anyhow!("The provider interrupted its response."));
                }
                if !event["usage"].is_null() {
                    usage = event["usage"].clone();
                }
                if let Some(r) = event["choices"][0]["finish_reason"].as_str() {
                    reason = r.into();
                }
                if let Some(chunk) = event["choices"][0]["delta"]["content"].as_str() {
                    content.push_str(chunk);
                    delta(chunk, &content)?;
                }
            }
        }
        if !done || content.is_empty() || reason == "length" {
            return Err(anyhow!(
                "The reply ended before it was complete. Your partial reply is saved."
            ));
        }
        Ok((content, usage))
    }
}
fn memory_format() -> Value {
    let mut properties = serde_json::Map::new();
    for k in ["key", "quote", "value", "aliases"] {
        properties.insert(
            k.into(),
            json!({
            "type":"string"}
            ),
        );
    }
    properties.insert(
        "operation".into(),
        json!({
        "type":"string","enum":["remember","forget"]}
        ),
    );
    properties.insert(
        "replaces".into(),
        json!({
        "type":["integer","null"]}
        ),
    );
    json!({
    "type":"json_schema","json_schema":{
    "name":"memory_changes","strict":true,"schema":{
    "type":"object","additionalProperties":false,"required":["changes"],"properties":{
    "changes":{
    "type":"array","items":{
    "type":"object","additionalProperties":false,"required":["operation","key","quote","value","aliases","replaces"],"properties":properties}
    }
    }
    }
    }
    }
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    fn server(body: String, status: u16) -> Model {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let n = socket.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&buf[..n]);
                if let Some(at) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..at]);
                    let len = headers
                        .lines()
                        .find_map(|l| {
                            l.to_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|s| s.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= at + 4 + len {
                        break;
                    }
                }
            }
            let header=format!("HTTP/1.1 {status} OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len());
            socket.write_all(header.as_bytes()).unwrap();
            for fragment in body.as_bytes().chunks(3) {
                if socket.write_all(fragment).is_err() {
                    break;
                }
                let _ = socket.flush();
            }
        });
        Model {
            platform: None,
            legacy_transport: true,
            targets: vec![],
            client: reqwest::Client::new(),
            key: "test-only".into(),
            model: "openai/gpt-oss-20b".into(),
            endpoint: format!("http://127.0.0.1:{port}/"),
            budget: 16000,
        }
    }
    #[tokio::test]
    async fn fragmented_unicode_sse_streams_and_retains_usage() {
        let body = format!(
            "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"delta":{"content":"Hello 🙂"},"finish_reason":null}]}),
            json!({"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":42}})
        );
        let model = server(body, 200);
        let mut partial = String::new();
        let (answer, usage) = model
            .stream(json!([]), &CancellationToken::new(), |chunk, _| {
                partial.push_str(chunk);
                Ok(())
            })
            .await
            .unwrap();
        assert_eq!(answer, "Hello 🙂");
        assert_eq!(answer, partial);
        assert_eq!(usage["prompt_tokens"], 42);
    }
    #[tokio::test]
    async fn interrupted_stream_keeps_partial_callback() {
        let model = server(
            format!(
                "data: {}\n\n",
                json!({"choices":[{"delta":{"content":"Partial reply"}}]})
            ),
            200,
        );
        let mut partial = String::new();
        assert!(model
            .stream(json!([]), &CancellationToken::new(), |chunk, _| {
                partial.push_str(chunk);
                Ok(())
            })
            .await
            .is_err());
        assert_eq!(partial, "Partial reply");
    }
    #[tokio::test]
    async fn rate_limit_is_actionable_and_sanitized() {
        let model = server("private provider error".into(), 429);
        let error = model
            .stream(json!([]), &CancellationToken::new(), |_, _| Ok(()))
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("rate limit"));
        assert!(!error.contains("private provider"));
    }
    #[tokio::test]
    async fn stopped_request_is_cancelled() {
        let model = server("data: [DONE]\n\n".into(), 200);
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(model
            .stream(json!([]), &cancel, |_, _| Ok(()))
            .await
            .is_err());
    }
}
