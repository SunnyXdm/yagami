"""Tests for event handlers — uses mocks for Telegram and filesystem."""

import asyncio
import json
import math
import os
import sys
import tempfile
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from telegram_client.config import Config
from telegram_client.handlers import (
    MAX_UPLOAD_BYTES,
    TELEGRAM_THUMB_MAX_BYTES,
    TELEGRAM_PARALLEL_UPLOAD_MIN_BYTES,
    TELEGRAM_UPLOAD_PART_SIZE_KB,
    _make_upload_progress_callback,
    _create_parallel_upload_sender,
    _upload_file_to_telegram,
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
    tg.upload_file = AsyncMock(return_value="uploaded-file")
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
    async def test_subscribe_event(self, mock_tg, config):
        data = {"channel_title": "New Channel", "channel_id": "UC123"}
        await handle_event(mock_tg, "youtube.subscribe", -100555, data, config)
        mock_tg.send_message.assert_called_once()
        msg = mock_tg.send_message.call_args[0][1]
        assert "`Subscribed`" in msg
        assert "New Channel" in msg

    @pytest.mark.asyncio
    async def test_unsubscribe_event(self, mock_tg, config):
        data = {"channel_title": "Old Channel", "channel_id": "UC999"}
        await handle_event(mock_tg, "youtube.unsubscribe", -100555, data, config)
        mock_tg.send_message.assert_called_once()
        msg = mock_tg.send_message.call_args[0][1]
        assert "`Unsubscribed`" in msg
        assert "Old Channel" in msg

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

            mock_tg.upload_file.assert_called_once()
            upload_kwargs = mock_tg.upload_file.call_args[1]
            assert mock_tg.upload_file.call_args[0][0] == temp_path
            assert upload_kwargs["part_size_kb"] == TELEGRAM_UPLOAD_PART_SIZE_KB

            mock_tg.send_file.assert_called_once()
            call_kwargs = mock_tg.send_file.call_args[1]
            assert call_kwargs["entity"] == -100111
            assert call_kwargs["file"] == "uploaded-file"
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
    async def test_upload_failure_sends_error_and_preserves_file(self, mock_tg):
        """When upload raises, an error message is sent and the source file is NOT deleted."""
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"video" * 100)
            temp_path = f.name

        try:
            mock_tg.send_file.side_effect = RuntimeError("network timeout")
            data = {
                "video_id": "v_fail",
                "title": "Fail Upload",
                "success": True,
                "file_path": temp_path,
            }
            await handle_download_complete(mock_tg, -100111, data)

            # Error notification must have been sent
            mock_tg.send_message.assert_called_once()
            assert "\u274c Upload failed" in mock_tg.send_message.call_args[0][1]

            # Original file must NOT be deleted
            assert os.path.exists(temp_path), "Source file must be preserved on upload failure"
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

    def test_thumbnail_budget_keeps_previews_crisp(self):
        assert TELEGRAM_THUMB_MAX_BYTES >= 180_000

    def test_medium_videos_use_parallel_upload_path(self):
        assert TELEGRAM_PARALLEL_UPLOAD_MIN_BYTES <= 52 * 1024 * 1024

    def test_part_calculation(self):
        """Verify the number of parts for a given file size."""
        assert math.ceil(4_000_000_000 / MAX_UPLOAD_BYTES) == 3
        assert math.ceil(2_000_000_000 / MAX_UPLOAD_BYTES) == 2
        assert math.ceil(1_900_000_000 / MAX_UPLOAD_BYTES) == 1


class TestUploadProgressCallback:
    @pytest.mark.asyncio
    async def test_publishes_progress_payload_and_logs(self):
        mock_publish = AsyncMock()
        nc = object()
        total_bytes = 64 * 1024 * 1024
        uploaded_bytes = 32 * 1024 * 1024

        with patch("telegram_client.handlers._publish_download_event", mock_publish), patch(
            "telegram_client.handlers.log"
        ) as mock_log, patch("telegram_client.handlers.time.monotonic", return_value=100.0):
            callback = _make_upload_progress_callback(
                "vid-progress",
                nc,
                started_at=90.0,
                bytes_before_part=0,
                total_bytes=total_bytes,
                part=1,
                total_parts=1,
            )

            assert callback is not None
            callback(uploaded_bytes, total_bytes)
            await asyncio.sleep(0)

        mock_publish.assert_awaited_once()
        args = mock_publish.await_args.args
        assert args[0] is nc
        assert args[1] == "download.upload_progress"

        payload = args[2]
        assert payload["video_id"] == "vid-progress"
        assert payload["status"] == "uploading"
        assert payload["uploaded_bytes"] == uploaded_bytes
        assert payload["total_bytes"] == total_bytes
        assert payload["part"] == 1
        assert payload["total_parts"] == 1
        assert payload["progress_text"] == "Uploading to Telegram 50% at 3.2 MB/s"
        assert payload["speed_text"] == "3.2 MB/s"
        assert payload["eta_text"] == "10s"

        mock_log.info.assert_called_once_with(
            "%s%s",
            payload["progress_text"],
            " ETA 10s",
        )


