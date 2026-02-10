/// Data models for NATS messages.
///
/// LEARNING: Serde's derive macros auto-generate JSON serialization code.
/// #[derive(Deserialize)] → can parse from JSON
/// #[derive(Serialize)]   → can convert to JSON
/// #[serde(rename_all = "snake_case")] → converts field names to snake_case in JSON
use serde::{Deserialize, Serialize};

/// Incoming request from NATS (youtube-poller publishes these)
#[derive(Debug, Deserialize)]
pub struct DownloadRequest {
    pub video_id: String,
    pub title: String,
    pub url: String,
    /// Metadata forwarded to download.complete so Telegram has context
    pub channel: Option<String>,
    pub channel_id: Option<String>,
    pub duration: Option<String>,
    pub thumbnail: Option<String>,
}

/// Outgoing result published to NATS (telegram-client consumes these)
#[derive(Debug, Serialize)]
pub struct DownloadResult {
    pub video_id: String,
    pub title: String,
    pub file_path: Option<String>,
    pub file_size: Option<u64>,
    pub success: bool,
    pub error: Option<String>,
    /// Forwarded metadata from the request
    pub channel: Option<String>,
    pub channel_id: Option<String>,
    pub duration: Option<String>,
    pub thumbnail: Option<String>,
}

/// LEARNING: `impl` blocks add methods to a struct. Rust doesn't have
/// class constructors — you just write functions that return the struct.
impl DownloadResult {
    pub fn success(req: &DownloadRequest, file_path: String, file_size: u64) -> Self {
        Self {
            video_id: req.video_id.clone(),
            title: req.title.clone(),
            file_path: Some(file_path),
            file_size: Some(file_size),
            success: true,
            error: None,
            channel: req.channel.clone(),
            channel_id: req.channel_id.clone(),
            duration: req.duration.clone(),
            thumbnail: req.thumbnail.clone(),
        }
    }

    pub fn failure(req: &DownloadRequest, error: String) -> Self {
        Self {
            video_id: req.video_id.clone(),
            title: req.title.clone(),
            file_path: None,
            file_size: None,
            success: false,
            error: Some(error),
            channel: req.channel.clone(),
            channel_id: req.channel_id.clone(),
            duration: req.duration.clone(),
            thumbnail: req.thumbnail.clone(),
        }
    }
}

/// LEARNING: `#[cfg(test)]` means this module is only compiled when running `cargo test`.
/// Tests live alongside the code they test — no separate test files needed.
#[cfg(test)]
mod tests {
    use super::*;

    fn test_request() -> DownloadRequest {
        DownloadRequest {
            video_id: "abc123".into(),
            title: "Test".into(),
            url: "https://youtube.com/watch?v=abc123".into(),
            channel: Some("TestChannel".into()),
            channel_id: Some("UC123".into()),
            duration: Some("3:45".into()),
            thumbnail: None,
        }
    }

    #[test]
    fn test_download_request_deserialize() {
        let json = r#"{"video_id":"abc123","title":"Test","url":"https://youtube.com/watch?v=abc123"}"#;
        let req: DownloadRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.video_id, "abc123");
        assert_eq!(req.title, "Test");
        assert!(req.channel.is_none());
    }

    #[test]
    fn test_download_request_with_metadata() {
        let json = r#"{"video_id":"abc123","title":"Test","url":"https://youtube.com/watch?v=abc123","channel":"Ch","duration":"3:45"}"#;
        let req: DownloadRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.channel, Some("Ch".into()));
        assert_eq!(req.duration, Some("3:45".into()));
    }

    #[test]
    fn test_download_request_missing_field() {
        let json = r#"{"video_id":"abc123","title":"Test"}"#;
        let result = serde_json::from_str::<DownloadRequest>(json);
        assert!(result.is_err(), "Should fail without url field");
    }

    #[test]
    fn test_download_result_success() {
        let req = test_request();
        let result = DownloadResult::success(&req, "/tmp/abc123.mp4".into(), 1024);
        assert!(result.success);
        assert_eq!(result.file_path, Some("/tmp/abc123.mp4".into()));
        assert_eq!(result.file_size, Some(1024));
        assert_eq!(result.channel, Some("TestChannel".into()));
        assert!(result.error.is_none());
    }

    #[test]
    fn test_download_result_failure() {
        let req = test_request();
        let result = DownloadResult::failure(&req, "404 not found".into());
        assert!(!result.success);
        assert!(result.file_path.is_none());
        assert_eq!(result.error, Some("404 not found".into()));
        assert_eq!(result.channel, Some("TestChannel".into()));
    }

    #[test]
    fn test_download_result_serializes_to_json() {
        let req = test_request();
        let result = DownloadResult::success(&req, "/tmp/abc123.mp4".into(), 2048);
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"video_id\":\"abc123\""));
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"channel\":\"TestChannel\""));
    }

    #[test]
    fn test_failure_result_serializes_null_optionals() {
        let req = test_request();
        let result = DownloadResult::failure(&req, "err".into());
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"file_path\":null"));
        assert!(json.contains("\"success\":false"));
    }
}
