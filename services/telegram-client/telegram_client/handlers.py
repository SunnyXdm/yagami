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
        await tg.send_message(chat_id, text)
        log.info("Sent watch notification: %s", data.get("title"))

    elif subject == "youtube.likes":
        text = format_like(data)
        await tg.send_message(chat_id, text)
        log.info("Sent like notification: %s", data.get("title"))

    elif subject == "youtube.subscriptions":
        text = format_subscription(data)
        await tg.send_message(chat_id, text)
        log.info("Sent subscription notification: %s", data.get("channel_title"))

    elif subject == "download.complete":
        await handle_download_complete(tg, chat_id, data)


async def handle_download_complete(
    tg: TelegramClient, chat_id: int, data: dict
) -> None:
    """Upload a downloaded video file to Telegram via MTProto."""

    video_id = data.get("video_id", "unknown")

    # Handle failed downloads
    if data.get("status") != "success":
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

    # LEARNING: supports_streaming=True tells Telegram this is a video
    # that can be played inline (not just downloaded as a file).
    # Telethon MTProto allows up to 2 GB with full inline player!
    await tg.send_file(
        entity=chat_id,
        file=file_path,
        caption=caption,
        supports_streaming=True,
    )

    # Clean up — delete the temp file after successful upload
    try:
        os.remove(file_path)
        log.info("Deleted temp file: %s", file_path)
    except OSError as e:
        log.warning("Could not delete %s: %s", file_path, e)

    log.info("Uploaded %s to Telegram successfully", video_id)