class TestParallelTelegramUpload:
    @pytest.mark.asyncio
    async def test_parallel_upload_uses_multiple_senders_for_large_files(self):
        class FakeInputFileBig:
            def __init__(self, file_id, parts, name):
                self.id = file_id
                self.parts = parts
                self.name = name

        class FakeSaveBigFilePartRequest:
            def __init__(self, file_id, file_part, file_total_parts, bytes_):
                self.file_id = file_id
                self.file_part = file_part
                self.file_total_parts = file_total_parts
                self.bytes = bytes_

        class FakeSender:
            def __init__(self):
                self.requests = []
                self.disconnect = AsyncMock()

            async def send(self, request):
                self.requests.append(request)
                return True

        file_size = 11 * 1024 * 1024
        senders = [FakeSender() for _ in range(3)]
        tg = MagicMock()
        tg.session = MagicMock(dc_id=4)
        tg.upload_file = AsyncMock()
        progress_callback = AsyncMock()

        helpers_mod = ModuleType("telethon.helpers")

        async def _maybe_await(value):
            if asyncio.iscoroutine(value):
                return await value
            return value

        helpers_mod.generate_random_long = lambda: 123456789
        helpers_mod._maybe_await = _maybe_await

        functions_mod = ModuleType("telethon.tl.functions")
        functions_mod.upload = ModuleType("telethon.tl.functions.upload")
        functions_mod.upload.SaveBigFilePartRequest = FakeSaveBigFilePartRequest

        types_mod = ModuleType("telethon.tl.types")
        types_mod.InputFileBig = FakeInputFileBig

        telethon_mod = ModuleType("telethon")
        telethon_mod.helpers = helpers_mod

        tl_mod = ModuleType("telethon.tl")
        tl_mod.functions = functions_mod
        tl_mod.types = types_mod

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"x" * file_size)
            temp_path = f.name

        try:
            with patch("telegram_client.handlers.TELEGRAM_PARALLEL_UPLOAD_CONNECTIONS", 3), patch(
                "telegram_client.handlers.TELEGRAM_PARALLEL_UPLOAD_MIN_BYTES", 1
            ), patch.dict(
                sys.modules,
                {
                    "telethon": telethon_mod,
                    "telethon.helpers": helpers_mod,
                    "telethon.tl": tl_mod,
                    "telethon.tl.functions": functions_mod,
                    "telethon.tl.types": types_mod,
                },
            ), patch(
                "telegram_client.handlers._create_parallel_upload_sender",
                AsyncMock(side_effect=senders),
            ) as create_sender:
                uploaded = await _upload_file_to_telegram(
                    tg,
                    temp_path,
                    file_size=file_size,
                    progress_callback=progress_callback,
                )

            assert uploaded.parts == math.ceil(file_size / (TELEGRAM_UPLOAD_PART_SIZE_KB * 1024))
            assert uploaded.name == os.path.basename(temp_path)
            assert create_sender.await_count == 3
            assert sum(len(sender.requests) for sender in senders) == uploaded.parts
            assert progress_callback.await_args_list[-1].args == (file_size, file_size)
            tg.upload_file.assert_not_called()
            for sender in senders:
                sender.disconnect.assert_awaited_once()
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    @pytest.mark.asyncio
    async def test_create_parallel_upload_sender_uses_current_dc_auth_key(self):
        class FakeMTProtoSender:
            def __init__(self, auth_key, *, loggers):
                self.auth_key = auth_key
                self.loggers = loggers
                self.connected_to = None
                self.dc_id = None

            async def connect(self, connection):
                self.connected_to = connection

        mtproto_mod = ModuleType("telethon.network.mtprotosender")
        mtproto_mod.MTProtoSender = FakeMTProtoSender
        network_mod = ModuleType("telethon.network")
        network_mod.mtprotosender = mtproto_mod

        auth_key = object()
        connection = object()
        tg = MagicMock()
        tg.session = SimpleNamespace(dc_id=4, auth_key=auth_key)
        tg._sender = None
        tg._log = object()
        tg._proxy = None
        tg._local_addr = None
        tg._connection = MagicMock(return_value=connection)
        tg._get_dc = AsyncMock(return_value=SimpleNamespace(ip_address="149.154.167.50", port=443, id=4))
        tg._create_exported_sender = AsyncMock()

        with patch.dict(
            sys.modules,
            {
                "telethon.network": network_mod,
                "telethon.network.mtprotosender": mtproto_mod,
            },
        ):
            sender = await _create_parallel_upload_sender(tg, 4)

        assert isinstance(sender, FakeMTProtoSender)
        assert sender.auth_key is auth_key
        assert sender.connected_to is connection
        assert sender.dc_id == 4
        tg._create_exported_sender.assert_not_awaited()
        tg._connection.assert_called_once_with(
            "149.154.167.50",
            443,
            4,
            loggers=tg._log,
            proxy=None,
            local_addr=None,
        )

    @pytest.mark.asyncio
    async def test_create_parallel_upload_sender_uses_exported_auth_for_other_dc(self):
        exported_sender = object()
        tg = MagicMock()
        tg.session = SimpleNamespace(dc_id=4, auth_key=object())
        tg._sender = None
        tg._create_exported_sender = AsyncMock(return_value=exported_sender)

        sender = await _create_parallel_upload_sender(tg, 5)

        assert sender is exported_sender
        tg._create_exported_sender.assert_awaited_once_with(5)

    @pytest.mark.asyncio
    async def test_parallel_upload_falls_back_to_sequential_when_parallel_path_fails(self):
        file_size = 11 * 1024 * 1024
        tg = MagicMock()
        tg.session = MagicMock(dc_id=4)
        tg.upload_file = AsyncMock(return_value="sequential-upload")
        tg._create_exported_sender = AsyncMock(side_effect=RuntimeError("boom"))

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"x" * file_size)
            temp_path = f.name

        try:
            with patch("telegram_client.handlers.TELEGRAM_PARALLEL_UPLOAD_MIN_BYTES", 1):
                uploaded = await _upload_file_to_telegram(
                    tg,
                    temp_path,
                    file_size=file_size,
                    progress_callback=None,
                )

            assert uploaded == "sequential-upload"
            tg.upload_file.assert_awaited_once()
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)


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



