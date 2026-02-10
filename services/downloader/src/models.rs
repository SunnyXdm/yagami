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
}

/// LEARNING: `impl` blocks add methods to a struct. Rust doesn't have
/// class constructors — you just write functions that return the struct.
impl DownloadResult {
    pub fn success(video_id: String, title: String, file_path: String, file_size: u64) -> Self {
        Self {
            video_id,
            title,
            file_path: Some(file_path),
            file_size: Some(file_size),
            success: true,
            error: None,
        }
    }

    pub fn failure(video_id: String, title: String, error: String) -> Self {
        Self {
            video_id,
            title,
            file_path: None,
            file_size: None,
            success: false,
            error: Some(error),
        }
    }
}

/// LEARNING: `#[cfg(test)]` means this module is only compiled when running `cargo test`.
/// Tests live alongside the code they test — no separate test files needed.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_download_request_deserialize() {
        let json = r#"{"video_id":"abc123","title":"Test","url":"https://youtube.com/watch?v=abc123"}"#;
        let req: DownloadRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.video_id, "abc123");
        assert_eq!(req.title, "Test");
        assert_eq!(req.url, "https://youtube.com/watch?v=abc123");
    }

    #[test]
    fn test_download_request_missing_field() {
        let json = r#"{"video_id":"abc123","title":"Test"}"#;
        let result = serde_json::from_str::<DownloadRequest>(json);
        assert!(result.is_err(), "Should fail without url field");
    }

    #[test]
    fn test_download_result_success() {
        let result = DownloadResult::success(
            "vid1".into(),
            "My Video".into(),
            "/tmp/vid1.mp4".into(),
            1024,
        );
        assert!(result.success);
        assert_eq!(result.file_path, Some("/tmp/vid1.mp4".into()));
        assert_eq!(result.file_size, Some(1024));
        assert!(result.error.is_none());
    }

    #[test]
    fn test_download_result_failure() {
        let result = DownloadResult::failure(
            "vid2".into(),
            "Bad Video".into(),
            "404 not found".into(),
        );
        assert!(!result.success);
        assert!(result.file_path.is_none());
        assert!(result.file_size.is_none());
        assert_eq!(result.error, Some("404 not found".into()));
    }

    #[test]
    fn test_download_result_serializes_to_json() {
        let result = DownloadResult::success(
            "vid3".into(),
            "Serializable".into(),
            "/tmp/vid3.mp4".into(),
            2048,
        );
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"video_id\":\"vid3\""));
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"file_size\":2048"));
    }

    #[test]
    fn test_failure_result_serializes_null_optionals() {
        let result = DownloadResult::failure("v".into(), "t".into(), "err".into());
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"file_path\":null"));
        assert!(json.contains("\"file_size\":null"));
        assert!(json.contains("\"success\":false"));
    }
}
