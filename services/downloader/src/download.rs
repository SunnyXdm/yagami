/// Video downloading via yt-dlp subprocess.
///
/// LEARNING: tokio::process::Command is the async version of std::process::Command.
/// It spawns a child process without blocking the async runtime, so other
/// downloads can proceed concurrently.
use anyhow::{Context, Result};
use log::{error, info, warn};
use serde::Deserialize;
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc::UnboundedSender;

use crate::config::Config;
use crate::models::QualityOption;

const YTDLP_FORMAT: &str = "bestvideo+bestaudio/best";
const YTDLP_JS_RUNTIME: &str = "node";

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

#[derive(Debug)]
pub struct InspectOutput {
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub qualities: Vec<QualityOption>,
}

#[derive(Debug, Clone)]
pub struct DownloadProgress {
    pub progress_percent: u8,
    pub progress_text: String,
    pub speed_text: Option<String>,
    pub eta_text: Option<String>,
}

/// Subset of yt-dlp's info.json we care about.
#[derive(Debug, Deserialize)]
struct YtdlpInfo {
    title: Option<String>,
    channel: Option<String>,
    channel_id: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    thumbnails: Option<Vec<YtdlpThumbnail>>,
    formats: Option<Vec<YtdlpFormat>>,
}

#[derive(Debug, Deserialize)]
struct YtdlpThumbnail {
    id: Option<String>,
    url: Option<String>,
    width: Option<u64>,
    height: Option<u64>,
    preference: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct YtdlpFormat {
    height: Option<u64>,
    vcodec: Option<String>,
}

/// Download a video using yt-dlp. Returns the file path and extracted metadata.
///
/// LEARNING: `Result<DownloadOutput>` is short for `Result<DownloadOutput, anyhow::Error>`.
/// The `?` operator propagates errors — if an expression returns Err,
/// the function immediately returns that Err. No try/catch needed!
pub async fn download_video(
    video_id: &str,
    url: &str,
    config: &Config,
    extractor_args: &str,
    quality: Option<&str>,
    progress_tx: Option<UnboundedSender<DownloadProgress>>,
) -> Result<DownloadOutput> {
    let cookies_path = PathBuf::from(&config.cookies_path);
    let args = build_ytdlp_args(
        video_id,
        url,
        config,
        cookies_path.exists(),
        extractor_args,
        quality,
    );

    info!("Downloading {} with yt-dlp...", video_id);

    let mut child = Command::new("yt-dlp")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Failed to spawn yt-dlp")?;

    let stdout = child.stdout.take().context("yt-dlp stdout unavailable")?;
    let stderr = child.stderr.take().context("yt-dlp stderr unavailable")?;

    let stdout_task = tokio::spawn(read_ytdlp_pipe(stdout, progress_tx.clone()));
    let stderr_task = tokio::spawn(read_ytdlp_pipe(stderr, progress_tx));
    let status = child.wait().await.context("Failed waiting for yt-dlp")?;
    let stdout = stdout_task
        .await
        .context("stdout reader task failed")??
        .join("\n");
    let stderr = stderr_task
        .await
        .context("stderr reader task failed")??
        .join("\n");

    if !status.success() {
        error!("yt-dlp failed for {}: {}", video_id, stderr);
        anyhow::bail!(format_ytdlp_failure(&stdout, &stderr, cookies_path.exists()));
    }

    let file_path = find_downloaded_file(&config.download_dir, video_id)?;
    let metadata = read_info_json(&config.download_dir, video_id);

    Ok(DownloadOutput {
        file_path,
        metadata,
    })
}

pub async fn inspect_video(url: &str, config: &Config, extractor_args: &str) -> Result<InspectOutput> {
    let cookies_path = PathBuf::from(&config.cookies_path);
    let args = build_ytdlp_inspect_args(config, url, cookies_path.exists(), extractor_args);
    let output = Command::new("yt-dlp")
        .args(&args)
        .output()
        .await
        .context("Failed to spawn yt-dlp metadata probe")?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!(format_ytdlp_failure(&stdout, &stderr, cookies_path.exists()));
    }

    let info: YtdlpInfo = serde_json::from_slice(&output.stdout)
        .context("Failed to parse yt-dlp metadata probe")?;

    let thumbnail = best_thumbnail_url(&info);
    let qualities = available_quality_options(&info);

    Ok(InspectOutput {
        title: info.title,
        thumbnail,
        qualities,
    })
}

