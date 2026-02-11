<p align="center">
  <img src="https://upload.wikimedia.org/wikipedia/commons/0/09/YouTube_full-color_icon_%282017%29.svg" width="80" alt="YouTube">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://upload.wikimedia.org/wikipedia/commons/8/82/Telegram_logo.svg" width="80" alt="Telegram">
</p>

<h1 align="center">Yagami</h1>
<p align="center"><strong>YouTube Activity Monitor → Telegram</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Elixir-4B275F?style=for-the-badge&logo=elixir&logoColor=white" alt="Elixir">
  <img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Rust">
  <img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/NATS-27AAE1?style=for-the-badge&logo=natsdotio&logoColor=white" alt="NATS">
</p>

<p align="center">
  Watches your YouTube activity — likes, subscriptions, watch history — and forwards<br>
  everything to Telegram channels in real-time. Downloads liked videos and uploads them via MTProto.
</p>

---

## Features

| | Feature | Description |
|---|---|---|
| 👍 | **Liked videos** | Detected instantly, downloaded via yt-dlp, uploaded to Telegram |
| 📡 | **Subscriptions** | New/lost subscriptions detected via API diffing |
| 🕐 | **Watch history** | Scraped via yt-dlp + cookies (not available via API) |
| 💬 | **Admin DM downloads** | Send a YouTube link to the bot → it downloads and sends the video back |
| ✂️ | **Large video splitting** | Videos >2 GB are automatically split into parts using ffmpeg |
| 🖼️ | **HD thumbnails** | Uses maxres YouTube thumbnails (1280×720) with aspect-ratio-correct cropping |
| 🐛 | **Debug messages** | Errors and status updates sent to admin via Telegram |
| 📊 | **REST API** | Query events and stats via the Go API gateway |

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

| Service | Language | Role |
|---------|----------|------|
| <img src="https://img.shields.io/badge/-Go-00ADD8?logo=go&logoColor=white&style=flat-square"> **API Gateway** | Go | REST API for querying events and stats |
| <img src="https://img.shields.io/badge/-Elixir-4B275F?logo=elixir&logoColor=white&style=flat-square"> **YouTube Poller** | Elixir | Polls YouTube for activity, publishes to NATS |
| <img src="https://img.shields.io/badge/-Rust-000000?logo=rust&logoColor=white&style=flat-square"> **Downloader** | Rust | Downloads liked videos using yt-dlp |
| <img src="https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white&style=flat-square"> **Telegram Client** | Python | Sends notifications + uploads videos via MTProto |

## Prerequisites

| Requirement | |
|---|---|
| <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white&style=flat-square"> | Docker & Docker Compose |
| <img src="https://img.shields.io/badge/Google_Cloud-4285F4?logo=googlecloud&logoColor=white&style=flat-square"> | Google Cloud project with YouTube Data API v3 |
| <img src="https://img.shields.io/badge/Telegram-26A5E4?logo=telegram&logoColor=white&style=flat-square"> | Telegram account + API credentials |

> **No local Python, Go, Elixir, or Rust required.** Everything runs in Docker containers, including the setup scripts.

---

## Quick Start

```bash
git clone https://github.com/SunnyXdm/yagami && cd yagami
chmod +x scripts/setup.sh
./scripts/setup.sh
```

The interactive setup wizard handles everything:
1. Creates `.env` from template
2. Walks you through Google OAuth (runs inside Docker — no local Python needed)
3. Generates your Telegram session string (also inside Docker)
4. Checks for YouTube cookies
5. Guides you through Telegram channel setup
6. Builds and launches all services

---

## Detailed Setup Guide

### Step 1 — Google Cloud OAuth Credentials

You need a Google OAuth client so Yagami can read your YouTube likes and subscriptions.

<details>
<summary><strong>📋 Click to expand full Google OAuth setup guide</strong></summary>

#### 1.1 Create a Google Cloud Project

