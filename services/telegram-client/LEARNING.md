# Telegram Client — Python + Telethon Learning Guide

## What This Service Does

The Telegram client is the final delivery layer.

It:

- consumes NATS activity and download events
- sends messages to the right Telegram destinations
- accepts admin DM YouTube links and turns them into download requests
- uploads completed videos
- splits oversized uploads into parts
- publishes live upload progress back into NATS

## Current Login Model

This service has two modes:

### Bot mode (preferred)

Bot mode is the normal path and is enough for normal delivery.

It still uses Telethon and Telegram MTProto internally, but the operator only needs a bot token plus the destination chat IDs.

### User-account mode (optional advanced)

User mode uses:

- `telegram.api_id`
- `telegram.api_hash`
- `telegram.session_string`

This is for advanced cases only. It is not required for routine posting, and it does not fix YouTube-side limitations.

Study:

- `telegram_client/client.py`
- `telegram_client/config.py`

## Python Concepts Worth Studying

### 1. `asyncio` is the baseline, not an extra

Everything important here is async: Telethon, NATS, and most control flow.

When the code does `await tg.send_message(...)`, other work can continue while Telegram is handling the request.

Study:

- `telegram_client/client.py`
- `telegram_client/handlers.py`

### 2. Closures are used to bind NATS routes safely

The route handler factory in `client.py` closes over `subject` and `chat_id` so each NATS subscription keeps the correct destination.

Without that pattern, all callbacks would accidentally share the last loop value.

Study:

- `telegram_client/client.py`

### 3. Pure formatting code stays separate from side effects

`formatter.py` holds message-shaping functions only. That is why formatting tests stay fast and easy.

Study:

- `telegram_client/formatter.py`
- `tests/test_formatter.py`

### 4. Admin commands and free-form DM parsing live in Telethon event handlers

The admin can DM the bot commands such as `/status`, or just paste a YouTube link. The link path publishes `download.request` and the finished upload can be routed back to that admin chat.

Study:

- `telegram_client/client.py`

### 5. Pillow is used for thumbnail preparation, not generic image effects

`prepare_thumbnail()` downloads the source thumbnail, optionally crops it to the video's aspect ratio, and keeps it high quality so Telegram renders a better preview card.

Study:

- `telegram_client/handlers.py`

### 6. `ffprobe` plus `ffmpeg -c copy` make large uploads practical

This service does not re-encode for normal splitting. It probes the source, computes parts, and stream-copies them into uploadable chunks.

That keeps splitting fast and preserves quality.

Study:

- `telegram_client/handlers.py`

### 7. Telethon progress callbacks become live product telemetry

The upload path attaches a `progress_callback`, converts it into `download.upload_progress`, and sends that event back through NATS. The Downloads page uses those live events to render progress bars and part counters.

Study:

- `telegram_client/handlers.py`
- `services/frontend/src/pages/Downloads.tsx`

### 8. Type hints matter even though Python will not enforce them at runtime

The type hints here are mostly for maintainability and editor help. They are especially useful in a service that mixes Telethon objects, NATS payloads, subprocess calls, and DB access.

## File Map

```text
telegram_client/client.py        Telethon startup, NATS routing, admin commands
telegram_client/config.py        DB-backed runtime config model
telegram_client/formatter.py     pure message/caption formatting
telegram_client/handlers.py      upload logic, splitting, progress, thumbnails
telegram_client/observability.py logs and heartbeats
tests/test_formatter.py          format regression coverage
tests/test_handlers.py           split/upload/thumbnail behavior coverage
tests/test_client.py             client routing coverage
```

## Current Behavior To Keep In Mind

- `youtube.watch`, `youtube.likes`, `youtube.subscribe`, and `youtube.unsubscribe` become Telegram messages.
- `download.complete` becomes either a Telegram upload or a failure message.
- Uploads above the service threshold are split into roughly 1.95 GB parts.
- Live upload progress is published back to the rest of the system.
- Bot mode is enough for normal installs.

## Common Gotchas

1. Telethon exceptions inside callbacks are easy to lose if you do not log them explicitly.
2. The session string in user-account mode is effectively a password.
3. Pillow-backed tests need Pillow installed locally.
4. `ffprobe` and `ffmpeg` failures must be treated as runtime conditions, not impossible states.

## Run And Verify

```bash
cd services/telegram-client
python -m pytest tests/ -q
```

Useful focused runs:

```bash
python -m pytest tests/test_formatter.py -q
python -m pytest tests/test_handlers.py -q -k 'handle_event or handle_download_complete or split_video'
python -m pytest tests/test_client.py tests/test_handlers.py -q -k 'not CropToRatio'
```

## Resources

- [Telethon docs](https://docs.telethon.dev/en/stable/)
- [nats-py docs](https://nats-io.github.io/nats.py/)
- [Real Python: async IO](https://realpython.com/async-io-python/)
- [Python dataclasses](https://docs.python.org/3/library/dataclasses.html)
