/// Yagami Downloader — listens for download requests on NATS and uses
/// yt-dlp to download videos, then publishes the result back to NATS.
///
/// LEARNING: This is a "DB-free" service. It only talks via NATS messages.
/// Input:  download.request  → {video_id, title, url}
/// Output: download.complete → {video_id, title, file_path, file_size, success}
///
/// Key Rust concepts used:
/// - Ownership & borrowing (& references)
/// - async/await with tokio
/// - Error handling with Result and ?
/// - Concurrency with Arc + Semaphore
/// - Pattern matching with match
mod config;
mod download;
mod models;

use anyhow::Result;
use futures::StreamExt;
use log::{error, info, warn};
use std::sync::Arc;
use tokio::sync::Semaphore;

use config::Config;
use models::{DownloadRequest, DownloadResult};

/// LEARNING: #[tokio::main] transforms main() into an async function.
/// Tokio is the async runtime — it manages the event loop, like asyncio in Python.
#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();

    let config = Arc::new(Config::from_env());
    info!("Starting downloader service");

    // Create download directory
    std::fs::create_dir_all(&config.download_dir)?;

    // Connect to NATS
    // LEARNING: `.await` suspends this function until the future completes.
    // `?` propagates any error. Combined: `.await?` = await and unwrap.
    let client = async_nats::connect(&config.nats_url).await?;
    info!("Connected to NATS at {}", config.nats_url);

    // Subscribe to download requests
    let mut subscriber = client.subscribe("download.request").await?;
    info!("Listening for download requests...");

    // LEARNING: Semaphore limits concurrent downloads. Arc (Atomic Reference Count)
    // lets multiple async tasks share ownership of the semaphore safely.
    // This is Rust's answer to "how do I share data between threads?"
    let semaphore = Arc::new(Semaphore::new(config.max_concurrent));

    // LEARNING: `while let Some(msg) = subscriber.next().await` is an
    // async iterator pattern. It pulls messages one at a time, awaiting each.
    while let Some(msg) = subscriber.next().await {
        // Parse the incoming message
        let request: DownloadRequest = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                warn!("Invalid download request: {}", e);
                continue;
            }
        };

        info!("Download request: {} ({})", request.title, request.video_id);

        // LEARNING: `.clone()` creates a deep copy. We need this because
        // each spawned task needs its own copy of these Arc pointers.
        // Arc::clone is cheap — it just increments a counter.
        let client = client.clone();
        let config = Arc::clone(&config);
        let semaphore = Arc::clone(&semaphore);

        // Spawn a new async task for each download
        // LEARNING: `tokio::spawn` is like `asyncio.create_task()` — it runs
        // the future concurrently without blocking the main loop.
        tokio::spawn(async move {
            // LEARNING: `.acquire_owned()` waits until a permit is available,
            // enforcing our max concurrent downloads limit. The permit is
            // automatically released when `_permit` is dropped (RAII pattern).
            let _permit = match semaphore.acquire_owned().await {
                Ok(p) => p,
                Err(_) => return,
            };

            let result = process_download(&request, &config).await;

            // Publish result to NATS
            match serde_json::to_vec(&result) {
                Ok(payload) => {
                    if let Err(e) = client.publish("download.complete", payload.into()).await {
                        error!("Failed to publish result: {}", e);
                    }
                }
                Err(e) => error!("Failed to serialize result: {}", e),
            }
        });
    }

    Ok(())
}

/// Process a single download request.
///
/// LEARNING: `&` means "borrow" — we're reading the data without taking ownership.
/// The original data stays valid. This is Rust's core memory safety mechanism.
async fn process_download(request: &DownloadRequest, config: &Config) -> DownloadResult {
    match download::download_video(&request.video_id, &request.url, config).await {
        Ok(output) => {
            let size = download::get_file_size(&output.file_path).unwrap_or(0);
            info!("Downloaded {} — {} bytes", request.video_id, size);
            let mut result = DownloadResult::success(request, output.file_path, size);

            // Enrich with yt-dlp metadata when the request has placeholder values
            // (e.g. admin DM downloads only have video_id as title)
            let meta = output.metadata;
            if let Some(t) = meta.title {
                if request.title == request.video_id {
                    result.title = t;
                }
            }
            if request.channel.is_none() {
                result.channel = meta.channel;
            }
            if request.channel_id.is_none() {
                result.channel_id = meta.channel_id;
            }
            if request.duration.is_none() {
                result.duration = meta.duration;
            }
            if request.thumbnail.is_none() {
                result.thumbnail = meta.thumbnail;
            }

            result
        }
        Err(e) => {
            error!("Download failed for {}: {}", request.video_id, e);
            DownloadResult::failure(request, e.to_string())
        }
    }
}
