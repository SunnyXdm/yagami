"""
Configuration — reads environment variables into a typed object.

LEARNING (Python):
  @dataclass auto-generates __init__, __repr__, __eq__ from field annotations.
  @classmethod lets us call Config.from_env() without an existing instance.
  os.environ["KEY"] raises KeyError if missing (fail-fast for required vars).
  os.environ.get("KEY", default) returns a fallback for optional vars.
"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)  # frozen=True makes the config immutable after creation
class Config:
    # Telegram MTProto
    api_id: int
    api_hash: str
    session_string: str

    # One channel per event type
    chat_id_likes: int
    chat_id_watch_history: int
    admin_user_id: int

    # Infrastructure
    nats_url: str
    database_url: str

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            api_id=int(os.environ["TELEGRAM_API_ID"]),
            api_hash=os.environ["TELEGRAM_API_HASH"],
            session_string=os.environ.get("TELEGRAM_SESSION_STRING", ""),
            chat_id_likes=int(os.environ["TELEGRAM_CHAT_ID_LIKES"]),
            chat_id_watch_history=int(os.environ["TELEGRAM_CHAT_ID_WATCH_HISTORY"]),
            admin_user_id=int(os.environ.get("TELEGRAM_ADMIN_USER_ID", "0")),
            nats_url=os.environ.get("NATS_URL", "nats://localhost:4222"),
            database_url=os.environ.get("DATABASE_URL", ""),
        )
