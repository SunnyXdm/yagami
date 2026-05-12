<p align="center">
  <img src="https://upload.wikimedia.org/wikipedia/commons/0/09/YouTube_full-color_icon_%282017%29.svg" width="76" alt="YouTube">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://upload.wikimedia.org/wikipedia/commons/8/82/Telegram_logo.svg" width="76" alt="Telegram">
</p>

<h1 align="center">Yagami</h1>
<p align="center"><strong>Self-hosted YouTube activity bridge with a guided localhost web setup</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/Frontend-React%20%2B%20Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Frontend: React and Vite">
  <img src="https://img.shields.io/badge/API-Go-00ADD8?style=for-the-badge&logo=go&logoColor=white" alt="API: Go">
  <img src="https://img.shields.io/badge/Poller-Elixir-4B275F?style=for-the-badge&logo=elixir&logoColor=white" alt="Poller: Elixir">
  <img src="https://img.shields.io/badge/Downloader-Rust-000000?style=for-the-badge&logo=rust&logoColor=white" alt="Downloader: Rust">
  <img src="https://img.shields.io/badge/Telegram-Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Telegram: Python">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/NATS-27AAE1?style=flat-square&logo=natsdotio&logoColor=white" alt="NATS">
  <img src="https://img.shields.io/badge/Localhost%20OAuth-8787-2F855A?style=flat-square" alt="Localhost OAuth callback">
  <img src="https://img.shields.io/badge/Telegram-Bot%20mode%20default-1D9BF0?style=flat-square&logo=telegram&logoColor=white" alt="Telegram bot mode default">
</p>

<p align="center">
  Watches your YouTube likes, watch history, and subscriptions, queues downloads with yt-dlp,<br>
  and delivers activity plus completed uploads to Telegram through a web-managed setup flow.
</p>

---

## Features

| Capability | Description |
| --- | --- |
| Guided setup | The first-run wizard writes runtime settings to Postgres and keeps the dashboard locked until the required checks pass. |
| Fixed localhost OAuth callback | Google browser authorization always returns to `http://localhost:8787/api/oauth/google/callback`, even if the UI is opened through another hostname. |
| Activity feed | Likes, watches, and subscription changes render newest first with links and thumbnails. |
| Download tracking | Queue state, retry, source labels, Telegram upload progress, and multi-part upload status for large videos. |
| Live operations view | Structured logs stream over SSE with filters, pause/follow mode, and older-history loading on scroll. |
| Practical Telegram defaults | Bot mode is the standard install path; user-account mode remains available only as an advanced option. |

## Architecture

```text
browser
  -> frontend (nginx on :8787)
    -> /api -> api-gateway

api-gateway <-> postgres
api-gateway <-> nats

youtube-poller <-> postgres / nats / cookies.txt / yt-dlp
downloader <-> postgres / nats / yt-dlp / downloaded files
telegram-client <-> postgres / nats / Telegram MTProto
```

Only the frontend is published on the host by default:

```text
127.0.0.1:8787 -> frontend nginx -> api-gateway /api proxy
```

Postgres, NATS, and the Go API stay on the internal Docker network.

## Services

| Service | Responsibility |
| --- | --- |
| <img src="https://img.shields.io/badge/frontend-React%20%2B%20Vite-646CFF?style=flat-square&logo=vite&logoColor=white" alt="frontend"> | Browser UI for onboarding, settings, dashboard, activity, downloads, and logs |
| <img src="https://img.shields.io/badge/api--gateway-Go-00ADD8?style=flat-square&logo=go&logoColor=white" alt="api-gateway"> | HTTP API, auth/session cookies, settings validation, OAuth, SSE, logs, and heartbeats |
| <img src="https://img.shields.io/badge/youtube--poller-Elixir-4B275F?style=flat-square&logo=elixir&logoColor=white" alt="youtube-poller"> | Likes, watch history, and subscription monitoring plus cookies sync and OAuth refresh |
| <img src="https://img.shields.io/badge/downloader-Rust-000000?style=flat-square&logo=rust&logoColor=white" alt="downloader"> | `yt-dlp` worker for `download.request` jobs |
| <img src="https://img.shields.io/badge/telegram--client-Python-3776AB?style=flat-square&logo=python&logoColor=white" alt="telegram-client"> | Telethon delivery service, upload progress publisher, and admin DM handler |
| <img src="https://img.shields.io/badge/postgres-PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="postgres"> | Users, sessions, settings, OAuth tokens, events, logs, heartbeats, and downloads |
| <img src="https://img.shields.io/badge/nats-JetStream-27AAE1?style=flat-square&logo=natsdotio&logoColor=white" alt="nats"> | Event bus for activity, downloads, config changes, heartbeats, and logs |

