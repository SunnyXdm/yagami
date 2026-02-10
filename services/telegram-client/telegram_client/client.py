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

import nats
from telethon import TelegramClient
from telethon.sessions import StringSession

from .config import Config
from .handlers import handle_event

log = logging.getLogger(__name__)


async def run() -> None:
    config = Config.from_env()

    # ── Telethon (Telegram MTProto) ──────────────────────────
    #
    # StringSession stores the auth session as a base64 string.
    # On first run, session_string is empty → Telethon will prompt
    # for phone number and verification code in the terminal.
    # After auth, run scripts/gen-session.py to get the string
    # and put it in .env so subsequent starts are automatic.

    session = StringSession(config.session_string)
    tg = TelegramClient(session, config.api_id, config.api_hash)
    await tg.start()

    me = await tg.get_me()
    log.info("Telethon connected as @%s (id=%d)", me.username, me.id)

    # ── NATS ─────────────────────────────────────────────────

    nc = await nats.connect(config.nats_url)
    log.info("NATS connected to %s", config.nats_url)

    # Map each NATS subject to the Telegram channel it should post to.
    routes = {
        "youtube.watch":         config.chat_id_watch_history,
        "youtube.likes":         config.chat_id_likes,
        "youtube.subscriptions": config.chat_id_subscriptions,
        "download.complete":     config.chat_id_likes,
        "system.health":         config.admin_user_id,
    }

    # LEARNING: We need a factory function here because Python closures
    # capture *variables*, not *values*. Without this, every callback
    # would use the last values of `subject` and `chat_id` from the loop.
    # This is the same "closure in a loop" gotcha as in JavaScript.

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

    # ── Run forever ──────────────────────────────────────────

    log.info("Telegram client ready — waiting for events...")
    try:
        # asyncio.Event().wait() blocks forever without burning CPU.
        await asyncio.Event().wait()
    finally:
        await nc.close()
        await tg.disconnect()
        log.info("Shutdown complete")
