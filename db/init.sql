-- ============================================================
-- Project Yagami — Database Schema
-- Idempotent: safe to re-run.
-- ============================================================

-- ── Users & Sessions (web UI auth) ─────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              BIGSERIAL PRIMARY KEY,
    username        VARCHAR(64)  NOT NULL UNIQUE,
    password_hash   TEXT         NOT NULL,
    is_admin        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
    token           TEXT         PRIMARY KEY,
    user_id         BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ  NOT NULL,
    user_agent      TEXT,
    ip              TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ── Settings (formerly env vars) ──────────────────────────
CREATE TABLE IF NOT EXISTS settings (
    key             VARCHAR(128) PRIMARY KEY,
    value           TEXT         NOT NULL DEFAULT '',
    description     TEXT,
    is_secret       BOOLEAN      NOT NULL DEFAULT FALSE,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO settings (key, description, is_secret) VALUES
    ('google.client_id',         'Google OAuth Client ID',                FALSE),
    ('google.client_secret',     'Google OAuth Client Secret',            TRUE),
    ('google.refresh_token',     'Google OAuth Refresh Token (auto-set)', TRUE),
    ('google.auth_status',       'Google OAuth health reported by the poller', FALSE),
    ('telegram.api_id',          'Telegram API ID (only needed for user-account login)',     FALSE),
    ('telegram.api_hash',        'Telegram API Hash (only needed for user-account login)',   TRUE),
    ('telegram.bot_token',       'Telegram Bot Token from @BotFather (recommended)',         TRUE),
    ('telegram.session_string',  'Telethon user session (advanced, optional)',               TRUE),
    ('telegram.chat_likes',      'Telegram chat ID for liked videos',     FALSE),
    ('telegram.chat_history',    'Telegram chat ID for watch history',    FALSE),
    ('telegram.chat_subs',       'Telegram chat ID for subscriptions',    FALSE),
    ('telegram.admin_user_id',   'Telegram admin user ID (DM)',           FALSE),
    ('youtube.cookies',          'youtube.com cookies.txt content',       TRUE),
    ('poll.interval_likes',      'Likes poll interval (seconds)',         FALSE),
    ('poll.interval_history',    'History poll interval (seconds)',       FALSE),
    ('poll.interval_subs',       'Subscriptions poll interval (seconds)', FALSE),
    ('downloader.max_concurrent','Max concurrent downloads',              FALSE),
    ('downloader.max_filesize_gb','Max file size to download (GB)',       FALSE),
    ('downloader.ytdlp_extractor_args','Optional yt-dlp extractor args override for YouTube edge cases', TRUE)
ON CONFLICT (key) DO NOTHING;

UPDATE settings SET value='300' WHERE key='poll.interval_likes'      AND value='';
UPDATE settings SET value='600' WHERE key='poll.interval_history'    AND value='';
UPDATE settings SET value='900' WHERE key='poll.interval_subs'       AND value='';
UPDATE settings SET value='2'   WHERE key='downloader.max_concurrent' AND value='';
UPDATE settings SET value='2'   WHERE key='downloader.max_filesize_gb' AND value='';

-- ── OAuth tokens ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oauth_tokens (
    provider        VARCHAR(20)  PRIMARY KEY,
    access_token    TEXT         NOT NULL,
    refresh_token   TEXT         NOT NULL,
    expires_at      TIMESTAMPTZ  NOT NULL,
    scopes          TEXT,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Activity events (immutable log) ────────────────────────
CREATE TABLE IF NOT EXISTS events (
    id               BIGSERIAL    PRIMARY KEY,
    event_type       VARCHAR(50)  NOT NULL,
    video_id         VARCHAR(20),
    channel_id       VARCHAR(40),
    title            TEXT,
    channel_title    TEXT,
    thumbnail_url    TEXT,
    duration_seconds INTEGER,
    metadata         JSONB,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_type_created ON events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_video_id     ON events(video_id);
CREATE INDEX IF NOT EXISTS idx_events_channel      ON events(channel_id);
CREATE INDEX IF NOT EXISTS idx_events_created      ON events(created_at DESC);

-- ── State-tracking tables (for diffing) ────────────────────
CREATE TABLE IF NOT EXISTS known_watch_history (
    video_id         VARCHAR(20) PRIMARY KEY,
    title            TEXT,
    channel_title    TEXT,
    channel_id       VARCHAR(40),
    duration_seconds INTEGER,
    thumbnail_url    TEXT,
    watched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_watch_history_watched ON known_watch_history(watched_at DESC);

CREATE TABLE IF NOT EXISTS known_likes (
    video_id         VARCHAR(20) PRIMARY KEY,
    title            TEXT,
    channel_title    TEXT,
    channel_id       VARCHAR(40),
    duration_seconds INTEGER,
    thumbnail_url    TEXT,
    liked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    download_status  VARCHAR(20) DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS known_subscriptions (
    channel_id       VARCHAR(40) PRIMARY KEY,
    channel_title    TEXT,
    description      TEXT,
    thumbnail_url    TEXT,
    subscribed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Downloads tracking ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS downloads (
    id                BIGSERIAL    PRIMARY KEY,
    video_id          VARCHAR(20)  NOT NULL UNIQUE,
    title             TEXT,
    url               TEXT,
    channel           TEXT,
    channel_id        VARCHAR(40),
    duration          TEXT,
    thumbnail_url     TEXT,
    status            VARCHAR(20)  NOT NULL DEFAULT 'queued',
    file_size         BIGINT,
    file_path         TEXT,
    telegram_msg_id   BIGINT,
    telegram_chat_id  BIGINT,
    error_message     TEXT,
    attempts          INTEGER      NOT NULL DEFAULT 0,
    requester_chat_id BIGINT,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    started_at        TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_downloads_status   ON downloads(status);
CREATE INDEX IF NOT EXISTS idx_downloads_video_id ON downloads(video_id);
CREATE INDEX IF NOT EXISTS idx_downloads_created  ON downloads(created_at DESC);

-- ── Service heartbeats ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_heartbeats (
    service          VARCHAR(64)  PRIMARY KEY,
    status           VARCHAR(20)  NOT NULL DEFAULT 'unknown',
    version          TEXT,
    details          JSONB,
    last_seen_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Centralized structured logs ────────────────────────────
CREATE TABLE IF NOT EXISTS service_logs (
    id               BIGSERIAL    PRIMARY KEY,
    ts               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    service          VARCHAR(64)  NOT NULL,
    level            VARCHAR(16)  NOT NULL,
    message          TEXT         NOT NULL,
    fields           JSONB,
    error            TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_ts          ON service_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_service_ts  ON service_logs(service, ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level_ts    ON service_logs(level, ts DESC);

-- ── First-run flags etc. ───────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
    key              VARCHAR(100) PRIMARY KEY,
    value            TEXT NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
