# Project Yagami Plan

This file describes the current product and architecture. It replaces the older exploratory notes that predated the web UI and database-backed settings.

## Current Product

Yagami is a single-user, self-hosted YouTube activity bridge:

- Polls liked videos and subscriptions via YouTube Data API.
- Scrapes private watch history with `yt-dlp` and browser cookies.
- Downloads liked videos with `yt-dlp`.
- Sends activity and completed downloads to Telegram.
- Provides a web UI for setup, readiness checks, settings, activity, downloads, logs, and service health.

## User Flow

1. Start with Docker Compose.
2. Open `http://localhost:8787`.
3. Create the admin account.
4. Complete the setup wizard:
   - Google OAuth client ID and secret
   - Google browser authorization
   - Telegram bot token
   - Likes, history, subscriptions, and admin Telegram IDs
   - YouTube `cookies.txt`
5. Dashboard unlocks after required readiness checks pass.

The dashboard should not be the first meaningful screen on a new install. The setup wizard is the product entry point until the system is actually usable.

## Architecture

| Component | Language | Responsibility |
|---|---|---|
| `frontend` | React + Vite | Browser UI, onboarding, settings, logs, activity, downloads |
| `api-gateway` | Go | REST API, auth/session cookies, settings validation, OAuth, SSE |
| `youtube-poller` | Elixir | Likes/subscription polling, watch-history scraping, OAuth refresh |
| `downloader` | Rust | Download work queue consumer, file metadata, size enforcement |
| `telegram-client` | Python | Telethon delivery, bot/user mode, admin DM download requests |
| `postgres` | PostgreSQL | Users, sessions, settings, tokens, events, logs, heartbeats, downloads |
| `nats` | NATS JetStream | Cross-service event and work streams |

## Network Model

Only the frontend is published on the host:

```text
127.0.0.1:8787 -> frontend nginx
frontend nginx /api -> api-gateway:8080
```

The OAuth redirect URI for local installs is:

```text
http://localhost:8787/api/oauth/google/callback
```

## Settings Model

All user-editable runtime settings live in Postgres, not in `.env` files:

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

The UI must show every setting in a human-readable group. Raw key/value editing is not the primary user experience.

## Readiness Gate

Dashboard access requires these checks:

- Google OAuth configured
- Google OAuth authorized and not marked unhealthy
- Telegram bot token configured
- Likes channel ID configured
- Watch-history channel ID configured
- Subscriptions channel ID configured
- Admin Telegram user ID configured
- YouTube cookies configured

Advanced Telethon user-account mode is optional and should never block normal bot-mode setup.

## Operational Expectations

- Services wait or degrade gracefully when settings are incomplete.
- Settings changes publish `system.config_changed`.
- Services reload or restart through Docker restart policy where needed.
- Secrets are masked by default in the UI.
- Logs and heartbeats are visible in the UI.
- Failed downloads expose error messages and retry.

## Development Checks

Use these before handing changes over:

```bash
npm run build --prefix services/frontend
docker compose config --quiet
python3 -m pytest services/telegram-client/tests -q
```

Go, Rust, and Elixir checks:

```bash
make test-go
make test-rust
make test-elixir
```

Full integration:

```bash
make test-all
```

## Open Improvements

- Add a dedicated UI helper for discovering Telegram chat IDs.
- Add explicit cookie-expiration status surfaced from `youtube-poller`.
- Add retry/backoff visibility for YouTube quota and OAuth failures.
- Add migration handling for existing Postgres volumes when schema changes.
