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
            cookies_path: env::var("COOKIES_PATH").unwrap_or_else(|_| "/app/cookies.txt".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    /// LEARNING: Rust tests run in parallel by default. Since env vars are
    /// global process state, we combine env var tests into one function to
    /// avoid race conditions. This is a common gotcha!
    #[test]
    fn test_config_from_env() {
        // --- Test 1: defaults when no env vars set ---
        env::remove_var("NATS_URL");
        env::remove_var("DOWNLOAD_DIR");
        env::remove_var("MAX_CONCURRENT_DOWNLOADS");
        env::remove_var("COOKIES_PATH");

        let config = Config::from_env();
        assert_eq!(config.nats_url, "nats://localhost:4222");
        assert_eq!(config.download_dir, "/tmp/downloads");
        assert_eq!(config.max_concurrent, 3);
        assert_eq!(config.cookies_path, "/app/cookies.txt");

        // --- Test 2: reads custom env vars ---
        env::set_var("NATS_URL", "nats://custom:9999");
        env::set_var("DOWNLOAD_DIR", "/custom/downloads");
        env::set_var("MAX_CONCURRENT_DOWNLOADS", "5");
        env::set_var("COOKIES_PATH", "/custom/cookies.txt");

        let config = Config::from_env();
        assert_eq!(config.nats_url, "nats://custom:9999");
        assert_eq!(config.download_dir, "/custom/downloads");
        assert_eq!(config.max_concurrent, 5);
        assert_eq!(config.cookies_path, "/custom/cookies.txt");

        // --- Test 3: invalid number falls back to default ---
        env::set_var("MAX_CONCURRENT_DOWNLOADS", "not_a_number");
        let config = Config::from_env();
        assert_eq!(config.max_concurrent, 3);

        // Clean up
        env::remove_var("NATS_URL");
        env::remove_var("DOWNLOAD_DIR");
        env::remove_var("MAX_CONCURRENT_DOWNLOADS");
        env::remove_var("COOKIES_PATH");
    }
}
