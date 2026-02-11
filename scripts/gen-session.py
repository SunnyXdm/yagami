"""
Generate a Telethon session string for the Telegram client.

Run this ONCE to get a session string, then put it in .env
as TELEGRAM_SESSION_STRING.

Usage (via setup.sh — runs inside Docker automatically):
    ./scripts/setup.sh

Usage (manual):
    pip install telethon
    python scripts/gen-session.py

You can also set TELEGRAM_API_ID and TELEGRAM_API_HASH as env vars
to skip the interactive prompts.
"""
import asyncio
import os
from telethon import TelegramClient
from telethon.sessions import StringSession

async def main():
    print("=== Telethon Session String Generator ===\n")

    # Try env vars first (set by setup.sh when running in Docker)
    api_id = os.environ.get("TELEGRAM_API_ID", "").strip()
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()

    if not api_id or api_id == "12345678":
        print("You need your Telegram API credentials from https://my.telegram.org\n")
        api_id = input("Enter your API ID: ").strip()
    if not api_hash or api_hash == "0123456789abcdef0123456789abcdef":
        api_hash = input("Enter your API hash: ").strip()

    api_id = int(api_id)

    # Start client with an empty StringSession — Telethon will ask for phone + code
    client = TelegramClient(StringSession(), api_id, api_hash)
    await client.start()

    session_string = client.session.save()

    print("\n✓ Authenticated successfully!")
    print(f"\nYour session string (put this in .env as TELEGRAM_SESSION_STRING):\n")
    print(session_string)
    print(f"\n⚠️  Keep this secret! Anyone with this string can access your Telegram account.")

    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
