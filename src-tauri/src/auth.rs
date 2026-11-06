use crate::{cloud::Platform, network, store::*};
use anyhow::{anyhow, Result};
use hmac::{Hmac, Mac};
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
fn hmac(key: &[u8], value: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts arbitrary key sizes");
    mac.update(value.as_bytes());
    mac.finalize().into_bytes().to_vec()
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub fn sigv4(
    url: &str,
    body: &Value,
    key: &Value,
    region: &str,
    date: chrono::DateTime<chrono::Utc>,
) -> Result<HeaderMap> {
    let access = st(key, "access_key_id");
    let secret = st(key, "secret_access_key");
    if access.is_empty() || secret.is_empty() || region.is_empty() {
        return Err(anyhow!("Bedrock IAM credentials require access_key_id, secret_access_key and a configured region."));
    }
    let url = reqwest::Url::parse(url)?;
    let host = url.host_str().unwrap_or("");
    let date_time = date.format("%Y%m%dT%H%M%SZ").to_string();
    let day = date.format("%Y%m%d").to_string();
    let token = st(key, "session_token");
    let mut headers = std::collections::BTreeMap::from([
        ("content-type", "application/json".to_owned()),
        ("host", host.to_owned()),
        ("x-amz-date", date_time.clone()),
    ]);
    if !token.is_empty() {
        headers.insert("x-amz-security-token", token.into());
    }
    let canonical_headers = headers
        .iter()
        .map(|(k, v)| format!("{k}:{}\n", v.trim()))
        .collect::<String>();
    let signed = headers.keys().copied().collect::<Vec<_>>().join(";");
    let encode = |s: &str| {
        s.bytes()
            .map(|b| {
                if b.is_ascii_alphanumeric() || b"-_.~/".contains(&b) {
                    (b as char).to_string()
                } else {
                    format!("%{b:02X}")
                }
            })
            .collect::<String>()
    };
    let canonical_path = encode(&url.path().replace("%3A", ":").replace("%2F", "/"));
    let hash = format!("{:x}", Sha256::digest(body.to_string().as_bytes()));
    let canonical = format!("POST\n{canonical_path}\n\n{canonical_headers}\n{signed}\n{hash}");
    let scope = format!("{day}/{region}/bedrock/aws4_request");
    let to_sign = format!(
        "AWS4-HMAC-SHA256\n{date_time}\n{scope}\n{:x}",
        Sha256::digest(canonical.as_bytes())
    );
    let k_date = hmac(format!("AWS4{secret}").as_bytes(), &day);
    let k_region = hmac(&k_date, region);
    let k_service = hmac(&k_region, "bedrock");
    let k_signing = hmac(&k_service, "aws4_request");
    let signature = hex(&hmac(&k_signing, &to_sign));
    let mut result = HeaderMap::new();
    for (k, v) in headers {
        result.insert(
            reqwest::header::HeaderName::from_bytes(k.as_bytes())?,
            HeaderValue::from_str(&v).map_err(|_| anyhow!("Invalid IAM credential."))?,
        );
    }
    result.insert("authorization",HeaderValue::from_str(&format!("AWS4-HMAC-SHA256 Credential={access}/{scope}, SignedHeaders={signed}, Signature={signature}"))?);
    Ok(result)
}
pub async fn headers(
    platform: &Platform,
    p: &Value,
    key: &str,
    url: &str,
    body: &Value,
) -> Result<HeaderMap> {
    if st(p, "id") == "bedrock" && key.trim_start().starts_with('{') {
        return sigv4(
            url,
            body,
            &serde_json::from_str(key).map_err(|_| anyhow!("Invalid IAM credential JSON."))?,
            st(p, "region"),
            chrono::Utc::now(),
        );
    }
    if st(p, "id") == "vertex" && key.trim_start().starts_with('{') {
        let token = service_token(key).await?;
        let mut h = HeaderMap::new();
        h.insert(
            "authorization",
            HeaderValue::from_str(&format!("Bearer {token}"))?,
        );
        return Ok(h);
    }
    platform.headers(p, key)
}
async fn service_token(raw: &str) -> Result<String> {
    use std::{
        collections::HashMap,
        sync::{Mutex, OnceLock},
    };
    static CACHE: OnceLock<Mutex<HashMap<String, (i64, String)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let fingerprint = format!("{:x}", Sha256::digest(raw.as_bytes()));
    let now = chrono::Utc::now().timestamp();
    if let Some((expiry, token)) = cache.lock().unwrap().get(&fingerprint) {
        if *expiry > now + 60 {
            return Ok(token.clone());
        }
    }
    let service: Value =
        serde_json::from_str(raw).map_err(|_| anyhow!("Invalid service-account JSON."))?;
    let email = st(&service, "client_email");
    let private = st(&service, "private_key");
    if !email.ends_with(".gserviceaccount.com") || private.is_empty() {
        return Err(anyhow!(
            "Service account requires client_email and private_key."
        ));
    }
    let claims = json!({"iss":email,"scope":"https://www.googleapis.com/auth/cloud-platform","aud":"https://oauth2.googleapis.com/token","iat":now,"exp":now+3600});
    let jwt = jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
        &claims,
        &jsonwebtoken::EncodingKey::from_rsa_pem(private.as_bytes())
            .map_err(|_| anyhow!("Invalid service-account signing key."))?,
    )?;
    let response = network::client_for("https://oauth2.googleapis.com/token")
        .await?
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", jwt.as_str()),
        ])
        .send()
        .await
        .map_err(|_| anyhow!("Google authorization could not be reached."))?;
    if !response.status().is_success() {
        return Err(anyhow!("Google rejected this service account."));
    }
    let value: Value = serde_json::from_slice(&network::bounded(response, 50000).await?)?;
    let token = st(&value, "access_token").to_owned();
    if token.is_empty() {
        return Err(anyhow!("Google did not return an access token."));
    }
    let expiry = now + n(&value, "expires_in").min(3600);
    cache
        .lock()
        .unwrap()
        .insert(fingerprint, (expiry, token.clone()));
    Ok(token)
}
