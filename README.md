# Yagami — YouTube Activity Monitor

Yagami watches your YouTube activity (likes, subscriptions, watch history) and forwards everything to Telegram channels in real-time. It also downloads liked videos via yt-dlp and uploads them to Telegram using MTProto for files up to 2GB. Videos larger than 2GB are automatically split into parts.

**Built with 4 languages to learn them all:**

| Service | Language | What it does |
|---------|----------|-------------|
| **API Gateway** | Go | REST API for querying events and stats |
| **YouTube Poller** | Elixir | Polls YouTube for new activity, publishes to NATS |
| **Downloader** | Rust | Downloads liked videos using yt-dlp |
| **Telegram Client** | Python | Sends notifications + uploads videos via MTProto |

## Features

- **Liked videos** — notified instantly, downloaded and uploaded to Telegram
- **Subscriptions** — new/lost subscriptions detected via API diffing
- **Watch history** — scraped via yt-dlp + cookies (not available via API)
- **Admin DM downloads** — send a YouTube link to the bot, it downloads and sends the video back
- **Large video splitting** — videos >2GB are split into parts using ffmpeg
- **High-quality thumbnails** — uses maxres YouTube thumbnails (1280×720)
- **Debug messages** — errors and status updates sent to admin via Telegram
- **Monospace formatting** — clean, minimal Telegram notifications

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  YouTube Poller  │────▶│      NATS        │────▶│ Telegram Client │
│    (Elixir)      │     │  Message Queue   │     │    (Python)     │
│                  │     │                  │     │   via MTProto   │
│  • Liked videos  │     │  Subjects:       │     │                 │
│  • Subscriptions │     │  youtube.likes   │     │  → Likes Channel│
│  • Watch history │     │  youtube.subs    │     │  → Subs Channel │
└──────┬───────────┘     │  youtube.watch   │     │  → History Chan │
       │                 │  download.req    │     └─────────────────┘
       │                 │  download.done   │              ▲
       ▼                 └──────┬───────────┘              │
┌──────────────┐                │                          │
│  PostgreSQL  │                ▼                          │
│              │         ┌──────────────┐                  │
│  • Events    │         │  Downloader  │──────────────────┘
│  • Known IDs │         │   (Rust)     │  download.complete
│  • OAuth     │         │   via yt-dlp │
└──────┬───────┘         └──────────────┘
       │
       ▼
┌──────────────┐
│ API Gateway  │  GET /api/events
│    (Go)      │  GET /api/stats
│  :8080       │  GET /health
└──────────────┘
```

## Prerequisites

- **Docker** and **Docker Compose**
- **Python 3.10+** (for setup scripts only)
- A **Google Cloud** project with YouTube Data API v3 enabled
- A **Telegram** account with API credentials from [my.telegram.org](https://my.telegram.org)

## Quick Start

### 1. Clone and configure

```bash
git clone <repo-url> && cd yagami
cp .env.example .env
```

Edit `.env` with your credentials:
```env
# Google OAuth (from console.cloud.google.com)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

# Telegram (from my.telegram.org)
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=your-api-hash

# Telegram channels (create 3 channels, get IDs via @userinfobot)
TELEGRAM_CHAT_ID_LIKES=-100xxxxxxxxxx
TELEGRAM_CHAT_ID_SUBS=-100xxxxxxxxxx
TELEGRAM_CHAT_ID_HISTORY=-100xxxxxxxxxx
```

### 2. Run setup scripts

```bash
# Start the database first
docker compose up -d postgres
sleep 3

# Set up Google OAuth (opens browser for consent)
pip3 install asyncpg
python3 scripts/oauth-setup.py

# Generate Telegram session string
pip3 install telethon
python3 scripts/gen-session.py
# Copy the output into .env as TELEGRAM_SESSION_STRING
```

### 3. Export YouTube cookies (for watch history)

Watch history isn't available via the API, so we use yt-dlp with cookies:

1. Install the "Get cookies.txt LOCALLY" browser extension
2. Go to youtube.com (logged in)
3. Export cookies → save as `config/cookies.txt`

### 4. Launch

```bash
docker compose up --build -d
```

Or use the interactive setup wizard:
```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### 5. Verify

```bash
# Check health
curl http://localhost:8080/health

# View logs
docker compose logs -f

# Check events
curl http://localhost:8080/api/events

# Check stats
curl http://localhost:8080/api/stats
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgres://yagami:yagami@postgres:5432/yagami` | PostgreSQL connection |
| `NATS_URL` | `nats://nats:4222` | NATS server |
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret |
| `TELEGRAM_API_ID` | — | Telegram API ID |
| `TELEGRAM_API_HASH` | — | Telegram API Hash |
| `TELEGRAM_SESSION_STRING` | — | Telethon session string |
| `TELEGRAM_CHAT_ID_LIKES` | — | Channel for liked videos |
| `TELEGRAM_CHAT_ID_SUBS` | — | Channel for subscriptions |
| `TELEGRAM_CHAT_ID_HISTORY` | — | Channel for watch history |
| `POLL_INTERVAL_LIKES` | `300` | Seconds between like polls |
| `POLL_INTERVAL_SUBS` | `3600` | Seconds between subscription polls |
| `POLL_INTERVAL_HISTORY` | `600` | Seconds between history scrapes |
| `MAX_CONCURRENT_DOWNLOADS` | `3` | Parallel yt-dlp downloads |

