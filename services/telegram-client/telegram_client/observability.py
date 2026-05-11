"""NATS-based logging + heartbeat for the telegram-client service."""

import asyncio
import json
import logging
from datetime import datetime, timezone

SERVICE = "telegram-client"


class NatsLogHandler(logging.Handler):
    """Forwards every log record to NATS at logs.telegram-client."""

    def __init__(self, nc, level=logging.INFO):
        super().__init__(level)
        self.nc = nc
        self._loop = asyncio.get_event_loop()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            payload = json.dumps({
                "ts": datetime.now(timezone.utc).isoformat(),
                "service": SERVICE,
                "level": record.levelname.lower(),
                "message": self.format(record),
                "fields": {"logger": record.name},
            }).encode()
            asyncio.run_coroutine_threadsafe(
                self.nc.publish("logs.telegram-client", payload),
                self._loop,
            )
        except Exception:
            pass


def install_log_handler(nc) -> None:
    handler = NatsLogHandler(nc)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logging.getLogger().addHandler(handler)


async def run_heartbeat(nc) -> None:
    while True:
        try:
            payload = json.dumps({
                "service": SERVICE,
                "status": "ok",
                "version": "1.0.0",
                "ts": datetime.now(timezone.utc).isoformat(),
            }).encode()
            await nc.publish("system.heartbeat", payload)
        except Exception:
            pass
        await asyncio.sleep(30)
