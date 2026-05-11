/// Database and runtime-settings access for the downloader.
///
/// Settings live in Postgres (`settings` table) and are refreshed
/// every 60s. The cookies file is rewritten when the value changes.
use anyhow::{Context, Result};
use log::{error, info, warn};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_postgres::{Client, NoTls};

use crate::models::DownloadRequest;

#[derive(Clone, Debug)]
pub struct RuntimeSettings {
    pub max_concurrent: usize,
    pub max_filesize_bytes: u64,
    pub cookies: String,
    pub ytdlp_extractor_args: String,
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self {
            max_concurrent: 3,
            max_filesize_bytes: 8 * 1024 * 1024 * 1024,
            cookies: String::new(),
            ytdlp_extractor_args: String::new(),
        }
    }
}

#[derive(Clone)]
pub struct Db {
    client: Arc<RwLock<Client>>,
    url: String,
}

impl Db {
    pub async fn connect(url: &str) -> Result<Self> {
        let client = connect_one(url).await?;
        Ok(Self {
            client: Arc::new(RwLock::new(client)),
            url: url.to_string(),
        })
    }

    pub async fn load_settings(&self) -> Result<RuntimeSettings> {
        let map = self.read_settings_map().await?;
        let max_concurrent = map
            .get("downloader.max_concurrent")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(3);
        let gb = map
            .get("downloader.max_filesize_gb")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(8);
        Ok(RuntimeSettings {
            max_concurrent,
            max_filesize_bytes: gb * 1024 * 1024 * 1024,
            cookies: map.get("youtube.cookies").cloned().unwrap_or_default(),
            ytdlp_extractor_args: map
                .get("downloader.ytdlp_extractor_args")
                .cloned()
                .unwrap_or_default(),
        })
    }

    async fn read_settings_map(&self) -> Result<HashMap<String, String>> {
        let client = self.client.read().await;
        let rows = client
            .query("SELECT key, COALESCE(value,'') FROM settings", &[])
            .await
            .context("read settings")?;
        Ok(rows.into_iter().map(|r| (r.get(0), r.get(1))).collect())
    }

    pub async fn upsert_download_queued(&self, req: &DownloadRequest) -> Result<()> {
        let client = self.client.read().await;
        client
            .execute(
                "INSERT INTO downloads
                (video_id, title, url, channel, channel_id, duration, thumbnail_url,
                 requester_chat_id, status, attempts, error_message)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', 0, NULL)
             ON CONFLICT (video_id) DO UPDATE SET
                title=EXCLUDED.title,
                url=EXCLUDED.url,
                channel=COALESCE(EXCLUDED.channel, downloads.channel),
                channel_id=COALESCE(EXCLUDED.channel_id, downloads.channel_id),
                duration=COALESCE(EXCLUDED.duration, downloads.duration),
                thumbnail_url=COALESCE(EXCLUDED.thumbnail_url, downloads.thumbnail_url),
                requester_chat_id=COALESCE(EXCLUDED.requester_chat_id, downloads.requester_chat_id),
                status='queued',
                error_message=NULL,
                updated_at=NOW()",
                &[
                    &req.video_id,
                    &req.title,
                    &req.url,
                    &req.channel,
                    &req.channel_id,
                    &req.duration,
                    &req.thumbnail,
                    &req.requester_chat_id,
                ],
            )
            .await?;
        Ok(())
    }

    pub async fn mark_downloading(&self, video_id: &str) -> Result<()> {
        let client = self.client.read().await;
        client.execute(
            "UPDATE downloads SET status='downloading', attempts=attempts+1, updated_at=NOW(), started_at=COALESCE(started_at, NOW())
             WHERE video_id=$1",
            &[&video_id],
        ).await?;
        Ok(())
    }

    pub async fn mark_completed(
        &self,
        video_id: &str,
        file_path: &str,
        size: i64,
        channel: Option<&str>,
        channel_id: Option<&str>,
        duration: Option<&str>,
        thumbnail: Option<&str>,
    ) -> Result<()> {
        let client = self.client.read().await;
        client
            .execute(
                "UPDATE downloads SET status='completed', file_path=$2, file_size=$3, channel=$4,
                                  channel_id=$5, duration=$6, thumbnail_url=$7,
                                  completed_at=NOW(), updated_at=NOW(), error_message=NULL
             WHERE video_id=$1",
                &[
                    &video_id,
                    &file_path,
                    &size,
                    &channel,
                    &channel_id,
                    &duration,
                    &thumbnail,
                ],
            )
            .await?;
        Ok(())
    }

