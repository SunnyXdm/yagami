"""Tests for event handlers — uses mocks for Telegram and filesystem."""

import json
import math
import os
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from telegram_client.config import Config
from telegram_client.handlers import (
    MAX_UPLOAD_BYTES,
    handle_download_complete,
    handle_event,
    prepare_thumbnail,
    split_video,
    _safe_remove,
    _get_video_dimensions,
    _crop_to_ratio,
)


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
        assert "`Watched`" in msg
        assert "Test Video" in msg

    @pytest.mark.asyncio
    async def test_like_event(self, mock_tg, config):
        data = {"title": "Liked Vid", "channel_title": "LikeCh"}
        await handle_event(mock_tg, "youtube.likes", -100111, data, config)
        mock_tg.send_message.assert_called_once()
        msg = mock_tg.send_message.call_args[0][1]
        assert "`Liked`" in msg

    @pytest.mark.asyncio
    async def test_subscription_event(self, mock_tg, config):
        data = {"channel_title": "New Channel", "channel_id": "UC999"}
        await handle_event(mock_tg, "youtube.subscriptions", -100222, data, config)
        mock_tg.send_message.assert_called_once()
        msg = mock_tg.send_message.call_args[0][1]
        assert "`Subscribed to`" in msg

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

    @pytest.mark.asyncio
    async def test_health_report_sent_to_admin(self, mock_tg, config):
        data = {"message": "✅ Yagami started (3/3 checks passed)", "passed": 3, "total": 3}
        await handle_event(mock_tg, "system.health", config.admin_user_id, data, config)
        mock_tg.send_message.assert_called_once()
        msg = mock_tg.send_message.call_args[0][1]
        assert "Yagami started" in msg


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
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"fake video data" * 100)
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

            mock_tg.send_file.assert_called_once()
            call_kwargs = mock_tg.send_file.call_args[1]
            assert call_kwargs["entity"] == -100111
            assert call_kwargs["file"] == temp_path
            assert call_kwargs["supports_streaming"] is True
            assert "Good Video" in call_kwargs["caption"]

            # Temp file should be deleted after upload
            assert not os.path.exists(temp_path)
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    @pytest.mark.asyncio
    async def test_empty_file_path(self, mock_tg):
        data = {"video_id": "v4", "title": "Test", "success": True, "file_path": ""}
        await handle_download_complete(mock_tg, -100111, data)
        mock_tg.send_message.assert_called_once()
        mock_tg.send_file.assert_not_called()

    @pytest.mark.asyncio
    async def test_upload_without_thumbnail(self, mock_tg):
        """Verify upload works even when thumbnail field is missing."""
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"data")
            temp_path = f.name

        try:
            data = {
                "video_id": "v5",
                "title": "No Thumb",
                "success": True,
                "file_path": temp_path,
            }
            await handle_download_complete(mock_tg, -100111, data)
            mock_tg.send_file.assert_called_once()
            call_kwargs = mock_tg.send_file.call_args[1]
            assert call_kwargs["thumb"] is None
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    @pytest.mark.asyncio
    async def test_requester_chat_id_overrides_target(self, mock_tg):
        """Admin-requested downloads go to the requester, not the likes channel."""
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"data")
            temp_path = f.name

        try:
            data = {
                "video_id": "v6",
                "title": "Admin Vid",
                "success": True,
                "file_path": temp_path,
                "requester_chat_id": 999,
            }
            await handle_download_complete(mock_tg, -100111, data)
            mock_tg.send_file.assert_called_once()
            call_kwargs = mock_tg.send_file.call_args[1]
            # Should send to requester (999), not default chat (-100111)
            assert call_kwargs["entity"] == 999
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    @pytest.mark.asyncio
    async def test_failed_download_goes_to_requester(self, mock_tg):
        """Error messages also go to the requester for admin downloads."""
        data = {
            "video_id": "v7",
            "title": "Fail",
            "success": False,
            "error": "network",
            "requester_chat_id": 888,
        }
        await handle_download_complete(mock_tg, -100111, data)
        # Error sent to requester (888), not default
        assert mock_tg.send_message.call_args[0][0] == 888


# ── prepare_thumbnail ───────────────────────────────────────


class TestPrepareThumbnail:
    def test_returns_none_for_no_url(self):
        assert prepare_thumbnail(None) is None
        assert prepare_thumbnail("") is None

    def test_returns_none_on_error(self):
        # Invalid URL should fail gracefully
        result = prepare_thumbnail("not-a-url")
        assert result is None


class TestGetVideoDimensions:
    def test_returns_none_for_no_path(self):
        assert _get_video_dimensions(None) == (None, None)
        assert _get_video_dimensions("") == (None, None)

    def test_returns_none_for_missing_file(self):
        assert _get_video_dimensions("/nonexistent/video.mp4") == (None, None)

    @patch("telegram_client.handlers.subprocess.run")
    def test_parses_ffprobe_output(self, mock_run):
        mock_run.return_value = MagicMock(stdout="1920x1080\n")
        with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
            w, h = _get_video_dimensions(f.name)
        assert (w, h) == (1920, 1080)


class TestCropToRatio:
    def test_crop_wider_image(self):
        from PIL import Image
        # 4:3 image (400x300) cropped to 16:9 target
        img = Image.new("RGB", (400, 300))
        result = _crop_to_ratio(img, 1920, 1080)
        # Result should be 16:9 ratio
        w, h = result.size
        assert abs(w / h - 16 / 9) < 0.02

    def test_already_correct_ratio(self):
        from PIL import Image
        img = Image.new("RGB", (320, 180))  # already 16:9
        result = _crop_to_ratio(img, 1920, 1080)
        assert result.size == (320, 180)

    def test_crop_taller_image(self):
        from PIL import Image
        # Tall image cropped to wide target
        img = Image.new("RGB", (200, 400))
        result = _crop_to_ratio(img, 1920, 1080)
        w, h = result.size
        assert abs(w / h - 16 / 9) < 0.02


# ── split_video (unit logic) ────────────────────────────────


class TestSplitVideoConstants:
    def test_max_upload_constant(self):
        assert MAX_UPLOAD_BYTES == 1_950_000_000

    def test_part_calculation(self):
        """Verify the number of parts for a given file size."""
        assert math.ceil(4_000_000_000 / MAX_UPLOAD_BYTES) == 3
        assert math.ceil(2_000_000_000 / MAX_UPLOAD_BYTES) == 2
        assert math.ceil(1_900_000_000 / MAX_UPLOAD_BYTES) == 1


# ── _safe_remove ────────────────────────────────────────────


class TestSafeRemove:
    def test_removes_existing_file(self):
        with tempfile.NamedTemporaryFile(delete=False) as f:
            path = f.name
        _safe_remove(path)
        assert not os.path.exists(path)

    def test_ignores_none(self):
        _safe_remove(None)  # Should not raise

    def test_ignores_missing_file(self):
        _safe_remove("/nonexistent/file.tmp")  # Should not raise
