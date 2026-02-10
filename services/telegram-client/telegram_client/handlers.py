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
import os
import tempfile

from telethon import TelegramClient

from .config import Config
from .formatter import (
    format_like,
    format_subscription,
    format_video_caption,
    format_watch,
)

log = logging.getLogger(__name__)


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
        log.info("Sent startup health report to admin")


async def handle_download_complete(
    tg: TelegramClient, chat_id: int, data: dict
) -> None:
    """Upload a downloaded video file to Telegram via MTProto."""

    video_id = data.get("video_id", "unknown")

    # Handle failed downloads
    # LEARNING: The Rust downloader sends {"success": true/false},
    # NOT {"status": "success"}. Always verify field names match between services!
    if not data.get("success", False):
        error = data.get("error", "Unknown error")
        await tg.send_message(
            chat_id,
            f"❌ Download failed: {data.get('title', video_id)}\n{error}",
        )
        log.error("Download failed for %s: %s", video_id, error)
        return

    file_path = data.get("file_path", "")
    if not file_path or not os.path.exists(file_path):
        await tg.send_message(chat_id, f"❌ File not found: {file_path}")
        log.error("File missing after download: %s", file_path)
        return

    caption = format_video_caption(data)
    file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
    log.info("Uploading %s (%.1f MB) to Telegram...", video_id, file_size_mb)

    # Download thumbnail to a temp file if URL is provided
    thumb_path = None
    thumbnail_url = data.get("thumbnail")
    if thumbnail_url:
        try:
            import urllib.request
            thumb_path = tempfile.mktemp(suffix=".jpg")
            urllib.request.urlretrieve(thumbnail_url, thumb_path)
            log.info("Downloaded thumbnail from %s", thumbnail_url)
        except Exception as e:
            log.warning("Failed to download thumbnail: %s", e)
            thumb_path = None

    # LEARNING: supports_streaming=True tells Telegram this is a video
    # that can be played inline (not just downloaded as a file).
    # Telethon MTProto allows up to 2 GB with full inline player!
    await tg.send_file(
        entity=chat_id,
        file=file_path,
        caption=caption,
        supports_streaming=True,
        thumb=thumb_path,
    )

    # Clean up — delete temp files after successful upload
    try:
        os.remove(file_path)
        log.info("Deleted temp file: %s", file_path)
    except OSError as e:
        log.warning("Could not delete %s: %s", file_path, e)

    if thumb_path and os.path.exists(thumb_path):
        try:
            os.remove(thumb_path)
            log.info("Deleted thumbnail: %s", thumb_path)
        except OSError as e:
            log.warning("Could not delete thumbnail %s: %s", thumb_path, e)

    log.info("Uploaded %s to Telegram successfully", video_id)
