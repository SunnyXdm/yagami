-- ============================================================
-- Project Yagami — Database Schema
-- Run once on first startup via Docker entrypoint.
-- ============================================================

-- Immutable event log — every detected activity is appended here.
CREATE TABLE IF NOT EXISTS events (
    id               BIGSERIAL PRIMARY KEY,
    event_type       VARCHAR(50)  NOT NULL,   -- watch | like
    video_id         VARCHAR(20),
    channel_id       VARCHAR(30),
    title            TEXT,
    channel_title    TEXT,
    thumbnail_url    TEXT,
    duration_seconds INTEGER,
    metadata         JSONB,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_type_created ON events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_video_id     ON events(video_id);

-- ── State-tracking tables (used for diffing) ───────────────

CREATE TABLE IF NOT EXISTS known_watch_history (
    video_id         VARCHAR(20) PRIMARY KEY,
    title            TEXT,
    channel_title    TEXT,
    channel_id       VARCHAR(30),
    duration_seconds INTEGER,
    watched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_watch_history_watched ON known_watch_history(watched_at DESC);

CREATE TABLE IF NOT EXISTS known_likes (
    video_id         VARCHAR(20) PRIMARY KEY,
    title            TEXT,
    channel_title    TEXT,
    liked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    download_status  VARCHAR(20) DEFAULT 'pending'  -- pending | downloading | uploaded | failed
);

-- ── Download tracking ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS downloads (
    id               BIGSERIAL PRIMARY KEY,
    video_id         VARCHAR(20) NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'queued',  -- queued | downloading | uploading | completed | failed
    file_size        BIGINT,
    file_path        TEXT,
    telegram_msg_id  BIGINT,
    telegram_chat_id BIGINT,
    error_message    TEXT,
    attempts         INTEGER     DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_downloads_status   ON downloads(status);
CREATE INDEX IF NOT EXISTS idx_downloads_video_id ON downloads(video_id);

-- ── OAuth tokens ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_tokens (
    id               SERIAL PRIMARY KEY,
    provider         VARCHAR(20) NOT NULL DEFAULT 'google',
    access_token     TEXT        NOT NULL,
    refresh_token    TEXT        NOT NULL,
    expires_at       TIMESTAMPTZ NOT NULL,
    scopes           TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider)
);

-- ── Application config (key-value store) ───────────────────

CREATE TABLE IF NOT EXISTS config (
    key              VARCHAR(100) PRIMARY KEY,
    value            TEXT NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
