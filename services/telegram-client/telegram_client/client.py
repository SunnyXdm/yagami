"""
Main client — ties Telethon + NATS together and runs forever.

LEARNING (Python):
  This module demonstrates several important patterns:
  1. Closure / factory function (make_handler) — creates callbacks
     bound to specific parameters. Similar to JS closures.
  2. asyncio.Event().wait() — blocks the event loop forever,
     keeping the program alive while NATS callbacks process messages.
  3. StringSession — stores auth state in a string instead of a file,
     making Docker deployment simpler (just an env var).
"""

import asyncio
import json
import logging
import re

import nats
from telethon import TelegramClient, events
from telethon.sessions import StringSession

from .config import Config
from .handlers import handle_event

log = logging.getLogger(__name__)

# Matches youtube.com/watch?v=, youtu.be/, youtube.com/shorts/
YOUTUBE_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})"
)


async def run() -> None:
    config = Config.from_env()

    # ── Telethon (Telegram MTProto) ──────────────────────────
    session = StringSession(config.session_string)
    tg = TelegramClient(session, config.api_id, config.api_hash)
    await tg.start()

    me = await tg.get_me()
    log.info("Telethon connected as @%s (id=%d)", me.username, me.id)

    # Pre-resolve all chat entities so Telethon can send by numeric ID.
    chat_ids = {
        config.chat_id_likes,
        config.chat_id_watch_history,
        config.admin_user_id,
    }
    for cid in chat_ids:
        try:
            await tg.get_entity(cid)
        except Exception as e:
            log.warning("Could not resolve entity %d: %s", cid, e)
    log.info("Entity cache populated")

    # ── NATS ─────────────────────────────────────────────────

    nc = await nats.connect(config.nats_url)
    log.info("NATS connected to %s", config.nats_url)

    # Map each NATS subject to the Telegram channel it should post to.
    routes = {
        "youtube.watch":         config.chat_id_watch_history,
        "youtube.likes":         config.chat_id_likes,
        "download.complete":     config.chat_id_likes,
        "system.health":         config.admin_user_id,
    }

    def make_handler(subject: str, chat_id: int):
        async def handler(msg):
            try:
                data = json.loads(msg.data.decode())
                await handle_event(tg, subject, chat_id, data, config)
            except Exception:
                log.exception("Error handling %s message", subject)
        return handler

    for subject, chat_id in routes.items():
        await nc.subscribe(subject, cb=make_handler(subject, chat_id))
        log.info("Subscribed: %s → chat %d", subject, chat_id)

    # ── Admin DM handler — download YouTube links on demand ──

    if config.admin_user_id:
        @tg.on(events.NewMessage(from_users=[config.admin_user_id]))
        async def on_admin_message(event):
            """When admin sends a YouTube URL, download and send it back."""
            text = event.message.text or ""
            match = YOUTUBE_RE.search(text)
            if not match:
                return

            video_id = match.group(1)
            url = f"https://www.youtube.com/watch?v={video_id}"

            log.info("Admin requested download: %s", url)
            await event.reply(f"`Downloading {video_id}...`")

            # Publish download request with admin's chat as the destination
            await nc.publish(
                "download.request",
                json.dumps({
                    "video_id": video_id,
                    "title": video_id,
                    "url": url,
                    "requester_chat_id": config.admin_user_id,
                }).encode(),
            )

        log.info("Admin DM handler registered for user %d", config.admin_user_id)

    # ── Run forever ──────────────────────────────────────────

    log.info("Telegram client ready — waiting for events...")
    try:
        await asyncio.Event().wait()
    finally:
        await nc.close()
        await tg.disconnect()
        log.info("Shutdown complete")
