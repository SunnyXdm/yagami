/// Heartbeat + log publishers — keeps this service visible in the dashboard.
use async_nats::Client;
use serde_json::json;

pub fn spawn_heartbeat(client: Client) {
    tokio::spawn(async move {
        let mut t = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            t.tick().await;
            let payload = json!({
                "service": "downloader",
                "status": "ok",
                "version": env!("CARGO_PKG_VERSION"),
                "ts": chrono::Utc::now().to_rfc3339()
            })
            .to_string();
            let _ = client.publish("system.heartbeat", payload.into()).await;
        }
    });
}

/// Publishes a log line to `logs.downloader`. Best-effort.
pub async fn publish_log(client: &Client, level: &str, msg: &str) {
    let payload = json!({
        "ts": chrono::Utc::now().to_rfc3339(),
        "service": "downloader",
        "level": level,
        "message": msg,
        "fields": {}
    })
    .to_string();
    let _ = client.publish("logs.downloader", payload.into()).await;
}
