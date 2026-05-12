"""
Message formatting — converts raw event dicts into pretty Telegram text.

LEARNING (Python):
  Pure functions (no side-effects) are the easiest code to test.
  f-strings (f"...{var}...") are Python's string interpolation (like JS template literals).
  Type hints (def func(x: int) -> str) don't enforce types at runtime,
  but help editors, linters, and future-you understand the code.
"""

from __future__ import annotations


MD_SPECIALS = "\\`*_[]()"


def format_duration(seconds: int | None) -> str:
    """Convert seconds → 'HH:MM:SS' or 'MM:SS'."""
    if not seconds:
        return "Unknown"
    h, remainder = divmod(seconds, 3600)
    m, s = divmod(remainder, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def format_views(count: int | None) -> str:
    """Convert view count → '1.2M', '45.3K', or raw number."""
    if not count:
        return "N/A"
    if count >= 1_000_000:
        return f"{count / 1_000_000:.1f}M"
    if count >= 1_000:
        return f"{count / 1_000:.1f}K"
    return str(count)


def format_watch(data: dict) -> str:
    video_id = data.get('video_id', '')
    title = _escape_md(_video_title(data))
    channel = _escape_md(_channel(data))
    duration = _escape_md(data.get("duration") or format_duration(data.get("duration_seconds")))
    video = _markdown_link(title, _youtube_video_url(video_id))
    return (
        f"`Watched`\n\n"
        f"{video}\n\n"
        f"`Channel:` {channel}\n"
        f"`Duration:` {duration}"
    )


def format_like(data: dict) -> str:
    video_id = data.get('video_id', '')
    title = _escape_md(_video_title(data))
    channel = _escape_md(_channel(data))
    duration = _escape_md(data.get("duration") or format_duration(data.get("duration_seconds")))
    video = _markdown_link(title, _youtube_video_url(video_id))
    return (
        f"`Liked`\n\n"
        f"{video}\n\n"
        f"`Channel:` {channel}\n"
        f"`Duration:` {duration}\n\n"
        f"`Downloading...`"
    )


def format_subscribe(data: dict) -> str:
    channel = _escape_md(_channel(data, allow_title_fallback=True))
    channel_id = _escape_md(data.get("channel_id") or "Unknown")
    channel_ref = _markdown_link(channel, _youtube_channel_url(data.get("channel_id")))
    return (
        f"`Subscribed`\n\n"
        f"{channel_ref}\n\n"
        f"`Channel ID:` {channel_id}"
    )


def format_unsubscribe(data: dict) -> str:
    channel = _escape_md(_channel(data, allow_title_fallback=True))
    channel_id = _escape_md(data.get("channel_id") or "Unknown")
    channel_ref = _markdown_link(channel, _youtube_channel_url(data.get("channel_id")))
    return (
        f"`Unsubscribed`\n\n"
        f"{channel_ref}\n\n"
        f"`Channel ID:` {channel_id}"
    )


def format_video_caption(data: dict, part: int | None = None, total: int | None = None) -> str:
    duration = _escape_md(data.get("duration") or format_duration(data.get("duration_seconds")))
    title = _escape_md(_video_title(data, fallback="Video"))
    channel = _escape_md(_channel(data))
    suffix = f" [Part {part}/{total}]" if part and total and total > 1 else ""
    return f"{title} — {channel} ({duration}){suffix}"


def _video_title(data: dict, fallback: str = "Unknown") -> str:
    title = data.get("title")
    if title:
        return str(title)
    return fallback


def _channel(data: dict, allow_title_fallback: bool = False) -> str:
    """Get channel name from either field name the poller/downloader might send."""
    channel = data.get("channel_title") or data.get("channel")
    if channel:
        return str(channel)
    if allow_title_fallback and data.get("title"):
        return str(data["title"])
    return "Unknown"


def _escape_md(value: object) -> str:
    text = str(value)
    for ch in MD_SPECIALS:
        text = text.replace(ch, f"\\{ch}")
    return text


def _markdown_link(text: str, url: str | None) -> str:
    if not url:
        return text
    return f"[{text}]({url})"


def _youtube_video_url(video_id: str | None) -> str | None:
    if not video_id:
        return None
    return f"https://youtube.com/watch?v={video_id}"


def _youtube_channel_url(channel_id: str | None) -> str | None:
    if not channel_id:
        return None
    return f"https://www.youtube.com/channel/{channel_id}"