1. Go to **[Google Cloud Console](https://console.cloud.google.com/)**
2. Click the project dropdown at the top → **New Project**
3. Enter a name (e.g., `yagami`) → **Create**
4. Make sure the new project is selected in the dropdown

#### 1.2 Enable YouTube Data API v3

1. Go to **[API Library](https://console.cloud.google.com/apis/library)**
2. Search for **YouTube Data API v3**
3. Click it → **Enable**

#### 1.3 Configure the OAuth Consent Screen

1. Go to **[OAuth Consent Screen](https://console.cloud.google.com/apis/credentials/consent)**
2. Select **External** → **Create**
3. Fill in:
   - **App name**: `Yagami` (or anything you like)
   - **User support email**: your email
   - **Developer contact email**: your email
4. Click **Save and Continue**
5. On the **Scopes** page → **Add or Remove Scopes**
6. Find and check: `https://www.googleapis.com/auth/youtube.readonly`
7. Click **Update** → **Save and Continue**
8. On the **Test users** page → **Add Users**
9. **Add your own Gmail address** (the one linked to your YouTube account)
10. **Save and Continue** → **Back to Dashboard**

> ⚠️ **Important**: Since the app stays in "Testing" mode, only the email addresses you add as test users can authorize. You do **not** need to publish or verify the app.

#### 1.4 Create OAuth Credentials

1. Go to **[Credentials](https://console.cloud.google.com/apis/credentials)**
2. Click **+ Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `Yagami` (or anything)
5. Under **Authorized redirect URIs**, add:
   ```
   http://localhost:8765/callback
   ```
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

#### 1.5 Add to .env

```env
GOOGLE_CLIENT_ID=123456789-xxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxx
```

</details>

---

### Step 2 — Telegram API Credentials

You need Telegram API credentials so Yagami can send messages and upload files using MTProto.

<details>
<summary><strong>📋 Click to expand full Telegram API setup guide</strong></summary>

#### 2.1 Get API ID & Hash

1. Go to **[my.telegram.org](https://my.telegram.org)**
2. Log in with your **phone number** (you'll receive a code in Telegram)
3. Click **API Development Tools**
4. Fill in:
   - **App title**: `Yagami` (or anything)
   - **Short name**: `yagami` (or anything, lowercase, no spaces)
   - **Platform**: can be anything (e.g., Desktop)
   - **Description**: optional
5. Click **Create Application**
6. You'll see your **App api_id** (a number) and **App api_hash** (a hex string)

#### 2.2 Add to .env

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
```

#### 2.3 Generate Session String

The setup wizard will run this automatically inside a Docker container. It will ask for:
1. Your **phone number** (international format, e.g., `+1234567890`)
2. The **verification code** Telegram sends you
3. Your **2FA password** (if enabled)

The output is a long base64 string — it goes into `.env` as `TELEGRAM_SESSION_STRING`.

> ⚠️ **Keep your session string secret!** Anyone with it can access your Telegram account.

</details>

---

### Step 3 — Telegram Channels

Create 3 Telegram channels (or groups) where Yagami will post notifications.

<details>
<summary><strong>📋 Click to expand Telegram channel setup guide</strong></summary>

#### 3.1 Create Channels

In Telegram, create 3 channels:
- **Yagami Likes** — for liked video notifications
- **Yagami Subs** — for subscription changes
- **Yagami History** — for watch history

#### 3.2 Get Channel IDs

1. Send any message in each channel
2. Forward that message to **[@userinfobot](https://t.me/userinfobot)**
3. The bot will reply with the channel's **chat ID** (a number starting with `-100`)

#### 3.3 Make Your Account an Admin

Make sure the Telegram account you used to generate the session string is an **admin** of all 3 channels (with permission to post messages).

#### 3.4 Get Your Admin User ID

Send any message to **[@userinfobot](https://t.me/userinfobot)** directly (not forwarded). It will reply with your personal user ID.

#### 3.5 Add to .env

```env
TELEGRAM_CHAT_ID_LIKES=-1001234567890
TELEGRAM_CHAT_ID_SUBSCRIPTIONS=-1001234567891
TELEGRAM_CHAT_ID_WATCH_HISTORY=-1001234567892
TELEGRAM_ADMIN_USER_ID=123456789
```

</details>

---

### Step 4 — YouTube Cookies (for Watch History)

Watch history is **not available** via the YouTube API. Yagami uses yt-dlp with browser cookies to scrape it.

<details>
<summary><strong>📋 Click to expand cookie export guide</strong></summary>

#### 4.1 Install Browser Extension

Install **[Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)** (Chrome/Edge) or the equivalent for your browser.

> ⚠️ Use the **"LOCALLY"** version — it doesn't send your cookies to any server.

#### 4.2 Export Cookies

1. Go to **[youtube.com](https://www.youtube.com)** and make sure you're **logged in**
2. Click the extension icon → **Export** (or "Get cookies.txt")
3. Save the file as `config/cookies.txt` in the yagami project folder

```bash
# Verify the file exists
ls -la config/cookies.txt
```

#### 4.3 Cookie Expiry

YouTube cookies expire periodically. If watch history stops working:
1. Re-export cookies using the same process above
2. Restart the services: `docker compose restart youtube-poller downloader`

Debug messages will be sent to your Telegram admin account if cookies become invalid.

</details>

---

## Configuration

All configuration is via environment variables in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_PASSWORD` | — | PostgreSQL password |
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | — | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | — | *Auto-filled by setup wizard* |
| `TELEGRAM_API_ID` | — | Telegram API ID |
| `TELEGRAM_API_HASH` | — | Telegram API Hash |
| `TELEGRAM_SESSION_STRING` | — | *Auto-filled by setup wizard* |
| `TELEGRAM_CHAT_ID_LIKES` | — | Channel for liked videos |
| `TELEGRAM_CHAT_ID_SUBSCRIPTIONS` | — | Channel for subscription changes |
| `TELEGRAM_CHAT_ID_WATCH_HISTORY` | — | Channel for watch history |
| `TELEGRAM_ADMIN_USER_ID` | — | Your Telegram user ID (for admin features) |
| `POLL_INTERVAL_LIKES` | `120` | Seconds between like polls |
| `POLL_INTERVAL_SUBS` | `600` | Seconds between subscription polls |
| `POLL_INTERVAL_HISTORY` | `300` | Seconds between history scrapes |
| `MAX_CONCURRENT_DOWNLOADS` | `2` | Parallel yt-dlp downloads |

## API Endpoints

The Go API gateway runs on port **8080**.

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
Query params: `type` (like / subscription / watch), `limit` (default 50)

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
├── docker-compose.yml              # All services + infrastructure
├── .env.example                    # Configuration template
├── db/init.sql                     # Database schema
├── config/cookies.txt              # YouTube cookies (gitignored)
├── scripts/
│   ├── setup.sh                    # Interactive setup wizard
│   ├── gen-session.py              # Generate Telegram session string
│   └── oauth-setup.py              # Google OAuth flow
├── services/
│   ├── api-gateway/                # Go — REST API
│   │   ├── cmd/server/main.go
│   │   ├── internal/
│   │   │   ├── handlers/           # HTTP handlers
│   │   │   └── store/              # Database queries
│   │   └── LEARNING.md
│   ├── youtube-poller/             # Elixir — YouTube monitoring
│   │   ├── lib/youtube_poller/
│   │   │   ├── application.ex      # OTP supervision tree
│   │   │   ├── likes_worker.ex     # Polls liked videos
│   │   │   ├── subs_worker.ex      # Polls subscriptions
│   │   │   ├── history_worker.ex   # Scrapes watch history
│   │   │   ├── youtube_api.ex      # YouTube API client
│   │   │   ├── ytdlp.ex            # yt-dlp wrapper
│   │   │   ├── oauth.ex            # Token management
│   │   │   ├── db.ex               # Database queries
│   │   │   └── nats_client.ex      # NATS publisher
│   │   └── LEARNING.md
│   ├── downloader/                 # Rust — Video downloader
│   │   ├── src/
│   │   │   ├── main.rs             # NATS listener + task spawner
│   │   │   ├── config.rs           # Environment config
│   │   │   ├── download.rs         # yt-dlp subprocess
│   │   │   └── models.rs           # Request/Result types
│   │   └── LEARNING.md
│   └── telegram-client/            # Python — Telegram forwarder
│       ├── telegram_client/
│       │   ├── client.py           # Main loop (Telethon + NATS)
│       │   ├── handlers.py         # Event routing + video upload
│       │   ├── formatter.py        # Message formatting
│       │   └── config.py           # Environment config
│       └── LEARNING.md
└── PROJECT_PLAN.md                 # Detailed design document
```

## Learning

Each service has a `LEARNING.md` with:
- Core language concepts used in that service
- Key patterns and idioms explained
- Common gotchas to watch for
- How to run and test locally
- Code examples you can experiment with

**Recommended learning order:**
1. <img src="https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white&style=flat-square"> **Python** (telegram-client) — Most familiar syntax, async/await intro
2. <img src="https://img.shields.io/badge/-Go-00ADD8?logo=go&logoColor=white&style=flat-square"> **Go** (api-gateway) — Simple, explicit, great error handling patterns
3. <img src="https://img.shields.io/badge/-Elixir-4B275F?logo=elixir&logoColor=white&style=flat-square"> **Elixir** (youtube-poller) — GenServer, supervision, pattern matching
4. <img src="https://img.shields.io/badge/-Rust-000000?logo=rust&logoColor=white&style=flat-square"> **Rust** (downloader) — Ownership, borrowing, Result types

## Troubleshooting

<details>
<summary><strong>"No OAuth token found"</strong></summary>

Re-run the OAuth setup:
```bash
docker compose up -d postgres
sleep 3
./scripts/setup.sh
```
Choose option to run OAuth setup when prompted.

</details>

<details>
<summary><strong>Watch history not working</strong></summary>

- Check that `config/cookies.txt` exists and is valid
- Cookies expire — re-export them periodically
- Ensure `COOKIES_PATH` env var matches the mount path (`/config/cookies.txt`)
- Debug messages are sent to the admin's Telegram — check there for yt-dlp errors
- Test manually:
  ```bash
  yt-dlp --flat-playlist -j --cookies config/cookies.txt \
    "https://www.youtube.com/feed/history" | head -1
  ```

</details>

<details>
<summary><strong>Subscriptions showing false changes</strong></summary>

- Partial API responses (pagination errors) are detected and skipped
- If >10 changes are detected in one poll, it's treated as suspicious and ignored
- Debug logs are sent to the admin for visibility

</details>

<details>
<summary><strong>"Failed to connect to NATS"</strong></summary>

NATS might not be ready yet. The services will retry on restart:
```bash
docker compose restart youtube-poller telegram-client downloader
```

</details>

<details>
<summary><strong>Telegram upload fails</strong></summary>

- Check `TELEGRAM_SESSION_STRING` is set correctly
- Verify channel IDs start with `-100`
- Ensure your account is an admin of the channels

</details>

<details>
<summary><strong>Large videos (>2 GB)</strong></summary>

Videos larger than 2 GB are automatically split into parts using ffmpeg and uploaded sequentially. Each part is labelled "(Part 1/3)" etc. in the caption.

</details>

<details>
<summary><strong>Admin DM download</strong></summary>

Send any YouTube link to the bot in a DM. Supported formats:
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://youtube.com/shorts/VIDEO_ID`

</details>

## Stopping

```bash
docker compose down        # Stop all services
docker compose down -v     # Stop + delete all data
```

## License

MIT
