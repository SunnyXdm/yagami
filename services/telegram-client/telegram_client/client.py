"""Main client — Telethon ↔ NATS bridge with bot commands and hot-reload."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
import os
import re
import time
from typing import Any

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
DOWNLOADS_PAGE_SIZE = 5
ADMIN_PROGRESS_EDIT_INTERVAL_SECONDS = 2.0
ACTIVE_DOWNLOAD_STATUSES = {"queued", "downloading", "completed", "uploading"}
TERMINAL_DOWNLOAD_STATUSES = {"uploaded", "upload_failed", "failed"}
DEFAULT_QUALITY_OPTIONS = [
    {"key": "best", "label": "Best"},
    {"key": "1080", "label": "1080p"},
    {"key": "720", "label": "720p"},
    {"key": "480", "label": "480p"},
    {"key": "360", "label": "360p"},
]
BOT_COMMANDS = [
    ("start", "Show Yagami admin controls"),
    ("cmds", "List commands"),
    ("status", "Show service status"),
    ("downloads", "Show paginated queue"),
    ("settings", "Open web settings"),
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


@dataclass
class AdminProgressMessage:
    video_id: str
    chat_id: int
    message_id: int
    title: str
    quality_label: str
    last_edit_at: float = 0.0
    last_text: str = ""


@dataclass
class QueuePage:
    rows: list[Any]
    page: int
    total_pages: int
    total_count: int
    active_count: int


@dataclass(frozen=True)
class ParsedAdminCommand:
    name: str
    args: tuple[str, ...]


_pending_downloads: dict[str, PendingDownloadRequest] = {}
_admin_progress_messages: dict[str, AdminProgressMessage] = {}


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
        await _register_admin_progress_handlers(tg, nc, config)
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
        "**Yagami admin controls**",
        "",
        "`/status` - service health and routing",
        "`/downloads` - paginated queue in Telegram",
        "`/downloads 2` - jump to a queue page",
        "`/settings` - open web settings",
        "`/ping` - quick health check",
        "",
        "Send a YouTube link here to inspect quality, queue it to your DM, and watch live progress in this chat.",
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
    bot_username = getattr(state.get("me"), "username", None)

    @tg.on(events.CallbackQuery(pattern=rb"^queue:"))
    async def _on_queue_page(event):
        if getattr(event, "sender_id", None) != admin:
            await event.answer("Not allowed", alert=True)
            return

        try:
            page = _page_number(event.data.decode().split(":", 1)[1])
        except Exception:
            await event.answer("Invalid page", alert=True)
            return

        text, buttons = await _download_queue_response(config, page)
        await event.edit(text, buttons=buttons)
        await event.answer(f"Page {page}")

    @tg.on(events.NewMessage(from_users=[admin]))
    async def _on_admin_msg(event):
        text = (getattr(event, "raw_text", None) or event.message.text or "").strip()
        if not text:
            return

        parsed = _parse_admin_command(text, bot_username)
        if parsed is not None:
            await _handle_admin_command(event, parsed, config, admin, nc, state)
            return

        if text.startswith("/"):
            await _safe_admin_reply(
                event,
                "Unknown command. Use /cmds to see the supported admin controls.",
                buttons=_command_buttons(config) if config.use_bot else None,
                plain_text="Unknown command. Use /cmds to see the supported admin controls.",
            )
            return

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
            await _safe_admin_reply(
                event,
                "Inline quality buttons require Telegram bot mode. Reply with one of these commands:\n"
                + _text_quality_options(video_id, probe["qualities"]),
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
        await _safe_admin_reply(
            event,
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
        await event.edit(
            _render_admin_progress_text(pending.video_id, pending.title, label, "queued", {}),
            buttons=_admin_progress_buttons(config),
        )
        message_id = getattr(event, "message_id", None)
        if not message_id:
            try:
                message = await event.get_message()
                message_id = getattr(message, "id", 0)
            except Exception:
                message_id = 0
        _remember_admin_progress_message(pending.video_id, admin, int(message_id or 0), pending.title, label)


def _parse_admin_command(text: str, bot_username: str | None = None) -> ParsedAdminCommand | None:
    stripped = text.strip()
    if not stripped.startswith("/"):
        return None

    parts = stripped.split()
    token = parts[0][1:]
    if not token:
        return None

    name, _, mention = token.partition("@")
    if mention and bot_username and mention.lower() != bot_username.lower():
        return None

    aliases = {
        "help": "cmds",
        "commands": "cmds",
    }
    normalized = aliases.get(name.lower(), name.lower())
    return ParsedAdminCommand(normalized, tuple(parts[1:]))


async def _handle_admin_command(event, command: ParsedAdminCommand, config: Config, admin: int, nc, state: dict) -> None:
    if command.name in {"start", "cmds"}:
        await _safe_admin_reply(
            event,
            _command_list_text(config),
            buttons=_command_buttons(config) if config.use_bot else None,
        )
        return

    if command.name == "settings":
        url = _web_url(config, "settings")
        buttons = [[Button.url("Open settings", url)]] if config.use_bot else None
        await _safe_admin_reply(event, f"Settings: {url}", buttons=buttons, plain_text=f"Settings: {url}")
        return

    if command.name == "downloads":
        page = _page_number(command.args[0] if command.args else None)
        text, buttons = await _download_queue_response(config, page)
        await _safe_admin_reply(event, text, buttons=buttons if config.use_bot else None)
        return

    if command.name == "dl":
        await _handle_text_quality_command(event, command, config, admin, nc)
        return

    if command.name == "ping":
        await _safe_admin_reply(
            event,
            f"pong — uptime {_fmt_uptime(time.time() - START_TS)}",
            plain_text=f"pong - uptime {_fmt_uptime(time.time() - START_TS)}",
        )
        return

    if command.name == "status":
        cfg = await Config.load()
        await _safe_admin_reply(event, _status_text(cfg, state), plain_text=_plain_text(_status_text(cfg, state)))
        return

    await _safe_admin_reply(
        event,
        "Unknown command. Use /cmds to see the supported admin controls.",
        buttons=_command_buttons(config) if config.use_bot else None,
        plain_text="Unknown command. Use /cmds to see the supported admin controls.",
    )


async def _handle_text_quality_command(event, command: ParsedAdminCommand, config: Config, admin: int, nc) -> None:
    if len(command.args) < 2:
        await _safe_admin_reply(event, "Usage: `/dl VIDEO_ID QUALITY`", plain_text="Usage: /dl VIDEO_ID QUALITY")
        return

    video_id = command.args[0]
    quality_key = command.args[1].lower()
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        await _safe_admin_reply(event, "Usage: `/dl VIDEO_ID QUALITY`", plain_text="Usage: /dl VIDEO_ID QUALITY")
        return

    pending = _pending_downloads.get(video_id)
    if quality_key == "cancel":
        _pending_downloads.pop(video_id, None)
        await _safe_admin_reply(event, f"Cancelled `{video_id}`.", plain_text=f"Cancelled {video_id}.")
        return

    if pending is None or _pending_download_expired(pending):
        _pending_downloads.pop(video_id, None)
        await _safe_admin_reply(event, "That quality picker expired. Send the link again.")
        return

    try:
        label = await _queue_pending_download(nc, pending, admin, quality_key)
    except ValueError:
        await _safe_admin_reply(
            event,
            "Unknown quality. Use one of these commands:\n" + _text_quality_options(video_id, pending.qualities),
        )
        return

    status_message = await _safe_admin_reply(
        event,
        _render_admin_progress_text(pending.video_id, pending.title, label, "queued", {}),
        buttons=_admin_progress_buttons(config) if config.use_bot else None,
    )
    _remember_admin_progress_message(
        pending.video_id,
        admin,
        getattr(status_message, "id", 0),
        pending.title,
        label,
    )


def _status_text(config: Config, state: dict) -> str:
    return "\n".join([
        "**Yagami status**",
        f"• Mode: `{'bot' if config.use_bot else 'user-account'}`",
        f"• Telegram: connected as `@{getattr(state['me'], 'username', '?')}`",
        f"• Uptime: `{_fmt_uptime(time.time() - START_TS)}`",
        f"• Events handled: `{state['events_handled']}`",
        f"• Likes channel: {'✓' if config.chat_id_likes else '✗ not set'}",
        f"• History channel: {'✓' if config.chat_id_watch_history else '✗ not set'}",
        f"• Subscriptions channel: {'✓' if config.chat_id_subscriptions else '✗ not set'}",
    ])


async def _safe_admin_reply(event, text: str, buttons=None, plain_text: str | None = None):
    try:
        return await event.reply(text, buttons=buttons)
    except Exception:
        log.exception("Admin reply failed; retrying without markdown or buttons")

    fallback = plain_text or _plain_text(text)
    try:
        return await event.reply(fallback, parse_mode=None)
    except Exception:
        log.exception("Admin reply fallback failed")
        return None


def _plain_text(text: str) -> str:
    plain = text.replace("**", "").replace("`", "").replace("•", "-")
    return plain.replace("\\", "")


async def _register_admin_progress_handlers(tg: TelegramClient, nc, config: Config) -> None:
    async def handler(msg, subject: str):
        try:
            data = json.loads(msg.data.decode())
            await _update_admin_progress_message(tg, config, subject, data)
        except Exception:
            log.exception("Error updating admin progress for %s", subject)

    for subject in (
        "download.progress",
        "download.complete",
        "download.upload_progress",
        "download.uploaded",
        "download.upload_failed",
    ):
        async def progress_handler(msg, subject=subject):
            await handler(msg, subject)

        await nc.subscribe(subject, cb=progress_handler)


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


def _remember_admin_progress_message(
    video_id: str,
    chat_id: int,
    message_id: int,
    title: str,
    quality_label: str,
) -> None:
    if not message_id:
        log.warning("Could not track admin progress for %s because message_id is missing", video_id)
        return
    _admin_progress_messages[video_id] = AdminProgressMessage(
        video_id=video_id,
        chat_id=chat_id,
        message_id=message_id,
        title=title,
        quality_label=quality_label,
    )


async def _update_admin_progress_message(
    tg: TelegramClient,
    config: Config,
    subject: str,
    payload: dict,
) -> None:
    video_id = str(payload.get("video_id") or "")
    state = _admin_progress_messages.get(video_id)
    if not state:
        return

    status = _status_from_progress_subject(subject, payload)
    text = _render_admin_progress_text(video_id, state.title, state.quality_label, status, payload)
    terminal = status in TERMINAL_DOWNLOAD_STATUSES
    now = time.monotonic()
    if not terminal and text == state.last_text:
        return
    if not terminal and now - state.last_edit_at < ADMIN_PROGRESS_EDIT_INTERVAL_SECONDS:
        return

    try:
        await tg.edit_message(
            state.chat_id,
            state.message_id,
            text,
            buttons=_admin_progress_buttons(config),
        )
        state.last_edit_at = now
        state.last_text = text
    except FloodWaitError as exc:
        log.warning("Admin progress edit for %s flood-waited for %ss", video_id, exc.seconds)
    except Exception:
        log.exception("Could not edit admin progress message for %s", video_id)

    if terminal:
        _admin_progress_messages.pop(video_id, None)


def _status_from_progress_subject(subject: str, payload: dict) -> str:
    if subject == "download.progress":
        return str(payload.get("status") or "downloading")
    if subject == "download.complete":
        return "failed" if payload.get("success") is False else "completed"
    if subject == "download.upload_progress":
        return "uploading"
    if subject == "download.uploaded":
        return "uploaded"
    if subject == "download.upload_failed":
        return "upload_failed"
    return str(payload.get("status") or "queued")


def _admin_progress_buttons(config: Config) -> list[list[Button]]:
    return [[Button.url("Open downloads", _web_url(config, "downloads"))]]


def _render_admin_progress_text(
    video_id: str,
    title: str,
    quality_label: str,
    status: str,
    payload: dict,
) -> str:
    percent = _progress_percent(status, payload)
    lines = [
        "**Yagami admin download**",
        "",
        f"`{_progress_bar(percent)}` `{percent:.0f}%`",
        f"`Status:` {_status_label(status)}",
        f"`Video:` {_escape_md_text(title)}",
        f"`Quality:` {_escape_md_text(quality_label)}",
        f"`ID:` `{_escape_code(video_id)}`",
    ]

    speed = payload.get("speed_text")
    eta = payload.get("eta_text")
    part = payload.get("part")
    total_parts = payload.get("total_parts")
    error = payload.get("error")
    if speed:
        lines.append(f"`Speed:` {_escape_md_text(speed)}")
    if eta:
        lines.append(f"`ETA:` {_escape_md_text(eta)}")
    if part and total_parts and int(total_parts) > 1:
        lines.append(f"`Part:` `{part}/{total_parts}`")
    if error:
        lines.extend(["", f"`Error:` {_escape_md_text(error)}"])

    if status == "queued":
        lines.extend(["", "Waiting for the downloader worker."])
    elif status == "completed":
        lines.extend(["", "Download finished. Telegram upload is starting."])
    elif status == "uploaded":
        elapsed = payload.get("elapsed_text")
        if elapsed:
            lines.extend(["", f"Delivered to Telegram in {_escape_md_text(elapsed)}."])
        else:
            lines.extend(["", "Delivered to Telegram."])

    return "\n".join(lines)


def _status_label(status: str) -> str:
    labels = {
        "queued": "Queued",
        "downloading": "Downloading with yt-dlp",
        "completed": "Download complete",
        "uploading": "Uploading to Telegram",
        "uploaded": "Uploaded to Telegram",
        "failed": "Download failed",
        "upload_failed": "Telegram upload failed",
    }
    return labels.get(status, status.replace("_", " ").title())


def _progress_percent(status: str, payload: dict) -> float:
    if status in {"uploaded"}:
        return 100.0
    if status in {"failed", "upload_failed"}:
        value = payload.get("progress_percent")
        return float(value) if isinstance(value, (int, float)) else 0.0
    value = payload.get("progress_percent")
    if isinstance(value, (int, float)):
        return max(0.0, min(100.0, float(value)))
    uploaded = payload.get("uploaded_bytes")
    total = payload.get("total_bytes")
    if isinstance(uploaded, (int, float)) and isinstance(total, (int, float)) and total > 0:
        return max(0.0, min(100.0, float(uploaded) / float(total) * 100.0))
    if status == "completed":
        return 100.0
    if status == "uploading":
        return 0.0
    return 0.0


def _progress_bar(percent: float) -> str:
    filled = max(0, min(10, round(percent / 10)))
    return "[" + "#" * filled + "-" * (10 - filled) + "]"


async def _download_queue_response(config: Config, page: int) -> tuple[str, list[list[Button]]]:
    try:
        queue_page = await _fetch_download_queue_page(config, page, DOWNLOADS_PAGE_SIZE)
    except Exception as exc:
        log.exception("Could not load download queue")
        return (
            "**Yagami queue**\n\nCould not load downloads from Postgres.\n"
            f"`Error:` {_escape_md_text(exc)}",
            [[Button.url("Open downloads", _web_url(config, "downloads"))]],
        )

    return _render_download_queue_page(queue_page), _queue_page_buttons(config, queue_page)


async def _fetch_download_queue_page(config: Config, page: int, page_size: int) -> QueuePage:
    import asyncpg

    page_size = max(1, min(10, page_size))
    conn = await asyncpg.connect(config.database_url)
    try:
        counts = await conn.fetchrow(
            """
            SELECT COUNT(*)::int AS total_count,
                   COUNT(*) FILTER (WHERE status IN ('queued','downloading','completed','uploading'))::int AS active_count
              FROM downloads
            """
        )
        total_count = int(counts["total_count"] or 0)
        active_count = int(counts["active_count"] or 0)
        total_pages = max(1, (total_count + page_size - 1) // page_size)
        page = max(1, min(page, total_pages))
        rows = await conn.fetch(
            """
            SELECT video_id, title, status, file_size, attempts, requester_chat_id,
                   telegram_chat_id, telegram_msg_id, error_message, updated_at
              FROM downloads
          ORDER BY CASE WHEN status IN ('queued','downloading','completed','uploading') THEN 0 ELSE 1 END,
                   updated_at DESC,
                   id DESC
             LIMIT $1 OFFSET $2
            """,
            page_size,
            (page - 1) * page_size,
        )
        return QueuePage(
            rows=list(rows),
            page=page,
            total_pages=total_pages,
            total_count=total_count,
            active_count=active_count,
        )
    finally:
        await conn.close()


def _render_download_queue_page(queue_page: QueuePage) -> str:
    lines = [
        "**Yagami queue**",
        f"Page `{queue_page.page}/{queue_page.total_pages}` - `{queue_page.total_count}` jobs - `{queue_page.active_count}` active",
        "",
    ]
    if not queue_page.rows:
        lines.append("No downloads yet. Send a YouTube link to this chat to queue one.")
        return "\n".join(lines)

    for index, row in enumerate(queue_page.rows, 1):
        status = str(_row_value(row, "status", "queued"))
        title = _escape_md_text(_row_value(row, "title", "Untitled") or "Untitled")
        video_id = _escape_code(str(_row_value(row, "video_id", "")))
        attempts = int(_row_value(row, "attempts", 0) or 0)
        route = "Admin DM" if _row_value(row, "requester_chat_id") else "Likes chat"
        size = _format_size(_row_value(row, "file_size"))
        updated = _format_relative_time(_row_value(row, "updated_at"))
        lines.extend([
            f"`{index}.` **{_status_label(status)}** - {title}",
            f"   `{video_id}` - {route} - {size} - {updated}",
        ])
        if attempts > 1:
            lines.append(f"   Retry `{attempts}`")
        error = _row_value(row, "error_message")
        if error and status in {"failed", "upload_failed"}:
            lines.append(f"   Error: {_escape_md_text(str(error)[:140])}")

    return "\n".join(lines)


def _queue_page_buttons(config: Config, queue_page: QueuePage) -> list[list[Button]]:
    nav: list[Button] = []
    if queue_page.page > 1:
        nav.append(Button.inline("Prev", data=f"queue:{queue_page.page - 1}".encode()))
    nav.append(Button.inline("Refresh", data=f"queue:{queue_page.page}".encode()))
    if queue_page.page < queue_page.total_pages:
        nav.append(Button.inline("Next", data=f"queue:{queue_page.page + 1}".encode()))
    rows = [nav] if nav else []
    rows.append([Button.url("Open downloads", _web_url(config, "downloads"))])
    return rows


def _page_number(value: object) -> int:
    try:
        return max(1, int(str(value or "1").strip()))
    except ValueError:
        return 1


def _row_value(row: Any, key: str, default: Any = None) -> Any:
    try:
        return row[key]
    except Exception:
        return getattr(row, key, default)


def _format_size(value: object) -> str:
    try:
        size = float(value or 0)
    except (TypeError, ValueError):
        size = 0.0
    units = ["B", "KB", "MB", "GB"]
    unit = units[0]
    for unit in units:
        if size < 1024 or unit == units[-1]:
            break
        size /= 1024
    return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"


def _format_relative_time(value: object) -> str:
    if not isinstance(value, datetime):
        return "unknown"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    seconds = max(0, int((datetime.now(timezone.utc) - value.astimezone(timezone.utc)).total_seconds()))
    if seconds < 60:
        return f"{seconds}s ago"
    minutes, seconds = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m ago"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h ago"
    days, hours = divmod(hours, 24)
    return f"{days}d ago"


def _escape_md_text(value: object) -> str:
    text = str(value)
    for ch in "\\`*_[]()":
        text = text.replace(ch, f"\\{ch}")
    return text


def _escape_code(value: str) -> str:
    return value.replace("`", "")


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
