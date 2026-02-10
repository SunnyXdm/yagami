"""
Entry point — run with:  python -m telegram_client

LEARNING (Python):
  The __main__.py file makes a package runnable with `python -m <package>`.
  asyncio.run() starts the async event loop and runs our coroutine.
"""

import asyncio
import logging

from .client import run

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)


if __name__ == "__main__":
    asyncio.run(run())
