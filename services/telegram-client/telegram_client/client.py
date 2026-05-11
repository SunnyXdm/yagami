"""Main client — Telethon ↔ NATS bridge with bot commands and hot-reload."""

import asyncio
import json
import logging
import os
import re
import time

import nats
from telethon import TelegramClient, events
from telethon.sessions import StringSession

from .config import Config
from .handlers import handle_event
from .observability import install_log_handler, run_heartbeat

log = logging.getLogger(__name__)

YOUTUBE_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})"
)

START_TS = time.time()


async def run() -> None:
    # Wait for credentials; publish "starting" heartbeats while we wait.
    nc_early = None
    while True:
        config = await Config.load()
        if config.is_complete():
            break
        if nc_early is None:
            try:
                nc_early = await nats.connect(config.nats_url)
                install_log_handler(nc_early)
                asyncio.create_task(_status_heartbeat(nc_early, lambda: "starting"))
            except Exception as e:
                log.warning("waiting for NATS: %s", e)
        log.warning("Telegram credentials not configured — set them in the web UI's Settings page.")
        await asyncio.sleep(15)

    if nc_early is not None:
        await nc_early.drain()

    nc = await nats.connect(config.nats_url)
    log.info("NATS connected (%s)", config.nats_url)
    install_log_handler(nc)

    # ── Telethon ──────────────────────────────────────────────
    # Two login modes:
    #   1. Bot mode (preferred): just a token from @BotFather, no api_id/hash needed.
    #   2. User mode (advanced): api_id + api_hash + session_string from Telethon.
    if config.use_bot:
        # Bot mode still needs *some* api_id/hash for MTProto framing; fall back
        # to Telegram's published demo credentials if the user didn't set their
        # own (they're public, used by official examples).
        api_id = config.api_id or 6
        api_hash = config.api_hash or "eb06d4abfb49dc3eeb1aeb98ae0f581e"
        tg = TelegramClient(StringSession(), api_id, api_hash)
        tg.parse_mode = "md"
        try:
            await tg.start(bot_token=config.bot_token)
            log.info("Telethon started in BOT mode.")
        except Exception as e:
            log.error("Bot login failed: %s — check the token in Settings.", e)
            await asyncio.sleep(30)
            os._exit(1)
    else:
        session = StringSession(config.session_string)
        tg = TelegramClient(session, config.api_id, config.api_hash)
        tg.parse_mode = "md"
        try:
            await tg.start()
            log.info("Telethon started in USER mode.")
        except Exception as e:
            log.error("User-account login failed: %s — check api_id/api_hash/session_string.", e)
            await asyncio.sleep(30)
            os._exit(1)

    me = await tg.get_me()
    log.info("Telegram connected as @%s (id=%s)", getattr(me, "username", "?"), me.id)

    # Pre-resolve entities so .send_message(numeric_id, ...) works.
    chat_ids = {
        cid for cid in (
            config.chat_id_likes,
            config.chat_id_watch_history,
            config.chat_id_subscriptions,
            config.admin_user_id,
        ) if cid
    }
    for cid in chat_ids:
        try:
            await tg.get_entity(cid)
        except Exception as e:
            log.warning("Could not resolve chat %s: %s", cid, e)

    # State for /status command.
    state = {
        "config": config,
        "nc": nc,
        "tg": tg,
        "me": me,
        "events_handled": 0,
    }

    asyncio.create_task(_status_heartbeat(nc, lambda: "ok"))

    # ── Route NATS events → Telegram channels ─────────────────
    routes: dict[str, int] = {}
    if config.chat_id_watch_history: routes["youtube.watch"]       = config.chat_id_watch_history
    if config.chat_id_likes:         routes["youtube.likes"]       = config.chat_id_likes
    if config.chat_id_likes:         routes["download.complete"]   = config.chat_id_likes
    if config.chat_id_subscriptions:
        routes["youtube.subscribe"]   = config.chat_id_subscriptions
        routes["youtube.unsubscribe"] = config.chat_id_subscriptions
    if config.admin_user_id:         routes["system.health"]       = config.admin_user_id

    def make_route_handler(subject: str, chat_id: int):
        async def handler(msg):
            try:
                data = json.loads(msg.data.decode())
                await handle_event(tg, subject, chat_id, data, config, nc)
                state["events_handled"] += 1
            except Exception:
                log.exception("Error handling %s", subject)
        return handler

    for subject, chat_id in routes.items():
        await nc.subscribe(subject, cb=make_route_handler(subject, chat_id))
        log.info("Subscribed: %s → chat %s", subject, chat_id)

    # ── Hot-reload on config change ───────────────────────────
    async def on_config_changed(_msg):
        log.info("Configuration changed — restarting to apply…")
        await asyncio.sleep(1)
        os._exit(0)  # docker restart policy will bring us right back

    await nc.subscribe("system.config_changed", cb=on_config_changed)

    # ── Bot commands (admin only) ─────────────────────────────
    if config.admin_user_id:
        _register_admin_handlers(tg, nc, state)
        log.info("Admin handlers registered (user_id=%s)", config.admin_user_id)
    else:
        log.warning("telegram.admin_user_id is not set — bot commands disabled.")

    log.info("Telegram client ready.")
    try:
        await asyncio.Event().wait()
    finally:
        await nc.close()
        await tg.disconnect()


