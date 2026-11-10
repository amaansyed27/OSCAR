use crate::{cloud::Platform, network, store::*};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
#[allow(async_fn_in_trait)]
pub trait SearchProvider {
    async fn query(&self, query: &str, cancel: &CancellationToken) -> Result<Value>;
}
pub struct Tavily {
    platform: Arc<Platform>,
    client: reqwest::Client,
    credential: String,
    key: String,
}
impl Tavily {
    pub async fn connect(platform: Arc<Platform>, calls: usize) -> Result<Self> {
        let(cid,key)=platform.credential("tavily",None).map_err(|_|anyhow!("Configure Tavily in AI Providers to verify this question, or explicitly select Search Off."))?;
        let client = network::client_for("https://api.tavily.com/usage").await?;
        let response = client
            .get("https://api.tavily.com/usage")
            .bearer_auth(&key)
            .send()
            .await
            .map_err(|_| anyhow!("Search quota could not be verified."))?;
        let status = response.status().as_u16();
        platform.record_status(&cid, status, 60)?;
        if status != 200 {
            return Err(anyhow!("Search quota check returned HTTP {status}."));
        }
        let usage: Value = serde_json::from_slice(&network::bounded(response, 50000).await?)?;
        let remaining = n(&usage["account"], "plan_limit") - n(&usage["account"], "plan_usage");
        let paygo = n(&usage["account"], "paygo_limit");
        let paid_budget = platform
            .store
            .lock()
            .unwrap()
            .get("search_paid_credits", "0")
            .parse::<usize>()
            .unwrap_or(0);
        if (remaining < calls as i64 || paygo > 0) && paid_budget < calls {
            return Err(anyhow!("Search billing cannot be bounded to included credits with this account configuration. Disable pay-as-you-go or explicitly allow a per-answer search-credit budget in Settings."));
        }
        if let Some(limit) = usage["key"]["limit"].as_i64() {
            if limit > 0 && limit - n(&usage["key"], "usage") < calls as i64 {
                return Err(anyhow!("This search credential has insufficient remaining quota. Other keys will not be used to bypass the account limit."));
            }
        }
        Ok(Self {
            platform,
            client,
            credential: cid,
            key,
        })
    }
}
impl SearchProvider for Tavily {
    async fn query(&self, query: &str, cancel: &CancellationToken) -> Result<Value> {
        let time_range = if re(r"(?i)\b(today|past 24 hours)\b").is_match(query) {
            Some("d")
        } else if re(r"(?i)\b(this week|past week)\b").is_match(query) {
            Some("w")
        } else {
            None
        };
        let response = tokio::select! {_=cancel.cancelled()=>return Err(anyhow!("Stopped")),r=self.client.post("https://api.tavily.com/search").bearer_auth(&self.key).json(&json!({"query":query,"search_depth":"basic","max_results":5,"include_raw_content":false,"include_answer":false,"include_usage":true,"include_published_date":true,"time_range":time_range})).send()=>r.map_err(|_|anyhow!("Search could not be reached."))?};
        let status = response.status().as_u16();
        self.platform.record_status(&self.credential, status, 60)?;
        if !(200..300).contains(&status) {
            return Err(anyhow!(
                "Search returned HTTP {status}; no sources were invented."
            ));
        }
        let value: Value = serde_json::from_slice(&network::bounded(response, 2_000_000).await?)?;
        Ok(value)
    }
}
