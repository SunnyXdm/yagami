/// Video downloading via yt-dlp subprocess.
///
/// LEARNING: tokio::process::Command is the async version of std::process::Command.
/// It spawns a child process without blocking the async runtime, so other
/// downloads can proceed concurrently.
use anyhow::{Context, Result};
use log::{error, info, warn};
use serde::Deserialize;
use std::path::PathBuf;
use tokio::process::Command;

use crate::config::Config;

/// Metadata extracted from yt-dlp's .info.json file.
#[derive(Debug, Default)]
pub struct VideoMetadata {
    pub title: Option<String>,
    pub channel: Option<String>,
    pub channel_id: Option<String>,
    pub duration: Option<String>,
    pub thumbnail: Option<String>,
}

/// Result of a successful download — file path + metadata from yt-dlp.
#[derive(Debug)]
pub struct DownloadOutput {
    pub file_path: String,
    pub metadata: VideoMetadata,
}

/// Subset of yt-dlp's info.json we care about.
#[derive(Debug, Deserialize)]
struct YtdlpInfo {
    title: Option<String>,
    channel: Option<String>,
    channel_id: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
}

/// Download a video using yt-dlp. Returns the file path and extracted metadata.
///
/// LEARNING: `Result<DownloadOutput>` is short for `Result<DownloadOutput, anyhow::Error>`.
/// The `?` operator propagates errors — if an expression returns Err,
/// the function immediately returns that Err. No try/catch needed!
pub async fn download_video(video_id: &str, url: &str, config: &Config) -> Result<DownloadOutput> {
    let output_template = format!("{}/{}.%(ext)s", config.download_dir, video_id);

    // LEARNING: `let mut` declares a mutable variable. By default, all
    // variables in Rust are immutable (like `val` in Kotlin or `let` in Swift).
    let mut args = vec![
        "-f".to_string(),
        "bestvideo[height<=1080]+bestaudio/best[height<=1080]".to_string(),
        "--merge-output-format".to_string(),
        "mp4".to_string(),
        "-o".to_string(),
        output_template,
        "--no-playlist".to_string(),
        "--write-info-json".to_string(),
        "--js-runtimes".to_string(),
        "node".to_string(),
    ];

    // Pass cookies directly — mounted read-write so yt-dlp can update rotated cookies
    let cookies_path = PathBuf::from(&config.cookies_path);
    if cookies_path.exists() {
        args.push("--cookies".to_string());
        args.push(config.cookies_path.clone());
    }

    args.push(url.to_string());

    info!("Downloading {} with yt-dlp...", video_id);

    let output = Command::new("yt-dlp")
        .args(&args)
        .output()
        .await
        .context("Failed to spawn yt-dlp")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("yt-dlp failed for {}: {}", video_id, stderr);
        anyhow::bail!("yt-dlp exited with: {}", stderr.chars().take(200).collect::<String>());
    }

    let file_path = find_downloaded_file(&config.download_dir, video_id)?;
    let metadata = read_info_json(&config.download_dir, video_id);

    Ok(DownloadOutput { file_path, metadata })
}

/// Find the file that yt-dlp created (we don't know the extension ahead of time).
///
/// LEARNING: `std::fs::read_dir` returns an iterator of Result<DirEntry>.
/// We use `.filter_map(|e| e.ok())` to skip any errors and unwrap the Ok values.
fn find_downloaded_file(dir: &str, video_id: &str) -> Result<String> {
    for entry in std::fs::read_dir(dir)?.filter_map(|e| e.ok()) {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with(video_id) {
            return Ok(entry.path().to_string_lossy().to_string());
        }
    }
    anyhow::bail!("Downloaded file not found for {}", video_id)
}

/// Get video metadata (file size) without downloading.
pub fn get_file_size(path: &str) -> Result<u64> {
    let metadata = std::fs::metadata(path).context("Failed to read file metadata")?;
    Ok(metadata.len())
}

/// Read the .info.json file that yt-dlp writes alongside the video.
/// Returns default metadata if the file is missing or unparseable.
fn read_info_json(dir: &str, video_id: &str) -> VideoMetadata {
    // Find .info.json file for this video
    let info_path = match std::fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .find(|e| {
                let name = e.file_name();
                let s = name.to_string_lossy();
                s.starts_with(video_id) && s.ends_with(".info.json")
            })
            .map(|e| e.path()),
        Err(_) => None,
    };

    let path = match info_path {
        Some(p) => p,
        None => {
            warn!("No .info.json found for {}", video_id);
            return VideoMetadata::default();
        }
    };

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => {
            warn!("Failed to read {}: {}", path.display(), e);
            return VideoMetadata::default();
        }
    };

    let info: YtdlpInfo = match serde_json::from_str(&content) {
        Ok(i) => i,
        Err(e) => {
            warn!("Failed to parse {}: {}", path.display(), e);
            return VideoMetadata::default();
        }
    };

    // Clean up the .info.json file — we don't need it anymore
    let _ = std::fs::remove_file(&path);

    VideoMetadata {
        title: info.title,
        channel: info.channel,
        channel_id: info.channel_id,
        duration: info.duration.map(format_duration),
        thumbnail: info.thumbnail,
    }
}

/// Format seconds into HH:MM:SS or MM:SS.
fn format_duration(seconds: f64) -> String {
    let total = seconds as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    if h > 0 {
        format!("{}:{:02}:{:02}", h, m, s)
    } else {
        format!("{}:{:02}", m, s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn test_get_file_size() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.mp4");
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(&[0u8; 1024]).unwrap();

        let size = get_file_size(path.to_str().unwrap()).unwrap();
        assert_eq!(size, 1024);
    }

    #[test]
    fn test_get_file_size_missing_file() {
        let result = get_file_size("/nonexistent/path.mp4");
        assert!(result.is_err());
    }

    #[test]
    fn test_find_downloaded_file_found() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("abc123.mp4");
        fs::File::create(&file_path).unwrap();

        let result = find_downloaded_file(dir.path().to_str().unwrap(), "abc123");
        assert!(result.is_ok());
        assert!(result.unwrap().contains("abc123.mp4"));
    }

    #[test]
    fn test_find_downloaded_file_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let result = find_downloaded_file(dir.path().to_str().unwrap(), "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_find_downloaded_file_matches_prefix() {
        let dir = tempfile::tempdir().unwrap();
        // yt-dlp might add extension like .webm or .mkv
        fs::File::create(dir.path().join("vid999.webm")).unwrap();
        fs::File::create(dir.path().join("other.mp4")).unwrap();

        let result = find_downloaded_file(dir.path().to_str().unwrap(), "vid999");
        assert!(result.is_ok());
        assert!(result.unwrap().contains("vid999"));
    }
}
