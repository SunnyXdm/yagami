# Elixir Learning Guide — YouTube Poller Service

## Core Concepts Used

### 1. OTP Application & Supervision Tree
The backbone of Elixir apps. Our tree:
```
Application (supervisor)
├── Postgrex (DB connection pool)
├── NatsClient (GenServer)
├── LikesWorker (GenServer)
├── SubsWorker (GenServer)
└── HistoryWorker (GenServer)
```

**Why it matters**: If any worker crashes, the supervisor restarts just that process.
No data corruption, no manual intervention. This is Erlang/Elixir's killer feature.

### 2. GenServer (Generic Server)
A process that holds state and responds to messages:
```elixir
# Define a GenServer
defmodule Counter do
  use GenServer

  # Client API (called by other code)
  def increment(pid), do: GenServer.cast(pid, :increment)
  def get(pid), do: GenServer.call(pid, :get)

  # Server callbacks (run inside the process)
  def init(_), do: {:ok, 0}
  def handle_cast(:increment, count), do: {:noreply, count + 1}
  def handle_call(:get, _from, count), do: {:reply, count, count}
end
```

**call** = synchronous (waits for reply)
**cast** = async (fire and forget)
**handle_info** = handles raw messages (like our :poll timer)

### 3. Pattern Matching
Elixir's most powerful feature. Instead of `if x.type == "video"`:
```elixir
# Match in function heads
def process(%{type: "video"} = item), do: handle_video(item)
def process(%{type: "channel"} = item), do: handle_channel(item)
def process(_), do: :ignored

# Match in case expressions
case Req.get(url) do
  {:ok, %{status: 200, body: body}} -> process(body)
  {:ok, %{status: 404}} -> :not_found
  {:error, reason} -> {:error, reason}
end
```

### 4. Pipe Operator `|>`
Transforms nested calls into readable chains:
```elixir
# Without pipes (read inside-out):
Enum.join(Enum.map(Enum.filter(list, &valid?/1), &transform/1), ", ")

# With pipes (read top-to-bottom):
list
|> Enum.filter(&valid?/1)
|> Enum.map(&transform/1)
|> Enum.join(", ")
```

### 5. `with` Expression
Chain pattern matches, short-circuiting on failure:
```elixir
with {:ok, token} <- get_token(),
     {:ok, data} <- fetch_data(token),
     {:ok, result} <- process(data) do
  {:ok, result}
else
  {:error, :no_token} -> handle_no_token()
  {:error, reason} -> handle_error(reason)
end
```

All workers use this pattern to chain token retrieval → API call →
processing. If any step fails, the `else` block handles the error and
a debug message is sent to the admin via NATS (`publish_debug/1`).

### 6. Immutability
All data is immutable. "Updating" creates a new copy:
```elixir
map = %{name: "Alice", age: 30}
updated = %{map | age: 31}  # New map! Original unchanged.
```

### 7. Processes & Message Passing
Every GenServer is a separate process with its own memory:
```elixir
# Process.send_after is how we build timers
Process.send_after(self(), :tick, 5000)  # Send :tick to myself in 5 seconds

# handle_info receives it
def handle_info(:tick, state) do
  do_work()
  Process.send_after(self(), :tick, 5000)  # Schedule next
  {:noreply, state}
end
```

## Key Patterns in This Service

### Timer-Based Polling Pattern
All three workers follow the same pattern:
1. `init/1` — Schedule first `:poll` message
2. `handle_info(:poll, state)` — Do work, schedule next `:poll`
3. Idempotent: diff current state vs DB, only process new items

### DB Diffing for Idempotency
```elixir
known_ids = DB.get_known_like_ids()  # MapSet from DB
current = YoutubeApi.list_liked_videos(token)  # Fresh from API
new = Enum.reject(current, fn v -> MapSet.member?(known_ids, v.video_id) end)
```

### System.cmd for External Programs
```elixir
# Like subprocess.run() in Python
{output, exit_code} = System.cmd("yt-dlp", ["--flat-playlist", "-j", url])
```

### Tagged Tuple Error Handling
API functions return `{:ok, data}` or `{:error, reason}` — never partial
results. `fetch_all_pages` used to silently return whatever it had
accumulated when a page request failed, causing the subscription worker
to see incomplete lists and report false unsubscriptions. Now it returns
`{:error, reason}` on any failure so callers can skip the cycle.

### Debug Messaging via NATS
Workers publish admin-facing debug messages to `system.health`:
```elixir
NatsClient.publish_debug("⚠️ History scrape failed: #{reason}")
```
The telegram-client forwards these to the admin's DM. This replaces
staring at logs.

### Threshold Protection (Subscriptions)
If a single poll cycle detects >10 subscription changes, it's almost
certainly caused by an API pagination hiccup — not real activity. The
worker skips the cycle and notifies the admin instead of spamming the
channel.

## Common Gotchas

1. **Atoms are not garbage collected** — Never convert user input to atoms
2. **Strings are binaries** — `"hello"` is a binary, `'hello'` is a charlist (different!)
3. **No loops** — Use recursion or Enum functions instead of for/while
4. **No nil checks** — Use pattern matching: `case x do nil -> ... _ -> ... end`
5. **Process mailbox overflow** — If handle_info is slow and messages pile up, bad things happen

## Running Locally

```bash
cd services/youtube-poller
mix deps.get          # Install dependencies
mix compile           # Compile (catches errors early)
iex -S mix            # Start interactive shell with the app running
```

In IEx (interactive shell):
```elixir
# Check if processes are alive
Process.whereis(YoutubePoller.LikesWorker)
Process.whereis(YoutubePoller.DB)

# Manually trigger a poll
send(YoutubePoller.LikesWorker, :poll)

# Test a function
YoutubePoller.YoutubeApi.parse_duration("PT1H23M45S")
```

## Testing Guide

```elixir
# test/youtube_api_test.exs
defmodule YoutubePoller.YoutubeApiTest do
  use ExUnit.Case

  test "parse_duration handles hours" do
    assert YoutubePoller.YoutubeApi.parse_duration("PT1H2M3S") == "1:02:03"
  end

  test "parse_duration handles minutes only" do
    assert YoutubePoller.YoutubeApi.parse_duration("PT5M30S") == "5:30"
  end

  test "parse_duration handles nil" do
    assert YoutubePoller.YoutubeApi.parse_duration(nil) == "unknown"
  end
end
```

Run with: `mix test`
