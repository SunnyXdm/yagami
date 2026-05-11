mod config;
mod db;
mod download;
mod models;
mod observability;

use anyhow::Result;
use async_nats::Client;
use futures::StreamExt;
use log::{error, info, warn};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tokio::sync::{RwLock, Semaphore};

use config::Config;
use db::{Db, RuntimeSettings};
use models::{DownloadRequest, DownloadResult};

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();

    let config = Arc::new(Config::from_env());
    info!("starting downloader service");
    std::fs::create_dir_all(&config.download_dir)?;

    let db = Db::connect(&config.database_url).await?;
    info!("connected to postgres");

    let runtime = Arc::new(RwLock::new(RuntimeSettings {
        max_concurrent: config.max_concurrent,
        ..RuntimeSettings::default()
    }));
    if let Ok(s) = db.load_settings().await {
        *runtime.write().await = s;
    }
    tokio::spawn(db::run_settings_loop(
        db.clone(),
        runtime.clone(),
        config.cookies_path.clone(),
    ));

    let client: Client = async_nats::connect(&config.nats_url).await?;
    info!("connected to NATS at {}", config.nats_url);
    observability::spawn_heartbeat(client.clone());
    observability::publish_log(&client, "info", "downloader online").await;

    {
        let client = client.clone();
        let db = db.clone();
        let runtime = runtime.clone();
        let cookies_path = config.cookies_path.clone();
        tokio::spawn(async move {
            let mut updates = match client.subscribe("system.config_changed").await {
                Ok(sub) => sub,
                Err(e) => {
                    warn!("failed to subscribe to config changes: {e}");
                    return;
                }
            };
            while updates.next().await.is_some() {
                match db::refresh_settings_now(&db, &runtime, &cookies_path).await {
                    Ok(()) => info!("applied config change immediately"),
                    Err(e) => warn!("config change refresh failed: {e}"),
                }
            }
        });
    }

    let mut subscriber = client.subscribe("download.request").await?;
    info!("listening for download requests...");

    let initial_concurrency = runtime.read().await.max_concurrent;
    let semaphore = Arc::new(Semaphore::new(initial_concurrency));
    let in_flight: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

    while let Some(msg) = subscriber.next().await {
        let request: DownloadRequest = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                warn!("bad request: {e}");
                continue;
            }
        };

        info!("download request: {} ({})", request.title, request.video_id);

        {
            let mut set = in_flight.lock().unwrap();
            if !set.insert(request.video_id.clone()) {
                warn!("duplicate in-flight: {}", request.video_id);
                continue;
            }
        }

        let _ = db.upsert_download_queued(&request).await;

        let client = client.clone();
        let config = Arc::clone(&config);
        let semaphore = Arc::clone(&semaphore);
        let in_flight = Arc::clone(&in_flight);
        let db = db.clone();
        let runtime = runtime.clone();

        tokio::spawn(async move {
            let _permit = match semaphore.acquire_owned().await {
                Ok(p) => p,
                Err(_) => {
                    in_flight.lock().unwrap().remove(&request.video_id);
                    return;
                }
            };

            let _ = db.mark_downloading(&request.video_id).await;
            let result = process_download(&request, &config, &runtime).await;
            in_flight.lock().unwrap().remove(&request.video_id);

            if result.success {
                let fp = result.file_path.clone().unwrap_or_default();
                let fs = result.file_size.unwrap_or(0) as i64;
                let _ = db
                    .mark_completed(
                        &request.video_id,
                        &fp,
                        fs,
                        result.channel.as_deref(),
                        result.channel_id.as_deref(),
                        result.duration.as_deref(),
                        result.thumbnail.as_deref(),
                    )
                    .await;
                observability::publish_log(
                    &client,
                    "info",
                    &format!("downloaded {} ({} bytes)", request.video_id, fs),
                )
                .await;
            } else {
                let err = result.error.clone().unwrap_or_default();
                let _ = db.mark_failed(&request.video_id, &err).await;
                observability::publish_log(
                    &client,
                    "error",
                    &format!("download failed {}: {}", request.video_id, err),
                )
                .await;
            }

            match serde_json::to_vec(&result) {
                Ok(payload) => {
                    if let Err(e) = client.publish("download.complete", payload.into()).await {
                        error!("publish result failed: {e}");
                    }
                }
                Err(e) => error!("serialize failed: {e}"),
            }
        });
    }

    Ok(())
}

async fn process_download(
    request: &DownloadRequest,
    config: &Config,
    runtime: &Arc<RwLock<RuntimeSettings>>,
) -> DownloadResult {
    let current = runtime.read().await.clone();
    match download::download_video(
        &request.video_id,
        &request.url,
        config,
        &current.ytdlp_extractor_args,
    ).await {
        Ok(output) => {
            let size = download::get_file_size(&output.file_path).unwrap_or(0);
            let max_size = current.max_filesize_bytes;
            if size > max_size {
                let _ = std::fs::remove_file(&output.file_path);
                return DownloadResult::failure(
                    request,
                    format!(
                        "downloaded file is {} bytes, over configured limit of {} bytes",
                        size, max_size
                    ),
                );
            }
            info!("downloaded {} ({} bytes)", request.video_id, size);
            let mut result = DownloadResult::success(request, output.file_path, size);
            let m = output.metadata;
            if let Some(t) = m.title {
                if request.title == request.video_id {
                    result.title = t;
                }
            }
            if request.channel.is_none() {
                result.channel = m.channel;
            }
            if request.channel_id.is_none() {
                result.channel_id = m.channel_id;
            }
            if request.duration.is_none() {
                result.duration = m.duration;
            }
            if request.thumbnail.is_none() {
                result.thumbnail = m.thumbnail;
            }
            result
        }
        Err(e) => {
            error!("download failed for {}: {e}", request.video_id);
            DownloadResult::failure(request, e.to_string())
        }
    }
}