## API Endpoints

### `GET /health`
```json
{"status": "ok"}
```

### `GET /api/events?type=like&limit=20`
```json
[
  {
    "id": 1,
    "event_type": "like",
    "data": {"video_id": "dQw4w9WgXcQ", "title": "..."},
    "created_at": "2024-01-15T10:30:00Z"
  }
]
```

Query params: `type` (like/subscription/watch), `limit` (default 50)

### `GET /api/stats`
```json
{
  "total_events": 142,
  "likes": 89,
  "subscriptions": 15,
  "watches": 38
}
```

## Project Structure

```
yagami/
├── docker-compose.yml          # All services + infrastructure
├── .env.example                # Configuration template
├── db/init.sql                 # Database schema
├── config/cookies.txt          # YouTube cookies (gitignored)
├── scripts/
│   ├── setup.sh                # Interactive setup wizard
│   ├── gen-session.py          # Generate Telegram session
│   └── oauth-setup.py          # Google OAuth flow
├── services/
│   ├── api-gateway/            # Go — REST API
│   │   ├── cmd/server/main.go
│   │   ├── internal/
│   │   │   ├── handlers/       # HTTP handlers
│   │   │   └── store/          # Database queries
│   │   └── LEARNING.md
│   ├── youtube-poller/         # Elixir — YouTube monitoring
│   │   ├── lib/youtube_poller/
│   │   │   ├── application.ex  # OTP supervision tree
│   │   │   ├── likes_worker.ex # Polls liked videos
│   │   │   ├── subs_worker.ex  # Polls subscriptions
│   │   │   ├── history_worker.ex # Scrapes watch history
│   │   │   ├── youtube_api.ex  # YouTube API client
│   │   │   ├── ytdlp.ex        # yt-dlp wrapper
│   │   │   ├── oauth.ex        # Token management
│   │   │   ├── db.ex           # Database queries
│   │   │   └── nats_client.ex  # NATS publisher
│   │   └── LEARNING.md
│   ├── downloader/             # Rust — Video downloader
│   │   ├── src/
│   │   │   ├── main.rs         # NATS listener + task spawner
│   │   │   ├── config.rs       # Environment config
│   │   │   ├── download.rs     # yt-dlp subprocess
│   │   │   └── models.rs       # Request/Result types
│   │   └── LEARNING.md
│   └── telegram-client/        # Python — Telegram forwarder
│       ├── telegram_client/
│       │   ├── client.py       # Main loop (Telethon + NATS)
│       │   ├── handlers.py     # Event routing + video upload
│       │   ├── formatter.py    # Message formatting
│       │   └── config.py       # Environment config
│       └── LEARNING.md
└── PROJECT_PLAN.md             # Detailed design document
```

## Learning

Each service has a `LEARNING.md` with:
- Core language concepts used in that service
- Key patterns and idioms explained
- Common gotchas to watch for
- How to run and test locally
- Code examples you can experiment with

**Recommended learning order:**
1. **Python** (telegram-client) — Most familiar syntax, async/await intro
2. **Go** (api-gateway) — Simple, explicit, great error handling patterns
3. **Elixir** (youtube-poller) — GenServer, supervision, pattern matching
4. **Rust** (downloader) — Ownership, borrowing, Result types

## Troubleshooting

### "No OAuth token found"
Run `python3 scripts/oauth-setup.py` with the database running.

### Watch history not working
- Check that `config/cookies.txt` exists and is valid
- Cookies expire — re-export them periodically
- Ensure `COOKIES_PATH` env var matches the mount path (`/config/cookies.txt`)
- Debug messages are sent to the admin's Telegram — check there for yt-dlp errors
- Test manually: `yt-dlp --flat-playlist -j --cookies config/cookies.txt "https://www.youtube.com/feed/history" | head -1`

### Subscriptions showing false changes
- Partial API responses (pagination errors) are now detected and skipped
- If >10 changes are detected in one poll, it's treated as suspicious and ignored
- Debug logs are sent to the admin for visibility

### "Failed to connect to NATS"
NATS might not be ready yet. The services will retry on restart:
```bash
docker compose restart youtube-poller telegram-client downloader
```

### Telegram upload fails
- Check `TELEGRAM_SESSION_STRING` is set correctly
- Verify channel IDs start with `-100`
- Ensure your account is an admin of the channels

### Large videos (>2GB)
Videos larger than 2 GB are automatically split into parts using ffmpeg and
uploaded sequentially. Each part is labelled "(Part 1/3)" etc. in the caption.

### Admin DM download
Send any YouTube link to the bot in a DM. Supported formats:
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://youtube.com/shorts/VIDEO_ID`

## Stopping

```bash
docker compose down        # Stop all services
docker compose down -v     # Stop + delete data
```

## License

MIT
