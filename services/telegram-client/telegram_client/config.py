"""Configuration loaded from the Postgres `settings` table.

Only DATABASE_URL and NATS_URL come from environment variables. User-managed
credentials and routing live in the web UI.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    api_id: int = 0
    api_hash: str = ""
    session_string: str = ""
    bot_token: str = ""
    chat_id_likes: int = 0
    chat_id_watch_history: int = 0
    chat_id_subscriptions: int = 0
    admin_user_id: int = 0
    nats_url: str = "nats://nats:4222"
    database_url: str = "postgres://yagami:yagami@postgres:5432/yagami"
    web_url: str = "http://localhost:8787"

    @property
    def use_bot(self) -> bool:
        return bool(self.bot_token)

    def is_complete(self) -> bool:
        has_route = bool(
            self.chat_id_likes
            or self.chat_id_watch_history
            or self.chat_id_subscriptions
            or self.admin_user_id
        )
        if self.use_bot:
            return has_route
        return bool(self.api_id and self.api_hash and self.session_string and has_route)

    @classmethod
    async def load(cls) -> "Config":
        nats_url = os.environ.get("NATS_URL", "nats://nats:4222")
        database_url = os.environ.get(
            "DATABASE_URL", "postgres://yagami:yagami@postgres:5432/yagami"
        )
        web_url = os.environ.get("YAGAMI_WEB_URL") or os.environ.get("WEB_URL") or "http://localhost:8787"
        settings = await _load_settings(database_url)

        def s(key: str) -> str:
            return (settings.get(key) or "").strip()

        def i(key: str) -> int:
            try:
                return int(s(key))
            except (TypeError, ValueError):
                return 0

        return cls(
            api_id=i("telegram.api_id"),
            api_hash=s("telegram.api_hash"),
            session_string=s("telegram.session_string"),
            bot_token=s("telegram.bot_token"),
            chat_id_likes=i("telegram.chat_likes"),
            chat_id_watch_history=i("telegram.chat_history"),
            chat_id_subscriptions=i("telegram.chat_subs"),
            admin_user_id=i("telegram.admin_user_id"),
            nats_url=nats_url,
            database_url=database_url,
            web_url=web_url.rstrip("/"),
        )

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            api_id=int(os.environ["TELEGRAM_API_ID"]),
            api_hash=os.environ["TELEGRAM_API_HASH"],
            session_string=os.environ.get("TELEGRAM_SESSION_STRING", ""),
            bot_token=os.environ.get("TELEGRAM_BOT_TOKEN", ""),
            chat_id_likes=int(os.environ["TELEGRAM_CHAT_ID_LIKES"]),
            chat_id_watch_history=int(os.environ["TELEGRAM_CHAT_ID_WATCH_HISTORY"]),
            chat_id_subscriptions=int(os.environ.get("TELEGRAM_CHAT_ID_SUBS", "0")),
            admin_user_id=int(os.environ.get("TELEGRAM_ADMIN_USER_ID", "0")),
            nats_url=os.environ.get("NATS_URL", "nats://localhost:4222"),
            database_url=os.environ.get("DATABASE_URL", ""),
            web_url=(os.environ.get("YAGAMI_WEB_URL") or os.environ.get("WEB_URL") or "http://localhost:8787").rstrip("/"),
        )


async def _load_settings(database_url: str) -> dict[str, str]:
    try:
        import asyncpg

        conn = await asyncpg.connect(database_url)
        try:
            rows = await conn.fetch("SELECT key, COALESCE(value,'') AS value FROM settings")
            return {r["key"]: r["value"] for r in rows}
        finally:
            await conn.close()
    except Exception:
        return {}
