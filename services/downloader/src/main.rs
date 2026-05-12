mod config;
mod db;
mod download;
mod models;
mod observability;

use anyhow::Result;
use async_nats::Client;
use futures::StreamExt;
use log::{error, info, warn};
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, Notify, RwLock};

use config::Config;
use db::{Db, RuntimeSettings};
use models::{DownloadInspectRequest, DownloadInspectResponse, DownloadRequest, DownloadResult};

#[derive(Clone, Debug)]
struct QueuedDownload {
    priority: i32,
    sequence: u64,
    request: DownloadRequest,
}

impl PartialEq for QueuedDownload {
    fn eq(&self, other: &Self) -> bool {
        self.sequence == other.sequence && self.request.video_id == other.request.video_id
    }
}

impl Eq for QueuedDownload {}

impl PartialOrd for QueuedDownload {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for QueuedDownload {
    fn cmp(&self, other: &Self) -> Ordering {
        self.priority
            .cmp(&other.priority)
            .then_with(|| other.sequence.cmp(&self.sequence))
    }
}

#[derive(Default)]
struct PendingDownloads {
    next_sequence: u64,
    queued: HashMap<String, QueuedDownload>,
    heap: BinaryHeap<QueuedDownload>,
}

impl PendingDownloads {
    fn enqueue(&mut self, request: DownloadRequest) -> DownloadRequest {
        let request = match self.queued.get(&request.video_id) {
            Some(existing) => merge_download_requests(&existing.request, request),
            None => request,
        };

        let queued = QueuedDownload {
            priority: request.priority,
            sequence: self.next_sequence,
            request: request.clone(),
        };
        self.next_sequence += 1;
        self.queued
            .insert(queued.request.video_id.clone(), queued.clone());
        self.heap.push(queued);
        request
    }

    fn pop(&mut self) -> Option<DownloadRequest> {
        while let Some(next) = self.heap.pop() {
            match self.queued.get(&next.request.video_id) {
                Some(current) if current.sequence == next.sequence => {
                    self.queued.remove(&next.request.video_id);
                    return Some(next.request);
                }
                _ => continue,
            }
        }
        None
    }
}

#[derive(Serialize)]
struct DownloadProgressPayload {
    video_id: String,
    status: String,
    progress_percent: Option<u8>,
    progress_text: Option<String>,
    speed_text: Option<String>,
    eta_text: Option<String>,
}

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

    {
        let client = client.clone();
        let config = Arc::clone(&config);
        let runtime = runtime.clone();
        tokio::spawn(async move {
            let mut inspect_subscriber = match client.subscribe("downloader.inspect").await {
                Ok(subscriber) => subscriber,
                Err(e) => {
                    warn!("failed to subscribe to downloader.inspect: {e}");
                    return;
                }
            };

            while let Some(msg) = inspect_subscriber.next().await {
                let request: DownloadInspectRequest = match serde_json::from_slice(&msg.payload) {
                    Ok(request) => request,
                    Err(e) => {
                        warn!("bad inspect request: {e}");
                        continue;
                    }
                };

                let response = {
                    let current = runtime.read().await.clone();
                    match download::inspect_video(&request.url, &config, &current.ytdlp_extractor_args).await {
                        Ok(output) => DownloadInspectResponse::success(
                            request.video_id,
                            output.title,
                            output.thumbnail,
                            output.qualities,
                        ),
                        Err(e) => DownloadInspectResponse::failure(request.video_id, e.to_string()),
                    }
                };

                let Some(reply) = msg.reply else {
                    continue;
                };
                match serde_json::to_vec(&response) {
                    Ok(payload) => {
                        if let Err(e) = client.publish(reply, payload.into()).await {
                            warn!("inspect response publish failed: {e}");
                        }
                    }
                    Err(e) => warn!("inspect response serialize failed: {e}"),
                }
            }
        });
    }

    let mut subscriber = client.subscribe("download.request").await?;
    info!("listening for download requests...");

    let worker_count = runtime.read().await.max_concurrent.max(1);
    let in_flight: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    let pending = Arc::new(Mutex::new(PendingDownloads::default()));
    let notify = Arc::new(Notify::new());

