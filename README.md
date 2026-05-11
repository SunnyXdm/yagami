# Yagami

Self-hosted YouTube-to-Telegram bridge with a guided web setup.

Yagami watches your YouTube likes, watch history, and subscriptions, downloads liked videos with `yt-dlp`, and sends activity plus completed downloads to Telegram.

## What Runs

| Service | Job |
|---|---|
| `frontend` | React/Vite UI served by nginx on `http://localhost:8787` |
| `api-gateway` | Go HTTP API, auth, settings, OAuth callback, SSE, logs, heartbeats |
| `youtube-poller` | Elixir workers for likes, watch history, subscriptions, OAuth token refresh |
| `downloader` | Rust `yt-dlp` worker for download requests |
| `telegram-client` | Python/Telethon delivery service and admin DM handler |
| `postgres` | Users, sessions, settings, OAuth tokens, events, logs, downloads |
| `nats` | JetStream event bus |

## Start

```bash
docker compose up -d --build --force-recreate
open http://localhost:8787
```

If you want a clean first-run database:

```bash
docker compose down -v
docker compose up -d --build --force-recreate
```

## First-Run Setup

The web UI is intentionally gated. After creating the admin account, Yagami opens a setup wizard and keeps the dashboard locked until required checks pass.

1. Create the admin web account.
2. Add Google OAuth credentials.
3. Authorize Google in the browser.
4. Add Telegram bot token and destination chat IDs.
5. Paste YouTube `cookies.txt`.
6. Open the dashboard after all required checks are green.

### Google OAuth

In Google Cloud Console:

1. Enable YouTube Data API v3.
2. Create OAuth credentials with type `Web application`.
3. Add this authorized redirect URI:

```text
http://localhost:8787/api/oauth/google/callback
```

Paste `google.client_id` and `google.client_secret` in the wizard, save, then click **Authorize Google**. Yagami stores the refresh token automatically.

### Telegram

Recommended mode is bot mode:

1. Create a bot with `@BotFather`.
2. Paste `telegram.bot_token`.
3. Add the bot as admin/member where it should post.
4. Fill numeric Telegram IDs:
   - `telegram.chat_likes`
   - `telegram.chat_history`
   - `telegram.chat_subs`
   - `telegram.admin_user_id`

The optional advanced user-account mode is still available in Settings for Telethon session-string usage, but normal setup does not require it.

### YouTube Cookies

Paste a Netscape-format cookies export into `youtube.cookies` in the wizard. This is used by both:

- `youtube-poller` for private watch-history scraping
- `downloader` for authenticated downloads

Use a local browser extension or tool that exports Netscape `cookies.txt` format. Treat the value like a password.

## Settings

After onboarding, Settings is organized by purpose:

- Google and YouTube API
- Telegram delivery
- Watch history access
- Worker defaults
- Telegram user-account mode

Secrets are masked by default. Use **Reveal secrets** only when you need to inspect or replace them. Only changed fields are written back to Postgres.

## Operations

```bash
docker compose ps
docker compose logs -f frontend api-gateway
docker compose logs -f youtube-poller downloader telegram-client
docker compose restart <service>
docker compose down
docker compose down -v
```

The UI shows:

- Dashboard: counters, recent activity, service health
- Activity: likes, watches, subscriptions
- Downloads: queue state, failures, retry
- Logs: live structured logs over SSE
- Settings: readiness and editable configuration

## Ports

Only the frontend is published to the host by default:

```text
127.0.0.1:8787 -> frontend nginx -> api-gateway /api proxy
```

Postgres, NATS, and the gateway are internal Docker network services.

## Tests

```bash
make test
make test-all
```

Local tests need language toolchains and dependencies installed. Docker builds fetch Go, Rust, npm, Python, and Elixir dependencies inside their build stages.
