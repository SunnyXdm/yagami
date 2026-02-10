"""
Message formatting — converts raw event dicts into pretty Telegram text.

LEARNING (Python):
  Pure functions (no side-effects) are the easiest code to test.
  f-strings (f"...{var}...") are Python's string interpolation (like JS template literals).
  Type hints (def func(x: int) -> str) don't enforce types at runtime,
  but help editors, linters, and future-you understand the code.
"""


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
    return (
        f"🎬 Watched\n\n"
        f"{data.get('title', 'Unknown')}\n"
        f"Channel: {data.get('channel_title', 'Unknown')}\n"
        f"Duration: {format_duration(data.get('duration_seconds'))}\n\n"
        f"🔗 https://youtube.com/watch?v={data.get('video_id', '')}"
    )


def format_like(data: dict) -> str:
    return (
        f"❤️ Liked\n\n"
        f"{data.get('title', 'Unknown')}\n"
        f"Channel: {data.get('channel_title', 'Unknown')}\n"
        f"Duration: {format_duration(data.get('duration_seconds'))}\n\n"
        f"⬇️ Downloading for Telegram..."
    )


def format_subscription(data: dict) -> str:
    event = data.get("event", "subscribe")
    if event == "unsubscribe":
        return (
            f"👋 Unsubscribed\n\n"
            f"Channel: {data.get('channel_title', 'Unknown')}"
        )
    return (
        f"📺 New Subscription\n\n"
        f"{data.get('channel_title', 'Unknown')}\n\n"
        f"🔗 https://youtube.com/channel/{data.get('channel_id', '')}"
    )


def format_video_caption(data: dict) -> str:
    dur = format_duration(data.get("duration_seconds"))
    title = data.get("title", "Video")
    channel = data.get("channel_title", "")
    return f"❤️ {title} — {channel} ({dur})"
