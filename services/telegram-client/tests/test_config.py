"""Tests for the Config dataclass."""

import os

import pytest

from telegram_client.config import Config


class TestConfig:
    """Test Config.from_env() reads environment variables correctly."""

    @pytest.fixture(autouse=True)
    def _set_env(self, monkeypatch):
        """Set all required env vars before each test."""
        monkeypatch.setenv("TELEGRAM_API_ID", "12345")
        monkeypatch.setenv("TELEGRAM_API_HASH", "abc123hash")
        monkeypatch.setenv("TELEGRAM_SESSION_STRING", "session_data")
        monkeypatch.setenv("TELEGRAM_CHAT_ID_LIKES", "-100111")
        monkeypatch.setenv("TELEGRAM_CHAT_ID_WATCH_HISTORY", "-100333")
        monkeypatch.setenv("TELEGRAM_ADMIN_USER_ID", "999")
        monkeypatch.setenv("NATS_URL", "nats://test:4222")
        monkeypatch.setenv("DATABASE_URL", "postgres://test:test@db:5432/test")

    def test_reads_all_required_fields(self):
        cfg = Config.from_env()
        assert cfg.api_id == 12345
        assert cfg.api_hash == "abc123hash"
        assert cfg.session_string == "session_data"
        assert cfg.chat_id_likes == -100111
        assert cfg.chat_id_watch_history == -100333
        assert cfg.admin_user_id == 999
        assert cfg.nats_url == "nats://test:4222"
        assert cfg.database_url == "postgres://test:test@db:5432/test"

    def test_defaults_for_optional_fields(self, monkeypatch):
        monkeypatch.delenv("TELEGRAM_SESSION_STRING", raising=False)
        monkeypatch.delenv("TELEGRAM_ADMIN_USER_ID", raising=False)
        monkeypatch.delenv("NATS_URL", raising=False)
        monkeypatch.delenv("DATABASE_URL", raising=False)

        cfg = Config.from_env()
        assert cfg.session_string == ""
        assert cfg.admin_user_id == 0
        assert cfg.nats_url == "nats://localhost:4222"
        assert cfg.database_url == ""

    def test_missing_required_field_raises(self, monkeypatch):
        monkeypatch.delenv("TELEGRAM_API_ID")
        with pytest.raises(KeyError):
            Config.from_env()

    def test_frozen_immutability(self):
        cfg = Config.from_env()
        with pytest.raises(AttributeError):
            cfg.api_id = 99999  # type: ignore[misc]

    def test_invalid_int_raises(self, monkeypatch):
        monkeypatch.setenv("TELEGRAM_API_ID", "not_a_number")
        with pytest.raises(ValueError):
            Config.from_env()
