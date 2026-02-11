# Rust Learning Guide — Downloader Service

## Core Concepts Used

### 1. Ownership & Borrowing (THE Rust concept)
Every value has exactly one owner. When the owner goes out of scope, the value is dropped.

```rust
let s1 = String::from("hello");
let s2 = s1;          // s1 is MOVED to s2. s1 is now invalid!
// println!("{}", s1); // COMPILE ERROR: s1 was moved

let s3 = s2.clone();  // Deep copy. Both s2 and s3 are valid.
```

**Borrowing** lets you reference data without taking ownership:
```rust
fn print_length(s: &String) {  // & = borrow (read-only reference)
    println!("{}", s.len());
}

let s = String::from("hello");
print_length(&s);  // s is still valid after this call
```

### 2. Result and the `?` Operator
No exceptions in Rust! Functions return `Result<T, E>`:

```rust
fn read_file(path: &str) -> Result<String, io::Error> {
    let content = std::fs::read_to_string(path)?;  // ? = return Err if failed
    Ok(content)                                      // Wrap success in Ok()
}
```

**`?` is syntactic sugar for:**
```rust
let content = match std::fs::read_to_string(path) {
    Ok(c) => c,
    Err(e) => return Err(e.into()),
};
```

### 3. Option<T> (Nullable types done right)
No null in Rust! Use `Option<T>` = `Some(value)` or `None`:

```rust
struct User {
    name: String,
    email: Option<String>,  // May or may not have an email
}

match user.email {
    Some(email) => println!("Email: {}", email),
    None => println!("No email"),
}
```

We use `Option<i64>` for `requester_chat_id` in download messages — it's
only `Some(chat_id)` when the admin triggered the download via DM, and
`None` for regular channel updates. This lets the telegram-client route
the finished video to the right place.

### 4. async/await with Tokio
Like Python's asyncio, but with ownership rules:

```rust
#[tokio::main]
async fn main() {
    let result = fetch_data().await;  // Suspend until done
}

// tokio::spawn = asyncio.create_task()
tokio::spawn(async move {  // `move` transfers ownership into the task
    do_work().await;
});
```

### 5. Arc (Shared Ownership)
When multiple tasks need the same data:

```rust
use std::sync::Arc;

let config = Arc::new(Config::from_env());

// Clone = increment reference counter (cheap!)
let config_clone = Arc::clone(&config);
tokio::spawn(async move {
    use_config(&config_clone).await;
});
```

### 6. Serde (Serialization)
Derive macros auto-generate JSON code:

```rust
#[derive(Serialize, Deserialize)]
struct User {
    name: String,
    age: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
}

// To JSON
let json = serde_json::to_string(&user)?;

// From JSON
let user: User = serde_json::from_str(&json)?;
```

### 7. Pattern Matching with `match`
Must be exhaustive — every case handled:

```rust
match status_code {
    200 => println!("OK"),
    404 => println!("Not found"),
    500..=599 => println!("Server error"),  // Range pattern
    _ => println!("Other"),                  // Catch-all
}
```

## Key Patterns in This Service

### Concurrency with Semaphore
```rust
let semaphore = Arc::new(Semaphore::new(3));  // Max 3 concurrent

let _permit = semaphore.acquire_owned().await?;
// ... do work ...
// permit is dropped here → slot opens up (RAII)
```

### Process Spawning
```rust
let output = Command::new("yt-dlp")
    .args(&["--format", "best", url])
    .output()
    .await?;

if output.status.success() {
    let stdout = String::from_utf8_lossy(&output.stdout);
}
```

### Async Message Loop
```rust
while let Some(msg) = subscriber.next().await {
    let request: Request = serde_json::from_slice(&msg.payload)?;
    tokio::spawn(handle(request));
}
```

### No Max File Size
The downloader does not impose `--max-filesize` on yt-dlp. Large videos
are downloaded in full and the telegram-client handles splitting files
that exceed Telegram's ~2 GB upload limit. This keeps the downloader
simple — it just downloads.

## Common Gotchas

1. **String vs &str**: `String` = owned, heap-allocated. `&str` = borrowed reference to string data.
   Use `&str` in function params, `String` in structs.

2. **Clone guilt**: Don't feel bad about `.clone()`. Premature optimization is worse than clear code.

3. **`move` closures**: `async move { }` takes ownership of captured variables.
   The original variables become invalid after the closure.

4. **Lifetimes**: If the compiler complains about lifetimes, try cloning or using `Arc`.

5. **`unwrap()` is a code smell**: Use `?` for propagation, `unwrap_or_else` for defaults,
   `if let Some(x) / match` for handling.

## Building & Running

```bash
cd services/downloader

# Debug build (fast compile, slow execution)
cargo build

# Release build (slow compile, fast execution)
cargo build --release

# Run directly
cargo run

# Check without building (fastest feedback)
cargo check

# Run tests
cargo test
```

## Useful Cargo Commands

```bash
cargo fmt       # Auto-format code
cargo clippy    # Linter (like ESLint for Rust)
cargo doc       # Generate documentation
cargo update    # Update dependencies
```