    for worker_id in 0..worker_count {
        let client = client.clone();
        let config = Arc::clone(&config);
        let in_flight = Arc::clone(&in_flight);
        let db = db.clone();
        let runtime = runtime.clone();
        let pending = Arc::clone(&pending);
        let notify = Arc::clone(&notify);

        tokio::spawn(async move {
            loop {
                let request = loop {
                    let notified = notify.notified();
                    if let Some(request) = pending.lock().unwrap().pop() {
                        break request;
                    }
                    notified.await;
                };

                {
                    let mut set = in_flight.lock().unwrap();
                    if !set.insert(request.video_id.clone()) {
                        warn!("duplicate in-flight: {}", request.video_id);
                        continue;
                    }
                }

                info!(
                    "worker {} processing {} ({}) priority={} quality={:?}",
                    worker_id,
                    request.title,
                    request.video_id,
                    request.priority,
                    request.quality
                );

                let _ = db.mark_downloading(&request.video_id).await;
                publish_download_progress(
                    &client,
                    DownloadProgressPayload {
                        video_id: request.video_id.clone(),
                        status: "downloading".into(),
                        progress_percent: Some(0),
                        progress_text: Some("Starting yt-dlp".into()),
                        speed_text: None,
                        eta_text: None,
                    },
                )
                .await;

                let result = process_download(&request, &config, &runtime, &client).await;
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
            }
        });
    }

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
            let set = in_flight.lock().unwrap();
            if set.contains(&request.video_id) {
                warn!("duplicate in-flight: {}", request.video_id);
                continue;
            }
        }

        let _ = db.upsert_download_queued(&request).await;
        let queued = pending.lock().unwrap().enqueue(request);
        info!(
            "queued {} ({}) priority={} quality={:?}",
            queued.title,
            queued.video_id,
            queued.priority,
            queued.quality
        );
        notify.notify_one();
    }

    Ok(())
}

async fn process_download(
    request: &DownloadRequest,
    config: &Config,
    runtime: &Arc<RwLock<RuntimeSettings>>,
    client: &Client,
) -> DownloadResult {
    let (progress_tx, mut progress_rx) = mpsc::unbounded_channel::<download::DownloadProgress>();
    let progress_client = client.clone();
    let progress_video_id = request.video_id.clone();
    let progress_task = tokio::spawn(async move {
        while let Some(progress) = progress_rx.recv().await {
            publish_download_progress(
                &progress_client,
                DownloadProgressPayload {
                    video_id: progress_video_id.clone(),
                    status: "downloading".into(),
                    progress_percent: Some(progress.progress_percent),
                    progress_text: Some(progress.progress_text),
                    speed_text: progress.speed_text,
                    eta_text: progress.eta_text,
                },
            )
            .await;
        }
    });

    let current = runtime.read().await.clone();
    let result = match download::download_video(
        &request.video_id,
        &request.url,
        config,
        &current.ytdlp_extractor_args,
        request.quality.as_deref(),
        Some(progress_tx),
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
    };

    let _ = progress_task.await;
    if result.success {
        publish_download_progress(
            client,
            DownloadProgressPayload {
                video_id: request.video_id.clone(),
                status: "completed".into(),
                progress_percent: Some(100),
                progress_text: Some("yt-dlp finished".into()),
                speed_text: None,
                eta_text: None,
            },
        )
        .await;
    }
    result
}

async fn publish_download_progress(client: &Client, payload: DownloadProgressPayload) {
    match serde_json::to_vec(&payload) {
        Ok(encoded) => {
            if let Err(e) = client.publish("download.progress", encoded.into()).await {
                warn!("download.progress publish failed: {e}");
            }
        }
        Err(e) => warn!("download.progress serialize failed: {e}"),
    }
}

fn merge_download_requests(existing: &DownloadRequest, incoming: DownloadRequest) -> DownloadRequest {
    let title = if existing.title == existing.video_id && incoming.title != incoming.video_id {
        incoming.title.clone()
    } else {
        existing.title.clone()
    };

    DownloadRequest {
        video_id: incoming.video_id,
        title,
        url: incoming.url,
        channel: incoming.channel.or_else(|| existing.channel.clone()),
        channel_id: incoming.channel_id.or_else(|| existing.channel_id.clone()),
        duration: incoming.duration.or_else(|| existing.duration.clone()),
        thumbnail: incoming.thumbnail.or_else(|| existing.thumbnail.clone()),
        requester_chat_id: incoming.requester_chat_id.or(existing.requester_chat_id),
        priority: incoming.priority.max(existing.priority),
        quality: incoming.quality.or_else(|| existing.quality.clone()),
    }
}
