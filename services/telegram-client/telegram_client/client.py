"""Main client — Telethon ↔ NATS bridge with bot commands and hot-reload."""

import asyncio
from dataclasses import dataclass
import json
import logging
import os
import re
import time

import nats
from telethon import Button, TelegramClient, events
from telethon.errors import FloodWaitError
from telethon.network.connection.tcpabridged import ConnectionTcpAbridged
from telethon.sessions import StringSession
from telethon.tl.functions.bots import SetBotCommandsRequest
from telethon.tl.types import BotCommand, BotCommandScopeDefault

from .config import Config
from .handlers import handle_event
from .observability import install_log_handler, run_heartbeat

log = logging.getLogger(__name__)

YOUTUBE_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})"
)

START_TS = time.time()
ADMIN_REQUEST_PRIORITY = 100
PENDING_DOWNLOAD_TTL_SECONDS = 15 * 60
DEFAULT_QUALITY_OPTIONS = [
    {"key": "best", "label": "Best"},
    {"key": "1080", "label": "1080p"},
    {"key": "720", "label": "720p"},
    {"key": "480", "label": "480p"},
    {"key": "360", "label": "360p"},
]
BOT_COMMANDS = [
    ("start", "Show help"),
    ("cmds", "List admin commands"),
    ("status", "Show service status"),
    ("settings", "Open web settings"),
    ("downloads", "Open download queue"),
    ("ping", "Quick health check"),
]


@dataclass
class PendingDownloadRequest:
    video_id: str
    url: str
    title: str
    thumbnail: str | None
    qualities: list[dict]
    created_at: float


_pending_downloads: dict[str, PendingDownloadRequest] = {}


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
    service_status = {"value": "starting"}
    asyncio.create_task(_status_heartbeat(nc, lambda: service_status["value"]))

    # ── Telethon ──────────────────────────────────────────────
    # Two login modes:
    #   1. Bot mode (preferred): just a token from @BotFather, no api_id/hash needed.
    #   2. User mode (advanced): api_id + api_hash + session_string from Telethon.
    if config.use_bot:
        tg = await _start_bot_client(config, service_status)
        await _install_bot_commands(tg)
    else:
        tg = await _start_user_client(config, service_status)

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

    service_status["value"] = "ok"

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


async def _start_bot_client(config: Config, service_status: dict[str, str]) -> TelegramClient:
    # Bot mode still needs *some* api_id/hash for MTProto framing; fall back
    # to Telegram's published demo credentials if the user didn't set their
    # own (they're public, used by official examples).
    api_id = config.api_id or 6
    api_hash = config.api_hash or "eb06d4abfb49dc3eeb1aeb98ae0f581e"

    while True:
        tg = TelegramClient(_bot_session_path(config), api_id, api_hash, connection=ConnectionTcpAbridged)
        tg.parse_mode = "md"
        try:
            await tg.start(bot_token=config.bot_token)
            log.info("Telethon started in BOT mode.")
            return tg
        except FloodWaitError as exc:
            wait_seconds = max(int(getattr(exc, "seconds", 0)), 60)
            service_status["value"] = "degraded"
            log.error(
                "Telegram bot login is flood-waited for %s seconds; holding the process instead of restart-looping.",
                wait_seconds,
            )
            await _safe_disconnect(tg)
            await asyncio.sleep(wait_seconds + 5)
            service_status["value"] = "starting"
        except Exception as exc:
            service_status["value"] = "degraded"
            log.error("Bot login failed: %s — retrying in 5 minutes.", exc)
            await _safe_disconnect(tg)
            await asyncio.sleep(300)
            service_status["value"] = "starting"


async def _start_user_client(config: Config, service_status: dict[str, str]) -> TelegramClient:
    while True:
        tg = TelegramClient(StringSession(config.session_string), config.api_id, config.api_hash, connection=ConnectionTcpAbridged)
        tg.parse_mode = "md"
        try:
            await tg.start()
            log.info("Telethon started in USER mode.")
            return tg
        except Exception as exc:
            service_status["value"] = "degraded"
            log.error("User-account login failed: %s — retrying in 5 minutes.", exc)
            await _safe_disconnect(tg)
            await asyncio.sleep(300)
            service_status["value"] = "starting"


async def _safe_disconnect(tg: TelegramClient) -> None:
    try:
        await tg.disconnect()
    except Exception:
        pass


async def _install_bot_commands(tg: TelegramClient) -> None:
    commands = [BotCommand(command=command, description=description) for command, description in BOT_COMMANDS]
    try:
        await tg(SetBotCommandsRequest(scope=BotCommandScopeDefault(), lang_code="", commands=commands))
        log.info("Installed Telegram bot command menu: %s", ", ".join(f"/{command}" for command, _ in BOT_COMMANDS))
    except Exception:
        log.exception("Could not install Telegram bot command menu")


