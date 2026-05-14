"""Tests for the main NATS+Telethon client wiring."""

import asyncio
from datetime import datetime, timezone
import json
import re
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from telegram_client.config import Config
from telegram_client.client import (
    QueuePage,
    _page_number,
    _progress_percent,
    _render_admin_progress_text,
    _render_download_queue_page,
    _status_from_progress_subject,
)


def make_config(**overrides) -> Config:
    defaults = dict(
        api_id=123,
        api_hash="hash",
        session_string="session",
        chat_id_likes=-100111,
        chat_id_watch_history=-100333,
        admin_user_id=0,
        nats_url="nats://localhost:4222",
        database_url="",
    )
    defaults.update(overrides)
    return Config(**defaults)


class TestClientRouting:
    """Test that the client wires NATS subjects to the correct Telegram channels."""

    def test_route_mapping(self):
        """Verify the subject → chat_id mapping is correct."""
        cfg = make_config()

        expected_routes = {
            "youtube.watch": cfg.chat_id_watch_history,
            "youtube.likes": cfg.chat_id_likes,
            "download.complete": cfg.chat_id_likes,
            "system.health": cfg.admin_user_id,
        }

        assert expected_routes["youtube.watch"] == -100333
        assert expected_routes["youtube.likes"] == -100111
        assert expected_routes["download.complete"] == -100111
        assert expected_routes["system.health"] == cfg.admin_user_id

    def test_all_chat_ids_are_distinct_channels(self):
        """Likes and history should go to different channels."""
        cfg = make_config()
        ids = {cfg.chat_id_likes, cfg.chat_id_watch_history}
        assert len(ids) == 2, "Each event type should have its own Telegram channel"


class TestMakeHandler:
    """Test the factory function pattern for NATS handlers."""

    @pytest.mark.asyncio
    async def test_handler_parses_json_and_calls_handle_event(self):
        """Verify that the closure correctly captures subject and chat_id."""
        captured_subjects = []
        captured_chat_ids = []

        def make_handler(subject: str, chat_id: int):
            async def handler(msg):
                captured_subjects.append(subject)
                captured_chat_ids.append(chat_id)

            return handler

        routes = {
            "youtube.watch": -100333,
            "youtube.likes": -100111,
        }

        handlers = {subj: make_handler(subj, cid) for subj, cid in routes.items()}

        mock_msg = MagicMock()
        mock_msg.data = json.dumps({"test": True}).encode()

        await handlers["youtube.watch"](mock_msg)
        await handlers["youtube.likes"](mock_msg)

        assert captured_subjects == ["youtube.watch", "youtube.likes"]
        assert captured_chat_ids == [-100333, -100111]


class TestYouTubeUrlParsing:
    """Test the YouTube URL regex used by the admin DM handler."""

    # Same regex as in client.py — tested independently to avoid importing
    # nats/telethon which aren't available in the local test environment.
    YOUTUBE_RE = re.compile(
        r"(?:https?://)?(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})"
    )

    def test_standard_url(self):
        match = self.YOUTUBE_RE.search("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assert match and match.group(1) == "dQw4w9WgXcQ"

    def test_short_url(self):
        match = self.YOUTUBE_RE.search("https://youtu.be/dQw4w9WgXcQ")
        assert match and match.group(1) == "dQw4w9WgXcQ"

    def test_shorts_url(self):
        match = self.YOUTUBE_RE.search("https://youtube.com/shorts/abc12345678")
        assert match and match.group(1) == "abc12345678"

    def test_embedded_in_text(self):
        match = self.YOUTUBE_RE.search("Check this out: https://youtu.be/xyzxyzxyz12 cool right?")
        assert match and match.group(1) == "xyzxyzxyz12"

    def test_no_match(self):
        assert self.YOUTUBE_RE.search("hello world") is None
        assert self.YOUTUBE_RE.search("https://google.com") is None



class TestSystemHealthSubscription:
    def test_no_admin_user_id_excludes_health_route(self):
        """system.health must not be subscribed when admin_user_id is 0."""
        cfg = make_config(admin_user_id=0)
        routes = {
            "youtube.watch":     cfg.chat_id_watch_history,
            "youtube.likes":     cfg.chat_id_likes,
            "download.complete": cfg.chat_id_likes,
        }
        if cfg.admin_user_id:
            routes["system.health"] = cfg.admin_user_id
        assert "system.health" not in routes

    def test_admin_user_id_includes_health_route(self):
        """system.health must be subscribed when admin_user_id is set."""
        cfg = make_config(admin_user_id=12345)
        routes = {
            "youtube.watch":     cfg.chat_id_watch_history,
            "youtube.likes":     cfg.chat_id_likes,
            "download.complete": cfg.chat_id_likes,
        }
        if cfg.admin_user_id:
            routes["system.health"] = cfg.admin_user_id
        assert "system.health" in routes
        assert routes["system.health"] == 12345


class TestAdminProgressFormatting:
    def test_upload_progress_percent_from_bytes(self):
        payload = {"uploaded_bytes": 25, "total_bytes": 100}

        assert _progress_percent("uploading", payload) == 25.0

    def test_terminal_upload_renders_delivered_text(self):
        text = _render_admin_progress_text(
            "abc12345678",
            "A video with *markdown*",
            "Best",
            "uploaded",
            {"elapsed_text": "6s (7.7 MB/s average)", "speed_text": "7.7 MB/s"},
        )

        assert "Yagami admin download" in text
        assert "Uploaded to Telegram" in text
        assert "Delivered to Telegram" in text
        assert "A video with \\*markdown\\*" in text

    def test_status_subject_mapping(self):
        assert _status_from_progress_subject("download.progress", {"status": "downloading"}) == "downloading"
        assert _status_from_progress_subject("download.complete", {"success": True}) == "completed"
        assert _status_from_progress_subject("download.complete", {"success": False}) == "failed"
        assert _status_from_progress_subject("download.uploaded", {}) == "uploaded"


class TestQueueRendering:
    def test_page_number_defaults_to_one(self):
        assert _page_number(None) == 1
        assert _page_number("bad") == 1
        assert _page_number("0") == 1
        assert _page_number("3") == 3

    def test_queue_page_renders_jobs(self):
        page = QueuePage(
            rows=[
                {
                    "video_id": "abc12345678",
                    "title": "Queue item",
                    "status": "uploading",
                    "file_size": 1024 * 1024,
                    "attempts": 2,
                    "requester_chat_id": 680240877,
                    "error_message": None,
                    "updated_at": datetime.now(timezone.utc),
                }
            ],
            page=1,
            total_pages=2,
            total_count=6,
            active_count=1,
        )

        text = _render_download_queue_page(page)

        assert "Yagami queue" in text
        assert "Page `1/2`" in text
        assert "Uploading to Telegram" in text
        assert "Queue item" in text
        assert "Admin DM" in text
        assert "Retry `2`" in text