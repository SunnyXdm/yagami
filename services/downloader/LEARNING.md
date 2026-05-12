# Rust Learning Guide — Downloader Service

## What This Service Does

The downloader consumes `download.request`, runs `yt-dlp`, stores queue state in Postgres, and publishes `download.complete` when a job finishes or fails.

It is deliberately narrow:

- fetch the video
- extract metadata from `.info.json`
- enforce the configured size limit
- record the result
- publish the completion payload

Telegram upload, splitting, and progress belong to the Python service, not here.

## Core Rust Concepts In This Service

### 1. Ownership and borrowing

Rust still revolves around one owner per value. The downloader mostly uses borrowing for read-only params and owned `String` values for message payloads and runtime settings.

Study:

- `src/models.rs`
- `src/download.rs`

### 2. `Result<T, E>` plus `?` is the normal control flow

Most fallible downloader operations are just straight-line code with `?`:

```rust
let output = Command::new("yt-dlp")
    .args(&args)
    .output()
    .await
    .context("Failed to spawn yt-dlp")?;
```

That reads like happy-path code while still preserving explicit failure handling.

Study:

- `src/download.rs`
- `src/db.rs`

### 3. Shared mutable runtime settings use `Arc<RwLock<...>>`

The service loads settings from Postgres, keeps them in memory, and refreshes them while downloads continue running.

That pattern looks like this:

```rust
let runtime: Arc<RwLock<RuntimeSettings>> = ...
let current = runtime.read().await.clone();
```

Study:

- `src/db.rs`
- `src/main.rs`

### 4. Async process spawning uses Tokio, not threads-per-download

`tokio::process::Command` lets the worker spawn `yt-dlp` without blocking the rest of the async runtime.

Study:

- `src/download.rs`

### 5. Runtime settings come from Postgres, not `.env`

The downloader hot-reloads:

- `downloader.max_concurrent`
- `downloader.max_filesize_gb`
- `youtube.cookies`
- `downloader.ytdlp_extractor_args`

`db.rs` also writes the cookies text out to the file path `yt-dlp` expects.

Study:

- `src/db.rs`

### 6. The size limit is enforced after download, not through yt-dlp flags

This is an important current behavior.

The worker downloads first, reads the file size, and then rejects files above `downloader.max_filesize_gb`.

That means:

- the limit is explicit and centralized in our code
- the failure message is under our control
- large files can still be accepted and later split by the Telegram client if they are under the downloader's limit but over Telegram's upload ceiling

Study:

- `src/main.rs`

### 7. yt-dlp failures are classified into useful operator messages

The downloader tries to turn ugly subprocess output into something actionable:

- JavaScript challenge failures
- stale or missing cookies
- PO-token enforcement
- generic yt-dlp crashes

Study:

- `src/download.rs`

### 8. Metadata repair happens after download

The request payload is sometimes incomplete, especially for admin-requested downloads. The downloader reads `yt-dlp`'s `.info.json` and fills in missing title, channel, duration, and thumbnail fields before publishing the final result.

Study:

- `src/download.rs`
- `src/main.rs`

## File Map

```text
src/main.rs         NATS loop, concurrency, size enforcement, result publishing
src/db.rs           Postgres access, runtime settings, cookie-file sync
src/download.rs     yt-dlp args, subprocess execution, metadata extraction
src/models.rs       request/result payloads
src/config.rs       environment-driven static config
src/observability.rs log publishing helpers
```

## Current Service Patterns

- Likes from the poller normally trigger downloads automatically.
- Admin DM links also become `download.request` jobs.
- Cookies and extractor args can change at runtime through the Settings UI.
- The service publishes one terminal event: `download.complete`.

## Common Rust Gotchas Here

1. `String` vs `&str` matters constantly. Prefer `&str` for inputs and owned `String` in stored structs.
2. `clone()` is often the right tradeoff when it makes async ownership simpler.
3. `async move` closures take ownership of captured values.
4. If the borrow checker fights you inside an async task, clone the small data and move on.
5. `unwrap()` in worker code is almost always the wrong choice. Use `?`, `match`, or a safe default.

## Build, Run, and Verify

```bash
cd services/downloader
cargo check
cargo test
```

Helpful extras:

```bash
cargo fmt
cargo clippy
cargo build --release
```

## Resources

- [The Rust Book](https://doc.rust-lang.org/book/)
- [Rust by Example](https://doc.rust-lang.org/rust-by-example/)
- [Tokio Tutorial](https://tokio.rs/tokio/tutorial)
- [Serde](https://serde.rs/)