    pub async fn mark_failed(&self, video_id: &str, err: &str) -> Result<()> {
        let client = self.client.read().await;
        client.execute(
            "UPDATE downloads SET status='failed', error_message=$2, updated_at=NOW() WHERE video_id=$1",
            &[&video_id, &err],
        ).await?;
        Ok(())
    }
}

async fn connect_one(url: &str) -> Result<Client> {
    let (client, conn) = tokio_postgres::connect(url, NoTls)
        .await
        .context("connect postgres")?;
    tokio::spawn(async move {
        if let Err(e) = conn.await {
            error!("postgres connection lost: {e}");
        }
    });
    Ok(client)
}

/// Periodically reload settings into the shared cell and write cookies to disk.
pub async fn run_settings_loop(
    db: Db,
    current: Arc<RwLock<RuntimeSettings>>,
    cookies_path: String,
) {
    let mut last_cookies_hash: u64 = 0;
    loop {
        match db.load_settings().await {
            Ok(s) => match apply_runtime_settings(&current, &cookies_path, s, &mut last_cookies_hash, false).await {
                Ok(()) => {}
                Err(e) => warn!("settings apply failed: {e}"),
            },
            Err(e) => warn!("settings reload failed: {e}"),
        }
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    }
}

pub async fn refresh_settings_now(
    db: &Db,
    current: &Arc<RwLock<RuntimeSettings>>,
    cookies_path: &str,
) -> Result<()> {
    let settings = db.load_settings().await?;
    let mut last_cookies_hash = hash_str(&settings.cookies);
    apply_runtime_settings(current, cookies_path, settings, &mut last_cookies_hash, true).await
}

async fn apply_runtime_settings(
    current: &Arc<RwLock<RuntimeSettings>>,
    cookies_path: &str,
    settings: RuntimeSettings,
    last_cookies_hash: &mut u64,
    force_cookie_sync: bool,
) -> Result<()> {
    sync_cookie_file(&settings.cookies, cookies_path, last_cookies_hash, force_cookie_sync).await?;
    *current.write().await = settings;
    Ok(())
}

async fn sync_cookie_file(
    cookies: &str,
    cookies_path: &str,
    last_cookies_hash: &mut u64,
    force_write: bool,
) -> Result<()> {
    let trimmed = cookies.trim();
    if trimmed.is_empty() {
        if Path::new(cookies_path).exists() {
            tokio::fs::remove_file(cookies_path)
                .await
                .context("remove stale cookies file")?;
            info!("removed stale cookies file at {cookies_path}");
        }
        *last_cookies_hash = 0;
        return Ok(());
    }

    let next_hash = hash_str(cookies);
    if !force_write && next_hash == *last_cookies_hash {
        return Ok(());
    }

    if let Some(parent) = Path::new(cookies_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .context("create cookies directory")?;
    }
    tokio::fs::write(cookies_path, cookies)
        .await
        .context("write cookies file")?;
    info!("wrote cookies to {cookies_path} ({} bytes)", cookies.len());
    *last_cookies_hash = next_hash;
    Ok(())
}

fn hash_str(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_sync_cookie_file_writes_cookies() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cookies.txt");
        let mut hash = 0;

        sync_cookie_file(".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tvalue", path.to_str().unwrap(), &mut hash, false)
            .await
            .unwrap();

        let written = tokio::fs::read_to_string(&path).await.unwrap();
        assert!(written.contains("SID"));
        assert_ne!(hash, 0);
    }

    #[tokio::test]
    async fn test_sync_cookie_file_removes_stale_file_when_cleared() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cookies.txt");
        let mut hash = 0;

        tokio::fs::write(&path, "stale").await.unwrap();
        sync_cookie_file("   ", path.to_str().unwrap(), &mut hash, false)
            .await
            .unwrap();

        assert!(!path.exists());
        assert_eq!(hash, 0);
    }
}
