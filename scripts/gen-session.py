"""
Generate a Telethon session string for the Telegram client.

Run this ONCE locally to get a session string, then put it in .env
as TELEGRAM_SESSION_STRING.

Usage:
    pip install telethon
    python scripts/gen-session.py
"""
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession

async def main():
    print("=== Telethon Session String Generator ===\n")
    print("You need your Telegram API credentials from https://my.telegram.org\n")

    api_id = int(input("Enter your API ID: "))
    api_hash = input("Enter your API hash: ")

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
