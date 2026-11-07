use crate::{
    cloud::{Platform, Spec},
    network, routing,
    store::*,
};
use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
#[derive(Clone)]
pub struct Target {
    pub spec: Spec,
    pub provider: Value,
    pub credential: Option<String>,
    pub reasoning: Option<String>,
}
impl Platform {
    pub fn targets(
        &self,
        selection: &str,
        text: &str,
        vision: bool,
        documents: bool,
    ) -> Result<(Vec<Target>, routing::Decision)> {
        let (smode, reasoning, waterfall, ceiling) = {
            let s = self.store.lock().unwrap();
            (
                s.get("search_mode", "auto"),
                s.get("reasoning", "auto"),
                s.get("waterfall", "[]"),
                s.get("spending_ceiling", ""),
            )
        };
        let decision = routing::decide(text, &smode, vision, documents);
        let mut preferences =
            std::collections::HashMap::<String, (Option<String>, Option<String>)>::new();
        let mut specs = if selection.starts_with("auto:") {
            let mut specs = vec![];
            for m in self.models(None)? {
                if m["enabled"] == true {
                    let spec: Spec = serde_json::from_value(m)?;
                    if self.credential(&spec.provider, None).is_ok() {
                        specs.push(spec);
                    }
                }
            }
            routing::rank(
                specs,
                selection.trim_start_matches("auto:"),
                &decision,
                crate::context::count(text) + 1024,
                ceiling.parse().ok(),
            )?
        } else {
            let primary = self.spec(selection);
            let mut specs = primary
                .as_ref()
                .ok()
                .cloned()
                .into_iter()
                .collect::<Vec<_>>();
            let waterfall: Value = serde_json::from_str(&waterfall)?;
            for item in waterfall.as_array().into_iter().flatten() {
                if item["enabled"] != false {
                    if let Ok(spec) = self.spec(st(item, "model")) {
                        preferences.insert(
                            spec.id.clone(),
                            (
                                item["credential"]
                                    .as_str()
                                    .filter(|s| !s.is_empty())
                                    .map(String::from),
                                Some(item["reasoning"].as_str().unwrap_or("auto").into()),
                            ),
                        );
                        if !specs.iter().any(|m| m.id == spec.id) {
                            specs.push(spec);
                        }
                    }
                }
            }
            if specs.is_empty() {
                primary?;
            }
            specs
        };
        let mut targets = vec![];
        for spec in specs.drain(..) {
            if spec.context.is_none() || spec.streaming == Some(false) {
                continue;
            }
            if vision && spec.vision != Some(true) {
                continue;
            }
            let p = self.provider(&spec.provider)?;
            if p["enabled"] == false || st(&p, "protocol") == "restricted" {
                continue;
            }
            let preference = preferences.get(&spec.id).cloned().unwrap_or_default();
            let level = routing::select_reasoning(
                &spec,
                preference
                    .1
                    .as_deref()
                    .unwrap_or(if selection.starts_with("auto:") {
                        "auto"
                    } else {
                        &reasoning
                    }),
                &decision,
            )?;
            targets.push(Target {
                spec,
                provider: p,
                credential: preference.0,
                reasoning: level,
            });
        }
        if targets.is_empty() {
            return Err(anyhow!("No enabled model with documented context limits supports these inputs. Check AI Providers and use a verified vision model for images."));
        }
        targets.truncate(8);
        Ok((targets, decision))
    }
}
pub fn request_body(
    target: &Target,
    messages: Value,
    json_mode: bool,
    stream: bool,
) -> Result<(String, Value)> {
    let spec = &target.spec;
    let p = &target.provider;
    let base = st(p, "base");
    if base.is_empty() {
        return Err(anyhow!(
            "This provider needs its project/account endpoint configured in AI Providers."
        ));
    }
    let protocol = st(p, "protocol");
    let out = spec.output.unwrap_or(4000).min(16000);
    let mut endpoint = match protocol {
        "anthropic" => format!("{base}/messages"),
        "gemini" => format!(
            "{base}/models/{}:{}",
            spec.model,
            if stream {
                "streamGenerateContent?alt=sse"
            } else {
                "generateContent"
            }
        ),
        "responses" => format!("{base}/responses"),
        "cohere" => format!("{base}/chat"),
        "ollama" => format!("{base}/chat"),
        "replicate" => format!("{base}/models/{}/predictions", spec.model),
        "bedrock" => format!(
            "{base}/model/{}/converse{}",
            spec.model,
            if stream { "-stream" } else { "" }
        ),
        "cloudflare" => {
            let account = st(p, "account");
            if account.is_empty() {
                return Err(anyhow!("Cloudflare requires an account ID."));
            }
            format!("{base}/accounts/{account}/ai/v1/chat/completions")
        }
        _ => format!("{base}/chat/completions"),
    };
    let mut body = json!({"model":spec.model,"messages":messages,"stream":stream,"max_tokens":out});
    match protocol {
        "anthropic" => {
            let system = messages
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| m["role"] == "system")
                .map(|m| st(m, "content"))
                .collect::<Vec<_>>()
                .join("\n\n");
            body["system"] = json!(system);
            body["messages"]=json!(messages.as_array().into_iter().flatten().filter(|m|m["role"]!="system").map(|m|{let mut m=m.clone();if let Some(parts)=m["content"].as_array(){m["content"]=json!(parts.iter().map(|p|{if p["type"]=="image_url"{let url=st(&p["image_url"],"url");let (head,data)=url.split_once(',').unwrap_or(("", ""));json!({"type":"image","source":{"type":"base64","media_type":head.trim_start_matches("data:").trim_end_matches(";base64"),"data":data}})}else{json!({"type":"text","text":p["text"]})}}).collect::<Vec<_>>());}m}).collect::<Vec<_>>());
        }
        "gemini" => {
            let system = messages
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| m["role"] == "system")
                .map(|m| st(m, "content"))
                .collect::<Vec<_>>()
                .join("\n\n");
            let contents:Vec<Value>=messages.as_array().into_iter().flatten().filter(|m|m["role"]!="system").map(|m|{let parts=if let Some(parts)=m["content"].as_array(){parts.iter().map(|p|if p["type"]=="image_url"{let (head,data)=st(&p["image_url"],"url").split_once(',').unwrap_or(("", ""));json!({"inlineData":{"mimeType":head.trim_start_matches("data:").trim_end_matches(";base64"),"data":data}})}else{json!({"text":p["text"]})}).collect::<Vec<_>>()}else{vec![json!({"text":m["content"]})]};json!({"role":if m["role"]=="assistant"{"model"}else{"user"},"parts":parts})}).collect();
            body = json!({"systemInstruction":{"parts":[{"text":system}]},"contents":contents,"generationConfig":{"maxOutputTokens":out}});
            if json_mode {
                body["generationConfig"]["responseMimeType"] = json!("application/json");
            }
        }
        "responses" => {
            body = json!({"model":spec.model,"input":messages,"max_output_tokens":out,"stream":stream,"store":false});
            if spec.provider == "perplexity" {
                body["tools"] = json!([]);
            }
            if let Some(items) = body["input"].as_array_mut() {
                for m in items {
                    if let Some(parts) = m["content"].as_array_mut() {
                        for p in parts {
                            if p["type"] == "image_url" {
                                *p =
                                    json!({"type":"input_image","image_url":p["image_url"]["url"]});
                            } else {
                                p["type"] = json!("input_text");
                            }
                        }
                    }
                }
            }
        }
        "ollama" => {
            if let Some(msgs) = body["messages"].as_array_mut() {
                for m in msgs {
                    if let Some(parts) = m["content"].as_array() {
                        let text = parts
                            .iter()
                            .filter_map(|p| p["text"].as_str())
                            .collect::<Vec<_>>()
                            .join("\n");
                        let images = parts
                            .iter()
                            .filter_map(|p| p["image_url"]["url"].as_str())
                            .filter_map(|s| s.split_once(',').map(|(_, s)| s.to_owned()))
                            .collect::<Vec<_>>();
                        m["content"] = json!(text);
                        m["images"] = json!(images);
                    }
                }
            }
            body["options"] = json!({"num_predict":out});
            body.as_object_mut().unwrap().remove("max_tokens");
            if json_mode {
                body["format"] = json!("json");
            }
        }
        "replicate" => {
            let prompt = messages
                .as_array()
                .into_iter()
                .flatten()
                .map(|m| format!("{}: {}", st(m, "role"), st(m, "content")))
                .collect::<Vec<_>>()
                .join("\n");
            body = json!({"input":{"prompt":prompt,"max_new_tokens":out},"stream":stream});
        }
        "bedrock" => {
            let system: Vec<_> = messages
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| m["role"] == "system")
                .map(|m| json!({"text":m["content"]}))
                .collect();
            let msgs: Vec<_> = messages
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| m["role"] != "system")
                .map(|m| { let parts=if let Some(parts)=m["content"].as_array() {parts.iter().map(|p| {if p["type"]=="image_url" {let (head,data)=st(&p["image_url"],"url").split_once(',').unwrap_or(("", ""));json!({"image":{"format":head.trim_start_matches("data:image/").trim_end_matches(";base64"),"source":{"bytes":data}}})} else {json!({"text":p["text"]})}}).collect::<Vec<_>>()}else{vec![json!({"text":m["content"]})]}; json!({"role":m["role"],"content":parts})})
                .collect();
            body = json!({"system":system,"messages":msgs,"inferenceConfig":{"maxTokens":out}});
        }
        _ => {
            if json_mode && spec.structured == Some(true) {
                body["response_format"] = json!({"type":"json_object"});
            }
            if spec.provider == "groq" {
                body["stream_options"] = json!({"include_usage":true});
                if !stream {
                    body.as_object_mut().unwrap().remove("stream_options");
                }
            }
        }
    }
    if let Some(level) = &target.reasoning {
        match spec.reasoning_parameter.as_deref() {
            Some("reasoning_effort") => body["reasoning_effort"] = json!(level),
            Some("reasoning.effort") => body["reasoning"] = json!({"effort":level}),
            Some("reasoning.effort.openrouter") => body["reasoning"] = json!({"effort":level}),
            Some("thinking.budget") => {
                body["generationConfig"]["thinkingConfig"] = json!({"thinkingBudget":if level=="off"{0}else if level=="high"{8192}else{1024}})
            }
            Some("thinking.level") => {
                body["generationConfig"]["thinkingConfig"] = json!({"thinkingLevel":level})
            }
            Some("thinking.adaptive") => {
                body["thinking"] = json!({"type":"adaptive"});
                body["output_config"] = json!({"effort":level});
            }
            Some("ollama.think") => {
                body["think"] = if ["on", "off"].contains(&level.as_str()) {
                    json!(level == "on")
                } else {
                    json!(level)
                };
            }
            Some("bedrock.thinking") => {
                body["additionalModelRequestFields"] = json!({"thinking":{"type":if level=="off"{"disabled"}else{"enabled"},"budget_tokens":1024}});
            }
            Some("thinking.enabled") => {
                body["thinking"] =
                    json!({"type":if level=="off"{"disabled"}else{"enabled"},"budget_tokens":1024})
            }
            _ => {}
        }
    }
    if spec.provider == "openrouter" && spec.free {
        body["provider"] = json!({"max_price":{"prompt":0,"completion":0},"allow_fallbacks":true});
    }
    if spec.provider == "azure" && !base.ends_with("/v1") {
        return Err(anyhow!(
            "Azure requires its current OpenAI v1 endpoint, ending in /openai/v1."
        ));
    }
    if protocol == "gemini" && !stream {
        endpoint = endpoint.trim_end_matches("?alt=sse").into();
    }
    Ok((endpoint, body))
}
pub fn event_text(protocol: &str, event: &Value) -> Option<String> {
    match protocol {
        "anthropic" => event["delta"]["text"].as_str().map(String::from),
        "gemini" => event["candidates"][0]["content"]["parts"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter(|p| p["thought"] != true)
                    .filter_map(|p| p["text"].as_str())
                    .collect::<String>()
            }),
        "responses" => {
            if event["type"] == "response.output_text.delta" {
                event["delta"].as_str().map(String::from)
            } else {
                None
            }
        }
        "cohere" => event["delta"]["message"]["content"]["text"]
            .as_str()
            .map(String::from),
        "ollama" => event["message"]["content"].as_str().map(String::from),
        _ => event["choices"][0]["delta"]["content"]
            .as_str()
            .map(String::from),
    }
}
pub fn completion_text(protocol: &str, value: &Value) -> String {
    match protocol {
        "anthropic" => value["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|b| b["text"].as_str())
            .collect(),
        "gemini" => value["candidates"][0]["content"]["parts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|p| p["thought"] != true)
            .filter_map(|b| b["text"].as_str())
            .collect(),
        "responses" => value["output"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|v| v["content"].as_array().into_iter().flatten())
            .filter_map(|v| v["text"].as_str())
            .collect(),
        "cohere" => value["message"]["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| v["text"].as_str())
            .collect(),
        "ollama" => st(&value["message"], "content").into(),
        "bedrock" => value["output"]["message"]["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| v["text"].as_str())
            .collect(),
        _ => value["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .into(),
    }
}
async fn request(
    platform: &Platform,
    target: &Target,
    messages: Value,
    json_mode: bool,
    stream: bool,
    cancel: &CancellationToken,
) -> Result<(reqwest::Response, String)> {
    let ceiling = platform
        .store
        .lock()
        .unwrap()
        .get("spending_ceiling", "")
        .parse::<f64>()
        .ok();
    if let Some(ceiling) = ceiling {
        if !routing::estimate(
            &target.spec,
            input_tokens(&messages, &target.spec.model),
            target.spec.output.unwrap_or(4000).min(16000),
        )
        .is_some_and(|cost| cost <= ceiling)
        {
            return Err(anyhow!(
                "Request cannot be proven to fit the configured spending ceiling."
            ));
        }
    }
    let (url, body) = request_body(target, messages, json_mode, stream)?;
    let safe_url = url.split('?').next().unwrap();
    let client = network::client_for(safe_url).await?;
    let (cid, key) = platform.credential(&target.spec.provider, target.credential.as_deref())?;
    let headers = crate::auth::headers(platform, &target.provider, &key, &url, &body).await?;
    let response = tokio::select! {_=cancel.cancelled()=>return Err(anyhow!("Stopped")),r=client.post(&url).headers(headers).json(&body).send()=>r.map_err(|_|anyhow!("{} could not be reached.",st(&target.provider,"name")))?};
    let status = response.status().as_u16();
    let retry = response
        .headers()
        .get("retry-after")
        .and_then(|s| s.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(60);
    platform.record_status(&cid, status, retry)?;
    if !(200..300).contains(&status) {
        let reason = if status == 400 || status == 404 || status == 422 {
            let raw = network::bounded(response, 16000).await.unwrap_or_default();
            let v: Value = serde_json::from_slice(&raw).unwrap_or(Value::Null);
            let message = v["error"]["message"]
                .as_str()
                .unwrap_or("The request was rejected.")
                .replace(&key, "[credential]");
            crate::store::re(r"(?i)(?:sk-|bearer )[a-z0-9_-]{8,}")
                .replace_all(&truncate(&message, 400), "[credential]")
                .into_owned()
        } else {
            match status { 429=>format!("Rate limited; retry after {retry} seconds. No quota-evading key rotation was attempted."),401|403=>"Check this credential and its product access.".into(),_=>"The request was not completed.".into() }
        };
        return Err(anyhow!(
            "{} returned HTTP {status}. {reason}",
            st(&target.provider, "name")
        ));
    }
    Ok((response, cid))
}
pub async fn complete(
    platform: &Arc<Platform>,
    target: &Target,
    messages: Value,
    cancel: &CancellationToken,
) -> Result<String> {
    let (response, _) = request(platform, target, messages, true, false, cancel).await?;
    let value: Value = serde_json::from_slice(&network::bounded(response, 2_000_000).await?)?;
    let text = completion_text(st(&target.provider, "protocol"), &value);
    if text.is_empty() {
        return Err(anyhow!("Provider returned no text."));
    }
    Ok(text)
}
pub async fn stream(
    platform: &Arc<Platform>,
    targets: &[Target],
    messages: Value,
    cancel: &CancellationToken,
    mut delta: impl FnMut(&str, &str) -> Result<()>,
) -> Result<(String, Value)> {
    let mut last = anyhow!("No suitable route is available.");
    let spending_ceiling = platform
        .store
        .lock()
        .unwrap()
        .get("spending_ceiling", "")
        .parse::<f64>()
        .ok();
    let mut reserved_cost = 0.;

    for target in targets {
        if cancel.is_cancelled() {
            return Err(anyhow!("Stopped"));
        }
        let input = input_tokens(&messages, &target.spec.model);
        if input + target.spec.output.unwrap_or(4000).min(16000) + 1024
            > target.spec.context.unwrap_or(8192)
        {
            last = anyhow!(
                "Fallback model context is too small; evidence was not silently truncated."
            );
            continue;
        }
        if let Some(ceiling) = spending_ceiling {
            let Some(cost) = routing::estimate(
                &target.spec,
                input,
                target.spec.output.unwrap_or(4000).min(16000),
            ) else {
                last =
                    anyhow!("Fallback pricing is unknown; spending ceiling cannot be guaranteed.");
                continue;
            };
            if reserved_cost + cost > ceiling {
                last = anyhow!("Fallback would exceed the per-answer spending ceiling.");
                continue;
            }
            reserved_cost += cost;
        }
        let response = request(platform, target, messages.clone(), false, true, cancel).await;
        let (response, cid) = match response {
            Ok(v) => v,
            Err(e) => {
                last = e;
                continue;
            }
        };
        let protocol = st(&target.provider, "protocol");
        let response = if protocol == "replicate" {
            replicate_stream(platform, target, response, cancel).await?
        } else {
            response
        };
        let mut stream = response.bytes_stream();
        let mut decoder = crate::wire::Decoder::new(protocol);
        let (mut content, mut done, mut usage) = (String::new(), false, json!({}));
        loop {
            let next = tokio::select! {_=cancel.cancelled()=>return Err(anyhow!("Stopped")),b=stream.next()=>b};
            let Some(bytes) = next else { break };
            let bytes = bytes.map_err(|_| {
                anyhow!(
                    "Stream interrupted. Partial reply is saved; no other model was mixed into it."
                )
            })?;
            for event in decoder.push(&bytes)? {
                done |= event.done;
                if let Some(values) = event.usage.as_object() {
                    for (k, v) in values {
                        if !v.is_null() {
                            usage[k] = v.clone();
                        }
                    }
                }
                if !event.text.is_empty() {
                    content.push_str(&event.text);
                    delta(&event.text, &content)?;
                }
            }
        }
        if !done || content.is_empty() {
            return Err(anyhow!(
                "Reply ended before completion. Partial reply is saved."
            ));
        }
        if !usage.is_object() {
            usage = json!({});
        }
        usage["provider"] = json!(target.spec.provider);
        usage["model"] = json!(target.spec.model);
        usage["credential"] = json!(cid);
        usage["estimated_cost"] = routing::estimate(
            &target.spec,
            usage["prompt_tokens"].as_u64().unwrap_or(input as u64) as usize,
            usage["completion_tokens"].as_u64().unwrap_or(0) as usize,
        )
        .map_or(Value::Null, |n| json!(n));
        return Ok((content, usage));
    }
    Err(last)
}

pub fn input_tokens(messages: &Value, model: &str) -> usize {
    messages
        .as_array()
        .into_iter()
        .flatten()
        .map(|m| {
            let count = |s: &str| {
                if model.contains("gpt-oss") {
                    crate::context::count(s)
                } else {
                    s.len()
                }
            };
            if let Some(parts) = m["content"].as_array() {
                parts
                    .iter()
                    .map(|p| {
                        if p["type"] == "image_url" {
                            4000
                        } else {
                            count(st(p, "text"))
                        }
                    })
                    .sum::<usize>()
                    + 24
            } else {
                count(st(m, "content")) + 24
            }
        })
        .sum::<usize>()
        + 64
}

async fn replicate_stream(
    platform: &Platform,
    target: &Target,
    response: reqwest::Response,
    cancel: &CancellationToken,
) -> Result<reqwest::Response> {
    let value: Value = serde_json::from_slice(&network::bounded(response, 1000000).await?)?;
    let url = st(&value["urls"], "stream");
    if url.is_empty() {
        return Err(anyhow!("This Replicate model did not offer a streaming output URL. The prediction was not replayed."));
    }
    let parsed = network::cloud_url(url.split('?').next().unwrap_or(url))?;
    if !parsed
        .host_str()
        .is_some_and(|h| h == "stream.replicate.com" || h.ends_with(".replicate.delivery"))
    {
        return Err(anyhow!(
            "Replicate returned an unexpected streaming host; no credentials were sent."
        ));
    }
    let client = network::client_for(url.split('?').next().unwrap_or(url)).await?;
    let response = tokio::select! {_=cancel.cancelled()=>return Err(anyhow!("Stopped")),r=client.get(url).send()=>r.map_err(|_|anyhow!("Replicate stream could not be opened."))?};
    if !response.status().is_success() {
        return Err(anyhow!("Replicate stream could not be opened."));
    }
    let _ = (platform, target);
    Ok(response)
}
