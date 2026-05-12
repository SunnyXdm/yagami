# Elixir Learning Guide — YouTube Poller Service

## What This Service Does

The YouTube poller is the ingestion side of Yagami.

It:

- polls liked videos through the YouTube Data API
- scrapes private watch history with `yt-dlp`
- monitors subscriptions with protective guards for broken large-account snapshots
- refreshes cookies onto disk for `yt-dlp`
- refreshes OAuth state and reports degradation
- publishes activity, debug messages, heartbeats, and download requests

## Current Supervision Tree

```text
YoutubePoller.Application
├── Postgrex
├── YoutubePoller.Settings
├── YoutubePoller.NatsClient
├── YoutubePoller.CookiesSync
├── YoutubePoller.Heartbeat
├── YoutubePoller.LikesWorker
├── YoutubePoller.HistoryWorker
└── YoutubePoller.SubsWorker
```

That tree is important: each worker is isolated, restartable, and independently schedulable.

Study:

- `lib/youtube_poller/application.ex`

## Elixir Concepts Worth Studying

### 1. GenServer timers are the backbone of the workers

Each worker schedules a `:poll` message to itself and reschedules after handling it.

That is the main recurring-job pattern in this service.

Study:

- `lib/youtube_poller/likes_worker.ex`
- `lib/youtube_poller/history_worker.ex`
- `lib/youtube_poller/subs_worker.ex`

### 2. ETS gives the service a fast in-memory settings cache

The poller keeps runtime settings in ETS and refreshes them periodically, instead of hitting Postgres for every poll loop.

Study:

- `lib/youtube_poller/settings.ex`

### 3. `with` chains make the success path readable

The service uses tagged tuples like `{:ok, data}` and `{:error, reason}` heavily. `with` lets it express token fetch → API call → processing as one readable flow.

Study:

- `lib/youtube_poller/likes_worker.ex`
- `lib/youtube_poller/subs_worker.ex`
- `lib/youtube_poller/youtube_api.ex`

### 4. Seeding plus diffing makes polling idempotent

On first successful load, the workers seed their known tables silently. On later runs they diff the fresh snapshot against the stored known set and only emit genuinely new items.

Study:

- `lib/youtube_poller/likes_worker.ex`
- `lib/youtube_poller/history_worker.ex`
- `lib/youtube_poller/db.ex`

### 5. External programs still fit naturally inside an OTP app

Watch history is not available through the YouTube Data API, so the poller shells out to `yt-dlp` with `System.cmd/3` and parses newline-delimited JSON.

Study:

- `lib/youtube_poller/ytdlp.ex`
- `test/ytdlp_test.exs`

### 6. Heartbeats and debug messages are first-class product behavior

The poller publishes:

- `system.heartbeat` for dashboard liveness
- `system.health` for operator-facing debug or warning messages

That means the service can explain itself in the UI and Telegram without requiring container log spelunking for every incident.

Study:

- `lib/youtube_poller/heartbeat.ex`
- `lib/youtube_poller/nats_client.ex`

### 7. Quota backoff is built into the likes worker

When YouTube returns `quotaExceeded`, the worker does not hammer the API. It backs off from 15 minutes up to 4 hours and alerts the admin once per incident.

Study:

- `lib/youtube_poller/likes_worker.ex`

### 8. Subscription monitoring has an upstream constraint, not just an app bug

For very large accounts, `subscriptions.list` can return partial or duplicate-filled snapshots near the 1000-item ceiling. The subscriptions worker now guards against that by pausing unsubscribe diffing and treating recent subscribe detection as best-effort only.

That limitation is caused by the upstream API shape, not by a missing Elixir abstraction.

Study:

- `lib/youtube_poller/subs_worker.ex`

## File Map

```text
lib/youtube_poller/application.ex     supervision tree
lib/youtube_poller/settings.ex        ETS-backed runtime settings cache
lib/youtube_poller/cookies_sync.ex    writes youtube.cookies to disk
lib/youtube_poller/heartbeat.ex       dashboard heartbeat publishing
lib/youtube_poller/likes_worker.ex    likes polling and quota backoff
lib/youtube_poller/history_worker.ex  watch-history scraping and seeding
lib/youtube_poller/subs_worker.ex     subscription monitoring and safeguards
lib/youtube_poller/youtube_api.ex     YouTube Data API paging and parsing
lib/youtube_poller/ytdlp.ex           watch-history subprocess wrapper
lib/youtube_poller/db.ex              Postgres access and known-set helpers
```

## Current Gotchas

1. Atoms are not garbage collected. Do not build them from user input.
2. `"hello"` is a binary string, `'hello'` is a charlist.
3. Slow `handle_info/2` callbacks can back up the mailbox.
4. Not every upstream snapshot is trustworthy; sometimes the correct behavior is to refuse to diff.
5. The poller is only as good as the cookies and OAuth state it currently has.

## Run And Verify

```bash
cd services/youtube-poller
mix deps.get
mix compile
mix test
```

Useful interactive checks:

```elixir
iex -S mix

Process.whereis(YoutubePoller.LikesWorker)
Process.whereis(YoutubePoller.HistoryWorker)
send(YoutubePoller.LikesWorker, :poll)
YoutubePoller.YoutubeApi.parse_duration("PT1H23M45S")
```

## Resources

- [Elixir Getting Started](https://elixir-lang.org/getting-started/introduction.html)
- [GenServer docs](https://hexdocs.pm/elixir/GenServer.html)
- [Supervision docs](https://hexdocs.pm/elixir/Supervisor.html)
- [Req docs](https://hexdocs.pm/req/readme.html)
