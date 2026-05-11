use std::env;

pub struct Config {
    pub nats_url: String,
    pub database_url: String,
    pub download_dir: String,
    pub cookies_path: String,
    pub max_concurrent: usize,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            nats_url: env::var("NATS_URL").unwrap_or_else(|_| "nats://nats:4222".into()),
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://yagami:yagami@postgres:5432/yagami".into()),
            download_dir: env::var("DOWNLOAD_DIR").unwrap_or_else(|_| "/tmp/downloads".into()),
            cookies_path: env::var("COOKIES_PATH")
                .unwrap_or_else(|_| "/cookies/cookies.txt".into()),
            max_concurrent: env::var("MAX_CONCURRENT_DOWNLOADS")
                .unwrap_or_else(|_| "3".into())
                .parse()
                .unwrap_or(3),
        }
    }
}