def _web_url(config: Config, path: str = "") -> str:
    base = config.web_url.rstrip("/")
    if not path:
        return base
    return f"{base}/{path.lstrip('/')}"


def _bot_session_path(config: Config) -> str:
    bot_id = config.bot_token.split(":", 1)[0] or "bot"
    bot_id = re.sub(r"[^0-9A-Za-z_-]", "", bot_id) or "bot"
    os.makedirs(config.session_dir, exist_ok=True)
    return os.path.join(config.session_dir, f"telegram-bot-{bot_id}")


def _command_list_text(config: Config) -> str:
    return "\n".join([
        "**Yagami commands**",
        "",
        "• `/status` — service status",
        "• `/settings` — open web settings",
        "• `/downloads` — open download queue",
        "• `/ping` — quick health check",
        "",
        "Send a YouTube link to choose quality and queue an admin download.",
        f"Web UI: {_web_url(config)}",
    ])


def _command_buttons(config: Config) -> list[list[Button]]:
    return [[
        Button.url("Settings", _web_url(config, "settings")),
        Button.url("Downloads", _web_url(config, "downloads")),
    ]]


def _register_admin_handlers(tg: TelegramClient, nc, state: dict) -> None:
    config: Config = state["config"]
    admin = config.admin_user_id

    @tg.on(events.NewMessage(from_users=[admin], pattern=r"^/start(?:@\w+)?$"))
    async def _start(event):
        await event.reply(_command_list_text(config), buttons=_command_buttons(config) if config.use_bot else None)

    @tg.on(events.NewMessage(from_users=[admin], pattern=r"^/(?:cmds|help)(?:@\w+)?$"))
    async def _cmds(event):
        await event.reply(_command_list_text(config), buttons=_command_buttons(config) if config.use_bot else None)

    @tg.on(events.NewMessage(from_users=[admin], pattern=r"^/settings(?:@\w+)?$"))
    async def _settings(event):
        url = _web_url(config, "settings")
        buttons = [[Button.url("Open settings", url)]] if config.use_bot else None
        await event.reply(f"Settings: {url}", buttons=buttons)

    @tg.on(events.NewMessage(from_users=[admin], pattern=r"^/downloads(?:@\w+)?$"))
    async def _downloads(event):
        url = _web_url(config, "downloads")
        buttons = [[Button.url("Open queue", url)]] if config.use_bot else None
        await event.reply(f"Download queue: {url}", buttons=buttons)

    @tg.on(events.NewMessage(from_users=[admin], pattern=r"^/dl(?:@\w+)?\s+([A-Za-z0-9_-]{11})\s+(\S+)$"))
    async def _text_quality_selected(event):
        video_id = event.pattern_match.group(1)
        quality_key = event.pattern_match.group(2).lower()
        pending = _pending_downloads.get(video_id)
        if quality_key == "cancel":
            _pending_downloads.pop(video_id, None)
            await event.reply(f"Cancelled `{video_id}`.")
            return

        if pending is None or _pending_download_expired(pending):
            _pending_downloads.pop(video_id, None)
            await event.reply("That quality picker expired. Send the link again.")
            return

        try:
            label = await _queue_pending_download(nc, pending, admin, quality_key)
        except ValueError:
            await event.reply("Unknown quality. Use one of these commands:\n" + _text_quality_options(video_id, pending.qualities))
            return
        await event.reply(f"Queued `{pending.title}` at `{label}`.")

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
        probe = await _probe_download_options(nc, video_id, url)
        title = probe.get("title") or "Untitled video"
        thumbnail = probe.get("thumbnail")

        if not config.use_bot:
            _remember_pending_download(
                PendingDownloadRequest(
                    video_id=video_id,
                    url=url,
                    title=title,
                    thumbnail=thumbnail,
                    qualities=probe["qualities"],
                    created_at=time.time(),
                )
            )
            await event.reply(
                "Inline quality buttons require Telegram bot mode. Reply with one of these commands:\n"
                + _text_quality_options(video_id, probe["qualities"])
            )
            return

        _remember_pending_download(
            PendingDownloadRequest(
                video_id=video_id,
                url=url,
                title=title,
                thumbnail=thumbnail,
                qualities=probe["qualities"],
                created_at=time.time(),
            )
        )

        lines = [f"Choose quality for `{title}`."]
        if probe.get("fallback_reason"):
            lines.append("Format probe fell back to common quality caps.")
        await event.reply(
            "\n".join(lines),
            buttons=_build_quality_buttons(video_id, probe["qualities"]),
        )

    @tg.on(events.CallbackQuery(pattern=rb"^dl:"))
    async def _on_quality_selected(event):
        if getattr(event, "sender_id", None) != admin:
            await event.answer("Not allowed", alert=True)
            return

        try:
            _, video_id, quality_key = event.data.decode().split(":", 2)
        except ValueError:
            await event.answer("Invalid selection", alert=True)
            return

        pending = _pending_downloads.get(video_id)
        if quality_key == "cancel":
            _pending_downloads.pop(video_id, None)
            await event.answer("Cancelled")
            await event.edit(f"Cancelled `{video_id}`.")
            return

        if pending is None or _pending_download_expired(pending):
            _pending_downloads.pop(video_id, None)
            await event.answer("Selection expired", alert=True)
            await event.edit("That quality picker expired. Send the link again.")
            return

        try:
            label = await _queue_pending_download(nc, pending, admin, quality_key)
        except ValueError:
            await event.answer("Unknown quality", alert=True)
            return
        await event.answer(f"Queued {label}")
        await event.edit(f"Queued `{pending.title}` at `{label}`.")


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