fn build_ytdlp_args(
    video_id: &str,
    url: &str,
    config: &Config,
    cookies_available: bool,
    extractor_args: &str,
    quality: Option<&str>,
) -> Vec<String> {
    let output_template = format!("{}/{}.%(ext)s", config.download_dir, video_id);
    let mut args = vec![
        "--js-runtimes".to_string(),
        YTDLP_JS_RUNTIME.to_string(),
        "--newline".to_string(),
        "-f".to_string(),
        ytdlp_format(quality),
        "--merge-output-format".to_string(),
        "mp4".to_string(),
        "-o".to_string(),
        output_template,
        "--no-playlist".to_string(),
        "--write-info-json".to_string(),
    ];

    if !extractor_args.trim().is_empty() {
        args.push("--extractor-args".to_string());
        args.push(extractor_args.trim().to_string());
    }

    if cookies_available {
        args.push("--cookies".to_string());
        args.push(config.cookies_path.clone());
    }

    args.push(url.to_string());
    args
}

fn build_ytdlp_inspect_args(
    config: &Config,
    url: &str,
    cookies_available: bool,
    extractor_args: &str,
) -> Vec<String> {
    let mut args = vec![
        "--js-runtimes".to_string(),
        YTDLP_JS_RUNTIME.to_string(),
        "--dump-single-json".to_string(),
        "--no-download".to_string(),
        "--no-playlist".to_string(),
    ];

    if !extractor_args.trim().is_empty() {
        args.push("--extractor-args".to_string());
        args.push(extractor_args.trim().to_string());
    }

    if cookies_available {
        args.push("--cookies".to_string());
        args.push(config.cookies_path.clone());
    }

    args.push(url.to_string());
    args
}

fn ytdlp_format(quality: Option<&str>) -> String {
    match quality_cap(quality) {
        Some(height) => format!(
            "bestvideo[height<={0}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={0}]+bestaudio/best[height<={0}][ext=mp4]/best[height<={0}]/best",
            height
        ),
        None => YTDLP_FORMAT.to_string(),
    }
}

fn quality_cap(quality: Option<&str>) -> Option<u16> {
    let raw = quality?.trim();
    if raw.is_empty() || raw.eq_ignore_ascii_case("best") {
        return None;
    }

    raw.trim_start_matches('q')
        .trim_end_matches('p')
        .parse::<u16>()
        .ok()
}

fn format_ytdlp_failure(stdout: &str, stderr: &str, cookies_available: bool) -> String {
    let output = if stderr.trim().is_empty() { stdout } else { stderr };
    let summary = compact_output(output, 360);

    if output.contains("challenge solving failed")
        || output.contains("JavaScript runtime")
        || output.contains("challenge solver distribution")
    {
        return format!(
            "yt-dlp could not solve YouTube's JavaScript challenge. {} Install yt-dlp with EJS support and enable a supported JS runtime. Raw output: {}",
            if cookies_available {
                "Cookies were present, so this is likely a downloader environment problem."
            } else {
                "No cookies file was available to the downloader either, so both auth and challenge solving need attention."
            },
            summary,
        );
    }

    if output.contains("PO Token") || output.contains("po_token") {
        return format!(
            "yt-dlp hit YouTube PO-token enforcement. Configure yt-dlp extractor args or a PO-token provider for the affected client. Raw output: {}",
            summary,
        );
    }

    if output.contains("cookies") || output.contains("Sign in") || output.contains("not a bot") {
        return format!(
            "yt-dlp likely needs fresher YouTube cookies for this video. Re-export youtube.com cookies from a fresh logged-in private session, then retry. Raw output: {}",
            summary,
        );
    }

    format!("yt-dlp exited with: {}", summary)
}

fn compact_output(output: &str, limit: usize) -> String {
    let single_line = output.split_whitespace().collect::<Vec<_>>().join(" ");
    if single_line.chars().count() <= limit {
        return single_line;
    }
    single_line.chars().take(limit).collect::<String>()
}

