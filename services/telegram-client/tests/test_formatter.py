"""Tests for the formatter module — pure functions, easy to test."""

import pytest

from telegram_client.formatter import (
    format_duration,
    format_like,
    format_subscription,
    format_video_caption,
    format_views,
    format_watch,
)


# ── format_duration ──────────────────────────────────────────


class TestFormatDuration:
    def test_seconds_only(self):
        assert format_duration(45) == "0:45"

    def test_minutes_and_seconds(self):
        assert format_duration(125) == "2:05"

    def test_hours_minutes_seconds(self):
        assert format_duration(3661) == "1:01:01"

    def test_exactly_one_hour(self):
        assert format_duration(3600) == "1:00:00"

    def test_zero(self):
        assert format_duration(0) == "Unknown"

    def test_none(self):
        assert format_duration(None) == "Unknown"

    def test_large_value(self):
        assert format_duration(36000) == "10:00:00"


# ── format_views ─────────────────────────────────────────────


class TestFormatViews:
    def test_millions(self):
        assert format_views(1_500_000) == "1.5M"

    def test_thousands(self):
        assert format_views(45_300) == "45.3K"

    def test_small_number(self):
        assert format_views(999) == "999"

    def test_exactly_one_million(self):
        assert format_views(1_000_000) == "1.0M"

    def test_exactly_one_thousand(self):
        assert format_views(1_000) == "1.0K"

    def test_zero(self):
        assert format_views(0) == "N/A"

    def test_none(self):
        assert format_views(None) == "N/A"


# ── format_watch ─────────────────────────────────────────────


class TestFormatWatch:
    def test_full_data(self):
        data = {
            "title": "Test Video",
            "channel_title": "TestChan",
            "duration_seconds": 300,
            "video_id": "abc123",
        }
        result = format_watch(data)
        assert "`Watched`" in result
        assert "Test Video" in result
        assert "TestChan" in result
        assert "5:00" in result
        assert "youtube.com/watch?v=abc123" in result

    def test_with_channel_field(self):
        """Poller sends 'channel' not 'channel_title' — formatter should handle both."""
        data = {"title": "V", "channel": "MyChan", "duration": "3:45", "video_id": "x"}
        result = format_watch(data)
        assert "MyChan" in result
        assert "3:45" in result

    def test_missing_fields_uses_defaults(self):
        result = format_watch({})
        assert "Unknown" in result

    def test_partial_data(self):
        result = format_watch({"title": "My Video"})
        assert "My Video" in result
        assert "Unknown" in result  # missing channel


# ── format_like ──────────────────────────────────────────────


class TestFormatLike:
    def test_full_data(self):
        data = {
            "title": "Liked Video",
            "channel_title": "Cool Channel",
            "duration_seconds": 60,
        }
        result = format_like(data)
        assert "`Liked`" in result
        assert "Liked Video" in result
        assert "Cool Channel" in result
        assert "Downloading" in result

    def test_empty_data(self):
        result = format_like({})
        assert "`Liked`" in result
        assert "Unknown" in result


# ── format_subscription ─────────────────────────────────────


class TestFormatSubscription:
    def test_new_subscription(self):
        data = {
            "channel_title": "Science Channel",
            "channel_id": "UC123",
        }
        result = format_subscription(data)
        assert "`Subscribed to`" in result
        assert "Science Channel" in result
        assert "youtube.com/channel/UC123" in result

    def test_unsubscription(self):
        data = {
            "action": "unsubscribed",
            "channel_title": "Old Channel",
        }
        result = format_subscription(data)
        assert "`Unsubscribed from`" in result
        assert "Old Channel" in result

    def test_empty_data_defaults_to_subscribe(self):
        result = format_subscription({})
        assert "`Subscribed to`" in result


# ── format_video_caption ─────────────────────────────────────


class TestFormatVideoCaption:
    def test_full_data(self):
        data = {
            "title": "My Video",
            "channel_title": "My Channel",
            "duration_seconds": 90,
        }
        result = format_video_caption(data)
        assert "My Video" in result
        assert "My Channel" in result
        assert "1:30" in result

    def test_with_channel_and_duration_strings(self):
        """download.complete sends 'channel' and 'duration' (string), not '_title'/'_seconds'."""
        data = {"title": "V", "channel": "Ch", "duration": "4:20"}
        result = format_video_caption(data)
        assert "Ch" in result
        assert "4:20" in result

    def test_missing_fields(self):
        result = format_video_caption({})
        assert "Video" in result  # default title