class TestSplitVideo:
    @patch("telegram_client.handlers.subprocess.run")
    def test_split_video_raises_on_empty_duration(self, mock_run):
        """split_video must raise when ffprobe returns empty stdout."""
        mock_run.return_value = MagicMock(stdout="", returncode=0)
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"x")
            path = f.name
        try:
            with patch("telegram_client.handlers.os.path.getsize", return_value=4_000_000_000):
                with pytest.raises((RuntimeError, ValueError)):
                    split_video(path)
        finally:
            if os.path.exists(path):
                os.unlink(path)

    @patch("telegram_client.handlers.subprocess.run")
    def test_split_video_raises_on_ffmpeg_failure(self, mock_run):
        mock_run.side_effect = [
            MagicMock(stdout="120\n", stderr="", returncode=0),
            MagicMock(stdout="", stderr="mux failed", returncode=1),
        ]
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"x")
            path = f.name
        try:
            with patch("telegram_client.handlers.os.path.getsize", return_value=4_000_000_000):
                with pytest.raises(RuntimeError, match="ffmpeg failed"):
                    split_video(path)
        finally:
            if os.path.exists(path):
                os.unlink(path)

    @patch("telegram_client.handlers.subprocess.run")
    def test_split_video_resplits_oversized_parts(self, mock_run):
        def fake_run(args, **kwargs):
            if args[0] == "ffprobe":
                return MagicMock(stdout="120\n", stderr="", returncode=0)
            if args[0] == "ffmpeg":
                with open(args[-1], "wb") as handle:
                    handle.write(b"part")
                return MagicMock(stdout="", stderr="", returncode=0)
            raise AssertionError(f"unexpected command: {args}")

        mock_run.side_effect = fake_run

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"x")
            path = f.name

        initial_part = f"{path}.part1.mp4"
        nested_part_1 = f"{initial_part}.part1.mp4"
        nested_part_2 = f"{initial_part}.part2.mp4"
        second_part = f"{path}.part2.mp4"

        size_map = {
            path: 3_800_000_000,
            initial_part: 2_100_000_000,
            nested_part_1: 1_050_000_000,
            nested_part_2: 1_050_000_000,
            second_part: 1_700_000_000,
        }

        try:
            with patch("telegram_client.handlers.os.path.getsize", side_effect=lambda p: size_map[p]):
                parts = split_video(path)

            assert parts == [nested_part_1, nested_part_2, second_part]
            assert not os.path.exists(initial_part)
        finally:
            for candidate in [path, initial_part, nested_part_1, nested_part_2, second_part]:
                if os.path.exists(candidate):
                    os.unlink(candidate)