# Project Yagami — YouTube Activity Guardian & Automated Media Interface

> A polyglot, dockerised system that tracks YouTube activity (watch history, likes, subscriptions) and forwards it to Telegram via MTProto, with automatic video downloading of liked videos via yt-dlp. No browser extensions — fully server-side and autonomous.

---

## Table of Contents

1. [Problem Statement & Goals](#1-problem-statement--goals)
2. [Critical Constraints & Research Findings](#2-critical-constraints--research-findings)
3. [Architecture Overview](#3-architecture-overview)
4. [Service Breakdown & Language Choices](#4-service-breakdown--language-choices)
5. [Data Flow Diagrams](#5-data-flow-diagrams)
6. [API & Integration Deep Dive](#6-api--integration-deep-dive)
7. [Database Design](#7-database-design)
8. [Message Queue & Inter-Service Communication](#8-message-queue--inter-service-communication)
9. [Telegram Client Design](#9-telegram-client-design)
10. [Docker & Infrastructure](#10-docker--infrastructure)
11. [Security Considerations](#11-security-considerations)
12. [Error Handling & Resilience](#12-error-handling--resilience)
13. [Testing Strategy](#13-testing-strategy)
14. [Development Phases & Milestones](#14-development-phases--milestones)
15. [Learning Roadmap (Language-by-Service)](#15-learning-roadmap-language-by-service)
16. [Open Questions & Decisions](#16-open-questions--decisions)

---

## 1. Problem Statement & Goals

### What We're Building

A self-hosted, fully autonomous, dockerised application that:

1. **Tracks YouTube activity** for a single user (you):
   - **Watch history** — what videos you watch (scraped via yt-dlp + cookies, no browser extension)
   - **Liked videos** — videos you hit "like" on (polled via YouTube Data API)
   - **New subscriptions** — channels you subscribe to (polled via YouTube Data API)

2. **Forwards activity to separate Telegram channels/groups** — each event type gets its own dedicated Telegram channel or group:
   - **Likes channel** — liked video notifications + downloaded video files
   - **Subscriptions channel** — new subscription notifications
   - **Watch History channel** — watched video notifications

3. **Downloads liked videos and sends to Telegram** — when you like a video on YouTube, uses yt-dlp to download it, uploads it to the Likes Telegram channel via **MTProto** (up to 2 GB with full inline video player), and **deletes the local copy** (no offline storage)

4. **Requires zero manual intervention** — once configured and started, everything runs autonomously inside Docker. No browser extensions, no manual exports, no human-in-the-loop.

### Non-Goals (for v1)

- Not a multi-user SaaS platform
- No web UI (Telegram IS the interface)
- No recommendation engine or analytics dashboard
- Not tracking comments, playlists, or other activity types
- Not keeping an offline media library
- **No browser extension** — everything is server-side

---

## 2. Critical Constraints & Research Findings

### 2.1 YouTube Data API v3 — What's Actually Possible

This is the single most important section. Misunderstanding YouTube's API will doom the project.

#### ✅ What the API CAN do:

| Feature | API Endpoint | Auth Required | Quota Cost |
|---|---|---|---|
| **List liked videos** | `GET /videos?myRating=like` | OAuth 2.0 | 1 unit/request |
| **List subscriptions** | `GET /subscriptions?mine=true` | OAuth 2.0 | 1 unit/request |
| **Get video details** | `GET /videos?id={id}` | API Key or OAuth | 1 unit/request |
| **List channel uploads** | `GET /playlistItems?playlistId={uploadsPlaylistId}` | API Key or OAuth | 1 unit/request |

#### ❌ What the API CANNOT do:

| Feature | Status | Workaround |
|---|---|---|
| **Watch history** | **DEPRECATED since 2016.** The Activities API no longer returns watch history. The "History" playlist (`HL`) is also inaccessible via API. | **yt-dlp with cookies** — scrape `youtube.com/feed/history` using `--flat-playlist -j` to extract video metadata as JSON. Fully server-side, no browser needed. |
| **Real-time webhooks for likes** | Not available. No push notification for "user liked a video". | Polling — periodically call `videos?myRating=like` and diff against stored state |
| **Real-time webhooks for subscriptions** | Not available. | Polling — periodically call `subscriptions?mine=true` and diff |
| **Push notifications for new activity** | YouTube PubSubHubbub only notifies about *new uploads* on a channel, not user activity. | Polling |

#### ⚠️ Quota Limits:

- **Default quota: 10,000 units/day**
- At 1 unit per `list` call, polling every 5 minutes = 288 calls/day per endpoint
- With 2 API-based endpoints (likes, subscriptions) = ~576 units/day
- Watch history via yt-dlp **does not use API quota** (uses web scraping with cookies)
- Video downloads via yt-dlp **do not use API quota** either
- **This is very comfortable.** Can even poll every 2 minutes (~1,440 units/day)

### 2.2 Watch History — Solved Without a Browser Extension

Since the YouTube Data API deprecated watch history access in 2016, we use **yt-dlp with cookies** to scrape the history feed directly. This is the same technique yt-dlp uses for any authenticated YouTube content.

#### How It Works

```bash
yt-dlp --flat-playlist -j --cookies /config/cookies.txt \
  "https://www.youtube.com/feed/history" \
  --playlist-end 30
```

This outputs one JSON object per line, each containing:
- `id` — YouTube video ID
- `title` — video title
- `channel` / `uploader` — channel name
- `channel_id` / `uploader_id` — channel ID
- `duration` — video duration in seconds
- `view_count` — view count
- `url` — full video URL

#### Strategy

1. **Poll periodically** (every 5-10 minutes) — run the yt-dlp command above
2. **Parse the JSON output** — extract video IDs and metadata
3. **Diff against stored state** in PostgreSQL (`known_watch_history` table)
4. **Emit events** for any new video IDs not previously seen
5. **Store new entries** in the database

#### Considerations

- **Cookies are required** — export from your browser once, mount as a read-only file in Docker
- **Cookies expire** — YouTube session cookies last weeks/months, but will eventually expire. When they do, re-export from your browser. The system will detect auth failures and alert you via Telegram.
- **Rate limiting** — don't poll too aggressively. Every 5-10 minutes is safe.
- **Order** — the feed returns most recent first, so we only need the first page (30 items) per poll
- **yt-dlp as a subprocess** — the Elixir poller will shell out to yt-dlp for watch history scraping (same cookies file used by the Rust downloader)

### 2.3 Telegram — MTProto via Telethon (Not Bot API)

#### Why Not Bot API?

| Constraint | Bot API Limit | Impact |
|---|---|---|
| **File upload size (sendVideo)** | **50 MB** | Most YouTube videos at 720p+ exceed this |
| **File upload via URL** | **20 MB** | Even more restrictive |
| **sendDocument** | **2 GB** | Works, but **no inline video player** — shows as file download |

The Bot API's 50 MB limit for `sendVideo` is a dealbreaker. Using `sendDocument` for larger files works but ruins the UX — videos appear as downloadable files instead of playable inline.

#### The Solution: MTProto via Telethon

**Telethon** is an actively maintained (updated 2 days ago, layer 222) Python asyncio MTProto library. It talks directly to Telegram's native API, bypassing Bot API limitations.

| Feature | Telethon (MTProto) | Bot API |
|---|---|---|
| **Video upload limit** | **2 GB** (4 GB for Premium accounts) | 50 MB |
| **Inline video player** | ✅ Yes, for all uploads up to 2 GB | Only for ≤50 MB |
| **Upload progress** | ✅ Native progress callback | No |
| **Auth method** | User account session (phone + code once) | Bot token |
| **Rate limits** | Much more generous | 30 msg/sec group |
| **Maintained** | ✅ Actively (11.8k stars, updated days ago) | N/A |

#### Why Telethon over Pyrogram?

- **Pyrogram is abandoned** — its docs state *"The project is no longer maintained or supported"*
- **Telethon is actively maintained** — last commit was days ago, regularly updated to latest Telegram API layers
- **Same capabilities** — both are MTProto libraries with near-identical features
- **Telethon has 11.8k stars** and 187 contributors on GitHub

#### Telethon Setup Requirements

1. **Get API credentials** from https://my.telegram.org → API Development
   - `api_id` (integer)
   - `api_hash` (string)
2. **One-time phone authentication** — first run requires entering a phone number + verification code
3. **Session persistence** — after first auth, Telethon creates a `.session` file. Mount this in Docker so you don't need to re-auth on container restarts.
4. **Can also run as a bot** — Telethon supports both user accounts and bot tokens. We'll use a **user account** for uploads (2 GB limit) and optionally a **bot** for command handling.

#### Telethon Upload Example

```python
from telethon import TelegramClient

client = TelegramClient('yagami_session', api_id, api_hash)
await client.start()

# Upload video to a specific channel — full inline player, up to 2 GB
await client.send_file(
    entity=likes_channel_id,       # Separate channel for likes
    file='/tmp/ytdl/abc123.mp4',
    caption='❤️ The Art of Code — Dylan Beattié (1:00:49)',
    supports_streaming=True,       # Enables inline video player
    progress_callback=upload_progress,
)
```

### 2.4 yt-dlp Considerations

- **Authentication**: yt-dlp uses a cookies file (`--cookies /config/cookies.txt`). Inside Docker, mount this as a read-only volume. The **same cookies file** is used for both watch history scraping (Elixir poller shelling out) and video downloading (Rust downloader).
- **Format selection**: With Telethon's 2 GB limit, we can download at much higher quality:
  - `yt-dlp -f "bv*[filesize<2G]+ba/b[filesize<2G]/bv*+ba/b"` — best quality under 2 GB
  - Most videos at 1080p are well under 2 GB
- **Rate limiting**: YouTube throttles downloads; adding `--sleep-interval` and `--limit-rate` is wise
- **Output**: Download to a temp directory, upload to Telegram, then delete. Use `--paths temp:/tmp/ytdl`
- **SponsorBlock**: Can optionally strip sponsor segments with `--sponsorblock-remove all`
- **Watch history scraping**: yt-dlp doubles as our watch history data source using `--flat-playlist -j`

---

## 3. Architecture Overview

```
┌──────────────┐    ┌───────────────────────────────────┐    ┌──────────────┐
│   YouTube    │◄───│         API Gateway               │───►│   PostgreSQL │
│   Data API   │    │           (Go)                    │    │              │
│              │    │                                   │    │  - events    │
│  - Likes     │    │  • REST endpoints                 │    │  - state     │
│  - Subs      │    │  • Health checks                  │    │  - config    │
│              │    │  • Config management              │    │  - tokens    │
└──────────────┘    └──────────┬────────────────────────┘    └──────┬───────┘
                               │                                    │
                               ▼                                    │
                    ┌───────────────────────────────────┐           │
                    │        Message Queue              │           │
                    │       (NATS JetStream)            │           │
                    │                                   │           │
                    │  Subjects:                        │           │
                    │  • youtube.likes                  │           │
                    │  • youtube.subscriptions          │           │
                    │  • youtube.watch                  │           │
                    │  • download.request               │           │
                    │  • download.complete              │           │
                    └───┬──────────────┬────────────────┘           │
                        │              │                            │
              ┌─────────▼────┐  ┌──────▼───────────────┐            │
              │  YouTube     │  │   Downloader         │            │
              │  Poller      │  │   Service            │            │
              │  (Elixir)    │  │   (Rust)             │            │
              │              │  │                      │            │
              │ • Poll likes │  │ • yt-dlp wrapper     │            │
              │ • Poll subs  │  │ • Download mgmt      │            │
              │ • Scrape     │  │ • File lifecycle     │            │
              │   watch      │  │ • Format selection   │            │
              │   history    │  │                      │            │
              │   (yt-dlp    │  └──────┬───────────────┘            │
              │    +cookies) │         │                            │
              │ • Diff state │         ▼                            │
              │ • Emit events│  ┌─────────────────────────────────┐ │
              └──────────────┘  │   Telegram Client               │ │
                                │      (Python + Telethon)        │◄┘
                                │                                 │
                                │ • MTProto uploads (up to 2 GB)  │
                                │ • Inline video player           │
                                │ • 3 separate channels:          │
                                │    Watch History channel        │
                                │    Likes channel (+ videos)     │
                                │    Subscriptions channel        │
                                │ • Bot commands via Telethon     │
                                └─────────────────────────────────┘
```

### Why This Architecture?

1. **Fully autonomous** — no browser extension, no manual steps. The Elixir poller scrapes watch history via yt-dlp cookies AND polls YouTube API for likes/subs. Everything server-side.
2. **Decoupled services** communicate via message queue — any service can crash and recover independently
3. **Each service is small** — 200-500 lines of code, perfect for learning a new language
4. **The heaviest I/O** (downloading + uploading) is isolated in its own service
5. **Polling logic** is separated from notification logic — easier to test and tune
6. **MTProto via Telethon** — full 2 GB uploads with inline video player, no quality compromises
7. **Separate Telegram channels** — clean separation of concerns, easy to mute/unmute per event type

---

## 4. Service Breakdown & Language Choices

### Service Map

| Service | Language | Why This Language | Complexity | Est. Lines |
|---|---|---|---|---|
| **API Gateway** | **Go** | Perfect first Go project: HTTP server, JSON handling, middleware. Go's stdlib `net/http` is excellent. Teaches concurrency patterns, error handling, and strict typing. | Medium | 400-600 |
| **YouTube Poller** | **Elixir** | Ideal for Elixir learning: GenServer for periodic polling, Supervisor trees for fault tolerance, pattern matching for diffing state. Showcases OTP's "let it crash" philosophy. Also handles watch history by shelling out to yt-dlp. | Medium-High | 400-600 |
| **Downloader Service** | **Rust** | A great Rust learning vehicle: file I/O, process management (spawning yt-dlp), error handling with Result types, memory-safe temp file management. Not too algorithmic, focuses on systems concepts. | Medium-High | 400-700 |
| **Telegram Client** | **Python** | Uses **Telethon** (MTProto) for all Telegram interactions. Python has the best Telegram MTProto libraries. Handles message formatting, 2 GB video uploads with inline player, sending to 3 separate channels, and bot commands. | Medium | 400-600 |

### Why Not Use One Language?

You explicitly want to learn Go, Rust, and Elixir. A polyglot microservice architecture is the *natural* way to do this because:

1. **Each service is self-contained** — you can mess up Go idioms without affecting the Rust service
2. **Docker equalises everything** — the container boundary hides implementation language
3. **Natural language-task fit** — Go for HTTP APIs, Elixir for concurrent polling, Rust for system-level work, Python for Telegram MTProto integration
4. **Incremental learning** — start with the Python service (familiar territory), then Go, then Elixir, then Rust

---

## 5. Data Flow Diagrams

### 5.1 Watch History Flow (yt-dlp + Cookies — No Browser Extension)

```
YouTube (user watches videos normally in any browser/device)
    │
    │  Watch history accumulates on youtube.com/feed/history
    │
    ▼
YouTube Poller (Elixir)
    │  Every 5-10 min: shell out to yt-dlp
    │  Command: yt-dlp --flat-playlist -j --cookies /config/cookies.txt
    │           "https://www.youtube.com/feed/history" --playlist-end 30
    │
    │  Parse JSON output (one object per line)
    │  Compare video IDs against known_watch_history table
    │  Detect new watches (IDs not seen before)
    │
    │  For each new watch:
    │    ├── Store in PostgreSQL (known_watch_history + events)
    │    └── Publish to queue: youtube.watch
    │
    ▼
Telegram Client (Python + Telethon)
    │  Subscribe to youtube.watch
    │  Format message: "🎬 Watched: {title} by {channel}\n{url}"
    │  Send to Watch History Telegram channel (MTProto)
    ▼
📺 Watch History Channel ✅
```

### 5.2 Liked Video Flow (with Download + Telethon Upload)

```
YouTube (user clicks Like)
    │
    │  (No webhook — we poll)
    │
    ▼
YouTube Poller (Elixir)
    │  Every 2-5 min: GET /videos?myRating=like&maxResults=10
    │  Compare against known_likes table
    │  Detect new likes
    │  For each new like:
    │    ├── Store in PostgreSQL (known_likes + events)
    │    ├── Publish to queue: youtube.likes (for notification)
    │    └── Publish to queue: download.request (for download)
    │
    ├──────────────────────┐
    ▼                      ▼
Telegram Client       Downloader Service (Rust)
(Python + Telethon)     │  Receive download.request
    │                   │  Run yt-dlp with format selection
    │                   │  Download to /tmp/ytdl/{videoId}.mp4
    │  Send like         │  (up to 2 GB — no need to compromise quality)
    │  notification      │  Publish: download.complete
    │  to Likes channel  │    {videoId, filePath, fileSize, metadata}
    │                    │
    ▼                    ▼
❤️ Likes Channel    Telegram Client (Python + Telethon)
(text msg) ✅        │  Receive download.complete
                      │  Upload via Telethon MTProto:
                      │    client.send_file(likes_channel, file,
                      │      supports_streaming=True)
                      │  Full inline video player up to 2 GB!
                      │  Delete local file after upload
                      ▼
                   ❤️ Likes Channel (video) ✅
```

### 5.3 Subscription Flow

```
YouTube (user subscribes to channel)
    │
    │  (No webhook — we poll)
    │
    ▼
YouTube Poller (Elixir)
    │  Every 10-15 min: GET /subscriptions?mine=true&maxResults=50
    │  Compare against known_subscriptions table
    │  Detect new subscriptions (and unsubscriptions)
    │
    │  Publish to queue: youtube.subscriptions
    ▼
Telegram Client (Python + Telethon)
    │  Format message: "📺 Subscribed to: {channelTitle}\n{channelUrl}"
    │  Include channel thumbnail, subscriber count, description snippet
    │  Send to Subscriptions Telegram channel (MTProto)
    │
    ▼
🔔 Subscriptions Channel ✅
```

---

## 6. API & Integration Deep Dive

### 6.1 YouTube Data API v3 — Exact Calls We'll Make

#### Liked Videos Polling

```
GET https://www.googleapis.com/youtube/v3/videos
  ?myRating=like
  &part=snippet,contentDetails,statistics
  &maxResults=10
  &order=date           # Not all orderings available, but results come newest-first
  &access_token={token}
```

Response gives us: `videoId`, `title`, `channelTitle`, `publishedAt`, `thumbnails`, `duration`, `viewCount`, `likeCount`.

**Strategy**: Store the IDs of known likes. On each poll, if we see IDs not in our stored set → new likes. We only need to check the first page (10 results) because we poll frequently enough that we'll catch new likes before they scroll past page 1.

#### Subscriptions Polling

```
GET https://www.googleapis.com/youtube/v3/subscriptions
  ?mine=true
  &part=snippet
  &maxResults=50
  &order=relevance      # "alphabetical" or "relevance" or "unread"
  &access_token={token}
```

Response gives us: `channelId`, `title`, `description`, `thumbnails`, `publishedAt` (subscription date).

**Strategy**: Store all known subscription channel IDs. On each poll, diff against stored set. New IDs → new subscriptions. Also detect unsubscriptions (IDs that disappeared).

**NOTE**: Subscriptions can be paginated. For first sync, we'll need to paginate through ALL pages. After initial sync, we only check for diffs regularly.

#### OAuth 2.0 Token Management

We need **offline access** (refresh token) because the app runs continuously without user interaction:

```
Scope: https://www.googleapis.com/auth/youtube.readonly
Grant type: authorization_code (initial) → refresh_token (ongoing)
Token refresh: Before each API call, check if access_token is expired
```

**Initial Auth Flow**: One-time browser-based OAuth consent → store refresh token in DB → auto-refresh forever.

### 6.2 yt-dlp — Download Configuration (Updated for 2 GB Limit)

Since we're using Telethon MTProto (2 GB upload limit), we can download at **much higher quality** than the original 50 MB Bot API limit allowed:

```bash
yt-dlp \
  --format "bv*+ba/b" \
  --merge-output-format mp4 \
  --output "/tmp/ytdl/%(id)s.%(ext)s" \
  --no-playlist \
  --no-part \
  --embed-thumbnail \
  --embed-metadata \
  --sponsorblock-remove all \
  --cookies /config/cookies.txt \
  --limit-rate 10M \
  --sleep-interval 3 \
  --max-sleep-interval 10 \
  --no-overwrites \
  --max-filesize 2G \
  "https://www.youtube.com/watch?v={videoId}"
```

**Format selection logic**:
1. Best video+audio combo — since we can upload up to 2 GB, no need for quality compromises
2. `--max-filesize 2G` — safety net to skip exceptionally large files
3. Always merge to MP4 (best Telegram compatibility + streaming support)
4. Embed thumbnail and metadata for nice Telegram preview
5. Strip sponsor segments

**Rust wrapper approach**: The Rust downloader service will spawn yt-dlp as a subprocess, parse its JSON output (`-j` flag for metadata, `--print after_move:filepath` for final path), and manage the file lifecycle.

### 6.3 yt-dlp — Watch History Scraping

The Elixir YouTube Poller shells out to yt-dlp for watch history:

```bash
yt-dlp --flat-playlist -j \
  --cookies /config/cookies.txt \
  --playlist-end 30 \
  "https://www.youtube.com/feed/history"
```

**Output format** — one JSON line per video:
```json
{"id": "dQw4w9WgXcQ", "title": "Rick Astley - Never Gonna Give You Up", "channel": "Rick Astley", "channel_id": "UCuAXFkgsw1L7xaCfnd5JJOw", "duration": 212, "view_count": 1500000000, "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", ...}
```

**Elixir integration**: Use `System.cmd("yt-dlp", [...args])` or `Port.open({:spawn_executable, ...})` to run yt-dlp and capture stdout. Parse each line as JSON using `Jason.decode!/1`.

### 6.4 Telethon MTProto — Message Design

All messages are sent via **Telethon** (MTProto) to dedicated channels:

#### Watch History Notification → 📺 Watch History Channel
```
🎬 Watched

Title: How to Build a Compiler
Channel: Tsoding Daily
Duration: 45:23
Views: 125K

🔗 https://youtube.com/watch?v=abc123
```

#### Like Notification → ❤️ Likes Channel
```
❤️ Liked

Title: The Art of Code
Channel: Dylan Beattié
Duration: 1:00:49
Views: 2.1M

⬇️ Downloading for Telegram...
```

Then, once downloaded — sent to the SAME ❤️ Likes Channel:
```
[Video file uploaded via MTProto — full inline player, up to 2 GB]
Caption: ❤️ The Art of Code — Dylan Beattié (1:00:49)
```

#### New Subscription Notification → 🔔 Subscriptions Channel
```
📺 New Subscription

Channel: Fireship
Subscribers: 3.2M
Videos: 850

🔗 https://youtube.com/c/Fireship
```

#### Unsubscription Notification → 🔔 Subscriptions Channel
```
👋 Unsubscribed

Channel: SomeChannel
(was subscribed since 2024-01-15)
```

---

## 7. Database Design

### PostgreSQL Schema

```sql
-- Core event log — immutable, append-only
CREATE TABLE events (
    id              BIGSERIAL PRIMARY KEY,
    event_type      VARCHAR(50) NOT NULL,  -- 'watch', 'like', 'unlike', 'subscribe', 'unsubscribe'
    video_id        VARCHAR(20),
    channel_id      VARCHAR(30),
    title           TEXT,
    channel_title   TEXT,
    thumbnail_url   TEXT,
    duration_seconds INTEGER,
    metadata        JSONB,                 -- Flexible field for extra data
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_type_created ON events(event_type, created_at DESC);
CREATE INDEX idx_events_video_id ON events(video_id);

-- Known state tracking — for diffing

-- Watch history state (scraped via yt-dlp)
CREATE TABLE known_watch_history (
    video_id        VARCHAR(20) PRIMARY KEY,
    title           TEXT,
    channel_title   TEXT,
    channel_id      VARCHAR(30),
    duration_seconds INTEGER,
    watched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- When we first detected it
);

CREATE INDEX idx_watch_history_watched ON known_watch_history(watched_at DESC);

-- Liked videos state (polled via YouTube Data API)
CREATE TABLE known_likes (
    video_id        VARCHAR(20) PRIMARY KEY,
    title           TEXT,
    channel_title   TEXT,
    liked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    download_status VARCHAR(20) DEFAULT 'pending'  -- 'pending', 'downloading', 'uploaded', 'failed', 'skipped'
);

-- Subscriptions state (polled via YouTube Data API)
CREATE TABLE known_subscriptions (
    channel_id      VARCHAR(30) PRIMARY KEY,
    channel_title   TEXT,
    subscribed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Download tracking
CREATE TABLE downloads (
    id              BIGSERIAL PRIMARY KEY,
    video_id        VARCHAR(20) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'queued',  -- 'queued', 'downloading', 'uploading', 'completed', 'failed'
    file_size       BIGINT,
    file_path       TEXT,
    telegram_msg_id BIGINT,
    telegram_chat_id BIGINT,              -- Which Telegram channel it was sent to
    error_message   TEXT,
    attempts        INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_downloads_status ON downloads(status);
CREATE INDEX idx_downloads_video_id ON downloads(video_id);

-- OAuth tokens
CREATE TABLE oauth_tokens (
    id              SERIAL PRIMARY KEY,
    provider        VARCHAR(20) NOT NULL,  -- 'google'
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    scopes          TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- App configuration
CREATE TABLE config (
    key             VARCHAR(100) PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Why PostgreSQL?

- **JSONB** for flexible metadata storage
- **Robust indexing** for efficient polling state diffs
- Excellent Docker support with persistent volumes
- You already know it (or should — it's the industry standard)
- Single dependency vs. adding Redis + SQLite + file state

---

## 8. Message Queue & Inter-Service Communication

### Option Analysis

| Queue | Pros | Cons | Fit |
|---|---|---|---|
| **Redis Streams** | Simple, you probably know Redis, pub/sub + persistence | Not a true message queue, limited consumer groups | Good enough |
| **NATS** | Tiny footprint, Go-native, JetStream for persistence, first-class client in Go/Rust/Elixir/Python | New thing to learn | **Best fit** |
| **RabbitMQ** | Industry standard, full AMQP | Heavy, overkill | Overkill |
| **Kafka** | Massive scale | Way overkill, complex | No |

### Recommendation: **NATS with JetStream**

- ~10 MB Docker image
- Persistent message streams with at-least-once delivery
- Native clients for all four languages (Go, Elixir, Rust, Python)
- Built-in reconnection and health checks
- Simple enough that it's not a distraction from learning the languages

### Message Schemas (JSON)

```jsonc
// youtube.watch (emitted by Elixir poller after scraping watch history via yt-dlp)
{
  "event": "watch",
  "video_id": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up",
  "channel_id": "UCuAXFkgsw1L7xaCfnd5JJOw",
  "channel_title": "Rick Astley",
  "duration_seconds": 212,
  "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  "url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
  "timestamp": "2026-02-10T15:04:05Z"
}

// youtube.likes (emitted by Elixir poller after polling YouTube Data API)
{
  "event": "like",
  "video_id": "abc123",
  "title": "...",
  "channel_title": "...",
  "duration_seconds": 3649,
  "should_download": true,
  "timestamp": "2026-02-10T15:04:05Z"
}

// download.request (emitted by Elixir poller for each new liked video)
{
  "video_id": "abc123",
  "url": "https://youtube.com/watch?v=abc123",
  "requested_at": "2026-02-10T15:04:05Z",
  "max_file_size_mb": 2000,
  "format_preference": "mp4"
}

// download.complete (emitted by Rust downloader)
{
  "video_id": "abc123",
  "status": "success",            // or "failed"
  "file_path": "/tmp/ytdl/abc123.mp4",
  "file_size_bytes": 420000000,
  "title": "...",
  "duration_seconds": 3649,
  "error": null
}
```

---

## 9. Telegram Client Design

### Architecture: Telethon MTProto Client

Unlike the Bot API approach, the Telegram Client service uses **Telethon** to connect as a **user account** via MTProto. This gives us:

- **2 GB video uploads** with full inline video player (4 GB for Telegram Premium)
- **No quality compromises** — download at best quality, upload the full file
- **Direct channel posting** — send to any channel/group the user is a member of
- **No bot intermediary** — the user account posts directly

### Three Separate Telegram Channels

Each event type gets its own dedicated Telegram channel or group. This keeps notifications organised and allows you to mute individual event types.

| Channel | Purpose | Content |
|---|---|---|
| **📺 Watch History** | Videos you watched | Text notifications with video title, channel, URL |
| **❤️ Likes** | Videos you liked + downloaded files | Text notification + full video file upload (inline player) |
| **🔔 Subscriptions** | Channels you subscribed to / unsubscribed from | Text notifications with channel info |

### Commands (via Telethon Event Handlers)

Commands are handled by listening for messages in a **control channel** or **DM to yourself**:

| Command | Description | Example |
|---|---|---|
| `/status` | Show system health: last poll time, queue depth, disk usage | `/status` |
| `/download <url>` | Manually request a video download | `/download https://youtube.com/watch?v=abc` |
| `/history [n]` | Show last N watched videos | `/history 5` |
| `/likes [n]` | Show last N liked videos | `/likes 10` |
| `/pause` | Pause all activity tracking | `/pause` |
| `/resume` | Resume tracking | `/resume` |
| `/config` | Show current configuration | `/config` |
| `/stats` | Daily/weekly stats: videos watched, liked, downloaded | `/stats` |

### Configuration Required

```bash
# Telegram MTProto (Telethon)
TELEGRAM_API_ID=12345678                              # From https://my.telegram.org
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef    # From https://my.telegram.org
TELEGRAM_SESSION_STRING=...                           # Generated after first auth (or mount .session file)

# Separate channel/group IDs for each event type
TELEGRAM_CHAT_ID_LIKES=-1001234567890                 # Channel for liked videos + downloads
TELEGRAM_CHAT_ID_SUBSCRIPTIONS=-1001234567891         # Channel for subscription events
TELEGRAM_CHAT_ID_WATCH_HISTORY=-1001234567892         # Channel for watch history events

# Optional: admin user ID for command auth
TELEGRAM_ADMIN_USER_ID=123456789                      # Your Telegram user ID
```

### First-Time Telethon Auth Flow

1. Run the Telegram Client service for the first time
2. Telethon prompts for your **phone number** (in the container logs)
3. Enter the **verification code** sent to your Telegram app
4. Telethon creates a session file (`yagami_session.session`)
5. **Mount this session file** in Docker so it persists across container restarts
6. Never need to re-auth unless the session is revoked

Alternatively, generate a **session string** (base64-encoded session) that can be stored as an environment variable — no file mounting needed:

```python
from telethon.sessions import StringSession
from telethon import TelegramClient

with TelegramClient(StringSession(), api_id, api_hash) as client:
    print(client.session.save())  # Prints session string to use as env var
```

---

## 10. Docker & Infrastructure

### Docker Compose Architecture

```yaml
services:
  # --- Infrastructure ---
  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql
    environment:
      POSTGRES_DB: yagami
      POSTGRES_USER: yagami
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U yagami"]
      interval: 5s
    restart: unless-stopped

  nats:
    image: nats:2-alpine
    command: ["--jetstream", "--store_dir", "/data"]
    volumes:
      - natsdata:/data
    ports:
      - "4222:4222"    # Client
      - "8222:8222"    # Monitoring
    restart: unless-stopped

  # --- Application Services ---
  api-gateway:
    build:
      context: ./services/api-gateway
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://yagami:${DB_PASSWORD}@postgres:5432/yagami
      NATS_URL: nats://nats:4222
    depends_on:
      postgres:
        condition: service_healthy
      nats:
        condition: service_started
    restart: unless-stopped

  youtube-poller:
    build:
      context: ./services/youtube-poller
      dockerfile: Dockerfile
    volumes:
      - ./config/cookies.txt:/config/cookies.txt:ro    # Shared cookies for yt-dlp watch history scraping
    environment:
      DATABASE_URL: postgres://yagami:${DB_PASSWORD}@postgres:5432/yagami
      NATS_URL: nats://nats:4222
      YOUTUBE_POLL_INTERVAL_LIKES: "120"       # seconds
      YOUTUBE_POLL_INTERVAL_SUBS: "600"        # seconds
      YOUTUBE_POLL_INTERVAL_HISTORY: "300"     # seconds (watch history via yt-dlp)
      YOUTUBE_HISTORY_MAX_RESULTS: "30"        # Number of history items to scrape per poll
    depends_on:
      postgres:
        condition: service_healthy
      nats:
        condition: service_started
    restart: unless-stopped

  downloader:
    build:
      context: ./services/downloader
      dockerfile: Dockerfile
    volumes:
      - downloads:/tmp/ytdl
      - ./config/cookies.txt:/config/cookies.txt:ro
    environment:
      NATS_URL: nats://nats:4222
      DATABASE_URL: postgres://yagami:${DB_PASSWORD}@postgres:5432/yagami
      DOWNLOAD_DIR: /tmp/ytdl
      MAX_CONCURRENT_DOWNLOADS: "2"
      MAX_FILE_SIZE_MB: "2000"                 # 2 GB — Telethon MTProto limit
    depends_on:
      nats:
        condition: service_started
    restart: unless-stopped

  telegram-client:
    build:
      context: ./services/telegram-client
      dockerfile: Dockerfile
    volumes:
      - downloads:/tmp/ytdl:ro
      - telegram_session:/app/session          # Persist Telethon session across restarts
    environment:
      NATS_URL: nats://nats:4222
      DATABASE_URL: postgres://yagami:${DB_PASSWORD}@postgres:5432/yagami
      TELEGRAM_API_ID: ${TELEGRAM_API_ID}
      TELEGRAM_API_HASH: ${TELEGRAM_API_HASH}
      TELEGRAM_SESSION_STRING: ${TELEGRAM_SESSION_STRING}        # Or use session file volume
      TELEGRAM_CHAT_ID_LIKES: ${TELEGRAM_CHAT_ID_LIKES}
      TELEGRAM_CHAT_ID_SUBSCRIPTIONS: ${TELEGRAM_CHAT_ID_SUBSCRIPTIONS}
      TELEGRAM_CHAT_ID_WATCH_HISTORY: ${TELEGRAM_CHAT_ID_WATCH_HISTORY}
      TELEGRAM_ADMIN_USER_ID: ${TELEGRAM_ADMIN_USER_ID}
    depends_on:
      nats:
        condition: service_started
    restart: unless-stopped

volumes:
  pgdata:
  natsdata:
  telegram_session:                            # Persists Telethon .session file
  downloads:
    driver: local
    driver_opts:
      type: tmpfs
      device: tmpfs
      o: size=10g    # 10GB tmpfs — larger since we download at full quality now
```

### Key Docker Decisions

1. **tmpfs for downloads** — Videos are temporary. Using tmpfs (in-memory filesystem) means fast I/O and automatic cleanup on restart. The 10 GB limit accommodates higher quality downloads (now that Telethon supports 2 GB uploads).

2. **Shared volume between downloader and telegram-client** — The downloader writes files; the Telegram client reads and uploads them. Both mount the same `downloads` volume.

3. **Shared cookies file** — The same `cookies.txt` is mounted read-only in both the YouTube Poller (for watch history scraping) and the Downloader (for authenticated downloads). One file, two consumers.

4. **Telethon session persistence** — The `telegram_session` volume ensures the Telethon auth session survives container restarts. No need to re-authenticate.

5. **Health checks** — PostgreSQL has a health check; services wait for it before starting.

6. **Configuration via `.env`** — All secrets in a `.env` file, not committed to git.

### Individual Dockerfiles

#### Go (API Gateway)
```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /api-gateway ./cmd/server

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /api-gateway /api-gateway
EXPOSE 8080
ENTRYPOINT ["/api-gateway"]
```

#### Elixir (YouTube Poller) — now includes yt-dlp for watch history
```dockerfile
FROM elixir:1.16-alpine AS builder
ENV MIX_ENV=prod
WORKDIR /app
COPY mix.exs mix.lock ./
RUN mix deps.get --only prod && mix deps.compile
COPY . .
RUN mix release

FROM alpine:3.19
RUN apk add --no-cache libstdc++ openssl ncurses-libs python3 py3-pip ffmpeg
RUN pip3 install --break-system-packages yt-dlp
COPY --from=builder /app/_build/prod/rel/youtube_poller /app
ENTRYPOINT ["/app/bin/youtube_poller", "start"]
```

> **Note**: The Elixir poller image now includes yt-dlp (Python + ffmpeg) because it shells out to yt-dlp for watch history scraping. This makes the image larger (~150 MB) but keeps the architecture clean — all YouTube data gathering lives in one service.

#### Rust (Downloader)
```dockerfile
FROM rust:1.77-alpine AS builder
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN cargo build --release

FROM alpine:3.19
RUN apk add --no-cache python3 py3-pip ffmpeg
RUN pip3 install --break-system-packages yt-dlp
COPY --from=builder /app/target/release/downloader /downloader
ENTRYPOINT ["/downloader"]
```

#### Python (Telegram Client — Telethon)
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENTRYPOINT ["python", "-m", "telegram_client"]
```

---

## 11. Security Considerations

### Secrets Management

| Secret | Storage | Notes |
|---|---|---|
| Google OAuth refresh token | PostgreSQL (encrypted at rest) | Never log this. Rotate if compromised. |
| YouTube API key | `.env` file | For unauthenticated calls only |
| Telegram API ID + Hash | `.env` file | From https://my.telegram.org. Tied to your phone number. |
| Telegram session string | `.env` file or persistent volume | Generated after first auth. Treat like a password — it IS your Telegram session. |
| Database password | `.env` file | Use a strong random password |
| YouTube cookies file | Mounted volume (read-only) | Needed by yt-dlp for downloads AND watch history scraping. Sensitive — treat like a password. Shared between poller and downloader containers. |

### Network Security

- **No service exposes ports to the host except the API Gateway** (port 8080) — and even that can be localhost-only
- **Inter-service communication** happens entirely within the Docker network
- **NATS has no auth by default** — acceptable since it's only accessible within Docker network
- **Telethon session** — if someone obtains your session string, they can access your Telegram account. Keep it secure.

### Cookie Management

The YouTube cookies file is shared between two services and is one of the most sensitive assets:
- **Mount as read-only** in Docker (both youtube-poller and downloader containers)
- **Never commit to git** — add to `.gitignore`
- **Refresh periodically** — export from browser every few weeks (or when auth fails)
- The Elixir poller should detect cookie expiration (yt-dlp returns auth errors) and send an alert to Telegram

### Telegram Session Security

- The Telethon `.session` file (or session string) is equivalent to being logged into your Telegram account
- **Never share it, never commit it to git**
- If compromised, revoke all sessions in Telegram → Settings → Devices → Terminate All Other Sessions
- Consider using a **dedicated Telegram account** for this application (not your personal one)

---

## 12. Error Handling & Resilience

### Failure Scenarios

| Scenario | Impact | Mitigation |
|---|---|---|
| YouTube API quota exceeded | Polling stops for the day | Exponential backoff + alert via Telegram. Resume next day automatically. |
| OAuth token expired + refresh fails | All YouTube API calls fail | Alert via Telegram. Provide re-auth flow via bot command. |
| yt-dlp download fails | Video not delivered | Retry 3 times with exponential backoff. Mark as failed. Alert user. |
| Telegram API down | Messages queued, not delivered | NATS persists messages. Retry with backoff once Telegram is back. |
| PostgreSQL down | All services degrade | Docker restart policy. NATS buffers messages. Services reconnect. |
| NATS down | Inter-service communication stops | Services buffer locally (in-memory). Docker restart. |
| Video larger than 2 GB | Can't upload via Telethon | Alert user with direct YouTube link. Skip upload. Optionally re-download at lower quality. |
| Service OOM | Service crashes | Docker `restart: unless-stopped`. Memory limits in compose. |
| YouTube cookies expired | Watch history scraping fails, yt-dlp downloads may fail | Detect auth errors from yt-dlp output, alert user via Telegram with instructions to re-export cookies |
| Telethon session revoked | All Telegram operations fail | Alert via structured logs. Re-run first-time auth flow. |

### Retry Strategy

```
Base: 5 seconds
Max: 5 minutes
Multiplier: 2x
Jitter: ±20%

Attempt 1: 5s
Attempt 2: 10s
Attempt 3: 20s
Attempt 4: 40s
Attempt 5: 80s (give up after 5 attempts for downloads)
```

### Observability

- **Structured logging** (JSON) from every service → `docker compose logs -f`
- **NATS monitoring** dashboard on port 8222
- **Health endpoint** on API Gateway: `GET /health` returns service statuses
- **Telegram as alerting channel** — the bot sends errors to you directly

---

## 13. Testing Strategy

### Unit Testing (per service, in native language)

| Service | Test Framework | What to Test |
|---|---|---|
| API Gateway (Go) | `testing` + `httptest` | Request validation, health endpoint, middleware |
| YouTube Poller (Elixir) | `ExUnit` | State diffing, YouTube API response parsing, yt-dlp output parsing, GenServer callbacks |
| Downloader (Rust) | `cargo test` | Format selection logic, file lifecycle, error handling, yt-dlp output parsing |
| Telegram Client (Python) | `pytest` | Message formatting, channel routing (which event → which channel), upload logic |

### Integration Testing

- **Docker Compose test profile** with mocked YouTube API (a simple HTTP server returning canned responses)
- **NATS message flow tests** — publish on one end, assert receipt on the other
- **yt-dlp mock** — mock the yt-dlp binary to return canned watch history JSON for Elixir poller tests
- **End-to-end**: Simulate a "new like" → assert Telegram message was sent (using test channels)

### Manual Testing Checklist

- [ ] Fresh setup with `docker compose up` works from zero state
- [ ] OAuth flow completes and token is stored
- [ ] Telethon first-time auth flow completes and session is persisted
- [ ] Watch history scraping works (yt-dlp + cookies returns video list)
- [ ] New watched video detected → notification appears in Watch History channel
- [ ] Like a video → notification appears in Likes channel within 5 minutes
- [ ] Liked video is downloaded and uploaded to Likes channel (full inline player)
- [ ] Video file is deleted after upload
- [ ] Subscribe to a channel → notification appears in Subscriptions channel within 15 minutes
- [ ] Unsubscribe from a channel → notification appears in Subscriptions channel
- [ ] `/download <url>` command works
- [ ] `/status` shows correct system state
- [ ] Service restart doesn't lose pending events (NATS persistence)
- [ ] Telethon session persists across container restarts (no re-auth)
- [ ] Graceful handling of >2 GB videos (skip upload, send link)
- [ ] Cookie expiration detected and alert sent

---

## 14. Development Phases & Milestones

### Phase 0: Foundation (Week 1)
**Goal**: Infrastructure that all services depend on.

- [ ] Set up monorepo structure
- [ ] Docker Compose with PostgreSQL + NATS
- [ ] Database schema migration (`init.sql`)
- [ ] `.env.example` with all required variables
- [ ] Google Cloud project + YouTube Data API enabled
- [ ] Telegram API credentials from https://my.telegram.org
- [ ] Create 3 Telegram channels/groups (Likes, Subscriptions, Watch History)
- [ ] Export YouTube cookies to `config/cookies.txt`
- [ ] NATS stream/subject configuration

### Phase 1: Telegram Client — Python + Telethon (Weeks 2-3)
**Goal**: Get messages flowing to Telegram. Start with the familiar.

- [ ] Python service scaffold with dependencies (`telethon`, `nats-py`, `asyncpg`)
- [ ] Telethon first-time auth flow (generate session string)
- [ ] Connect to all 3 Telegram channels, send test messages
- [ ] NATS subscription for all event subjects
- [ ] Message formatting for each event type
- [ ] Route events to correct channel (likes → likes channel, etc.)
- [ ] File upload logic via Telethon MTProto (`send_file` with `supports_streaming=True`)
- [ ] Command handlers via Telethon event listeners (`/status`, `/download`, `/help`)
- [ ] Dockerfile + integration into compose

### Phase 2: API Gateway — Go (Weeks 3-4)
**Goal**: Learn Go by building an HTTP API. First Go project!

- [ ] Go project setup (modules, structure)
- [ ] HTTP server with router (chi or stdlib)
- [ ] GET `/health` endpoint (reports all service statuses)
- [ ] GET `/api/events` — query events from DB
- [ ] GET `/api/stats` — activity statistics
- [ ] PostgreSQL connection (pgx library)
- [ ] NATS publisher (for manual download requests)
- [ ] Configuration management
- [ ] Dockerfile + integration into compose

### Phase 3: YouTube Poller — Elixir (Weeks 5-7)
**Goal**: Learn Elixir/OTP. The most educational and central service.

- [ ] Elixir project with Mix
- [ ] OAuth 2.0 token management (refresh flow)
- [ ] GenServer for polling liked videos (YouTube Data API)
- [ ] GenServer for polling subscriptions (YouTube Data API)
- [ ] GenServer for polling watch history (yt-dlp shell out)
- [ ] yt-dlp output parsing (JSON per line)
- [ ] State diffing with pattern matching (all 3 event types)
- [ ] Supervisor tree for fault tolerance
- [ ] NATS publishing (youtube.likes, youtube.subscriptions, youtube.watch, download.request)
- [ ] PostgreSQL state persistence (Ecto)
- [ ] Cookie expiration detection + alert publishing
- [ ] Dockerfile (includes yt-dlp + ffmpeg) + integration into compose

### Phase 4: Downloader — Rust (Weeks 7-9)
**Goal**: Learn Rust by building a system-level service.

- [ ] Rust project with Cargo
- [ ] NATS subscription for download requests
- [ ] yt-dlp process spawning and management
- [ ] Download progress tracking
- [ ] File size checking (skip >2 GB, or re-download at lower quality)
- [ ] Temp file lifecycle management
- [ ] Concurrent download limiting (semaphore)
- [ ] NATS publishing of completion events
- [ ] Dockerfile + integration into compose

### Phase 5: Integration & Polish (Weeks 9-10)
**Goal**: Everything works together flawlessly.

- [ ] End-to-end testing
- [ ] Error handling audit across all services
- [ ] Logging standardisation (structured JSON logs)
- [ ] Performance tuning (poll intervals, download concurrency)
- [ ] README with full setup guide
- [ ] `docker compose up` → everything works from zero
- [ ] Stress test: like 10 videos rapidly, verify all downloaded + forwarded to correct channels
- [ ] Cookie expiration + Telethon session expiration handling verified

---

## 15. Learning Roadmap (Language-by-Service)

### Go (API Gateway) — Key Concepts You'll Learn

| Concept | Where in Service |
|---|---|
| **Goroutines & channels** | HTTP request handling (automatic), NATS publishing |
| **Error handling** (no exceptions, explicit `error` returns) | Every function |
| **Interfaces** | Database repository pattern, middleware |
| **Struct tags** (JSON marshaling) | Request/response types |
| **Context propagation** | Request timeouts, cancellation |
| **Package structure** | Organising a Go project (`cmd/`, `internal/`, `pkg/`) |
| **Dependency management** (Go modules) | `go.mod`, `go.sum` |

**Resources**: Effective Go, Go by Example, Let's Go (book by Alex Edwards)

### Elixir (YouTube Poller) — Key Concepts You'll Learn

| Concept | Where in Service |
|---|---|
| **GenServer** | Polling workers with internal state (3 workers: likes, subs, history) |
| **Supervisor trees** | Fault tolerance, "let it crash" |
| **Pattern matching** | Diffing API responses, parsing yt-dlp JSON output, handling different event types |
| **Immutable data** | State management in GenServer |
| **Pipe operator** (`\|>`) | Data transformation pipelines |
| **Ports / System.cmd** | Shelling out to yt-dlp for watch history scraping |
| **Mix & OTP releases** | Project setup, deployment |
| **Ecto** | Database interaction, changesets |
| **Processes & message passing** | Understanding the Actor model |

**Resources**: Elixir in Action (book), Programming Elixir (Dave Thomas), elixir-lang.org Getting Started

### Rust (Downloader) — Key Concepts You'll Learn

| Concept | Where in Service |
|---|---|
| **Ownership & borrowing** | File handles, string manipulation |
| **Result & Option types** | Error handling everywhere |
| **Async/await** (tokio) | NATS subscription, concurrent downloads |
| **Process spawning** (`std::process::Command`) | Running yt-dlp |
| **Serde** | JSON serialization/deserialization |
| **Lifetimes** (basic) | Struct definitions with references |
| **Cargo & crates.io** | Dependency management |
| **Traits** | Abstraction over download strategies |

**Resources**: The Rust Book, Rust by Example, rustlings exercises (do these BEFORE starting the service)

### Python (Telegram Client) — Familiar Territory + Telethon

You know JS/TS well, and Python is close enough. Key focuses:
- **Telethon** — asyncio MTProto library. Learn `TelegramClient`, `send_file()`, event handlers, session management
- **nats-py** — NATS client for Python (async)
- **asyncpg** — async PostgreSQL client
- **asyncio** patterns — this service is heavily async (Telethon is async-native)
- **Type hints** — for maintainability
- **Session management** — understanding StringSession vs file sessions for Telethon

---

## 16. Open Questions & Decisions

### Decisions to Make Before Coding

| # | Question | Options | Recommendation |
|---|---|---|---|
| 1 | **Watch history polling frequency?** | Every 2 min (aggressive) vs. every 10 min (safe) | Every 5 min — good balance between timeliness and not hammering YouTube |
| 2 | **Video quality for downloads?** | Best available vs. 1080p cap vs. 720p cap | Best available — no max file size limit. Videos >2 GB are split into parts by telegram-client using ffmpeg |
| 3 | **Download trigger**: All likes or opt-in? | Auto-download all likes vs. bot command per video | Auto-download all likes (with `/config` to toggle) |
| 4 | **Telethon auth**: Session string or session file? | Environment variable vs. mounted file | Session string (env var) — simpler Docker setup, no volume needed for session |
| 5 | **Cookies for yt-dlp**: Manual export or auto? | Manual cookie file vs. build cookie exporter | Manual for v1 — auto is complex and browser-dependent in Docker |
| 6 | **Do you want unsubscription tracking too?** | Track unsubs vs. only new subs | Track both — it's the same diff logic, almost free |
| 7 | **Should downloads be retried across restarts?** | Persist queue in DB vs. in-memory only | Persist in DB — resume pending downloads after restart |
| 8 | **Dedicated Telegram account?** | Use personal account vs. create a new one | Dedicated account recommended — isolates risk, can be set up specifically for this |

### Potential v2 Features (Post-MVP)

- **Web dashboard** (SvelteKit or Next.js) for viewing history + stats
- **Full-text search** across watched video history
- **Automatic cookie refresh** via browser automation (Playwright in Docker)
- **Watch time analytics** — how many hours/week on YouTube
- **Smart download filtering** — skip music videos, only download >10 min videos, etc.
- **Webhook support** via YouTube PubSubHubbub for tracking uploads from subscribed channels
- **Telegram forum topics** — if using a supergroup with forum mode, use topics instead of separate channels
- **Download quality selector** — per-video quality override via Telegram command
- **Scheduled digest** — daily/weekly summary of all activity sent as a single message

---

## Repository Structure

```
yagami/
├── docker-compose.yml
├── docker-compose.dev.yml        # Dev overrides (hot reload, debug ports)
├── .env.example
├── .gitignore
├── README.md
├── PROJECT_PLAN.md               # This document
│
├── db/
│   └── init.sql                  # PostgreSQL schema
│
├── config/
│   ├── cookies.txt.example       # Placeholder for YouTube cookies
│   └── nats.conf                 # NATS JetStream config
│
├── services/
│   ├── api-gateway/              # Go
│   │   ├── Dockerfile
│   │   ├── go.mod
│   │   ├── go.sum
│   │   ├── cmd/
│   │   │   └── server/
│   │   │       └── main.go
│   │   └── internal/
│   │       ├── handlers/         # HTTP handlers
│   │       ├── middleware/       # Logging, CORS
│   │       ├── models/          # Data types
│   │       ├── queue/           # NATS publisher
│   │       └── store/           # PostgreSQL repository
│   │
│   ├── youtube-poller/           # Elixir
│   │   ├── Dockerfile
│   │   ├── mix.exs
│   │   ├── config/
│   │   │   ├── config.exs
│   │   │   ├── dev.exs
│   │   │   └── prod.exs
│   │   └── lib/
│   │       ├── youtube_poller/
│   │       │   ├── application.ex      # OTP Application
│   │       │   ├── supervisor.ex       # Supervisor tree
│   │       │   ├── likes_worker.ex     # GenServer — polls likes via YouTube API
│   │       │   ├── subs_worker.ex      # GenServer — polls subs via YouTube API
│   │       │   ├── history_worker.ex   # GenServer — scrapes watch history via yt-dlp
│   │       │   ├── ytdlp.ex           # yt-dlp shell-out wrapper
│   │       │   ├── youtube_api.ex      # YouTube Data API client
│   │       │   ├── oauth.ex            # Token management
│   │       │   ├── state_store.ex      # PostgreSQL state access (Ecto)
│   │       │   └── nats_publisher.ex   # NATS integration
│   │       └── youtube_poller.ex
│   │
│   ├── downloader/               # Rust
│   │   ├── Dockerfile
│   │   ├── Cargo.toml
│   │   ├── Cargo.lock
│   │   └── src/
│   │       ├── main.rs
│   │       ├── config.rs          # Configuration management
│   │       ├── download.rs        # yt-dlp process management
│   │       ├── queue.rs           # NATS subscription/publishing
│   │       ├── models.rs          # Data types
│   │       └── lifecycle.rs       # File cleanup, temp management
│   │
│   └── telegram-client/          # Python + Telethon
│       ├── Dockerfile
│       ├── requirements.txt      # telethon, nats-py, asyncpg, etc.
│       ├── pyproject.toml
│       └── telegram_client/
│           ├── __init__.py
│           ├── __main__.py        # Entry point
│           ├── client.py          # Telethon client setup + session management
│           ├── handlers.py        # Event handlers (watch, like, sub → route to correct channel)
│           ├── uploader.py        # Video upload logic via MTProto
│           ├── commands.py        # Command handlers (/status, /download, etc.)
│           ├── formatter.py       # Message formatting
│           └── queue.py           # NATS subscription
│
└── scripts/
    ├── setup.sh                   # First-time setup wizard
    ├── export-cookies.sh          # Helper to export YouTube cookies
    ├── gen-session.py             # Generate Telethon session string
    └── oauth-setup.py             # One-time OAuth consent flow
```

---

## Post-v1 Changes (Implemented)

These features and fixes were added after the initial v1 build:

### Admin DM Downloads
The admin can send a YouTube link to the bot via DM. The bot downloads the
video and sends it back to the admin. This uses a `requester_chat_id` field
on the download request/result to route the video to the admin instead of the
likes channel.

### Video Splitting (>2 GB)
Videos larger than ~2 GB are automatically split into time-based parts using
`ffmpeg -c copy` (no re-encoding). Each part is uploaded as "Part 1/3" etc.
The `--max-filesize` limit was removed from the downloader so any video can
be downloaded.

### High-Quality Thumbnails
Thumbnails now use `maxres` (1280×720) with fallback to standard/high. Before
upload, they are resized using Pillow's LANCZOS resampling at JPEG quality 95
to produce sharp 320×320 thumbnails instead of blurry ones.

### Debug Messaging
All workers send admin-facing debug messages via NATS (`system.health`) for
events like seeding, errors, and suspicious subscription diffs. The
telegram-client forwards these to the admin's DM.

### Subscription False-Positive Fix
`fetch_all_pages` now returns `{:ok, items}` or `{:error, reason}` — never
partial data. A failed API page silently returning accumulated results was the
root cause of random subscribe/unsubscribe spam. A threshold check (>10
changes = suspicious) provides additional protection.

### Watch History Fix
Added `COOKIES_PATH` env var to docker-compose for the youtube-poller service.
It was defaulting to `/app/cookies.txt` instead of the mounted path
`/config/cookies.txt`, so watch history never worked.

---

## Summary

This is a **polyglot microservice system** with 4 services in 4 languages (Go, Elixir, Rust, Python), communicating over NATS JetStream, persisting to PostgreSQL, and fully containerised with Docker Compose.

**Key design decisions**:
- **No browser extension** — watch history is scraped server-side via yt-dlp with cookies
- **MTProto via Telethon** (not Bot API) — 2 GB video uploads with full inline video player
- **3 separate Telegram channels** — one each for likes, subscriptions, and watch history
- **Fully autonomous** — once `docker compose up` runs, everything operates without human intervention
- **Admin DM downloads** — send a YouTube link to the bot, get the video back
- **Video splitting** — files >2 GB are split into parts using ffmpeg (no re-encoding)
- **Debug messaging** — system issues are reported to the admin's DM, not just logs

**The hardest problems are already solved in this plan**:
- Watch history → yt-dlp scrapes `youtube.com/feed/history` with cookies (no browser extension needed)
- File size limit → Telethon MTProto gives us 2 GB uploads with inline video player (no more 50 MB Bot API limit)
- Real-time detection → polling with efficient diffing against DB state
- Fault tolerance → NATS persistence + Docker restart policies + Supervisor trees (Elixir)

**Total estimated effort**: 8-10 weeks for a working v1, assuming part-time (evenings/weekends) and accounting for language learning curves. The Rust service will take the longest due to the steepest learning curve; Python will be the fastest.

Build the services in this order: **Python → Go → Elixir → Rust** (familiar → unfamiliar).
