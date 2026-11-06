use anyhow::{anyhow, Result};
use reqwest::{Client, Url};
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            !(v.is_private()
                || v.is_loopback()
                || v.is_link_local()
                || v.is_unspecified()
                || v.is_broadcast()
                || v.is_multicast()
                || o[0] == 0
                || o[0] >= 240
                || o[0] == 127
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                || (o[0] == 192 && o[1] == 0)
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
                || (o[0] == 198 && o[1] == 51 && o[2] == 100)
                || (o[0] == 203 && o[1] == 0 && o[2] == 113))
        }
        IpAddr::V6(v) => {
            if let Some(ip) = v.to_ipv4_mapped() {
                return public_ip(IpAddr::V4(ip));
            }
            let s = v.segments();
            !v.is_unspecified()
                && !v.is_loopback()
                && (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && (s[1] == 0x0db8 || s[1] < 0x0200))
                && s[0] != 0x2002
        }
    }
}
pub fn cloud_url(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| anyhow!("Enter a valid HTTPS cloud URL."))?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow!("Cloud URL needs a host."))?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some()
        || host == "localhost"
        || [".localhost", ".local", ".internal", ".arpa"]
            .iter()
            .any(|s| host.ends_with(s))
    {
        return Err(anyhow!(
            "Only public HTTPS cloud endpoints without credentials or query strings are allowed."
        ));
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        if !public_ip(ip) {
            return Err(anyhow!(
                "Private, local and metadata endpoints are blocked."
            ));
        }
    }
    Ok(url)
}
pub async fn client_for(raw: &str) -> Result<Client> {
    use std::{
        collections::HashMap,
        sync::{Mutex, OnceLock},
        time::Instant,
    };
    static CACHE: OnceLock<Mutex<HashMap<String, (Instant, Client)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let parsed = cloud_url(raw)?;
    let cache_key = format!(
        "{}:{}",
        parsed.host_str().unwrap(),
        parsed.port_or_known_default().unwrap_or(443)
    );
    if let Some((created, client)) = cache.lock().unwrap().get(&cache_key) {
        if created.elapsed().as_secs() < 60 {
            return Ok(client.clone());
        }
    }

    let url = cloud_url(raw)?;
    let host = url.host_str().unwrap();
    let ips: Vec<SocketAddr> =
        tokio::net::lookup_host((host, url.port_or_known_default().unwrap_or(443)))
            .await
            .map_err(|_| anyhow!("Cloud host could not be resolved."))?
            .collect();
    if ips.is_empty() || ips.iter().any(|ip| !public_ip(ip.ip())) {
        return Err(anyhow!("Cloud host resolved to a blocked address."));
    }
    let client = Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
        .resolve_to_addrs(host, &ips)
        .build()?;
    {
        let mut cache = cache.lock().unwrap();
        if cache.len() > 100 {
            cache.clear();
        }
        cache.insert(cache_key, (Instant::now(), client.clone()));
    }
    Ok(client)
}
pub async fn bounded(response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    use futures_util::StreamExt;
    if response.content_length().unwrap_or(0) > limit as u64 {
        return Err(anyhow!("Cloud response exceeds the size limit."));
    }
    let mut bytes = vec![];
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| anyhow!("Cloud response interrupted."))?;
        if bytes.len() + chunk.len() > limit {
            return Err(anyhow!("Cloud response exceeds the size limit."));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blocks_private_and_metadata() {
        for url in [
            "http://api.example.com",
            "https://127.0.0.1",
            "https://169.254.169.254",
            "https://10.0.0.1",
            "https://[::1]",
            "https://[::ffff:127.0.0.1]",
            "https://x.local",
            "https://u:pass@example.com",
        ] {
            assert!(cloud_url(url).is_err(), "{url}");
        }
        assert!(cloud_url("https://api.example.com/v1").is_ok());
    }
    #[test]
    fn rejects_special_ranges() {
        for ip in [
            "192.168.1.1",
            "100.64.0.1",
            "198.18.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()));
        }
    }
}
