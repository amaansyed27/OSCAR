use crate::{adapters::event_text, store::*};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
#[derive(Default, Debug)]
pub struct Event {
    pub text: String,
    pub done: bool,
    pub usage: Value,
}
pub struct Decoder {
    protocol: String,
    buffer: Vec<u8>,
    data: Vec<String>,
    name: String,
}
impl Decoder {
    pub fn new(protocol: &str) -> Self {
        Self {
            protocol: protocol.into(),
            buffer: vec![],
            data: vec![],
            name: String::new(),
        }
    }
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Event>> {
        self.buffer.extend(bytes);
        if self.buffer.len() > 2_000_000 {
            return Err(anyhow!("Provider event exceeded the size limit."));
        }
        let mut events = vec![];
        if self.protocol == "bedrock" {
            loop {
                if self.buffer.len() < 12 {
                    break;
                }
                let size = u32::from_be_bytes(self.buffer[..4].try_into().unwrap()) as usize;
                let headers = u32::from_be_bytes(self.buffer[4..8].try_into().unwrap()) as usize;
                if !(16..=2_000_000).contains(&size) || headers + 16 > size {
                    return Err(anyhow!("Invalid Bedrock event frame."));
                }
                if self.buffer.len() < size {
                    break;
                }
                let frame: Vec<u8> = self.buffer.drain(..size).collect();
                if crc32fast::hash(&frame[..8])
                    != u32::from_be_bytes(frame[8..12].try_into().unwrap())
                    || crc32fast::hash(&frame[..size - 4])
                        != u32::from_be_bytes(frame[size - 4..].try_into().unwrap())
                {
                    return Err(anyhow!("Bedrock stream checksum failed."));
                }
                let data: Value = serde_json::from_slice(&frame[12 + headers..size - 4])?;
                if !data["modelStreamErrorException"].is_null()
                    || !data["validationException"].is_null()
                    || !data["throttlingException"].is_null()
                {
                    return Err(anyhow!("Bedrock stream was interrupted."));
                }
                let text = st(&data["contentBlockDelta"]["delta"], "text").to_owned();
                if data["messageStop"]["stopReason"] == "max_tokens" {
                    return Err(anyhow!("Reply reached its output limit."));
                }
                events.push(Event{text,done:!data["messageStop"].is_null(),usage:if data["metadata"]["usage"].is_object(){json!({"prompt_tokens":data["metadata"]["usage"]["inputTokens"],"completion_tokens":data["metadata"]["usage"]["outputTokens"]})}else{Value::Null}});
            }
            return Ok(events);
        }
        while let Some(at) = self.buffer.iter().position(|b| *b == b'\n') {
            let raw: Vec<_> = self.buffer.drain(..=at).collect();
            let line = std::str::from_utf8(&raw)?.trim_end_matches(['\r', '\n']);
            if self.protocol == "ollama" {
                if !line.is_empty() {
                    events.push(self.parse(line)?);
                }
                continue;
            }
            if line.is_empty() {
                if !self.data.is_empty() {
                    let data = std::mem::take(&mut self.data).join("\n");
                    events.push(self.parse(&data)?);
                }
                self.name.clear();
            } else if let Some(name) = line.strip_prefix("event:") {
                self.name = name.trim().into();
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data.push(data.trim_start().into());
            }
        }
        Ok(events)
    }
    fn parse(&self, data: &str) -> Result<Event> {
        if data.trim() == "[DONE]" {
            return Ok(Event {
                done: true,
                ..Default::default()
            });
        }
        if self.protocol == "replicate" {
            return match self.name.as_str() {
                "output" => Ok(Event {
                    text: serde_json::from_str::<String>(data).unwrap_or(data.to_owned()),
                    ..Default::default()
                }),
                "done" => Ok(Event {
                    done: true,
                    ..Default::default()
                }),
                "error" => Err(anyhow!("Replicate stream interrupted.")),
                _ => Ok(Event::default()),
            };
        }
        let v: Value = serde_json::from_str(data)?;
        if !v["error"].is_null() || v["type"] == "error" {
            return Err(anyhow!(
                "Provider interrupted its response. Partial reply is saved."
            ));
        }
        if v["choices"][0]["finish_reason"] == "length"
            || v["delta"]["stop_reason"] == "max_tokens"
            || v["done_reason"] == "length"
            || v["finish_reason"] == "MAX_TOKENS"
            || v["candidates"][0]["finishReason"] == "MAX_TOKENS"
            || v["type"] == "response.incomplete"
        {
            return Err(anyhow!(
                "Reply reached the output limit. Partial reply is saved."
            ));
        }
        let mut usage = v["usage"].clone();
        if v["type"] == "message_start" {
            usage = json!({"prompt_tokens":v["message"]["usage"]["input_tokens"]});
        }
        if v["type"] == "message_delta" {
            usage = json!({"completion_tokens":v["usage"]["output_tokens"]});
        }
        if !v["usageMetadata"].is_null() {
            usage = json!({"prompt_tokens":v["usageMetadata"]["promptTokenCount"],"completion_tokens":v["usageMetadata"]["candidatesTokenCount"]});
        }
        if !v["response"]["usage"].is_null() {
            usage = json!({"prompt_tokens":v["response"]["usage"]["input_tokens"],"completion_tokens":v["response"]["usage"]["output_tokens"]});
        }
        if self.protocol == "ollama" && v["done"] == true {
            usage =
                json!({"prompt_tokens":v["prompt_eval_count"],"completion_tokens":v["eval_count"]});
        }
        if v["type"] == "message-end" {
            usage = json!({"prompt_tokens":v["delta"]["usage"]["tokens"]["input_tokens"],"completion_tokens":v["delta"]["usage"]["tokens"]["output_tokens"]});
        }
        Ok(Event {
            text: event_text(&self.protocol, &v).unwrap_or_default(),
            done: v["type"] == "message_stop"
                || v["type"] == "response.completed"
                || v["type"] == "message-end"
                || v["done"] == true
                || v["candidates"][0]["finishReason"] == "STOP",
            usage,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragmented_unicode_openai() {
        let text = "data: {\"choices\":[{\"delta\":{\"content\":\"Hi 🙂\"}}]}\n\ndata: [DONE]\n\n";
        let mut d = Decoder::new("openai");
        let mut out = String::new();
        let mut done = false;
        for c in text.as_bytes().chunks(2) {
            for e in d.push(c).unwrap() {
                out.push_str(&e.text);
                done |= e.done;
            }
        }
        assert_eq!(out, "Hi 🙂");
        assert!(done);
    }
    #[test]
    fn provider_families() {
        for (p, data, expected) in [
            ("anthropic", r#"{"delta":{"text":"Hello"}}"#, "Hello"),
            (
                "gemini",
                r#"{"candidates":[{"content":{"parts":[{"text":"hidden","thought":true},{"text":"Hello"}]}}]}"#,
                "Hello",
            ),
            (
                "responses",
                r#"{"type":"response.output_text.delta","delta":"Hello"}"#,
                "Hello",
            ),
            (
                "cohere",
                r#"{"delta":{"message":{"content":{"text":"Hello"}}}}"#,
                "Hello",
            ),
        ] {
            let mut d = Decoder::new(p);
            assert_eq!(
                d.push(format!("data: {data}\n\n").as_bytes()).unwrap()[0].text,
                expected
            );
        }
    }
    #[test]
    fn replicate_sse() {
        let mut d = Decoder::new("replicate");
        let events = d
            .push(b"event: output\ndata: Hello\n\nevent: done\ndata: {}\n\n")
            .unwrap();
        assert_eq!(events[0].text, "Hello");
        assert!(events[1].done);
    }
    #[test]
    fn truncation_is_not_success() {
        let mut d = Decoder::new("anthropic");
        assert!(d
            .push(b"data: {\"delta\":{\"stop_reason\":\"max_tokens\"}}\n\n")
            .is_err());
    }
}
