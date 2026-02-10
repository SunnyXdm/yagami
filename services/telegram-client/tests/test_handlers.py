"""Tests for event handlers — uses mocks for Telegram and filesystem."""

import json
import os
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from telegram_client.config import Config
from telegram_client.handlers import handle_download_complete, handle_event


def make_config(**overrides) -> Config:
    defaults = dict(
        api_id=123,
        api_hash="hash",
        session_string="",
        chat_id_likes=-100111,
        chat_id_subscriptions=-100222,
        chat_id_watch_history=-100333,
        admin_user_id=0,
        nats_url="nats://localhost:4222",
        database_url="",
    )
    defaults.update(overrides)
    return Config(**defaults)


@pytest.fixture
def mock_tg():
    """Mock TelegramClient with async methods."""
    tg = AsyncMock()
    tg.send_message = AsyncMock()
    tg.send_file = AsyncMock()
    return tg


@pytest.fixture
def config():
    return make_config()


# ── handle_event routing ────────────────────────────────────


class TestHandleEvent:
    @pytest.mark.asyncio
    async def test_watch_event(self, mock_tg, config):
        data = {"title": "Test Video", "video_id": "abc", "channel_title": "Ch"}
        await handle_event(mock_tg, "youtube.watch", -100333, data, config)
        mock_tg.send_message.assert_called_once()
        msg = mock_tg.send_message.call_args[0][1]
        assert "🎬 Watched" in msg
        assert "Test Video" in msg

    @pytest.mark.asyncio
    async def test_like_event(self, mock_tg, config):
        data = {"title": "Liked Vid", "channel_title": "LikeCh"}
        await handle_event(mock_tg, "youtube.likes", -100111, data, config)
        mock_tg.send_message.assert_called_once()
        msg = mock_tg.send_message.call_args[0][1]
        assert "❤️ Liked" in msg

    @pytest.mark.asyncio
    async def test_subscription_event(self, mock_tg, config):
        data = {"channel_title": "New Channel", "channel_id": "UC999"}
        await handle_event(mock_tg, "youtube.subscriptions", -100222, data, config)
        mock_tg.send_message.assert_called_once()
        msg = mock_tg.send_message.call_args[0][1]
        assert "📺 New Subscription" in msg

    @pytest.mark.asyncio
    async def test_download_complete_routes_correctly(self, mock_tg, config):
        data = {"video_id": "vid1", "success": False, "error": "too large"}
        await handle_event(mock_tg, "download.complete", -100111, data, config)
        mock_tg.send_message.assert_called_once()
        msg = mock_tg.send_message.call_args[0][1]
        assert "❌ Download failed" in msg

    @pytest.mark.asyncio
    async def test_unknown_subject_does_nothing(self, mock_tg, config):
        await handle_event(mock_tg, "unknown.subject", -100111, {}, config)
        mock_tg.send_message.assert_not_called()
        mock_tg.send_file.assert_not_called()


# ── handle_download_complete ────────────────────────────────


class TestHandleDownloadComplete:
    @pytest.mark.asyncio
    async def test_failed_download_sends_error(self, mock_tg):
        data = {"video_id": "v1", "title": "Test", "success": False, "error": "404"}
        await handle_download_complete(mock_tg, -100111, data)
        mock_tg.send_message.assert_called_once()
        assert "❌" in mock_tg.send_message.call_args[0][1]

    @pytest.mark.asyncio
    async def test_missing_file_sends_error(self, mock_tg):
        data = {
            "video_id": "v2",
            "title": "Test",
            "success": True,
            "file_path": "/nonexistent/path.mp4",
        }
        await handle_download_complete(mock_tg, -100111, data)
        mock_tg.send_message.assert_called_once()
        assert "❌ File not found" in mock_tg.send_message.call_args[0][1]

    @pytest.mark.asyncio
    async def test_successful_upload(self, mock_tg):
        # Create a real temp file so os.path.exists + os.path.getsize work
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"fake video data " * 100)
            temp_path = f.name

        try:
            data = {
                "video_id": "v3",
                "title": "Good Video",
                "channel_title": "GoodCh",
                "success": True,
                "file_path": temp_path,
                "duration_seconds": 120,
            }
            await handle_download_complete(mock_tg, -100111, data)

            # Should have called send_file, not send_message
            mock_tg.send_file.assert_called_once()
            call_kwargs = mock_tg.send_file.call_args[1]
            assert call_kwargs["entity"] == -100111
            assert call_kwargs["file"] == temp_path
            assert call_kwargs["supports_streaming"] is True
            assert "Good Video" in call_kwargs["caption"]

            # Temp file should be deleted after upload
            assert not os.path.exists(temp_path)
        finally:
            # Clean up in case test failed before handler deleted it
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    @pytest.mark.asyncio
    async def test_empty_file_path(self, mock_tg):
        data = {"video_id": "v4", "title": "Test", "success": True, "file_path": ""}
        await handle_download_complete(mock_tg, -100111, data)
        mock_tg.send_message.assert_called_once()
        mock_tg.send_file.assert_not_called()