## Quick Start

```bash
docker compose up -d --build --force-recreate
open http://localhost:8787
```

For a clean first run:

```bash
docker compose down -v
docker compose up -d --build --force-recreate
```

## First-Run Setup

Yagami is intentionally gated until it is actually usable.

1. Create the admin web account.
2. Paste the Google OAuth client ID and secret.
3. Click **Authorize Google** and finish the browser flow.
4. Paste the Telegram bot token and numeric chat IDs.
5. Paste YouTube `cookies.txt`.
6. Open the dashboard once every required check is green.

### Google OAuth

In Google Cloud Console:

1. Enable **YouTube Data API v3**.
2. Create OAuth credentials of type **Web application**.
3. Add this exact authorized redirect URI:

```text
http://localhost:8787/api/oauth/google/callback
```

Paste `google.client_id` and `google.client_secret` in the UI, save, then click **Authorize Google**. Yagami stores and refreshes the Google token automatically after that.

### Telegram Modes

#### Recommended: bot mode

1. Create a bot with `@BotFather`.
2. Paste `telegram.bot_token`.
3. Add the bot to the destination chats.
4. Fill these numeric IDs:
   - `telegram.chat_likes`
   - `telegram.chat_history`
   - `telegram.chat_subs`
   - `telegram.admin_user_id`

Bot mode is enough for normal delivery. Likes, watch notifications, subscription events, completed downloads, and admin DM-triggered downloads all work in this mode.

#### Optional advanced mode: user-account Telethon session

The Settings page also exposes:

- `telegram.api_id`
- `telegram.api_hash`
- `telegram.session_string`

This is only for advanced cases where you explicitly want a real user session. It is not required for normal posting, and it does not solve YouTube API or cookie issues.

### YouTube Cookies and yt-dlp Overrides

Paste a Netscape-format export into `youtube.cookies`. Yagami uses it in two places:

- `youtube-poller` scrapes the private YouTube watch-history feed with it.
- `downloader` passes it to `yt-dlp` for authenticated downloads.

If YouTube changes extractor behavior, the optional advanced setting `downloader.ytdlp_extractor_args` lets you pass raw `--extractor-args` through to `yt-dlp`.

Example:

```text
youtube:player_client=mweb;po_token=mweb.gvs+...
```

Treat both values like passwords.

## UI Surfaces

| Page | Current behavior |
| --- | --- |
| Dashboard | Counters, service health, and recent activity |
| Activity | Likes, watches, subscriptions, thumbnails, and newest-first ordering |
| Downloads | Queue state, retry, source labels, Telegram upload progress, and part counts |
| Logs | Live logs from every service with filters, pause/follow mode, and older-history loading on scroll |
| Settings | Readiness checks, grouped configuration, masked secrets, and optional advanced fields |

## Operations

```bash
docker compose ps
docker compose logs -f frontend api-gateway
docker compose logs -f youtube-poller downloader telegram-client
docker compose restart <service>
docker compose down
docker compose down -v
```

Whenever settings are saved, the API broadcasts `system.config_changed` so services can reload or restart with the new values.

## Known Limits and Caveats

- Watch history is not available in the YouTube Data API. If `youtube.cookies` expires or becomes invalid, watch-history scraping stops working until you paste fresh cookies.
- Very large YouTube accounts near the `subscriptions.list` 1000-item ceiling are upstream-limited. In that case, unsubscribe detection is paused and recent subscribe detection is best-effort only.
- The downloader enforces `downloader.max_filesize_gb` after download. If the file is accepted but larger than Telegram's upload ceiling, the Telegram client splits it into roughly 1.95 GB parts and uploads them sequentially.
- Bot mode still runs through Telethon and Telegram MTProto under the hood. User-account mode is optional advanced behavior, not the normal install path.

## Development Checks

```bash
make test
make test-all
```

Useful targeted checks:

```bash
npm run build --prefix services/frontend
cd services/api-gateway && go test ./...
cd services/downloader && cargo test
cd services/telegram-client && python -m pytest tests/ -q
cd services/youtube-poller && mix test
```

Notes:

- The Telegram image-processing tests need Pillow installed.
- Elixir tests need `mix` available locally.
- Docker builds install each service's language dependencies inside their build stage, so local toolchains are mainly for development and test runs.
