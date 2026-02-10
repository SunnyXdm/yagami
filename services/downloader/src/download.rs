/// Video downloading via yt-dlp subprocess.
///
/// LEARNING: tokio::process::Command is the async version of std::process::Command.
/// It spawns a child process without blocking the async runtime, so other
/// downloads can proceed concurrently.
use anyhow::{Context, Result};
use log::{error, info};
use std::path::PathBuf;
use tokio::process::Command;

use crate::config::Config;

/// Download a video using yt-dlp. Returns the file path on success.
///
/// LEARNING: `Result<String>` is short for `Result<String, anyhow::Error>`.
/// The `?` operator propagates errors — if an expression returns Err,
/// the function immediately returns that Err. No try/catch needed!
pub async fn download_video(video_id: &str, url: &str, config: &Config) -> Result<String> {
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
        "--max-filesize".to_string(),
        format!("{}M", config.max_file_size_mb),
    ];

    // Add cookies if the file exists
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

    // Find the downloaded file (yt-dlp picks the extension)
    find_downloaded_file(&config.download_dir, video_id)
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