def _register_admin_handlers(tg: TelegramClient, nc, state: dict) -> None:
    config: Config = state["config"]
    admin = config.admin_user_id

    @tg.on(events.NewMessage(from_users=[admin], pattern=r"^/start(?:@\w+)?$"))
    async def _start(event):
        await event.reply(
            "**Yagami is online.**\n\n"
            "Available commands:\n"
            "• `/ping` — quick health check\n"
            "• `/status` — full system status\n\n"
            "Send any YouTube link and I'll download it for you."
        )

    @tg.on(events.NewMessage(from_users=[admin], pattern=r"^/ping(?:@\w+)?$"))
    async def _ping(event):
        await event.reply(f"pong — uptime {_fmt_uptime(time.time() - START_TS)}")

    @tg.on(events.NewMessage(from_users=[admin], pattern=r"^/status(?:@\w+)?$"))
    async def _status(event):
        # Reload config so we report fresh state.
        cfg = await Config.load()
        lines = [
            "**Yagami status**",
            f"• Mode: `{'bot' if cfg.use_bot else 'user-account'}`",
            f"• Telegram: connected as `@{getattr(state['me'], 'username', '?')}`",
            f"• Uptime: `{_fmt_uptime(time.time() - START_TS)}`",
            f"• Events handled: `{state['events_handled']}`",
            f"• Likes channel: {'✓' if cfg.chat_id_likes else '✗ not set'}",
            f"• History channel: {'✓' if cfg.chat_id_watch_history else '✗ not set'}",
            f"• Subscriptions channel: {'✓' if cfg.chat_id_subscriptions else '✗ not set'}",
        ]
        await event.reply("\n".join(lines))

    # YouTube-link auto-download (kept).
    @tg.on(events.NewMessage(from_users=[admin]))
    async def _on_admin_msg(event):
        text = event.message.text or ""
        if text.startswith("/"):
            return  # already handled by command handlers above
        m = YOUTUBE_RE.search(text)
        if not m:
            return
        video_id = m.group(1)
        url = f"https://www.youtube.com/watch?v={video_id}"
        log.info("Admin requested download: %s", url)
        await event.reply(f"Downloading `{video_id}`…")
        await nc.publish(
            "download.request",
            json.dumps({
                "video_id": video_id,
                "title": video_id,
                "url": url,
                "requester_chat_id": admin,
            }).encode(),
        )


async def _status_heartbeat(nc, status_fn) -> None:
    """Publish a heartbeat with a dynamic status (ok/starting/degraded)."""
    while True:
        try:
            payload = json.dumps({
                "service": "telegram-client",
                "status": status_fn(),
                "version": "1.0.0",
            }).encode()
            await nc.publish("system.heartbeat", payload)
        except Exception:
            pass
        await asyncio.sleep(30)


def _fmt_uptime(seconds: float) -> str:
    s = int(seconds)
    if s < 60: return f"{s}s"
    m, s = divmod(s, 60)
    if m < 60: return f"{m}m {s}s"
    h, m = divmod(m, 60)
    if h < 24: return f"{h}h {m}m"
    d, h = divmod(h, 24)
    return f"{d}d {h}h"