/// Find the file that yt-dlp created (we don't know the extension ahead of time).
///
/// LEARNING: `std::fs::read_dir` returns an iterator of Result<DirEntry>.
/// We use `.filter_map(|e| e.ok())` to skip any errors and unwrap the Ok values.
fn find_downloaded_file(dir: &str, video_id: &str) -> Result<String> {
    // Collect all candidate files first so we can prefer the final merged output
    // over yt-dlp fragment files (e.g. abc123.f137.mp4 vs abc123.mp4).
    let entries: Vec<_> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name();
            let s = name.to_string_lossy();
            s.starts_with(video_id)
                && !s.ends_with(".info.json")
                && !s.ends_with(".part")
                && !s.ends_with(".ytdl")
        })
        .collect();

    if entries.is_empty() {
        anyhow::bail!("Downloaded file not found for {}", video_id);
    }

    // Prefer the entry whose stem is exactly video_id (e.g. abc123.mp4).
    // Fragment files have compound stems like abc123.f137, so they won't match.
    if let Some(final_entry) = entries.iter().find(|e| {
        e.path()
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s == video_id)
            .unwrap_or(false)
    }) {
        return Ok(final_entry.path().to_string_lossy().to_string());
    }

    // No clean final output yet — fall back to the first matching fragment.
    Ok(entries[0].path().to_string_lossy().to_string())
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

    let thumbnail = best_thumbnail_url(&info);

    VideoMetadata {
        title: info.title,
        channel: info.channel,
        channel_id: info.channel_id,
        duration: info.duration.map(format_duration),
        thumbnail,
    }
}

fn best_thumbnail_url(info: &YtdlpInfo) -> Option<String> {
    info.thumbnails
        .as_ref()
        .and_then(|thumbnails| {
            thumbnails
                .iter()
                .filter_map(|thumbnail| {
                    let url = thumbnail.url.as_ref()?.trim();
                    if url.is_empty() {
                        return None;
                    }
                    Some((thumbnail_sort_key(thumbnail), url.to_string()))
                })
                .max_by(|left, right| left.0.cmp(&right.0))
                .map(|(_, url)| url)
        })
        .or_else(|| info.thumbnail.clone())
}

fn available_quality_options(info: &YtdlpInfo) -> Vec<QualityOption> {
    let mut bands = BTreeSet::new();
    if let Some(formats) = &info.formats {
        for format in formats {
            if !format_has_video(format) {
                continue;
            }
            if let Some(height) = format.height.and_then(quality_band) {
                bands.insert(height);
            }
        }
    }

    let mut options = vec![QualityOption {
        key: "best".into(),
        label: "Best".into(),
    }];
    for band in bands.into_iter().rev().take(6) {
        options.push(QualityOption {
            key: band.to_string(),
            label: format!("{}p", band),
        });
    }
    options
}

fn format_has_video(format: &YtdlpFormat) -> bool {
    !matches!(format.vcodec.as_deref(), None | Some("none"))
}

fn quality_band(height: u64) -> Option<u16> {
    for band in [4320_u16, 2160, 1440, 1080, 720, 480, 360, 240, 144] {
        if height >= band as u64 {
            return Some(band);
        }
    }
    None
}

fn thumbnail_sort_key(thumbnail: &YtdlpThumbnail) -> (u8, u64, i64) {
    let area = thumbnail
        .width
        .unwrap_or(0)
        .saturating_mul(thumbnail.height.unwrap_or(0));
    (
        thumbnail_id_rank(thumbnail.id.as_deref()),
        area,
        thumbnail.preference.unwrap_or(i64::MIN),
    )
}

async fn read_ytdlp_pipe<R>(reader: R, progress_tx: Option<UnboundedSender<DownloadProgress>>) -> Result<Vec<String>>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = Vec::new();
    let mut reader = BufReader::new(reader).lines();
    while let Some(line) = reader.next_line().await.context("Failed reading yt-dlp output")? {
        if let Some(progress) = parse_progress_line(&line) {
            if let Some(tx) = &progress_tx {
                let _ = tx.send(progress);
            }
        }
        lines.push(line);
    }
    Ok(lines)
}

fn parse_progress_line(line: &str) -> Option<DownloadProgress> {
    if !line.contains("[download]") || !line.contains('%') {
        return None;
    }

    let percent_text = line.split('%').next()?.split_whitespace().last()?;
    let percent = percent_text.parse::<f64>().ok()?;
    let progress_percent = percent.round().clamp(0.0, 100.0) as u8;

    let (speed_text, eta_text) = if let Some((_, tail)) = line.split_once(" at ") {
        match tail.split_once(" ETA ") {
            Some((speed, eta)) => (Some(speed.trim().to_string()), Some(eta.trim().to_string())),
            None => (Some(tail.trim().to_string()), None),
        }
    } else {
        (None, None)
    };

    Some(DownloadProgress {
        progress_percent,
        progress_text: line.trim().to_string(),
        speed_text,
        eta_text,
    })
}

