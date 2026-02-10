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
