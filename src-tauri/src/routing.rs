use crate::{cloud::Spec, store::re};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub const TASKS: &[&str] = &[
    "conversation",
    "knowledge questions",
    "complex reasoning",
    "mathematics",
    "programming",
    "research",
    "document analysis",
    "image analysis",
    "multi-step tasks",
];

pub fn ambiguous(text: &str, decision: &Decision) -> bool {
    decision.task == "conversation"
        && text.split_whitespace().count() >= 12
        && !re(r"(?i)^\s*(hi|hello|hey|rewrite|translate|summari[sz]e)\b").is_match(text)
}

pub fn classified(value: &Value, original: &Decision, search_mode: &str) -> Result<Decision> {
    let task = value["task"]
        .as_str()
        .filter(|t| TASKS.contains(t))
        .ok_or_else(|| anyhow!("Invalid decision task."))?;
    let complex = value["complex"]
        .as_bool()
        .ok_or_else(|| anyhow!("Invalid complexity."))?;
    let search = value["search"]
        .as_bool()
        .ok_or_else(|| anyhow!("Invalid search decision."))?;
    Ok(Decision { task: task.into(), complex, search: search_mode == "on" || (search_mode != "off" && (original.search || search)),
        vision: original.vision, reasoning: if complex {"high"} else {"low"}.into(),
        explanation: "Ambiguous request classified by a verified zero-price Decision Model; capability and spending rules remain enforced.".into() })
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Decision {
    pub task: String,
    pub search: bool,
    pub complex: bool,
    pub vision: bool,
    pub reasoning: String,
    pub explanation: String,
}
pub fn decide(text: &str, search_mode: &str, images: bool, documents: bool) -> Decision {
    let complex=re(r"(?i)\b(prove|derive|architecture|debug|multi.step|research|investigate|compare|analy[sz]e|mathematics|equation)\b").is_match(text);
    let current=re(r"(?i)\b(latest|today|current|news|recent|price|law|legal|medical|verify|look up|search|browse|research|new version|president|CEO|unfamiliar)\b").is_match(text);
    let trivial =
        re(r"(?i)^\s*(hi|hello|hey|rewrite|translate|summari[sz]e this|what is \d|calculate \d)\b")
            .is_match(text);
    let search = search_mode == "on" || (search_mode != "off" && current && !trivial);
    let task = if images {
        "image analysis"
    } else if documents {
        "document analysis"
    } else if search {
        "research"
    } else if re(r"(?i)\b(code|function|program|debug|rust|javascript|python)\b").is_match(text) {
        "programming"
    } else if re(r"(?i)\b(prove|derive|mathematics|equation|calculate|integral)\b").is_match(text) {
        "mathematics"
    } else if re(r"(?i)\b(plan|multi.step|steps|schedule)\b").is_match(text) {
        "multi-step tasks"
    } else if complex {
        "complex reasoning"
    } else {
        "conversation"
    };
    Decision {
        task: task.into(),
        search,
        complex,
        vision: images,
        reasoning: if complex { "high" } else { "low" }.into(),
        explanation: if search {
            "Fresh or explicitly requested sources are needed."
        } else {
            "No separate decision-model request is necessary for this task."
        }
        .into(),
    }
}
pub fn rank(
    mut models: Vec<Spec>,
    mode: &str,
    decision: &Decision,
    input: usize,
    ceiling: Option<f64>,
) -> Result<Vec<Spec>> {
    models.retain(|m| {
        (!decision.vision || m.vision == Some(true))
            && m.context.is_some_and(|n| n >= input + 1024)
            && m.streaming != Some(false)
    });
    if mode == "free" {
        models.retain(|m| {
            m.free
                && m.free_verified_at
                    .is_some_and(|t| chrono::Utc::now().timestamp() - t < 86400)
                && m.input_price == Some(0.)
                && m.output_price == Some(0.)
        });
    }
    if mode == "efficient" {
        models.retain(|m| m.input_price.is_some() && m.output_price.is_some());
    }
    if let Some(max) = ceiling {
        models.retain(|m| estimate(m, input, 4000).is_some_and(|p| p <= max));
    }
    if mode == "super" {
        let quality = |m: &Spec| m.task_quality.get(&decision.task).copied().or(m.quality);
        models.retain(|m| quality(m).is_some());
        models.sort_by(|a, b| {
            quality(b)
                .partial_cmp(&quality(a))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    } else {
        models.sort_by(|a, b| {
            estimate(a, input, 4000)
                .unwrap_or(f64::MAX)
                .total_cmp(&estimate(b, input, 4000).unwrap_or(f64::MAX))
                .then_with(|| {
                    a.latency_ms
                        .unwrap_or(f64::MAX)
                        .total_cmp(&b.latency_ms.unwrap_or(f64::MAX))
                })
        });
    }
    if models.is_empty() {
        return Err(anyhow!(match mode{"free"=>"No verified free model with suitable capabilities is available. Free mode never uses paid inference.","super"=>"No suitable model has recorded quality evidence. Add an evaluation rating in AI Providers or choose a manual model.",_=>"No suitable model has known pricing and capabilities. Refresh AI Providers or choose a model manually."}));
    }
    Ok(models)
}
pub fn estimate(m: &Spec, input: usize, output: usize) -> Option<f64> {
    Some((m.input_price? * input as f64 + m.output_price? * output as f64) / 1_000_000.)
}
pub fn select_reasoning(spec: &Spec, choice: &str, decision: &Decision) -> Result<Option<String>> {
    if choice == "auto" || choice.is_empty() {
        return Ok(spec
            .reasoning
            .iter()
            .find(|s| *s == &decision.reasoning)
            .cloned());
    }
    if !spec.reasoning.iter().any(|s| s == choice) {
        return Err(anyhow!(
            "That reasoning level is not supported by the selected model."
        ));
    }
    Ok(Some(choice.into()))
}
pub fn personalization(value: &Value) -> String {
    let profile = format!(
        "Name: {}. Background: {}. Projects: {}. Notes: {}",
        st_profile(value, "name"),
        st_profile(value, "background"),
        st_profile(value, "projects"),
        st_profile(value, "profile")
    );
    let instructions = value["instructions"].as_str().unwrap_or("");
    let style = value["style"].as_str().unwrap_or("Default");
    format!("Owner-provided profile (user assertion, not independently verified): {profile}\nOwner response preferences: {instructions}\nStyle: {style}. Length: {}. Warmth: {}. Enthusiasm: {}. Humor: {}. Expressiveness: {}. Emoji frequency: {}. These preferences never override factual correctness, source grounding, memory exclusions or safety.",value["length"].as_str().unwrap_or("balanced"),value["warmth"].as_str().unwrap_or("balanced"),value["enthusiasm"].as_str().unwrap_or("restrained"),value["humor"].as_str().unwrap_or("restrained"),value["expressiveness"].as_str().unwrap_or("balanced"),value["emoji"].as_str().unwrap_or("rare"))
}
fn st_profile<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn no_search_for_trivial() {
        assert!(!decide("Hello", "auto", false, false).search);
        assert!(decide("latest Rust API", "auto", false, false).search);
        assert!(!decide("latest prices", "off", false, false).search);
    }
    #[test]
    fn unknown_is_not_free() {
        let mut m = Spec::manual("x", "x");
        m.context = Some(10000);
        assert!(rank(
            vec![m.clone()],
            "free",
            &decide("hello", "auto", false, false),
            100,
            None
        )
        .is_err());
        m.free = true;
        m.free_verified_at = Some(chrono::Utc::now().timestamp());
        m.input_price = Some(0.);
        m.output_price = Some(0.);
        assert!(rank(
            vec![m],
            "free",
            &decide("hello", "auto", false, false),
            100,
            None
        )
        .is_ok());
    }
}