fn thumbnail_id_rank(id: Option<&str>) -> u8 {
    match id {
        Some("maxres") | Some("maxresdefault") => 4,
        Some("sddefault") => 3,
        Some("hqdefault") => 2,
        Some("mqdefault") => 1,
        _ => 0,
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

    fn test_config(download_dir: &str) -> Config {
        Config {
            nats_url: "nats://nats:4222".into(),
            database_url: "postgres://test".into(),
            download_dir: download_dir.into(),
            cookies_path: "/cookies/cookies.txt".into(),
            max_concurrent: 2,
        }
    }

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
    fn test_build_ytdlp_args_enables_node_runtime() {
        let cfg = test_config("/tmp/downloads");
        let args = build_ytdlp_args(
            "abc123",
            "https://www.youtube.com/watch?v=abc123",
            &cfg,
            false,
            "",
            None,
        );

        assert_eq!(args[0], "--js-runtimes");
        assert_eq!(args[1], "node");
        assert!(args.iter().any(|arg| arg == "--newline"));
        assert!(args.iter().any(|arg| arg == YTDLP_FORMAT));
        assert!(!args.iter().any(|arg| arg == "--cookies"));
    }

    #[test]
    fn test_build_ytdlp_args_uses_cookie_file_when_available() {
        let cfg = test_config("/tmp/downloads");
        let args = build_ytdlp_args(
            "abc123",
            "https://www.youtube.com/watch?v=abc123",
            &cfg,
            true,
            "",
            None,
        );

        let cookies_index = args.iter().position(|arg| arg == "--cookies").unwrap();
        assert_eq!(args[cookies_index + 1], "/cookies/cookies.txt");
    }

    #[test]
    fn test_build_ytdlp_args_appends_custom_extractor_args() {
        let cfg = test_config("/tmp/downloads");
        let args = build_ytdlp_args(
            "abc123",
            "https://www.youtube.com/watch?v=abc123",
            &cfg,
            true,
            "youtube:player_client=mweb;po_token=mweb.gvs+token",
            None,
        );

        let extractor_index = args.iter().position(|arg| arg == "--extractor-args").unwrap();
        assert_eq!(args[extractor_index + 1], "youtube:player_client=mweb;po_token=mweb.gvs+token");
    }

    #[test]
    fn test_build_ytdlp_args_applies_quality_cap() {
        let cfg = test_config("/tmp/downloads");
        let args = build_ytdlp_args(
            "abc123",
            "https://www.youtube.com/watch?v=abc123",
            &cfg,
            false,
            "",
            Some("720"),
        );

        let format_index = args.iter().position(|arg| arg == "-f").unwrap();
        assert!(args[format_index + 1].contains("height<=720"));
    }

    #[test]
    fn test_format_ytdlp_failure_explains_js_challenge_issue() {
        let msg = format_ytdlp_failure(
            "",
            "WARNING: Some formats may be missing. Ensure you have a supported JavaScript runtime and challenge solver distribution installed.",
            true,
        );

        assert!(msg.contains("JavaScript challenge"));
        assert!(msg.contains("Cookies were present"));
    }

    #[test]
    fn test_format_ytdlp_failure_explains_po_token_issue() {
        let msg = format_ytdlp_failure("", "HTTP Error 403. Missing PO Token for client", true);

        assert!(msg.contains("PO-token enforcement"));
    }

    #[test]
    fn test_format_ytdlp_failure_explains_cookie_issue() {
        let msg = format_ytdlp_failure("", "Sign in to confirm you're not a bot", false);

        assert!(msg.contains("needs fresher YouTube cookies"));
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

    #[test]
    fn test_find_downloaded_file_skips_info_json() {
        let dir = tempfile::tempdir().unwrap();
        // Only .info.json present — should NOT be found
        fs::File::create(dir.path().join("abc123.info.json")).unwrap();

        let result = find_downloaded_file(dir.path().to_str().unwrap(), "abc123");
        assert!(result.is_err());

        // Now add the actual video file — should be found
        fs::File::create(dir.path().join("abc123.mp4")).unwrap();
        let result = find_downloaded_file(dir.path().to_str().unwrap(), "abc123");
        assert!(result.is_ok());
        assert!(result.unwrap().contains("abc123.mp4"));
    }

    #[test]
    fn test_find_downloaded_file_prefers_clean_mp4() {
        let dir = tempfile::tempdir().unwrap();
        // Simulate yt-dlp intermediate fragments and final merged output.
        fs::File::create(dir.path().join("abc123.f137.mp4")).unwrap();
        fs::File::create(dir.path().join("abc123.f251.webm")).unwrap();
        fs::File::create(dir.path().join("abc123.mp4")).unwrap();

        let result = find_downloaded_file(dir.path().to_str().unwrap(), "abc123").unwrap();
        // Must return the final merged file, not a fragment.
        assert!(
            result.contains("abc123.mp4"),
            "expected abc123.mp4, got {}",
            result
        );
        assert!(
            !result.contains(".f137."),
            "should not return fragment .f137."
        );
        assert!(
            !result.contains(".f251."),
            "should not return fragment .f251."
        );
    }

    #[test]
    fn test_find_downloaded_file_falls_back_to_fragment() {
        let dir = tempfile::tempdir().unwrap();
        // No final merged file — only a fragment is present.
        fs::File::create(dir.path().join("abc123.f137.mp4")).unwrap();

        let result = find_downloaded_file(dir.path().to_str().unwrap(), "abc123");
        assert!(
            result.is_ok(),
            "should fall back to fragment when no merged file exists"
        );
    }

    #[test]
    fn test_best_thumbnail_url_prefers_highest_resolution_variant() {
        let info = YtdlpInfo {
            title: None,
            channel: None,
            channel_id: None,
            duration: None,
            thumbnail: Some("https://i.ytimg.com/vi/abc123/hqdefault.jpg".into()),
            thumbnails: Some(vec![
                YtdlpThumbnail {
                    id: Some("hqdefault".into()),
                    url: Some("https://i.ytimg.com/vi/abc123/hqdefault.jpg".into()),
                    width: Some(480),
                    height: Some(360),
                    preference: Some(0),
                },
                YtdlpThumbnail {
                    id: Some("maxresdefault".into()),
                    url: Some("https://i.ytimg.com/vi/abc123/maxresdefault.jpg".into()),
                    width: Some(1280),
                    height: Some(720),
                    preference: Some(1),
                },
            ]),
            formats: None,
        };

        assert_eq!(
            best_thumbnail_url(&info).as_deref(),
            Some("https://i.ytimg.com/vi/abc123/maxresdefault.jpg")
        );
    }

    #[test]
    fn test_best_thumbnail_url_falls_back_to_single_thumbnail_field() {
        let info = YtdlpInfo {
            title: None,
            channel: None,
            channel_id: None,
            duration: None,
            thumbnail: Some("https://i.ytimg.com/vi/abc123/hqdefault.jpg".into()),
            thumbnails: Some(vec![YtdlpThumbnail {
                id: Some("maxresdefault".into()),
                url: None,
                width: Some(1280),
                height: Some(720),
                preference: Some(1),
            }]),
            formats: None,
        };

        assert_eq!(
            best_thumbnail_url(&info).as_deref(),
            Some("https://i.ytimg.com/vi/abc123/hqdefault.jpg")
        );
    }

    #[test]
    fn test_available_quality_options_includes_unique_bands() {
        let info = YtdlpInfo {
            title: None,
            channel: None,
            channel_id: None,
            duration: None,
            thumbnail: None,
            thumbnails: None,
            formats: Some(vec![
                YtdlpFormat {
                    height: Some(1080),
                    vcodec: Some("avc1".into()),
                },
                YtdlpFormat {
                    height: Some(720),
                    vcodec: Some("avc1".into()),
                },
                YtdlpFormat {
                    height: Some(1080),
                    vcodec: Some("vp9".into()),
                },
                YtdlpFormat {
                    height: Some(0),
                    vcodec: Some("none".into()),
                },
            ]),
        };

        let options = available_quality_options(&info);
        assert_eq!(options[0].key, "best");
        assert!(options.iter().any(|option| option.key == "1080"));
        assert!(options.iter().any(|option| option.key == "720"));
    }

    #[test]
    fn test_parse_progress_line_extracts_percent_speed_and_eta() {
        let progress = parse_progress_line(
            "[download]  42.3% of   10.00MiB at    2.00MiB/s ETA 00:03",
        )
        .unwrap();

        assert_eq!(progress.progress_percent, 42);
        assert_eq!(progress.speed_text.as_deref(), Some("2.00MiB/s"));
        assert_eq!(progress.eta_text.as_deref(), Some("00:03"));
    }
}
