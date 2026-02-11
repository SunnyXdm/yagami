# Telegram Client — Python + Telethon  (LEARNING GUIDE)

## Key Concepts Demonstrated

### 1. asyncio (async/await)
Everything in this service is async. Telethon and nats-py are both
async-native libraries. When you write `await tg.send_message(...)`,
Python surrenders control to the event loop so other work (like
processing the next NATS message) can proceed while we wait for
Telegram's server to respond.

**Study**: `client.py` — the entire file is one async function.

### 2. Closures & Factory Functions
In `client.py`, `make_handler()` creates a callback function that
"closes over" the `subject` and `chat_id` variables. Without this
pattern, every callback would share the same variable reference
(the last value from the loop). This is the *exact same* gotcha
as JavaScript's `var` in a `for` loop.

**Study**: `client.py` — the `make_handler` function and comments.

### 3. Dataclasses
`config.py` uses `@dataclass(frozen=True)` to create an immutable
configuration object. Python dataclasses are like TypeScript interfaces
with auto-generated `__init__`, `__repr__`, and `__eq__`.

**Study**: `config.py`

### 4. Type Hints
Every function has type annotations (`def func(x: int) -> str`).
Python **does not enforce these at runtime** — they're documentation
for humans and editors. Using them consistently catches bugs early.

### 5. Pure Functions
`formatter.py` contains only pure functions (input → output, no
side effects). This makes them trivially testable with `pytest`.

### 6. Telethon Event Handlers
`events.NewMessage` lets you react to incoming messages. We use it to
detect when the admin sends a YouTube link via DM:
```python
@tg.on(events.NewMessage(from_users=[admin_id]))
async def on_admin_message(event):
    match = YOUTUBE_RE.search(event.raw_text)
    if match:
        video_id = match.group("id")
        await event.reply(f"⏳ Downloading {video_id}...")
        # publish download request via NATS
```

**Study**: `client.py` — the `@tg.on(events.NewMessage(...))` handler.

### 7. Pillow for Image Processing
Telegram thumbnails must be ≤320px on each side. We use Pillow's
`Image.LANCZOS` resampling (highest quality) to resize downloaded
thumbnails before uploading:
```python
from PIL import Image
img = Image.open(path)
img.thumbnail((320, 320), Image.LANCZOS)
img.save(out, "JPEG", quality=95)
```

**Study**: `handlers.py` — `prepare_thumbnail()`.

### 8. ffmpeg for Video Splitting
Telegram limits uploads to ~2 GB. We use `ffprobe` to read the duration,
calculate how many parts are needed, then use `ffmpeg -c copy` (no
re-encoding, instant) to split by time:
```python
subprocess.run(["ffmpeg", "-ss", start, "-to", end,
                "-i", path, "-c", "copy", part_path])
```

**Study**: `handlers.py` — `split_video()`.

### 9. Regex for URL Parsing
A compiled regex extracts YouTube video IDs from several URL formats
(watch, youtu.be, shorts):
```python
YOUTUBE_RE = re.compile(
    r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|shorts/))(?P<id>[\w-]{11})"
)
```

**Study**: `client.py` — `YOUTUBE_RE` and how it's used in the handler.

---

## Common Gotchas

- **Telethon first-run auth**: On first start, Telethon asks for your
  phone number in the terminal. Use `scripts/gen-session.py` to generate
  a session string, then set it as `TELEGRAM_SESSION_STRING` in `.env`.
- **Session string security**: The session string IS your Telegram login.
  Treat it like a password. Never commit it to git.
- **NATS callback errors**: If a callback raises an exception, nats-py
  silently swallows it. That's why we wrap everything in `try/except`
  and log the error explicitly.

---

## How to Test

```bash
# Install deps
pip install -r requirements.txt pytest

# Run formatter tests (pure functions — easy to test)
pytest tests/

# Manual: publish a test NATS message
python -c "
import nats, asyncio, json

async def test():
    nc = await nats.connect('nats://localhost:4222')
    await nc.publish('youtube.watch', json.dumps({
        'video_id': 'test123',
        'title': 'Test Video',
        'channel_title': 'Test Channel',
        'duration_seconds': 300,
    }).encode())
    await nc.close()

asyncio.run(test())
"
```

## Resources

- [Telethon docs](https://docs.telethon.dev/en/stable/)
- [nats-py docs](https://nats-io.github.io/nats.py/)
- [Real Python: async/await](https://realpython.com/async-io-python/)
- [Python dataclasses](https://docs.python.org/3/library/dataclasses.html)
