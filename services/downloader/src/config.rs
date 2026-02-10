/// Configuration loaded from environment variables.
///
/// LEARNING: In Rust, a struct is like a class without methods (data only).
/// Methods are added separately in `impl` blocks. This separation is a key
/// Rust design pattern.
use std::env;

pub struct Config {
    pub nats_url: String,
    pub download_dir: String,
    pub max_concurrent: usize,
    pub max_file_size_mb: u64,
    pub cookies_path: String,
}

impl Config {
    /// LEARNING: `Self` refers to the type being implemented (Config).
    /// This is a constructor pattern — Rust has no `new` keyword,
    /// just functions that return Self.
    pub fn from_env() -> Self {
        Self {
            nats_url: env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".into()),
            download_dir: env::var("DOWNLOAD_DIR").unwrap_or_else(|_| "/tmp/downloads".into()),
            max_concurrent: env::var("MAX_CONCURRENT_DOWNLOADS")
                .unwrap_or_else(|_| "3".into())
                .parse()
                .unwrap_or(3),
            max_file_size_mb: env::var("MAX_FILE_SIZE_MB")
                .unwrap_or_else(|_| "2000".into())
                .parse()
                .unwrap_or(2000),
            cookies_path: env::var("COOKIES_PATH").unwrap_or_else(|_| "/app/cookies.txt".into()),
        }
    }
}
