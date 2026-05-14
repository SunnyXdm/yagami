# Project Yagami Plan

This file describes the product as it exists today, not an earlier prototype.

## Product Summary

Yagami is a single-user, self-hosted YouTube activity bridge with a guarded web UI.

Current shipped behavior:

- Poll liked videos through the YouTube Data API.
- Scrape private watch history with `yt-dlp` and browser cookies.
- Track subscription changes, with protective fallbacks for unstable large-account snapshots.
- Queue liked videos and admin-requested links for download.
- Upload completed downloads to Telegram, including live upload progress, admin DM status-message edits, and multi-part uploads.
- Surface activity, downloads, logs, heartbeats, and readiness in the browser.

## Primary User Flow

1. Start the stack with Docker Compose.
2. Open `http://localhost:8787`.
3. Create the admin web account.
4. Finish the guided setup:
   - Google OAuth client ID and secret
   - Browser-based Google authorization
   - Telegram bot token
   - Likes, history, subscriptions, and admin Telegram IDs
   - YouTube `cookies.txt`
5. The dashboard unlocks only after the required checks pass.

The setup wizard is the intended entry point. The dashboard is not supposed to be the first useful screen on a fresh install.

## Service Topology

| Component | Language | Responsibility |
| --- | --- | --- |
| `frontend` | React + Vite | Onboarding, settings, activity, downloads, logs, service health |
| `api-gateway` | Go | REST API, auth/session cookies, settings validation, OAuth, SSE, historical queries |
| `youtube-poller` | Elixir | Likes polling, watch-history scraping, subscription monitoring, cookies sync, OAuth refresh |
| `downloader` | Rust | `download.request` consumer, `yt-dlp` execution, metadata extraction, size enforcement |
| `telegram-client` | Python | Telethon delivery, upload progress events, file splitting, admin DM download requests |
| `postgres` | PostgreSQL | Users, sessions, settings, tokens, events, logs, heartbeats, downloads |
| `nats` | NATS JetStream | Cross-service activity, work, heartbeat, config-change, and log streams |

## Network Model

Only the frontend is published on the host:

```text
127.0.0.1:8787 -> frontend nginx
frontend nginx /api -> api-gateway:8080
```

The OAuth redirect URI for local installs is fixed to:

```text
http://localhost:8787/api/oauth/google/callback
```

## Event Flow

```text
youtube-poller --youtube.likes----------> NATS --download.request------> downloader
youtube-poller --youtube.watch----------> NATS ------------------------> telegram-client
youtube-poller --youtube.subscribe-----> NATS ------------------------> telegram-client
downloader ----download.complete-------> NATS ------------------------> telegram-client
telegram-client --download.upload_*----> NATS --SSE fanout-----------> frontend
all services ---system.heartbeat/logs--> NATS -> api-gateway sinks -> Postgres + SSE
```

Admin DM downloads use the same event stream. After the admin chooses a quality, the Telegram client keeps the bot message as a live job surface and edits it as `download.progress`, `download.upload_progress`, `download.uploaded`, or `download.upload_failed` arrives.

## Runtime Settings Model

All user-editable runtime settings live in Postgres rather than `.env` files:

- `google.client_id`
- `google.client_secret`
- `google.refresh_token`
- `google.auth_status`
- `telegram.bot_token`
- `telegram.chat_likes`
- `telegram.chat_history`
- `telegram.chat_subs`
- `telegram.admin_user_id`
- `telegram.api_id`
- `telegram.api_hash`
- `telegram.session_string`
- `youtube.cookies`
- `poll.interval_likes`
- `poll.interval_history`
- `poll.interval_subs`
- `downloader.max_concurrent`
- `downloader.max_filesize_gb`
- `downloader.ytdlp_extractor_args`

The UI groups these settings by purpose. Raw key/value editing is not the primary user experience.

## Readiness Gate

Dashboard access currently depends on:

- Google OAuth configured
- Google OAuth authorized and not marked unhealthy
- Telegram bot token configured
- Likes channel configured
- Watch-history channel configured
- Subscriptions channel configured
- Admin Telegram user configured
- YouTube cookies configured
- Downloader cookies file materialized on disk

Advanced Telethon user-account mode is optional and must never block normal bot-mode setup.

## Current UI Behavior

- **Activity** shows likes, watches, and subscription changes newest first with thumbnails and deep links.
- **Downloads** shows queue state, source labels, Telegram upload progress, delivery status, retry, and multi-part upload state.
- **Telegram bot** shows `/status`, `/settings`, `/downloads`, and `/ping`; `/downloads` renders a paginated queue with active jobs first.
- **Logs** mixes a cursor-based historical query with a live SSE stream; the page can pause live following and load older rows on scroll.
- **Settings** masks secrets by default, validates changed fields, and writes only touched keys.
- **Dashboard** surfaces counters plus service heartbeat health.

## Operational Expectations

- Services degrade gracefully while settings are incomplete.
- Saving settings publishes `system.config_changed`.
- Secrets remain masked in the browser unless explicitly revealed.
- Logs and heartbeats remain visible in the UI.
- The likes worker backs off exponentially on YouTube quota exhaustion.
- Watch history depends on valid Netscape cookies.
- Telegram uploads publish progress over NATS so the UI can render live status.

## Current Constraints

- Watch history is upstream-limited by cookies and `yt-dlp`; no YouTube Data API exists for it.
- Very large YouTube accounts near the `subscriptions.list` 1000-item ceiling can receive partial or duplicate-filled subscription snapshots. In that case, unsubscribe detection is paused and recent subscribe detection is only best-effort.
- The downloader enforces `downloader.max_filesize_gb` after download. Files that pass the downloader but exceed Telegram's practical upload ceiling are split by the Telegram client.
- Bot mode is the standard path. User-account mode is optional advanced behavior, not a required setup dependency.

## Development Checks

Fast product-level checks:

```bash
npm run build --prefix services/frontend
docker compose config --quiet
python3 -m pytest services/telegram-client/tests -q
```

Language-specific checks:

```bash
make test-go
make test-rust
make test-elixir
```

Full suite:

```bash
make test-all
```

## Near-Term Improvements

- Add a dedicated UI helper for discovering Telegram chat IDs.
- Surface cookie freshness and poller auth degradation more explicitly in the UI.
- Add downloader download-progress telemetry, not just Telegram upload progress.
- Improve migration handling for long-lived Postgres volumes.
- Keep researching a more reliable subscription-monitoring strategy for accounts above the YouTube API's practical ceiling.