def _remember_pending_download(pending: PendingDownloadRequest) -> None:
    _prune_pending_downloads()
    _pending_downloads[pending.video_id] = pending


def _prune_pending_downloads() -> None:
    now = time.time()
    expired = [
        video_id
        for video_id, pending in _pending_downloads.items()
        if now - pending.created_at > PENDING_DOWNLOAD_TTL_SECONDS
    ]
    for video_id in expired:
        _pending_downloads.pop(video_id, None)


def _pending_download_expired(pending: PendingDownloadRequest) -> bool:
    return time.time() - pending.created_at > PENDING_DOWNLOAD_TTL_SECONDS


async def _queue_pending_download(nc, pending: PendingDownloadRequest, admin: int, quality_key: str) -> str:
    quality_key = quality_key.strip().lower()
    available = {str(option.get("key") or "").lower() for option in pending.qualities}
    if quality_key not in available:
        raise ValueError(f"unknown quality {quality_key!r}")
    await _publish_download_request(
        nc,
        {
            "video_id": pending.video_id,
            "title": pending.title,
            "url": pending.url,
            "thumbnail": pending.thumbnail,
            "requester_chat_id": admin,
            "priority": ADMIN_REQUEST_PRIORITY,
            "quality": None if quality_key == "best" else quality_key,
        },
    )
    _pending_downloads.pop(pending.video_id, None)
    return _quality_label(quality_key)


async def _probe_download_options(nc, video_id: str, url: str) -> dict:
    fallback = {"qualities": list(DEFAULT_QUALITY_OPTIONS), "fallback_reason": "probe_failed"}
    try:
        msg = await nc.request(
            "downloader.inspect",
            json.dumps({"video_id": video_id, "url": url}).encode(),
            timeout=15,
        )
        payload = json.loads(msg.data.decode())
    except Exception as e:
        log.warning("Quality probe failed for %s: %s", video_id, e)
        return fallback

    qualities = _normalize_quality_options(payload.get("qualities") or [])
    result = {
        "title": payload.get("title"),
        "thumbnail": payload.get("thumbnail"),
        "qualities": qualities or list(DEFAULT_QUALITY_OPTIONS),
    }
    if payload.get("error") or not qualities:
        result["fallback_reason"] = payload.get("error") or "no_qualities"
    return result


def _normalize_quality_options(options: list[dict]) -> list[dict]:
    seen: set[str] = set()
    normalized: list[dict] = []
    for option in options:
        key = str(option.get("key") or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append({"key": key, "label": _quality_label(key)})

    if not normalized:
        return []

    normalized.sort(key=lambda option: _quality_sort_key(option["key"]))
    return normalized


def _quality_sort_key(key: str) -> tuple[int, int]:
    if key == "best":
        return (0, 0)
    try:
        return (1, -int(key))
    except ValueError:
        return (2, 0)


def _quality_label(key: str) -> str:
    if key == "best":
        return "Best"
    return f"{key}p"


def _text_quality_options(video_id: str, qualities: list[dict]) -> str:
    rows = [f"• `/dl {video_id} {option['key']}` — {option['label']}" for option in qualities]
    rows.append(f"• `/dl {video_id} cancel` — Cancel")
    return "\n".join(rows)


def _build_quality_buttons(video_id: str, qualities: list[dict]) -> list[list[Button]]:
    rows = [
        [Button.inline(option["label"], data=f"dl:{video_id}:{option['key']}".encode())]
        for option in qualities
    ]
    rows.append([Button.inline("Cancel", data=f"dl:{video_id}:cancel".encode())])
    return rows


async def _publish_download_request(nc, payload: dict) -> None:
    await nc.publish("download.request", json.dumps(payload).encode())
