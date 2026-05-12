"""
Event handlers — process NATS messages and send to Telegram.

LEARNING (Python):
  async/await is Python's way of writing non-blocking code.
  When we `await tg.send_message(...)` Python can do other work
  while waiting for Telegram's response — just like JavaScript Promises,
  but with explicit `await` keywords everywhere.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
import subprocess
import tempfile
import time
import urllib.request
from typing import Any

try:
    from telethon import TelegramClient
    from telethon.tl.types import DocumentAttributeVideo, DocumentAttributeFilename
except ImportError:  # pragma: no cover - lets pure unit tests run without Telethon installed.
    TelegramClient = Any

    class DocumentAttributeVideo:  # type: ignore[no-redef]
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    class DocumentAttributeFilename:  # type: ignore[no-redef]
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

from .config import Config
from .formatter import (
    format_like,
    format_subscribe,
    format_unsubscribe,
    format_video_caption,
    format_watch,
)

log = logging.getLogger(__name__)

# Telegram MTProto max file size: 2 GB. We split at 1.95 GB to leave margin.
MAX_UPLOAD_BYTES = 1_950_000_000
TELEGRAM_THUMB_MAX_DIMENSION = 320
TELEGRAM_THUMB_MAX_BYTES = 20_000
YOUTUBE_THUMB_RE = re.compile(r"(?:i\.ytimg\.com|img\.youtube\.com)/vi(?:_webp)?/([a-zA-Z0-9_-]{11})/")


async def handle_event(
    tg: TelegramClient,
    subject: str,
    chat_id: int,
    data: dict,
    config: Config,
    nc: Any | None = None,
) -> None:
    """Route a NATS message to the right handler and Telegram channel."""

    if subject == "youtube.watch":
        text = format_watch(data)
        await tg.send_message(chat_id, text, link_preview=True)
        log.info("Sent watch notification: %s", data.get("title"))

    elif subject == "youtube.likes":
        text = format_like(data)
        await tg.send_message(chat_id, text, link_preview=True)
        log.info("Sent like notification: %s", data.get("title"))

    elif subject == "youtube.subscribe":
        text = format_subscribe(data)
        await tg.send_message(chat_id, text, link_preview=True)
        log.info("Sent subscribe notification: %s", data.get("channel_title") or data.get("channel_id"))

    elif subject == "youtube.unsubscribe":
        text = format_unsubscribe(data)
        await tg.send_message(chat_id, text, link_preview=True)
        log.info("Sent unsubscribe notification: %s", data.get("channel_title") or data.get("channel_id"))

    elif subject == "download.complete":
        await handle_download_complete(tg, chat_id, data, config, nc)

    elif subject == "system.health":
        text = data.get("message", "Health check received")
        await tg.send_message(chat_id, text)
        log.info("Sent health/debug message to admin")


async def handle_download_complete(
    tg: TelegramClient,
    chat_id: int,
    data: dict,
    config: Config | None = None,
    nc: Any | None = None,
) -> None:
    """Upload a downloaded video file to Telegram via MTProto.

    If the file exceeds 2 GB, it is split into parts using ffmpeg
    and uploaded sequentially.

    If requester_chat_id is present (admin-requested download),
    the file is sent to that chat instead of the default likes channel.
    """
    video_id = data.get("video_id", "unknown")

    # Route to requester if this was an admin-initiated download
    target_chat = data.get("requester_chat_id") or chat_id

    # Handle failed downloads
    if not data.get("success", False):
        error = data.get("error", "Unknown error")
        await tg.send_message(
            target_chat,
            f"❌ Download failed: {_display_title(data)}\n{error}",
        )
        log.error("Download failed for %s: %s", video_id, error)
        return

    file_path = data.get("file_path", "")
    if not file_path or not os.path.exists(file_path):
        await tg.send_message(target_chat, f"❌ File not found: {file_path}")
        log.error("File missing after download: %s", file_path)
        return

    file_size = os.path.getsize(file_path)
    file_size_mb = file_size / (1024 * 1024)
    log.info("Uploading %s (%.1f MB) to Telegram...", video_id, file_size_mb)

    if config is not None:
        await _update_download_status(
            config,
            video_id,
            "uploading",
            telegram_chat_id=int(target_chat),
        )

    # Prepare high-quality thumbnail matching the video's aspect ratio
    thumb_path = prepare_thumbnail(data.get("thumbnail"), file_path)

    # Get explicit video dimensions + duration for Telegram metadata.
    # Without this, Telethon can't detect dimensions (needs hachoir)
    # and Telegram renders the preview with wrong aspect ratio.
    video_w, video_h = _get_video_dimensions(file_path)
    duration_secs = _get_video_duration(file_path)
    video_attrs = _make_video_attributes(video_id, video_w, video_h, duration_secs)

    upload_succeeded = False
    part_paths: list[str] = []
    total_upload_parts = 1
    last_message_id: int | None = None
    try:
        if file_size <= MAX_UPLOAD_BYTES:
            # Single file upload
            caption = format_video_caption(data)
            message = await tg.send_file(
                entity=target_chat,
                file=file_path,
                file_size=file_size,
                caption=caption,
                supports_streaming=True,
                thumb=thumb_path,
                attributes=video_attrs,
                progress_callback=_make_upload_progress_callback(
                    video_id,
                    nc,
                    bytes_before_part=0,
                    total_bytes=file_size,
                    part=1,
                    total_parts=1,
                ),
            )
            last_message_id = getattr(message, "id", None)
            log.info("Uploaded %s to Telegram successfully", video_id)
            upload_succeeded = True
        else:
            # Split and upload in parts
            parts = split_video(file_path)
            part_paths = list(parts)
            total = len(parts)
            total_upload_parts = total
            total_bytes = sum(os.path.getsize(part_path) for part_path in parts)
            bytes_before_part = 0
            log.info("File too large (%.1f MB), split into %d parts", file_size_mb, total)

            for i, part_path in enumerate(parts, 1):
                caption = format_video_caption(data, part=i, total=total)
                part_w, part_h = _get_video_dimensions(part_path)
                part_dur = _get_video_duration(part_path)
                part_attrs = _make_video_attributes(video_id, part_w or video_w, part_h or video_h, part_dur)
                part_size = os.path.getsize(part_path)
                message = await tg.send_file(
                    entity=target_chat,
                    file=part_path,
                    file_size=part_size,
                    caption=caption,
                    supports_streaming=True,
                    thumb=thumb_path,
                    attributes=part_attrs,
                    progress_callback=_make_upload_progress_callback(
                        video_id,
                        nc,
                        bytes_before_part=bytes_before_part,
                        total_bytes=total_bytes,
                        part=i,
                        total_parts=total,
                    ),
                )
                last_message_id = getattr(message, "id", None)
                bytes_before_part += part_size
                log.info("Uploaded part %d/%d of %s", i, total, video_id)

                # Clean up part file after upload
                _safe_remove(part_path)

            log.info("All %d parts of %s uploaded successfully", total, video_id)
            upload_succeeded = True

        if upload_succeeded and config is not None:
            await _update_download_status(
                config,
                video_id,
                "uploaded",
                telegram_chat_id=int(target_chat),
                telegram_msg_id=last_message_id if total_upload_parts == 1 else None,
            )
        await _publish_download_event(
            nc,
            "download.uploaded",
            {
                "video_id": video_id,
                "status": "uploaded",
                "telegram_chat_id": int(target_chat),
                "telegram_msg_id": last_message_id if total_upload_parts == 1 else None,
                "total_parts": total_upload_parts,
            },
        )
    except Exception as exc:
        log.exception("Upload failed for %s", video_id)
        if config is not None:
            await _update_download_status(
                config,
                video_id,
                "upload_failed",
                telegram_chat_id=int(target_chat),
                error=f"Upload failed: {exc}",
            )
        await _publish_download_event(
            nc,
            "download.upload_failed",
            {
                "video_id": video_id,
                "status": "upload_failed",
                "telegram_chat_id": int(target_chat),
                "error": str(exc),
            },
        )
        try:
            await tg.send_message(
                target_chat,
                f"\u274c Upload failed: {_display_title(data)}\n{exc}",
            )
        except Exception:
            log.exception("Failed to send upload error notification for %s", video_id)
    finally:
        for part_path in part_paths:
            _safe_remove(part_path)
        if upload_succeeded:
            _safe_remove(file_path)
        _safe_remove(thumb_path)


def _display_title(data: dict) -> str:
    return str(data.get("title") or "Untitled video")


def prepare_thumbnail(thumbnail_url: str | None, video_path: str | None = None) -> str | None:
    """Prepare a Telegram-compatible JPEG thumbnail.

    Telegram ignores document thumbnails that are too large, so we keep the
    sharpest available YouTube source, crop it to the video's aspect ratio,
    and then compress it into Telegram's accepted thumbnail envelope.
    """
    if not thumbnail_url:
        return None

    tmp = None
    try:
        from PIL import Image

        fd, tmp = tempfile.mkstemp(suffix=".jpg")
        os.close(fd)
        source_url = _download_thumbnail_image(thumbnail_url, tmp)

        # Get the video's actual aspect ratio
        video_w, video_h = _get_video_dimensions(video_path)

        with Image.open(tmp) as img:
            if video_w and video_h:
                img = _crop_to_ratio(img, video_w, video_h)

            img, saved_bytes = _finalize_telegram_thumbnail(img, tmp)
            out_w, out_h = img.size

        log.info(
            "Prepared Telegram thumbnail (%dx%d, %d bytes, video %dx%d) from %s",
            out_w,
            out_h,
            saved_bytes,
            video_w or 0,
            video_h or 0,
            source_url,
        )
        return tmp
    except Exception as e:
        log.warning("Failed to prepare thumbnail: %s", e)
        _safe_remove(tmp)
        return None


def _download_thumbnail_image(thumbnail_url: str, output_path: str) -> str:
    last_error: Exception | None = None
    for candidate in _thumbnail_candidate_urls(thumbnail_url):
        try:
            with urllib.request.urlopen(candidate, timeout=10) as response:
                data = response.read()
            if not data:
                continue
            with open(output_path, "wb") as handle:
                handle.write(data)
            return candidate
        except Exception as e:
            last_error = e

    if last_error is not None:
        raise last_error
    raise RuntimeError("No thumbnail candidates succeeded")


def _thumbnail_candidate_urls(thumbnail_url: str) -> list[str]:
    match = YOUTUBE_THUMB_RE.search(thumbnail_url)
    if not match:
        return [thumbnail_url]

    video_id = match.group(1)
    use_webp = "/vi_webp/" in thumbnail_url or thumbnail_url.endswith(".webp")
    prefix = "vi_webp" if use_webp else "vi"
    ext = "webp" if use_webp else "jpg"
    candidates = [
        f"https://i.ytimg.com/{prefix}/{video_id}/maxresdefault.{ext}",
        f"https://i.ytimg.com/{prefix}/{video_id}/sddefault.{ext}",
        f"https://i.ytimg.com/{prefix}/{video_id}/hqdefault.{ext}",
        f"https://i.ytimg.com/{prefix}/{video_id}/mqdefault.{ext}",
        thumbnail_url,
    ]

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped


def _finalize_telegram_thumbnail(img, output_path: str):
    from PIL import Image

    working = img.convert("RGB")
    for max_dimension in (TELEGRAM_THUMB_MAX_DIMENSION, 280, 240, 200):
        sized = _resize_max_dimension(working, max_dimension)
        for quality in (95, 90, 85, 80, 75, 70, 65, 60):
            sized.save(
                output_path,
                "JPEG",
                quality=quality,
                optimize=True,
                progressive=True,
                subsampling=0,
            )
            saved_bytes = os.path.getsize(output_path)
            if saved_bytes <= TELEGRAM_THUMB_MAX_BYTES:
                return sized, saved_bytes

    fallback = _resize_max_dimension(working, 160)
    fallback.save(
        output_path,
        "JPEG",
        quality=55,
        optimize=True,
        progressive=True,
        subsampling=0,
    )
    return fallback, os.path.getsize(output_path)


def _resize_max_dimension(img, max_dimension: int):
    from PIL import Image

    width, height = img.size
    largest_side = max(width, height)
    if largest_side <= max_dimension:
        return img

    scale = max_dimension / largest_side
    resized = (
        max(1, int(round(width * scale))),
        max(1, int(round(height * scale))),
    )
    return img.resize(resized, Image.Resampling.LANCZOS)


def _get_video_dimensions(video_path: str | None) -> tuple[int | None, int | None]:
    """Extract width and height from a video file using ffprobe."""
    if not video_path or not os.path.exists(video_path):
        return None, None
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "csv=s=x:p=0",
                video_path,
            ],
            capture_output=True,
            text=True,
        )
        parts = result.stdout.strip().split("x")
        if len(parts) == 2:
            return int(parts[0]), int(parts[1])
    except Exception as e:
        log.warning("Could not read video dimensions: %s", e)
    return None, None


def _get_video_duration(video_path: str | None) -> int:
    """Extract duration in seconds from a video file using ffprobe."""
    if not video_path or not os.path.exists(video_path):
        return 0
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path,
            ],
            capture_output=True,
            text=True,
        )
        return int(float(result.stdout.strip()))
    except Exception as e:
        log.warning("Could not read video duration: %s", e)
    return 0


def _make_video_attributes(
    video_id: str,
    w: int | None,
    h: int | None,
    duration: int,
) -> list:
    """Build Telethon document attributes for a video upload.

    Explicitly sets width, height, and duration so Telegram renders the
    correct aspect ratio in the preview card — Telethon cannot detect
    these without the hachoir library installed.
    """
    attrs = [
        DocumentAttributeFilename(f"{video_id}.mp4"),
    ]
    if w and h:
        attrs.append(
            DocumentAttributeVideo(
                duration=duration,
                w=w,
                h=h,
                supports_streaming=True,
            )
        )
    return attrs


def _crop_to_ratio(img, target_w: int, target_h: int):
    """Center-crop an image to match the target aspect ratio."""
    from PIL import Image

    img_w, img_h = img.size
    target_ratio = target_w / target_h
    img_ratio = img_w / img_h

    if abs(target_ratio - img_ratio) < 0.01:
        # Already close enough
        return img

    if img_ratio > target_ratio:
        # Image is wider than target — crop sides
        new_w = int(img_h * target_ratio)
        offset = (img_w - new_w) // 2
        return img.crop((offset, 0, offset + new_w, img_h))
    else:
        # Image is taller than target — crop top/bottom
        new_h = int(img_w / target_ratio)
        offset = (img_h - new_h) // 2
        return img.crop((0, offset, img_w, offset + new_h))


def split_video(file_path: str) -> list[str]:
    """Split a video into parts that fit within Telegram's 2 GB limit.

    Uses ffmpeg with stream copy (no re-encoding) for speed.
    Splits by time segments calculated from file size ratio.
    """
    file_size = os.path.getsize(file_path)
    if file_size <= MAX_UPLOAD_BYTES:
        return [file_path]

    duration = _probe_duration_seconds(file_path)
    return _split_video_parts(file_path, file_size, duration)


def _split_video_parts(file_path: str, file_size: int, duration: float) -> list[str]:
    num_parts = math.ceil(file_size / MAX_UPLOAD_BYTES)
    segment_duration = duration / num_parts

    parts = []
    for i in range(num_parts):
        part_path = f"{file_path}.part{i + 1}.mp4"
        start = i * segment_duration

        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(start),
                "-i", file_path,
                "-t", str(segment_duration),
                "-c", "copy",
                "-movflags", "+faststart",
                part_path,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed while splitting {file_path}: {result.stderr.strip() or 'unknown error'}")
        if not os.path.exists(part_path):
            raise RuntimeError(f"ffmpeg did not produce split output {part_path}")

        part_size = os.path.getsize(part_path)
        if part_size <= 0:
            raise RuntimeError(f"ffmpeg produced an empty split output {part_path}")

        if part_size > MAX_UPLOAD_BYTES:
            nested_duration = _probe_duration_seconds(part_path)
            nested_parts = _split_video_parts(part_path, part_size, nested_duration)
            _safe_remove(part_path)
            parts.extend(nested_parts)
            log.info("Resplit oversized part %d/%d: %s", i + 1, num_parts, part_path)
            continue

        parts.append(part_path)
        log.info("Split part %d/%d: %s", i + 1, num_parts, part_path)

    return parts


def _probe_duration_seconds(file_path: str) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            file_path,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {file_path}: {result.stderr.strip() or 'unknown error'}")

    stdout = result.stdout.strip()
    if not stdout:
        raise RuntimeError(f"ffprobe returned empty duration output for {file_path}")

    duration = float(stdout)
    if duration <= 0:
        raise RuntimeError(f"ffprobe returned non-positive duration {duration!r} for {file_path}")
    return duration


def _safe_remove(path: str | None) -> None:
    """Delete a file if it exists, logging any errors."""
    if not path or not os.path.exists(path):
        return
    try:
        os.remove(path)
    except OSError as e:
        log.warning("Could not delete %s: %s", path, e)


def _make_upload_progress_callback(
    video_id: str,
    nc: Any | None,
    *,
    bytes_before_part: int,
    total_bytes: int,
    part: int,
    total_parts: int,
):
    if nc is None or total_bytes <= 0:
        return None

    loop = asyncio.get_running_loop()
    last_sent = {"bytes": -1, "ts": 0.0}

    def callback(current: int | float, total: int | float) -> None:
        sent_now = max(bytes_before_part, min(bytes_before_part + int(current), total_bytes))
        now = time.monotonic()
        if sent_now < total_bytes and sent_now - last_sent["bytes"] < 16 * 1024 * 1024 and now - last_sent["ts"] < 1.0:
            return

        last_sent["bytes"] = sent_now
        last_sent["ts"] = now
        loop.create_task(
            _publish_download_event(
                nc,
                "download.upload_progress",
                {
                    "video_id": video_id,
                    "status": "uploading",
                    "uploaded_bytes": sent_now,
                    "total_bytes": total_bytes,
                    "part": part,
                    "total_parts": total_parts,
                },
            )
        )

    return callback


async def _publish_download_event(nc: Any | None, subject: str, payload: dict[str, Any]) -> None:
    if nc is None:
        return
    try:
        await nc.publish(subject, json.dumps(payload).encode())
    except Exception:
        log.exception("Failed to publish %s for %s", subject, payload.get("video_id"))


async def _update_download_status(
    config: Config,
    video_id: str,
    status: str,
    *,
    telegram_msg_id: int | None = None,
    telegram_chat_id: int | None = None,
    error: str | None = None,
) -> None:
    try:
        import asyncpg

        conn = await asyncpg.connect(config.database_url)
        try:
            await conn.execute(
                """
                UPDATE downloads
                   SET status = $2,
                       telegram_msg_id = COALESCE($3, telegram_msg_id),
                       telegram_chat_id = COALESCE($4, telegram_chat_id),
                       error_message = CASE WHEN $5::text IS NULL THEN NULL ELSE $5 END,
                       updated_at = NOW()
                 WHERE video_id = $1
                """,
                video_id,
                status,
                telegram_msg_id,
                telegram_chat_id,
                error,
            )
        finally:
            await conn.close()
    except Exception:
        log.exception("Failed to update download status for %s", video_id)
