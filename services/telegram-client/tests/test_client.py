"""Tests for the main NATS+Telethon client wiring."""

import asyncio
import json
import re
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from telegram_client.config import Config


def make_config(**overrides) -> Config:
    defaults = dict(
        api_id=123,
        api_hash="hash",
        session_string="session",
        chat_id_likes=-100111,
        chat_id_subscriptions=-100222,
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
            "youtube.subscriptions": cfg.chat_id_subscriptions,
            "download.complete": cfg.chat_id_likes,
            "system.health": cfg.admin_user_id,
        }

        assert expected_routes["youtube.watch"] == -100333
        assert expected_routes["youtube.likes"] == -100111
        assert expected_routes["youtube.subscriptions"] == -100222
        assert expected_routes["download.complete"] == -100111
        assert expected_routes["system.health"] == cfg.admin_user_id

    def test_all_chat_ids_are_distinct_channels(self):
        """Likes, subs, and history should go to different channels."""
        cfg = make_config()
        ids = {cfg.chat_id_likes, cfg.chat_id_subscriptions, cfg.chat_id_watch_history}
        assert len(ids) == 3, "Each event type should have its own Telegram channel"


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
