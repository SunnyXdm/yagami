"""
Event handlers — process NATS messages and send to Telegram.

LEARNING (Python):
  async/await is Python's way of writing non-blocking code.
  When we `await tg.send_message(...)` Python can do other work
  while waiting for Telegram's response — just like JavaScript Promises,
  but with explicit `await` keywords everywhere.
"""

import json
import logging
import math
import os
import subprocess
import tempfile
import urllib.request

from telethon import TelegramClient

from .config import Config
from .formatter import (
    format_like,
    format_subscription,
    format_video_caption,
    format_watch,
)

log = logging.getLogger(__name__)

# Telegram MTProto max file size: 2 GB. We split at 1.95 GB to leave margin.
MAX_UPLOAD_BYTES = 1_950_000_000


async def handle_event(
    tg: TelegramClient,
    subject: str,
    chat_id: int,
    data: dict,
    config: Config,
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

    elif subject == "youtube.subscriptions":
        text = format_subscription(data)
        await tg.send_message(chat_id, text, link_preview=True)
        log.info("Sent subscription notification: %s", data.get("channel_title"))

    elif subject == "download.complete":
        await handle_download_complete(tg, chat_id, data)

    elif subject == "system.health":
        text = data.get("message", "Health check received")
        await tg.send_message(chat_id, text)
        log.info("Sent health/debug message to admin")


async def handle_download_complete(
    tg: TelegramClient, chat_id: int, data: dict
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
            f"❌ Download failed: {data.get('title', video_id)}\n{error}",
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

    # Prepare high-quality thumbnail
    thumb_path = prepare_thumbnail(data.get("thumbnail"))

    try:
        if file_size <= MAX_UPLOAD_BYTES:
            # Single file upload
            caption = format_video_caption(data)
            await tg.send_file(
                entity=target_chat,
                file=file_path,
                caption=caption,
                supports_streaming=True,
                thumb=thumb_path,
            )
            log.info("Uploaded %s to Telegram successfully", video_id)
        else:
            # Split and upload in parts
            parts = split_video(file_path)
            total = len(parts)
            log.info("File too large (%.1f MB), split into %d parts", file_size_mb, total)

            for i, part_path in enumerate(parts, 1):
                caption = format_video_caption(data, part=i, total=total)
                await tg.send_file(
                    entity=target_chat,
                    file=part_path,
                    caption=caption,
                    supports_streaming=True,
                    thumb=thumb_path,
                )
                log.info("Uploaded part %d/%d of %s", i, total, video_id)

                # Clean up part file after upload
                _safe_remove(part_path)

            log.info("All %d parts of %s uploaded successfully", total, video_id)
    finally:
        # Clean up original file and thumbnail
        _safe_remove(file_path)
        _safe_remove(thumb_path)


def prepare_thumbnail(thumbnail_url: str | None) -> str | None:
    """Download a thumbnail and resize it for Telegram (max 320x320, JPEG).

    Uses Pillow for high-quality LANCZOS downscaling to avoid blurry thumbnails.
    """
    if not thumbnail_url:
        return None

    try:
        from PIL import Image

        tmp = tempfile.mktemp(suffix=".jpg")
        urllib.request.urlretrieve(thumbnail_url, tmp)

        with Image.open(tmp) as img:
            img.thumbnail((320, 320), Image.LANCZOS)
            img.save(tmp, "JPEG", quality=95)

        log.info("Prepared thumbnail from %s", thumbnail_url)
        return tmp
    except Exception as e:
        log.warning("Failed to prepare thumbnail: %s", e)
        return None


def split_video(file_path: str) -> list[str]:
    """Split a video into parts that fit within Telegram's 2 GB limit.

    Uses ffmpeg with stream copy (no re-encoding) for speed.
    Splits by time segments calculated from file size ratio.
    """
    file_size = os.path.getsize(file_path)
    num_parts = math.ceil(file_size / MAX_UPLOAD_BYTES)

    # Get video duration via ffprobe
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
    duration = float(result.stdout.strip())
    segment_duration = duration / num_parts

    parts = []
    for i in range(num_parts):
        part_path = f"{file_path}.part{i + 1}.mp4"
        start = i * segment_duration

        subprocess.run(
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
        )
        parts.append(part_path)
        log.info("Split part %d/%d: %s", i + 1, num_parts, part_path)

    return parts


def _safe_remove(path: str | None) -> None:
    """Delete a file if it exists, logging any errors."""
    if not path or not os.path.exists(path):
        return
    try:
        os.remove(path)
    except OSError as e:
        log.warning("Could not delete %s: %s", path, e)
